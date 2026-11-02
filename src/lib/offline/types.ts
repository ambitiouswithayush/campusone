/** Shapes shared by the class-pack API, the phone's IndexedDB and the sync client. */

export interface PackStudent {
  id: number;
  rollNo: string;
  name: string;
  /** Overall attendance so the teacher can see who is already short. */
  pct: number | null;
}

export interface PackClass {
  key: string; // assignmentId:date:period
  assignmentId: number;
  batchId: number;
  date: string;
  period: number;
  start: string;
  end: string;
  subjectCode: string;
  subjectName: string;
  batchLabel: string;
  /** Faculty may still submit or correct (48-hour window from the end of class). */
  editableUntil: string;
  session: { id: string; markedAt: string; takenBy: string; absentIds: number[]; total: number } | null;
}

export interface PackDay {
  date: string;
  holiday: string | null;
  classes: PackClass[];
}

export interface TimetableEntry {
  assignmentId: number;
  batchId: number;
  dayOfWeek: number;
  period: number;
  start: string;
  end: string;
  subjectCode: string;
  subjectName: string;
  batchLabel: string;
}

export interface ClassPack {
  downloadedAt: string;
  serverTime: string;
  facultyName: string;
  days: PackDay[];
  rosters: Record<number, PackStudent[]>;
  /** Lets the phone build later days' class lists if it stays offline past midnight. */
  timetable: TimetableEntry[];
  holidays: { date: string; title: string }[];
  editWindowHours: number;
}

export type OutboxStatus = "pending" | "syncing" | "conflict" | "rejected";

export interface OutboxItem {
  id: string; // session UUID
  classKey: string;
  assignmentId: number;
  date: string;
  period: number;
  markedAt: string;
  records: { studentId: number; present: boolean }[];
  offline: boolean;
  override: boolean;
  status: OutboxStatus;
  attempts: number;
  message?: string;
  server?: { id: string; markedAt: string; takenBy: string; absentStudentIds: number[] };
}
