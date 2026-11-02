/**
 * Academic rules are fixed settings decided by the institution — never inferred by AI.
 */
export const RULES = {
  /** University minimum attendance to sit the end-semester exam. */
  attendanceThreshold: 75,
  /** Faculty may correct attendance for this long after a class; after that only office admin. */
  facultyEditWindowHours: 48,
  /** Internal assessment total (university scheme). */
  internalMax: 40,
  /** Pass mark for internal assessment, used only for risk signals. */
  internalPassPercent: 40,
  /** Minimum attendance sessions / mark components before the risk model will judge a student. */
  riskMinSessions: 20,
  riskMinComponents: 1,
} as const;

export const ACADEMIC_YEAR = "2026-27";

/** Period bell times (assumption: 7 × 50-minute periods, Mon–Sat). */
export const PERIODS: Record<number, { start: string; end: string }> = {
  1: { start: "09:00", end: "09:50" },
  2: { start: "09:50", end: "10:40" },
  3: { start: "10:55", end: "11:45" },
  4: { start: "11:45", end: "12:35" },
  5: { start: "13:30", end: "14:20" },
  6: { start: "14:20", end: "15:10" },
  7: { start: "15:10", end: "16:00" },
};
