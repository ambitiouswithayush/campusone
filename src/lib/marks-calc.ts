import { RULES } from "./config";
import type { Role } from "./session";

export type SheetStatus = "draft" | "submitted" | "locked";

export interface MarkEntry {
  studentId: number;
  componentId: number;
  score: number | null;
  absent: boolean;
}

/** Faculty edit their draft; the exam cell edits only while moderating. Nobody edits locked. */
export function canEdit(status: SheetStatus, role: Role): boolean {
  if (role === "faculty") return status === "draft";
  return status === "submitted";
}

/** Validate one value against its component; returns an error message or null. */
export function validateEntry(e: MarkEntry, maxMarks: number): string | null {
  if (e.absent && e.score !== null) return "Absent students cannot have a score.";
  if (e.score !== null && e.score > maxMarks) return `Score cannot exceed ${maxMarks}.`;
  return null;
}

/** Sum of components, scaled to the university internal maximum if the scheme differs. */
export function internalTotal(
  entries: { score: number | null; absent: boolean; maxMarks: number }[],
  internalMax: number = RULES.internalMax,
): number | null {
  if (!entries.length || entries.every((e) => e.score === null && !e.absent)) return null;
  const max = entries.reduce((s, e) => s + e.maxMarks, 0);
  const got = entries.reduce((s, e) => s + (e.absent ? 0 : (e.score ?? 0)), 0);
  if (max === 0) return null;
  return Math.round(((got * internalMax) / max) * 2) / 2;
}

