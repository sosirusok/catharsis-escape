export type ThemeRecord = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  genre: string;
  synopsis: string;
  artKey: string;
  imageKey: string | null;
  difficulty: number;
  difficultyLabel: string;
  durationMin: number;
  turnoverMin: number;
  minPeople: number;
  maxPeople: number;
  notice: string;
  prices: Record<string, number>;
  status: "active" | "hidden" | "archived";
  displayOrder: number;
};

export type BookingSettingsRecord = {
  timezone: string;
  horizonDays: number;
  leadMinutes: number;
  cancelCutoffMinutes: number;
  consentVersion: string;
  bookingOpen: boolean;
  pausedMessage: string;
  storePhone: string;
};

export const DEFAULT_SETTINGS: BookingSettingsRecord = {
  timezone: "Asia/Seoul", horizonDays: 21, leadMinutes: 60, cancelCutoffMinutes: 1440,
  consentVersion: "2026-08-13", bookingOpen: true,
  pausedMessage: "현재 예약 접수가 잠시 중단되었습니다.", storePhone: "051-802-3341",
};

export const DEFAULT_THEMES: ThemeRecord[] = [
  { id: "life", slug: "life-theme", name: "당신의 인생테마를 찾아드립니다", shortName: "인생테마", genre: "감성 · 스릴러", synopsis: "당신의 기억 속 인생 테마를 재현해 드립니다. 단 한 편을 찾는 특별한 상담이 시작됩니다.", artKey: "life", imageKey: null, difficulty: 3, difficultyLabel: "", durationMin: 60, turnoverMin: 30, minPeople: 2, maxPeople: 5, notice: "미성년자 비권장", prices: { "2": 44000, "3": 60000, "4": 72000, "5": 90000 }, status: "active", displayOrder: 1 },
  { id: "office", slug: "office-day", name: "왠지 출근하기 싫은날", shortName: "출근하기 싫은날", genre: "일상 · 코믹", synopsis: "하… 출근하기 싫다. 익숙한 사무실에서 시작되는, 익숙하지 않은 하루. 유쾌하지만 만만하지 않습니다.", artKey: "office", imageKey: null, difficulty: 4, difficultyLabel: "", durationMin: 60, turnoverMin: 30, minPeople: 2, maxPeople: 5, notice: "", prices: { "2": 44000, "3": 60000, "4": 72000, "5": 90000 }, status: "active", displayOrder: 2 },
  { id: "knock", slug: "knock-knock", name: "똑똑! 계시나요?", shortName: "똑똑! 계시나요?", genre: "범죄 · 잠입", synopsis: "여기가 그 집 맞아? 그래, 맞다니까. 문이 열리면 계획대로 움직이세요.", artKey: "knock", imageKey: null, difficulty: 4, difficultyLabel: "문제 중심", durationMin: 60, turnoverMin: 30, minPeople: 2, maxPeople: 5, notice: "", prices: { "2": 44000, "3": 60000, "4": 72000, "5": 90000 }, status: "active", displayOrder: 3 },
];

export type PublicSlot = { id: string; time: string; startMinute: number; durationMin: number; status: "available" | "held" | "booked" | "closed" | "blocked" };
export type PublicDateAvailability = { date: string; closed: boolean; closureMessage: string; slots: PublicSlot[] };
