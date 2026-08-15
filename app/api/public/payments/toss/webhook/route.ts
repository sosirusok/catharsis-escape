import { getD1, isJsonRequest, json, readJsonBody, sha256 } from "@/lib/booking";
import { syncTossPaymentByOrderId } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

type TossWebhookBody = {
  eventType?: unknown;
  createdAt?: unknown;
  data?: unknown;
};

function paymentData(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) return json({ ok: false }, 415);
  let body: TossWebhookBody;
  try {
    body = await readJsonBody<TossWebhookBody>(request, 64_000);
  } catch (error) {
    return json({ ok: false }, error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400);
  }

  const eventType = typeof body.eventType === "string" ? body.eventType.slice(0, 80) : "";
  const createdAt = typeof body.createdAt === "string" ? body.createdAt.slice(0, 80) : "";
  const data = paymentData(body.data);
  const orderId = typeof data.orderId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(data.orderId) ? data.orderId : "";
  const providerStatus = typeof data.status === "string" ? data.status.slice(0, 40) : "";
  const canonical = JSON.stringify(body);
  const payloadHash = await sha256(canonical);
  const eventKey = await sha256(JSON.stringify([eventType, createdAt, orderId, payloadHash]));
  const db = getD1();

  // Toss webhooks are verified against the authoritative Payments API below. Drop
  // unrelated or unknown orders before persisting anything so the public endpoint
  // cannot be used to grow the deduplication table with arbitrary payloads.
  if (eventType !== "PAYMENT_STATUS_CHANGED" || !orderId) return json({ ok: true });
  const knownOrder = await db.prepare("SELECT id FROM reservations WHERE payment_order_id = ? LIMIT 1")
    .bind(orderId).first<{ id: string }>();
  if (!knownOrder) return json({ ok: true });

  await db.prepare("INSERT OR IGNORE INTO payment_webhook_events (event_key, event_type, order_id, provider_status, payload_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(eventKey, eventType, orderId, providerStatus, payloadHash).run();
  const claimed = await db.prepare("UPDATE payment_webhook_events SET status = 'processing', attempts = attempts + 1, last_error = '', updated_at = CURRENT_TIMESTAMP WHERE event_key = ? AND (status IN ('received','failed') OR (status = 'processing' AND updated_at <= datetime('now', '-2 minutes')))")
    .bind(eventKey).run();
  if (!claimed.meta.changes) return json({ ok: true });

  try {
    const reservation = await syncTossPaymentByOrderId(orderId, "webhook");
    await db.prepare("UPDATE payment_webhook_events SET status = ?, updated_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP WHERE event_key = ? AND status = 'processing'")
      .bind(reservation ? "processed" : "ignored", eventKey).run();
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_PROCESSING_FAILED";
    await db.prepare("UPDATE payment_webhook_events SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE event_key = ? AND status = 'processing'")
      .bind(message.slice(0, 240), eventKey).run();
    return json({ ok: false }, 500);
  }
}
