export type DailyTimedSlot = {
  startMinute: number;
  durationMin: number;
};

export type WeeklyTimedSlot = DailyTimedSlot & {
  weekday: number;
};

export type ScheduleOverlap<T> = {
  first: T;
  second: T;
};

const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export function slotsOverlap(first: DailyTimedSlot, second: DailyTimedSlot, turnoverMin: number): boolean {
  const firstEnd = first.startMinute + first.durationMin + turnoverMin;
  const secondEnd = second.startMinute + second.durationMin + turnoverMin;
  return first.startMinute < secondEnd && second.startMinute < firstEnd;
}

export function findDailyOverlap<T extends DailyTimedSlot>(slots: T[], turnoverMin: number): ScheduleOverlap<T> | null {
  const sorted = [...slots].sort((left, right) => left.startMinute - right.startMinute);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (slotsOverlap(sorted[index], sorted[index + 1], turnoverMin)) {
      return { first: sorted[index], second: sorted[index + 1] };
    }
  }
  return null;
}

export function findWeeklyOverlap<T extends WeeklyTimedSlot>(slots: T[], turnoverMin: number): ScheduleOverlap<T> | null {
  if (slots.length < 2) return null;
  const sorted = [...slots]
    .map((slot) => ({ slot, absoluteStart: slot.weekday * MINUTES_PER_DAY + slot.startMinute }))
    .sort((left, right) => left.absoluteStart - right.absoluteStart);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = index + 1 < sorted.length
      ? sorted[index + 1]
      : { slot: sorted[0].slot, absoluteStart: sorted[0].absoluteStart + MINUTES_PER_WEEK };
    if (current.absoluteStart + current.slot.durationMin + turnoverMin > next.absoluteStart) {
      return { first: current.slot, second: next.slot };
    }
  }
  return null;
}
