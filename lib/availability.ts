import {
  addDays,
  getD1,
  getSettings,
  getThemes,
  kstDateKey,
  minuteToTime,
  startAtUtcMs,
  weekdayKst,
} from "@/lib/booking";
import { expirePaymentHolds } from "@/lib/payment-flow";
import { slotsOverlap } from "@/lib/scheduling";

import type { PublicDateAvailability, PublicSlot } from "@/lib/models";
export type { PublicDateAvailability, PublicSlot } from "@/lib/models";

type RuleRow = { weekday: number; start_minute: number };
type OverrideRow = { service_date: string; start_minute: number; action: string; duration_min: number | null };
type ClosureRow = { scope: string; theme_id: string | null; start_date: string; end_date: string; public_message: string };
type ReservationRow = { slot_id: string; service_date: string; start_minute: number; duration_min: number; payment_status: string };

export function slotId(themeId: string, date: string, startMinute: number) {
  return `slot_${themeId}_${date.replaceAll("-", "")}_${startMinute}`;
}

export async function buildAvailability(themeId: string, days?: number) {
  const db = getD1();
  await expirePaymentHolds();
  const [settings, themes] = await Promise.all([getSettings(db), getThemes("active", db)]);
  const theme = themes.find((item) => item.id === themeId);
  if (!theme) return null;

  const rangeDays = Math.max(1, Math.min(days ?? settings.horizonDays, settings.horizonDays, 31));
  const from = kstDateKey();
  const to = addDays(from, rangeDays - 1);
  const now = Date.now();
  const cutoffMs = now + settings.leadMinutes * 60_000;

  const [rulesResult, overrideResult, closureResult, reservationResult] = await Promise.all([
    db.prepare("SELECT weekday, start_minute FROM schedule_rules WHERE theme_id = ? ORDER BY weekday, start_minute").bind(themeId).all<RuleRow>(),
    db.prepare("SELECT service_date, start_minute, action, duration_min FROM slot_overrides WHERE theme_id = ? AND service_date BETWEEN ? AND ? ORDER BY service_date, start_minute").bind(themeId, from, to).all<OverrideRow>(),
    db.prepare("SELECT scope, theme_id, start_date, end_date, public_message FROM closures WHERE start_date <= ? AND end_date >= ? AND (scope = 'store' OR theme_id = ?)").bind(to, from, themeId).all<ClosureRow>(),
    db.prepare("SELECT slot_id, service_date, start_minute, duration_min, payment_status FROM reservations WHERE theme_id = ? AND service_date BETWEEN ? AND ? AND status IN ('confirmed','checked_in')").bind(themeId, from, to).all<ReservationRow>(),
  ]);

  const rules = rulesResult.results;
  const overrideMap = new Map(overrideResult.results.map((item) => [`${item.service_date}:${item.start_minute}`, item]));
  const dates: PublicDateAvailability[] = [];

  for (let offset = 0; offset < rangeDays; offset += 1) {
    const date = addDays(from, offset);
    const closure = closureResult.results.find((item) => item.start_date <= date && item.end_date >= date);
    const minutes = new Set(rules.filter((rule) => rule.weekday === weekdayKst(date)).map((rule) => rule.start_minute));
    for (const override of overrideResult.results.filter((item) => item.service_date === date)) {
      if (override.action === "add") minutes.add(override.start_minute);
      else minutes.add(override.start_minute);
    }

    const slots = [...minutes].sort((a, b) => a - b).map((startMinute) => {
      const override = overrideMap.get(`${date}:${startMinute}`);
      const id = slotId(themeId, date, startMinute);
      const durationMin = override?.duration_min || theme.durationMin;
      const startMs = startAtUtcMs(date, startMinute);
      const blocked = override?.action === "block";
      const occupied = reservationResult.results.find((reservation) => reservation.service_date === date && slotsOverlap(
        { startMinute, durationMin },
        { startMinute: reservation.start_minute, durationMin: reservation.duration_min },
        theme.turnoverMin,
      ));
      return {
        id,
        time: minuteToTime(startMinute),
        startMinute,
        durationMin,
        status: closure || blocked ? "blocked" : occupied ? (["ready", "confirming", "review_required"].includes(occupied.payment_status) ? "held" : "booked") : startMs <= cutoffMs || !settings.bookingOpen ? "closed" : "available",
      } satisfies PublicSlot;
    });
    dates.push({ date, closed: Boolean(closure), closureMessage: closure?.public_message || "", slots });
  }

  return {
    timezone: settings.timezone,
    serverNow: new Date(now).toISOString(),
    bookingOpen: settings.bookingOpen,
    pausedMessage: settings.pausedMessage,
    consentVersion: settings.consentVersion,
    theme,
    dates,
  };
}
