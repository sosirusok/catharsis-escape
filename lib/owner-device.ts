import { getD1, sha256 } from "@/lib/booking";

export type OwnerDeviceIdentity = { id: string };

export async function authorizeOwnerDevice(request: Request): Promise<OwnerDeviceIdentity | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+([A-Za-z0-9_-]{40,80})$/)?.[1];
  if (!token) return null;
  const digest = await sha256(token);
  const db = getD1();
  const device = await db.prepare("SELECT id FROM owner_devices WHERE token_hash = ? AND active = 1 LIMIT 1")
    .bind(digest).first<OwnerDeviceIdentity>();
  if (!device) return null;
  await db.prepare("UPDATE owner_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(device.id).run();
  return device;
}
