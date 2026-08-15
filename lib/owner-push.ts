import { createId, decryptPrivate, getD1 } from "@/lib/booking";
import { FirebaseDeliveryError, firebaseIsConfigured, sendFirebaseAlert } from "@/lib/firebase";

type PushDeliveryRow = {
  id: number;
  alertId: number;
  kind: string;
  deviceId: string;
  installationIdEnc: string | null;
  attempts: number;
  leaseToken: string;
  active: number;
};

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 90_000;

function boundedMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
}

function nextRetryAt(attempts: number, providerDelayMs: number): number {
  const exponential = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(7, Math.max(0, attempts - 1))));
  const jitter = Math.floor(Math.random() * 15_000);
  return Date.now() + Math.max(providerDelayMs, exponential) + jitter;
}

async function claimDelivery(id: number, now: number): Promise<PushDeliveryRow | null> {
  const db = getD1();
  const leaseToken = createId("pushlease");
  const claim = await db.prepare(
    `UPDATE owner_push_deliveries
     SET status = 'sending', attempts = attempts + 1, lease_token = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND ((status IN ('pending','retry') AND next_attempt_at <= ?)
         OR (status = 'sending' AND COALESCE(lease_until, 0) <= ?))`,
  ).bind(leaseToken, now + LEASE_MS, id, now, now).run();
  if (Number(claim.meta.changes || 0) !== 1) return null;
  return db.prepare(
    `SELECT p.id, p.alert_id alertId, a.type kind, p.device_id deviceId,
            d.fcm_fid_enc installationIdEnc, p.attempts, p.lease_token leaseToken, d.active
     FROM owner_push_deliveries p
     JOIN owner_alerts a ON a.id = p.alert_id
     JOIN owner_devices d ON d.id = p.device_id
     WHERE p.id = ? AND p.lease_token = ? AND p.status = 'sending'`,
  ).bind(id, leaseToken).first<PushDeliveryRow>();
}

async function completeDelivery(row: PushDeliveryRow, providerMessageId: string): Promise<void> {
  await getD1().prepare(
    `UPDATE owner_push_deliveries
     SET status = 'sent', provider_message_id = ?, lease_token = NULL, lease_until = NULL,
         last_error_code = '', last_error_message = '', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'sending' AND lease_token = ?`,
  ).bind(providerMessageId.slice(0, 240), row.id, row.leaseToken).run();
}

async function abandonDelivery(row: PushDeliveryRow): Promise<void> {
  await getD1().prepare(
    `UPDATE owner_push_deliveries
     SET status = 'dead', lease_token = NULL, lease_until = NULL,
         last_error_code = 'DEVICE_INACTIVE', last_error_message = '', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'sending' AND lease_token = ?`,
  ).bind(row.id, row.leaseToken).run();
}

async function failDelivery(row: PushDeliveryRow, error: unknown): Promise<void> {
  const db = getD1();
  const firebaseError = error instanceof FirebaseDeliveryError ? error : null;
  const code = firebaseError?.code || "FCM_UNEXPECTED";
  const message = boundedMessage(firebaseError?.message || "Firebase 알림 발송에 실패했습니다.");
  if (firebaseError?.invalidInstallation) {
    await db.batch([
      db.prepare(
        `UPDATE owner_devices
         SET fcm_fid_enc = NULL, fcm_fid_hash = NULL, fcm_fid_updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND fcm_fid_enc = ?`,
      ).bind(row.deviceId, row.installationIdEnc),
      db.prepare(
        `UPDATE owner_push_deliveries
         SET status = 'dead', lease_token = NULL, lease_until = NULL,
             last_error_code = ?, last_error_message = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'sending' AND lease_token = ?`,
      ).bind(code, message, row.id, row.leaseToken),
    ]);
    return;
  }

  const providerDelay = firebaseError?.retryAfterMs || (firebaseError?.retryable ? 0 : 6 * 60 * 60 * 1000);
  await db.prepare(
    `UPDATE owner_push_deliveries
     SET status = 'retry', next_attempt_at = ?, lease_token = NULL, lease_until = NULL,
         last_error_code = ?, last_error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'sending' AND lease_token = ?`,
  ).bind(nextRetryAt(row.attempts, providerDelay), code, message, row.id, row.leaseToken).run();
}

async function expireOldDeliveries(): Promise<void> {
  const cutoff = new Date(Date.now() - DELIVERY_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
  await getD1().prepare(
    `UPDATE owner_push_deliveries
     SET status = 'dead', lease_token = NULL, lease_until = NULL,
         last_error_code = 'DELIVERY_EXPIRED', last_error_message = '', updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('pending','retry','sending')
       AND alert_id IN (SELECT id FROM owner_alerts WHERE created_at < ?)`,
  ).bind(cutoff).run();
}

export async function dispatchOwnerPushes(limit = 10): Promise<number> {
  if (!firebaseIsConfigured()) return 0;
  const db = getD1();
  const now = Date.now();
  await expireOldDeliveries();
  const due = await db.prepare(
    `SELECT id FROM owner_push_deliveries
     WHERE (status IN ('pending','retry') AND next_attempt_at <= ?)
        OR (status = 'sending' AND COALESCE(lease_until, 0) <= ?)
     ORDER BY id ASC LIMIT ?`,
  ).bind(now, now, Math.max(1, Math.min(25, limit))).all<{ id: number }>();

  let sent = 0;
  for (const candidate of due.results) {
    const row = await claimDelivery(candidate.id, Date.now());
    if (!row) continue;
    if (row.active !== 1 || !row.installationIdEnc) {
      await abandonDelivery(row);
      continue;
    }
    try {
      const installationId = await decryptPrivate(row.installationIdEnc);
      const providerMessageId = await sendFirebaseAlert(installationId, row.alertId, row.kind);
      await completeDelivery(row, providerMessageId);
      sent += 1;
    } catch (error) {
      await failDelivery(row, error);
    }
  }
  return sent;
}
