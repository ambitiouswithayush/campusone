import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { assessmentComponents, marks, riskFlags, students } from "@/db/schema";
import { attendanceByStudent, weeklyAttendance } from "./attendance";
import { RULES } from "./config";
import { addDays, isoDateIST } from "./dates";

/**
 * At-risk early warning.
 *
 * A transparent points model over attendance and internal-marks *levels and trends*. We do not
 * have historical outcome labels for this trust yet, so a black-box classifier would be guesswork
 * dressed up as science; weights below are assumptions to recalibrate once a semester of results
 * exists (see TDD). The model only ever creates a mentor task — it never touches marks,
 * attendance or eligibility.
 */

export interface RiskFeatures {
  attendancePct: number | null;
  sessionsHeld: number;
  /** Recent 3 weeks minus the weeks before, in percentage points. */
  attendanceTrend: number | null;
  marksPct: number | null;
  componentsGraded: number;
  /** Latest assessment % minus earlier assessments %, averaged across subjects. */
  marksTrend: number | null;
  failingSubjects: number;
}

export interface RiskResult {
  score: number;
  level: "high" | "medium" | "low" | "insufficient";
  reasons: string[];
  confidence: "normal" | "partial";
}

export function scoreStudent(f: RiskFeatures): RiskResult {
  const hasAttendance = f.attendancePct !== null && f.sessionsHeld >= RULES.riskMinSessions;
  const hasMarks = f.marksPct !== null && f.componentsGraded >= RULES.riskMinComponents;
  if (!hasAttendance && !hasMarks) {
    return { score: 0, level: "insufficient", reasons: ["Not enough classes or marks recorded yet to judge."], confidence: "partial" };
  }

  let score = 0;
  const reasons: string[] = [];
  const t = RULES.attendanceThreshold;

  if (hasAttendance) {
    const a = f.attendancePct!;
    if (a < t) {
      score += Math.min(40, (t - a) * 2.5 + 10);
      reasons.push(`Attendance ${a.toFixed(1)}% is below the ${t}% minimum.`);
    } else if (a < t + 5) {
      score += 8;
      reasons.push(`Attendance ${a.toFixed(1)}% is within 5 points of the minimum.`);
    }
    if (f.attendanceTrend !== null && f.attendanceTrend <= -8) {
      score += Math.min(20, -f.attendanceTrend * 1.2);
      reasons.push(`Attendance fell ${Math.abs(f.attendanceTrend).toFixed(0)} points in the last 3 weeks.`);
    }
  }

  if (hasMarks) {
    const m = f.marksPct!;
    if (m < 50) {
      score += Math.min(30, (50 - m) * 1.5);
      reasons.push(`Internal marks average ${m.toFixed(0)}%.`);
    }
    if (f.marksTrend !== null && f.marksTrend <= -12) {
      score += Math.min(15, -f.marksTrend * 0.6);
      reasons.push(`Latest assessment is ${Math.abs(f.marksTrend).toFixed(0)} points below earlier ones.`);
    }
    if (f.failingSubjects > 0) {
      score += Math.min(15, f.failingSubjects * 5);
      reasons.push(`Below ${RULES.internalPassPercent}% internals in ${f.failingSubjects} subject${f.failingSubjects > 1 ? "s" : ""}.`);
    }
  }

  const confidence = hasAttendance && hasMarks ? "normal" : "partial";
  if (confidence === "partial") reasons.push(hasAttendance ? "Based on attendance only — no marks yet." : "Based on marks only — too few classes yet.");
  score = Math.round(Math.min(100, score));
  const level = score >= 50 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, reasons, confidence };
}

