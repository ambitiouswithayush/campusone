import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { DB } from "./index";
import * as t from "./schema";
import { ACADEMIC_YEAR, PERIODS } from "@/lib/config";
import { addDays, dayOfWeek, isoDateIST, istInstant } from "@/lib/dates";
import { runRiskScan } from "@/lib/risk";
import { runFeeReminders, runShortageAlerts } from "@/lib/automations";
import { concessionFor } from "@/lib/fees";

/**
 * Deterministic demo data for Company A's engineering campus, built around the three students in
 * the brief. Dates are relative to "today" so the demo always has a current semester.
 */

export const DEMO_PASSWORD = "Demo@2026";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Sai Prasad", "Smruti", "Ipsita", "Debasish", "Satyajit", "Lipsa", "Ananya", "Rashmi", "Bikash", "Sonali", "Pratyush", "Soumya", "Ayesha", "Rohit", "Sneha", "Manas", "Tapaswini", "Chinmay", "Priyanka", "Abhishek", "Swagatika", "Jyoti", "Arpita", "Sourav", "Monalisa", "Sambit", "Truptimayee", "Kishore", "Nibedita", "Asutosh", "Sushree", "Omkar", "Riya", "Saswat", "Pooja", "Himanshu", "Bandita", "Imran", "Sarthak", "Ritika"];
const LAST = ["Mohanty", "Panda", "Das", "Sahu", "Mishra", "Patnaik", "Behera", "Nayak", "Swain", "Pradhan", "Rout", "Jena", "Mallick", "Tripathy", "Sethi", "Biswal", "Dash", "Senapati", "Acharya", "Barik", "Khan", "Hota"];
const GUARDIAN_FIRST = ["Prasanta", "Sudhir", "Ramesh", "Bijay", "Sarat", "Pramod", "Ashok", "Nirmal", "Gopal", "Rabindra", "Sanjukta", "Minati"];

interface SampleStudent { roll: string; name: string; attendance: number; components: number[]; due: number; trend?: "down" }
const SAMPLE: SampleStudent[] = [
  { roll: "ENG-24-CSE-0412", name: "Subhashree Mohanty", attendance: 81.5, components: [4, 17, 8, 4], due: 0 },
  { roll: "ENG-24-ME-0177", name: "Ankit Panda", attendance: 68.2, components: [4, 11, 4, 2], due: 45000, trend: "down" },
  { roll: "MBA-25-0093", name: "Farheen Ali", attendance: 92.0, components: [5, 18, 9, 4], due: 0 },
];

export interface SeedOptions { today?: string; weeks?: number; studentsPerSection?: number; quiet?: boolean }

