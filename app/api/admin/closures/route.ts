import { audit, requireAdminApi } from "@/lib/admin-api";
import { createId, getD1, isDateKey, json } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = (await request.json()) as { scope?: unknown; themeId?: unknown; startDate?: unknown; endDate?: unknown; note?: unknown; publicMessage?: unknown };
    const scope = body.scope === "theme" ? "theme" : "store";
    const themeId = scope === "theme" && typeof body.themeId === "string" ? body.themeId : null;
    const startDate = isDateKey(body.startDate) ? body.startDate : "";
    const endDate = isDateKey(body.endDate) ? body.endDate : "";
    if (!startDate || !endDate || endDate < startDate || (scope === "theme" && !themeId)) return json({ ok: false, error: { message: "휴무 기간과 대상을 확인해 주세요." } }, 400);
    const db = getD1();
    const booked = scope === "store"
      ? await db.prepare("SELECT COUNT(*) count FROM reservations WHERE service_date BETWEEN ? AND ? AND status IN ('confirmed','checked_in')").bind(startDate, endDate).first<{ count: number }>()
      : await db.prepare("SELECT COUNT(*) count FROM reservations WHERE theme_id = ? AND service_date BETWEEN ? AND ? AND status IN ('confirmed','checked_in')").bind(themeId, startDate, endDate).first<{ count: number }>();
    if (Number(booked?.count || 0) > 0) return json({ ok: false, error: { code: "HAS_BOOKINGS", message: `선택한 기간에 확정 예약 ${booked?.count}건이 있습니다. 예약을 먼저 변경하거나 취소해 주세요.` } }, 409);
    const id = createId("closure");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : "";
    const publicMessage = typeof body.publicMessage === "string" ? body.publicMessage.trim().slice(0, 80) : "휴무";
    await db.prepare("INSERT INTO closures (id, scope, theme_id, start_date, end_date, note, public_message) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, scope, themeId, startDate, endDate, note, publicMessage).run();
    const collision = scope === "store"
      ? await db.prepare("SELECT COUNT(*) count FROM reservations WHERE service_date BETWEEN ? AND ? AND status IN ('confirmed','checked_in')").bind(startDate, endDate).first<{ count: number }>()
      : await db.prepare("SELECT COUNT(*) count FROM reservations WHERE theme_id = ? AND service_date BETWEEN ? AND ? AND status IN ('confirmed','checked_in')").bind(themeId, startDate, endDate).first<{ count: number }>();
    if (Number(collision?.count || 0) > 0) {
      await db.prepare("DELETE FROM closures WHERE id = ?").bind(id).run();
      return json({ ok: false, error: { code: "HAS_BOOKINGS", message: "동시에 새 예약이 접수되어 휴무를 적용하지 않았습니다. 예약 현황을 확인해 주세요." } }, 409);
    }
    await audit(db, auth.admin.email, "create", "closure", id, null, { scope, themeId, startDate, endDate, note, publicMessage });
    return json({ ok: true }, 201);
  } catch {
    return json({ ok: false, error: { message: "휴무를 등록하지 못했습니다." } }, 500);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  const id = new URL(request.url).searchParams.get("id") || "";
  const db = getD1();
  const before = await db.prepare("SELECT * FROM closures WHERE id = ?").bind(id).first();
  if (!before) return json({ ok: false, error: { message: "휴무를 찾을 수 없습니다." } }, 404);
  await db.prepare("DELETE FROM closures WHERE id = ?").bind(id).run();
  await audit(db, auth.admin.email, "delete", "closure", id, before, null);
  return json({ ok: true });
}