/** Gather features for many students in a few aggregate queries. */
export async function featuresFor(db: DB, studentIds: number[], today = isoDateIST()): Promise<Map<number, RiskFeatures>> {
  const out = new Map<number, RiskFeatures>();
  if (!studentIds.length) return out;
  const overall = await attendanceByStudent(db, studentIds);
  const weekly = await weeklyAttendance(db, studentIds, addDays(today, -84));
  const recentFrom = addDays(today, -21);

  const markRows = await db
    .select({
      studentId: marks.studentId,
      subjectId: assessmentComponents.subjectId,
      sortOrder: assessmentComponents.sortOrder,
      score: marks.score,
      absent: marks.absent,
      max: assessmentComponents.maxMarks,
    })
    .from(marks)
    .innerJoin(assessmentComponents, eq(assessmentComponents.id, marks.componentId))
    .where(inArray(marks.studentId, studentIds));
  const bySubject = new Map<number, Map<number, { order: number; pct: number }[]>>();
  for (const r of markRows) {
    if (r.score === null && !r.absent) continue;
    const pct = r.absent ? 0 : ((r.score ?? 0) / r.max) * 100;
    const subj = bySubject.get(r.studentId) ?? new Map();
    const list = subj.get(r.subjectId) ?? [];
    list.push({ order: r.sortOrder, pct });
    subj.set(r.subjectId, list);
    bySubject.set(r.studentId, subj);
  }

  for (const id of studentIds) {
    const o = overall.get(id);
    const weeks = weekly.get(id) ?? [];
    const recent = weeks.filter((w) => w.week >= recentFrom);
    const earlier = weeks.filter((w) => w.week < recentFrom);
    const avg = (ws: typeof weeks) => {
      const held = ws.reduce((s, w) => s + w.held, 0);
      return held ? ws.reduce((s, w) => s + (w.pct * w.held) / 100, 0) / held * 100 : null;
    };
    const r = avg(recent);
    const e = avg(earlier);

    const subj = bySubject.get(id);
    let graded = 0;
    let failing = 0;
    const subjectPcts: number[] = [];
    const trends: number[] = [];
    for (const list of subj?.values() ?? []) {
      list.sort((a, b) => a.order - b.order);
      graded += list.length;
      const mean = list.reduce((s, x) => s + x.pct, 0) / list.length;
      subjectPcts.push(mean);
      if (mean < RULES.internalPassPercent) failing++;
      if (list.length >= 2) {
        const last = list[list.length - 1].pct;
        const prev = list.slice(0, -1).reduce((s, x) => s + x.pct, 0) / (list.length - 1);
        trends.push(last - prev);
      }
    }
    out.set(id, {
      attendancePct: o?.pct ?? null,
      sessionsHeld: o?.held ?? 0,
      attendanceTrend: r !== null && e !== null ? Math.round((r - e) * 10) / 10 : null,
      marksPct: subjectPcts.length ? subjectPcts.reduce((s, x) => s + x, 0) / subjectPcts.length : null,
      componentsGraded: graded,
      marksTrend: trends.length ? trends.reduce((s, x) => s + x, 0) / trends.length : null,
      failingSubjects: failing,
    });
  }
  return out;
}

/**
 * Scan a campus and turn new risks into mentor tasks.
 * - an open task is refreshed, not duplicated;
 * - a task the mentor dismissed is not re-raised for 14 days unless the score rises 15+ points;
 * - an untouched open task whose student has recovered is auto-closed with a note.
 */
export async function runRiskScan(db: DB, campusId: number, now = new Date()) {
  const roster = await db
    .select({ id: students.id, mentor: students.mentorFacultyId })
    .from(students)
    .where(and(eq(students.campusId, campusId), eq(students.status, "active")));
  const feats = await featuresFor(db, roster.map((r) => r.id), isoDateIST(now));
  const flags = roster.length
    ? await db
        .select()
        .from(riskFlags)
        .where(inArray(riskFlags.studentId, roster.map((r) => r.id)))
        .orderBy(sql`${riskFlags.createdAt} desc`)
    : [];
  const latest = new Map<number, (typeof flags)[number]>();
  for (const f of flags) if (!latest.has(f.studentId)) latest.set(f.studentId, f);

  const summary = { created: 0, refreshed: 0, autoClosed: 0, suppressed: 0, insufficient: 0 };
  for (const s of roster) {
    const f = feats.get(s.id)!;
    const r = scoreStudent(f);
    const prev = latest.get(s.id);
    if (r.level === "insufficient") summary.insufficient++;
    const atRisk = r.level === "high" || r.level === "medium";

    if (!atRisk) {
      if (prev && prev.status === "open") {
        await db.update(riskFlags)
          .set({ status: "resolved", closedAt: now, note: "Auto-closed: indicators back to normal." })
          .where(eq(riskFlags.id, prev.id));
        summary.autoClosed++;
      }
      continue;
    }
    const payload = { score: r.score, level: r.level as "high" | "medium", reasons: r.reasons, features: f as unknown as Record<string, number | null> };
    if (prev && (prev.status === "open" || prev.status === "in_progress")) {
      await db.update(riskFlags).set(payload).where(eq(riskFlags.id, prev.id));
      summary.refreshed++;
      continue;
    }
    if (prev && prev.status === "dismissed" && prev.closedAt) {
      const recent = now.getTime() - prev.closedAt.getTime() < 14 * 86400_000;
      if (recent && r.score < prev.score + 15) {
        summary.suppressed++;
        continue;
      }
    }
    await db.insert(riskFlags).values({ studentId: s.id, mentorFacultyId: s.mentor, ...payload });
    summary.created++;
  }
  return summary;
}