export async function seed(db: DB, opts: SeedOptions = {}) {
  const today = opts.today ?? isoDateIST();
  const weeks = opts.weeks ?? 10;
  const perSection = opts.studentsPerSection ?? 36;
  const log = (m: string) => !opts.quiet && console.log(`  · ${m}`);
  const rand = rng(20260702);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Semester began on the Monday `weeks` weeks ago.
  const semStart = addDays(today, -(dayOfWeek(today) - 1) - weeks * 7);

  // ── Campuses, departments, programmes ────────────────────────────────────
  const [eng, mgt] = await db
    .insert(t.campuses)
    .values([
      { code: "ENG", name: "Engineering College", city: "Bhubaneswar" },
      { code: "MGT", name: "School of Management", city: "Bhubaneswar" },
      { code: "PHA", name: "College of Pharmacy", city: "Bhubaneswar" },
    ])
    .returning();
  const [dCse, dMe, dBsh, dMba] = await db
    .insert(t.departments)
    .values([
      { campusId: eng.id, code: "CSE", name: "Computer Science & Engineering" },
      { campusId: eng.id, code: "ME", name: "Mechanical Engineering" },
      { campusId: eng.id, code: "BSH", name: "Basic Sciences & Humanities" },
      { campusId: mgt.id, code: "MBA", name: "Business Administration" },
    ])
    .returning();
  const [pCse, pMe, pMba] = await db
    .insert(t.programmes)
    .values([
      { campusId: eng.id, departmentId: dCse.id, code: "BTECH-CSE", name: "B.Tech CSE", durationYears: 4 },
      { campusId: eng.id, departmentId: dMe.id, code: "BTECH-ME", name: "B.Tech Mechanical", durationYears: 4 },
      { campusId: mgt.id, departmentId: dMba.id, code: "MBA", name: "MBA", durationYears: 2 },
    ])
    .returning();

  // ── Faculty and logins ───────────────────────────────────────────────────
  const facultySpec = [
    ["F-CSE-014", "Dr. Priya Das", dCse, "Assistant Professor"],
    ["F-CSE-007", "Manoj Kumar Mishra", dCse, "Associate Professor"],
    ["F-CSE-021", "Sasmita Patnaik", dCse, "Assistant Professor"],
    ["F-CSE-009", "Debendra Nayak", dCse, "Assistant Professor"],
    ["F-BSH-003", "Dr. Anjali Tripathy", dBsh, "Professor"],
    ["F-BSH-011", "Rajesh Behera", dBsh, "Assistant Professor"],
    ["F-BSH-015", "Sujata Rout", dBsh, "Assistant Professor"],
    ["F-ME-005", "Rakesh Sahu", dMe, "Associate Professor"],
    ["F-ME-012", "Bibhuti Bhusan Swain", dMe, "Assistant Professor"],
    ["F-ME-018", "Sanjay Pradhan", dMe, "Assistant Professor"],
    ["F-MBA-002", "Dr. Nandita Acharya", dMba, "Professor"],
  ] as const;
  const fac = await db
    .insert(t.faculty)
    .values(
      facultySpec.map(([empCode, name, dept, designation]) => ({
        campusId: dept.campusId,
        departmentId: dept.id,
        empCode,
        name,
        designation,
        email: `${name.replace(/^Dr\. /, "").split(" ")[0].toLowerCase()}.${name.split(" ").pop()!.toLowerCase()}@campusone.test`,
      })),
    )
    .returning();
  const F = Object.fromEntries(fac.map((f) => [f.empCode, f]));

  await db.insert(t.users).values([
    { email: "admin@campusone.test", name: "Sunita Mahapatra", passwordHash: hash, role: "office_admin", campusId: eng.id },
    { email: "priya.das@campusone.test", name: "Dr. Priya Das", passwordHash: hash, role: "faculty", campusId: eng.id, facultyId: F["F-CSE-014"].id },
    { email: "rakesh.sahu@campusone.test", name: "Rakesh Sahu", passwordHash: hash, role: "faculty", campusId: eng.id, facultyId: F["F-ME-005"].id },
    { email: "mgt.admin@campusone.test", name: "Alok Ranjan Dash", passwordHash: hash, role: "office_admin", campusId: mgt.id },
  ]);
  const users = await db.select().from(t.users);
  const facultyUser = new Map(users.filter((u) => u.facultyId).map((u) => [u.facultyId!, u.id]));
  const adminUser = users.find((u) => u.email === "admin@campusone.test")!;

  // ── Batches and subjects ─────────────────────────────────────────────────
  const [bCse2A, bCse2B, bCse1A, bMe2A, bMba1A] = await db
    .insert(t.batches)
    .values([
      { programmeId: pCse.id, admissionYear: 2024, yearOfStudy: 2, semester: 3, section: "A" },
      { programmeId: pCse.id, admissionYear: 2024, yearOfStudy: 2, semester: 3, section: "B" },
      { programmeId: pCse.id, admissionYear: 2025, yearOfStudy: 1, semester: 1, section: "A" },
      { programmeId: pMe.id, admissionYear: 2024, yearOfStudy: 2, semester: 3, section: "A" },
      { programmeId: pMba.id, admissionYear: 2025, yearOfStudy: 1, semester: 1, section: "A" },
    ])
    .returning();

  const subjectSpec: [typeof pCse, number, string, string, number][] = [
    [pCse, 3, "CS201", "Data Structures", 4],
    [pCse, 3, "CS203", "Digital Logic Design", 3],
    [pCse, 3, "CS205", "Object Oriented Programming", 3],
    [pCse, 3, "CS207", "Computer Organisation", 3],
    [pCse, 3, "MA201", "Discrete Mathematics", 4],
    [pCse, 3, "HS201", "Engineering Economics", 2],
    [pCse, 1, "CS101", "Programming in C", 4],
    [pCse, 1, "MA101", "Engineering Mathematics I", 4],
    [pCse, 1, "PH101", "Engineering Physics", 3],
    [pCse, 1, "EE101", "Basic Electrical Engineering", 3],
    [pCse, 1, "HS101", "Communicative English", 2],
    [pCse, 1, "ME101", "Engineering Graphics", 2],
    [pMe, 3, "ME201", "Engineering Thermodynamics", 4],
    [pMe, 3, "ME203", "Mechanics of Solids", 4],
    [pMe, 3, "ME205", "Fluid Mechanics", 3],
    [pMe, 3, "ME207", "Manufacturing Processes", 3],
    [pMe, 3, "MA203", "Mathematics III", 4],
    [pMe, 3, "HS201", "Engineering Economics", 2],
    [pMba, 1, "MB101", "Managerial Economics", 3],
    [pMba, 1, "MB103", "Financial Accounting", 3],
    [pMba, 1, "MB105", "Organisational Behaviour", 3],
    [pMba, 1, "MB107", "Business Statistics", 3],
    [pMba, 1, "MB109", "Marketing Management", 3],
  ];
  const subs = await db
    .insert(t.subjects)
    .values(subjectSpec.map(([p, semester, code, name, credits]) => ({ programmeId: p.id, semester, code, name, credits })))
    .returning();
  const S = (prog: typeof pCse, code: string) => subs.find((s) => s.programmeId === prog.id && s.code === code)!;

  await db.insert(t.assessmentComponents).values(
    subs.flatMap((s) => [
      { subjectId: s.id, code: "Q1", name: "Quiz 1", maxMarks: 5, sortOrder: 1 },
      { subjectId: s.id, code: "MID", name: "Mid-semester", maxMarks: 20, sortOrder: 2 },
      { subjectId: s.id, code: "ASG", name: "Assignment", maxMarks: 10, sortOrder: 3 },
      { subjectId: s.id, code: "Q2", name: "Quiz 2", maxMarks: 5, sortOrder: 4 },
    ]),
  );
  const comps = await db.select().from(t.assessmentComponents);

  // ── Teaching assignments and a clash-free weekly timetable ───────────────
  const plan: [typeof bCse2A, typeof pCse, string, string][] = [
    [bCse2A, pCse, "CS201", "F-CSE-014"], [bCse2B, pCse, "CS201", "F-CSE-014"], [bCse1A, pCse, "CS101", "F-CSE-014"],
    [bCse2A, pCse, "CS203", "F-CSE-007"], [bCse2B, pCse, "CS203", "F-CSE-007"],
    [bCse2A, pCse, "CS205", "F-CSE-021"], [bCse2B, pCse, "CS205", "F-CSE-021"],
    [bCse2A, pCse, "CS207", "F-CSE-009"], [bCse2B, pCse, "CS207", "F-CSE-009"],
    [bCse2A, pCse, "MA201", "F-BSH-003"], [bCse2B, pCse, "MA201", "F-BSH-003"], [bCse1A, pCse, "MA101", "F-BSH-003"],
    [bCse2A, pCse, "HS201", "F-BSH-011"], [bCse2B, pCse, "HS201", "F-BSH-011"], [bCse1A, pCse, "HS101", "F-BSH-011"],
    [bCse1A, pCse, "PH101", "F-BSH-015"], [bCse1A, pCse, "EE101", "F-CSE-009"], [bCse1A, pCse, "ME101", "F-ME-012"],
    [bMe2A, pMe, "ME201", "F-ME-005"], [bMe2A, pMe, "ME203", "F-ME-012"], [bMe2A, pMe, "ME205", "F-ME-012"],
    [bMe2A, pMe, "ME207", "F-ME-018"], [bMe2A, pMe, "MA203", "F-BSH-003"], [bMe2A, pMe, "HS201", "F-BSH-011"],
    [bMba1A, pMba, "MB101", "F-MBA-002"], [bMba1A, pMba, "MB103", "F-MBA-002"], [bMba1A, pMba, "MB105", "F-MBA-002"],
    [bMba1A, pMba, "MB107", "F-MBA-002"], [bMba1A, pMba, "MB109", "F-MBA-002"],
  ];
  const assignments = await db
    .insert(t.teachingAssignments)
    .values(plan.map(([b, p, code, emp]) => ({ batchId: b.id, subjectId: S(p, code).id, facultyId: F[emp].id })))
    .returning();

  const batchBusy = new Set<string>();
  const facBusy = new Set<string>();
  const slots: { assignmentId: number; batchId: number; dayOfWeek: number; period: number }[] = [];
  const order = [...assignments].sort((a, b) => a.facultyId - b.facultyId);
  for (const a of order) {
    const perWeek = 4;
    let placed = 0;
    for (let round = 0; round < 3 && placed < perWeek; round++) {
      for (let k = 0; k < 6 && placed < perWeek; k++) {
        const day = ((a.id + k * 2) % 6) + 1;
        if (round === 0 && slots.some((s) => s.assignmentId === a.id && s.dayOfWeek === day)) continue;
        for (let p0 = 0; p0 < 6; p0++) {
          const period = ((a.id + p0 + round) % 6) + 1;
          const bk = `${a.batchId}:${day}:${period}`;
          const fk = `${a.facultyId}:${day}:${period}`;
          if (batchBusy.has(bk) || facBusy.has(fk)) continue;
          batchBusy.add(bk);
          facBusy.add(fk);
          slots.push({ assignmentId: a.id, batchId: a.batchId, dayOfWeek: day, period });
          placed++;
          break;
        }
      }
    }
  }
  await db.insert(t.timetableSlots).values(slots);
  log(`${assignments.length} teaching assignments, ${slots.length} timetable slots`);

  // ── Calendar ─────────────────────────────────────────────────────────────
  const holiday = addDays(semStart, 7 * 5 + 2); // a Wednesday mid-semester
  await db.insert(t.calendarEvents).values([
    { campusId: eng.id, date: semStart, kind: "event", title: "Odd semester classes begin" },
    { campusId: eng.id, date: holiday, kind: "holiday", title: "Puja holiday" },
    { campusId: eng.id, date: addDays(semStart, 7 * 6), kind: "exam", title: "Mid-semester examinations begin" },
    { campusId: eng.id, date: addDays(today, 24), kind: "exam", title: "Internal marks upload deadline" },
    { campusId: eng.id, date: addDays(today, 38), kind: "exam", title: "End-semester examinations begin" },
    { campusId: mgt.id, date: semStart, kind: "event", title: "Term 1 begins" },
  ]);

  // ── Students ─────────────────────────────────────────────────────────────
  type Profile = { base: number; trend: number; ability: number };
  const profiles = new Map<string, Profile>();
  const rows: (typeof t.students.$inferInsert)[] = [];
  const used = new Set<string>(SAMPLE.map((s) => s.name));
  const nameFor = () => {
    for (;;) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  };
  const mentorsFor: Record<number, number[]> = {
    [bCse2A.id]: [F["F-CSE-014"].id, F["F-CSE-021"].id],
    [bCse2B.id]: [F["F-CSE-007"].id, F["F-CSE-009"].id],
    [bCse1A.id]: [F["F-CSE-014"].id, F["F-BSH-015"].id],
    [bMe2A.id]: [F["F-ME-005"].id, F["F-ME-018"].id],
    [bMba1A.id]: [F["F-MBA-002"].id],
  };
  const addBatch = (b: typeof bCse2A, prog: typeof pCse, prefix: string, startNo: number, count: number, dobYear: number) => {
    for (let i = 0; i < count; i++) {
      const roll = `${prefix}${String(startNo + i).padStart(4, "0")}`;
      const sample = SAMPLE.find((s) => s.roll === roll);
      const r = rand();
      // Most students attend well; a tail does not. A few slide in recent weeks.
      const base = sample ? sample.attendance / 100 : r < 0.1 ? 0.58 + rand() * 0.12 : r < 0.25 ? 0.72 + rand() * 0.08 : 0.82 + rand() * 0.15;
      const trend = sample?.trend === "down" ? -0.25 : rand() < 0.08 ? -0.3 : 0;
      profiles.set(roll, { base, trend, ability: Math.min(1, Math.max(0.25, base - 0.1 + (rand() - 0.5) * 0.4)) });
      const month = 1 + Math.floor(rand() * 12);
      const day = 1 + Math.floor(rand() * 28);
      const year = dobYear + (rand() < 0.35 ? 1 : 0);
      const dob = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const minor = addDays(dob, 365 * 18 + 4) > today;
      const mentors = mentorsFor[b.id];
      const category = sample ? "GEN" : (pick(["GEN", "GEN", "GEN", "GEN", "OBC", "OBC", "SC", "ST", "EWS"]) as "GEN");
      rows.push({
        campusId: prog.campusId,
        programmeId: prog.id,
        batchId: b.id,
        rollNo: roll,
        name: sample?.name ?? nameFor(),
        dob,
        category,
        guardianName: `${pick(GUARDIAN_FIRST)} ${(sample?.name ?? "x " + pick(LAST)).split(" ").pop()}`,
        guardianPhone: `+91 7${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`,
        guardianLang: rand() < 0.6 ? "or" : "en",
        // A few minors' consent forms are still pending — they get no parent messages.
        parentConsentAt: minor && rand() < 0.3 ? null : new Date(`${semStart}T10:00:00+05:30`),
        mentorFacultyId: mentors[i % mentors.length],
      });
    }
  };
  addBatch(bCse2A, pCse, "ENG-24-CSE-", 401, perSection, 2006);
  addBatch(bCse2B, pCse, "ENG-24-CSE-", 401 + perSection, perSection, 2006);
  addBatch(bCse1A, pCse, "ENG-25-CSE-", 101, perSection, 2007);
  addBatch(bMe2A, pMe, "ENG-24-ME-", 161, Math.max(perSection - 6, 20), 2006);
  addBatch(bMba1A, pMba, "MBA-25-", 81, 20, 2003);
  const stu = await db.insert(t.students).values(rows).returning();
  log(`${stu.length} students`);
  const byBatch = new Map<number, typeof stu>();
  for (const s of stu) byBatch.set(s.batchId, [...(byBatch.get(s.batchId) ?? []), s]);

  // ── Attendance history ───────────────────────────────────────────────────
  const recentFrom = addDays(today, -21);
  const sessions: (typeof t.attendanceSessions.$inferInsert)[] = [];
  const records: (typeof t.attendanceRecords.$inferInsert)[] = [];
  const priyaUser = facultyUser.get(F["F-CSE-014"].id)!;
  const yesterday = addDays(today, -1);
  const uuid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(rand() * 16);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  const sampleSessions = new Map<string, number[]>(); // roll -> indexes into records

  for (let d = semStart; d < today; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    if (dow === 7 || d === holiday) continue;
    for (const slot of slots.filter((s) => s.dayOfWeek === dow)) {
      const a = assignments.find((x) => x.id === slot.assignmentId)!;
      const takerUser = facultyUser.get(a.facultyId) ?? adminUser.id;
      // Leave a few classes unmarked so completion is realistic; keep one of Priya's from yesterday pending.
      if (d === yesterday && a.facultyId === F["F-CSE-014"].id && slot.period === Math.max(...slots.filter((s) => s.assignmentId === a.id && s.dayOfWeek === dow).map((s) => s.period))) continue;
      if (rand() < 0.025) continue;
      const late = rand() < 0.07;
      const end = istInstant(d, PERIODS[slot.period].end);
      const markedAt = new Date(end.getTime() + (late ? 16 * 3600_000 : rand() * 40 * 60_000));
      const id = uuid();
      let present = 0;
      const roster = byBatch.get(slot.batchId) ?? [];
      for (const s of roster) {
        const p = profiles.get(s.rollNo)!;
        const prob = d >= recentFrom ? p.base + p.trend : p.base - p.trend * 0.35;
        const isPresent = rand() < Math.min(0.99, Math.max(0.05, prob));
        if (isPresent) present++;
        if (SAMPLE.some((x) => x.roll === s.rollNo)) {
          sampleSessions.set(s.rollNo, [...(sampleSessions.get(s.rollNo) ?? []), records.length]);
        }
        records.push({ sessionId: id, studentId: s.id, present: isPresent });
      }
      sessions.push({
        id,
        assignmentId: a.id,
        batchId: slot.batchId,
        date: d,
        period: slot.period,
        takenByUserId: a.facultyId === F["F-CSE-014"].id ? priyaUser : takerUser,
        markedAt,
        syncedAt: new Date(markedAt.getTime() + (rand() < 0.3 ? rand() * 3 * 3600_000 : 2000)),
        source: rand() < 0.3 ? "offline" : "online",
        presentCount: present,
        absentCount: roster.length - present,
      });
    }
  }

  // Pin the brief's sample students to their exact attendance figures.
  const dropped = new Set<number>();
  for (const s of SAMPLE) {
    const idx = sampleSessions.get(s.roll);
    if (!idx) continue;
    // Whole-number class counts can't always produce the exact figure, so the student "reported"
    // k classes late (common in week 1) — choose the smallest k that matches exactly.
    const exact = (h: number) => {
      const c = Math.round((s.attendance / 100) * h);
      return Math.round((c / h) * 1000) / 10 === s.attendance ? c : null;
    };
    let k = 0;
    while (k < 15 && exact(idx.length - k) === null) k++;
    idx.slice(0, k).forEach((i) => dropped.add(i));
    idx.splice(0, k);
    const held = idx.length;
    const best = exact(held) ?? Math.round((s.attendance / 100) * held);
    // A declining student misses about half of the recent classes; everyone else is spread out.
    const shuffle = (a: number[]) => a.map((v) => ({ v, k: rand() })).sort((x, y) => x.k - y.k).map((x) => x.v);
    const absences = held - best;
    let absent: number[];
    if (s.trend === "down") {
      const cut = Math.floor(held * 0.75);
      const recent = shuffle(idx.slice(cut)).slice(0, Math.min(absences, Math.round((held - cut) * 0.55)));
      absent = [...recent, ...shuffle(idx.slice(0, cut)).slice(0, absences - recent.length)];
    } else {
      absent = shuffle(idx).slice(0, absences);
    }
    const absentSet = new Set(absent);
    for (const i of idx) records[i].present = !absentSet.has(i);
  }
  const kept = records.filter((_, i) => !dropped.has(i));
  records.length = 0;
  records.push(...kept);
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of records) totals.set(r.sessionId, (totals.get(r.sessionId) ?? 0) + 1);
  for (const r of records) if (r.present) counts.set(r.sessionId, (counts.get(r.sessionId) ?? 0) + 1);
  for (const sess of sessions) {
    const total = totals.get(sess.id) ?? 0;
    sess.presentCount = counts.get(sess.id) ?? 0;
    sess.absentCount = total - sess.presentCount;
  }

  const chunk = async <T,>(arr: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
    for (let i = 0; i < arr.length; i += size) await fn(arr.slice(i, i + size));
  };
  await chunk(sessions, 500, (c) => db.insert(t.attendanceSessions).values(c));
  await chunk(records, 5000, (c) => db.insert(t.attendanceRecords).values(c));
  log(`${sessions.length} classes, ${records.length} attendance marks`);

  // ── Internal marks ───────────────────────────────────────────────────────
  // Sheet states give every workflow step something to show.
  const sheetState = (a: (typeof assignments)[number]): "draft" | "submitted" | "locked" => {
    const code = subs.find((s) => s.id === a.subjectId)!.code;
    if (a.batchId === bCse2A.id && code === "CS201") return "draft";
    if (a.batchId === bCse2B.id && code === "CS201") return "submitted";
    if (a.batchId === bCse1A.id && code === "CS101") return "locked";
    if (a.batchId === bMe2A.id && code === "ME201") return "draft";
    return (["locked", "submitted", "draft", "locked"] as const)[a.id % 4];
  };
  const markRows: (typeof t.marks.$inferInsert)[] = [];
  for (const a of assignments) {
    const state = sheetState(a);
    const cs = comps.filter((c) => c.subjectId === a.subjectId).sort((x, y) => x.sortOrder - y.sortOrder);
    const taker = facultyUser.get(a.facultyId) ?? adminUser.id;
    for (const s of byBatch.get(a.batchId) ?? []) {
      const sample = SAMPLE.find((x) => x.roll === s.rollNo);
      const p = profiles.get(s.rollNo)!;
      cs.forEach((c, i) => {
        // Draft sheets are still missing Quiz 2 for most students.
        if (!sample && state === "draft" && c.code === "Q2" && rand() < 0.7) return;
        let score: number | null;
        let absent = false;
        if (sample) score = sample.components[i];
        else if (rand() < 0.015) { score = null; absent = true; }
        else {
          const ability = i >= 2 ? p.ability + p.trend * 0.8 : p.ability;
          const raw = c.maxMarks * Math.min(1, Math.max(0.1, ability + (rand() - 0.5) * 0.3));
          score = Math.round(raw * 2) / 2;
        }
        markRows.push({ studentId: s.id, componentId: c.id, score, absent, updatedByUserId: taker });
      });
    }
  }
  await chunk(markRows, 3000, (c) => db.insert(t.marks).values(c));
  const sheetRows = assignments.map((a) => {
    const status = sheetState(a);
    return {
      assignmentId: a.id,
      status,
      submittedAt: status === "draft" ? null : new Date(`${addDays(today, -6)}T15:00:00+05:30`),
      lockedAt: status === "locked" ? new Date(`${addDays(today, -3)}T12:00:00+05:30`) : null,
      lockedByUserId: status === "locked" ? adminUser.id : null,
    };
  });
  await db.insert(t.markSheets).values(sheetRows);
  await db.insert(t.auditLog).values(
    sheetRows
      .filter((s) => s.status === "locked")
      .map((s) => ({ campusId: eng.id, actorUserId: adminUser.id, entity: "mark_sheet", entityId: String(s.assignmentId), action: "submitted→locked", createdAt: s.lockedAt! })),
  );
  log(`${markRows.length} marks across ${sheetRows.length} sheets`);

  // ── Fees ─────────────────────────────────────────────────────────────────
  const heads = (tuition: number, dev: number, exam: number, lab: number) => [
    { head: "Tuition", amount: tuition },
    { head: "Development", amount: dev },
    { head: "Examination", amount: exam },
    { head: "Library & Lab", amount: lab },
  ];
  const structureRows: (typeof t.feeStructures.$inferInsert)[] = [];
  for (const prog of [pCse, pMe]) {
    for (const cat of ["GEN", "OBC", "EWS"] as const) structureRows.push({ programmeId: prog.id, category: cat, academicYear: ACADEMIC_YEAR, heads: heads(110000, 15000, 5000, 10000), total: 140000 });
    for (const cat of ["SC", "ST"] as const) structureRows.push({ programmeId: prog.id, category: cat, academicYear: ACADEMIC_YEAR, heads: heads(110000, 0, 5000, 10000), total: 125000 });
  }
  for (const cat of ["GEN", "OBC", "EWS", "SC", "ST"] as const) structureRows.push({ programmeId: pMba.id, category: cat, academicYear: ACADEMIC_YEAR, heads: heads(170000, 25000, 6000, 9000), total: 210000 });
  const structures = await db.insert(t.feeStructures).values(structureRows).returning();

  const scholarshipRows: (typeof t.scholarships.$inferInsert)[] = [];
  const invoiceRows: (typeof t.feeInvoices.$inferInsert)[] = [];
  const dueDate = addDays(semStart, 30);
  for (const s of stu) {
    const st = structures.find((x) => x.programmeId === s.programmeId && x.category === s.category)!;
    const sch: { name: string; amount: number }[] = [];
    if (s.category === "SC" || s.category === "ST") sch.push({ name: "Post-Matric Scholarship (State)", amount: 90000 });
    else if (!SAMPLE.some((x) => x.roll === s.rollNo) && rand() < 0.08) sch.push({ name: "Merit Scholarship", amount: 25000 });
    sch.forEach((x) => scholarshipRows.push({ studentId: s.id, academicYear: ACADEMIC_YEAR, ...x }));
    invoiceRows.push({ studentId: s.id, structureId: st.id, academicYear: ACADEMIC_YEAR, gross: st.total, concession: concessionFor(st.total, sch.map((x) => x.amount)), dueDate });
  }
  if (scholarshipRows.length) await db.insert(t.scholarships).values(scholarshipRows);
  const invoices = await db.insert(t.feeInvoices).values(invoiceRows).returning();

  const paymentRows: (typeof t.payments.$inferInsert)[] = [];
  let receipt = 0;
  for (const inv of invoices) {
    const s = stu.find((x) => x.id === inv.studentId)!;
    const net = inv.gross - inv.concession;
    const sample = SAMPLE.find((x) => x.roll === s.rollNo);
    const r = rand();
    const paid = sample ? net - sample.due : r < 0.72 ? net : r < 0.88 ? Math.round((net * (0.4 + rand() * 0.4)) / 1000) * 1000 : 0;
    if (paid <= 0) continue;
    const parts = paid === net && rand() < 0.4 ? [Math.round(paid / 2000) * 1000, paid - Math.round(paid / 2000) * 1000] : [paid];
    parts.forEach((amount, i) => {
      receipt++;
      const paidAt = new Date(`${addDays(semStart, 3 + i * 20 + Math.floor(rand() * 10))}T${11 + Math.floor(rand() * 4)}:15:00+05:30`);
      paymentRows.push({
        invoiceId: inv.id,
        studentId: s.id,
        amount,
        mode: "bank_counter",
        status: "success",
        reference: `SBIN${String(26000000 + Math.floor(rand() * 999999)).padStart(8, "0")}${receipt}`,
        receiptNo: `RCPT/${ACADEMIC_YEAR}/${String(receipt).padStart(6, "0")}`,
        createdAt: paidAt,
        paidAt,
      });
    });
  }
  await chunk(paymentRows, 500, (c) => db.insert(t.payments).values(c));
  log(`${invoices.length} fee invoices, ${paymentRows.length} payments`);

  // ── Automations: risk scan, shortage alerts, fee reminders ───────────────
  for (const campus of [eng, mgt]) {
    const r = await runRiskScan(db, campus.id);
    log(`${campus.code} risk scan: ${r.created} mentor tasks`);
  }
  const flags = await db.select().from(t.riskFlags);
  if (flags[1]) await db.update(t.riskFlags).set({ status: "in_progress", note: "Spoke to student after class; family issue, follow up on Friday." }).where(eq(t.riskFlags.id, flags[1].id));
  await runShortageAlerts(db, stu.map((s) => s.id));
  await runFeeReminders(db, eng.id);
  await runFeeReminders(db, mgt.id);
  await bumpReceiptSeq(db);
  log("automations run");
  return { campusId: eng.id, today };
}

/** Restart the receipt sequence after seeded receipts. */
export async function bumpReceiptSeq(db: DB) {
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`select count(*)::int as n from payments where receipt_no is not null`);
  const n = (res as unknown as { rows: { n: number }[] }).rows[0].n;
  await db.execute(sql.raw(`select setval('receipt_seq', ${n + 1}, false)`));
}
