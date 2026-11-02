import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  numeric,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
  pgSequence,
} from "drizzle-orm/pg-core";

// ── Masters ────────────────────────────────────────────────────────────────

export const campuses = pgTable("campuses", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
});

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
});

export const programmes = pgTable("programmes", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  departmentId: integer("department_id").notNull().references(() => departments.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  durationYears: integer("duration_years").notNull(),
});

/** A batch is one section of one admission year of a programme, e.g. B.Tech CSE 2024 section A. */
export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    programmeId: integer("programme_id").notNull().references(() => programmes.id),
    admissionYear: integer("admission_year").notNull(),
    yearOfStudy: integer("year_of_study").notNull(),
    semester: integer("semester").notNull(),
    section: text("section").notNull(),
  },
  (t) => [uniqueIndex("batches_unique").on(t.programmeId, t.admissionYear, t.section)],
);

export const subjects = pgTable(
  "subjects",
  {
    id: serial("id").primaryKey(),
    programmeId: integer("programme_id").notNull().references(() => programmes.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    semester: integer("semester").notNull(),
    credits: integer("credits").notNull(),
  },
  (t) => [uniqueIndex("subjects_code_unique").on(t.programmeId, t.code)],
);

export const faculty = pgTable("faculty", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  departmentId: integer("department_id").notNull().references(() => departments.id),
  empCode: text("emp_code").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  designation: text("designation").notNull(),
  active: boolean("active").notNull().default(true),
});

/** Who teaches which subject to which batch. Attendance and marks hang off this. */
export const teachingAssignments = pgTable(
  "teaching_assignments",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => batches.id),
    subjectId: integer("subject_id").notNull().references(() => subjects.id),
    facultyId: integer("faculty_id").notNull().references(() => faculty.id),
  },
  (t) => [uniqueIndex("ta_unique").on(t.batchId, t.subjectId)],
);

/** Fixed weekly timetable (generation is out of scope; slots are entered as masters). */
export const timetableSlots = pgTable(
  "timetable_slots",
  {
    id: serial("id").primaryKey(),
    assignmentId: integer("assignment_id").notNull().references(() => teachingAssignments.id),
    batchId: integer("batch_id").notNull().references(() => batches.id),
    dayOfWeek: integer("day_of_week").notNull(), // 1 = Monday … 6 = Saturday
    period: integer("period").notNull(),
  },
  (t) => [uniqueIndex("slot_unique").on(t.batchId, t.dayOfWeek, t.period)],
);

export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  date: date("date").notNull(),
  kind: text("kind", { enum: ["holiday", "exam", "event"] }).notNull(),
  title: text("title").notNull(),
});

// ── People ─────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["faculty", "office_admin"] }).notNull(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  facultyId: integer("faculty_id").references(() => faculty.id),
});

export const students = pgTable(
  "students",
  {
    id: serial("id").primaryKey(),
    campusId: integer("campus_id").notNull().references(() => campuses.id),
    programmeId: integer("programme_id").notNull().references(() => programmes.id),
    batchId: integer("batch_id").notNull().references(() => batches.id),
    rollNo: text("roll_no").notNull().unique(),
    name: text("name").notNull(),
    dob: date("dob").notNull(),
    category: text("category", { enum: ["GEN", "OBC", "SC", "ST", "EWS"] }).notNull(),
    guardianName: text("guardian_name").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    guardianLang: text("guardian_lang", { enum: ["en", "or"] }).notNull().default("en"),
    /** DPDP Act 2023: verifiable parental consent for minors before we process/message. */
    parentConsentAt: timestamp("parent_consent_at", { withTimezone: true }),
    mentorFacultyId: integer("mentor_faculty_id").references(() => faculty.id),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  },
  (t) => [index("students_batch_idx").on(t.batchId)],
);

// ── Attendance ─────────────────────────────────────────────────────────────

export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    /** Generated on the device so an offline submission can be retried safely. */
    id: uuid("id").primaryKey(),
    assignmentId: integer("assignment_id").notNull().references(() => teachingAssignments.id),
    batchId: integer("batch_id").notNull().references(() => batches.id),
    date: date("date").notNull(),
    period: integer("period").notNull(),
    takenByUserId: integer("taken_by_user_id").notNull().references(() => users.id),
    /** When the teacher pressed submit on the device (clamped to server time). */
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source", { enum: ["online", "offline"] }).notNull(),
    presentCount: integer("present_count").notNull(),
    absentCount: integer("absent_count").notNull(),
  },
  (t) => [
    uniqueIndex("session_slot_unique").on(t.batchId, t.date, t.period),
    index("session_assignment_idx").on(t.assignmentId),
  ],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => students.id),
    present: boolean("present").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] }), index("records_student_idx").on(t.studentId)],
);

// ── Internal marks ─────────────────────────────────────────────────────────

export const assessmentComponents = pgTable("assessment_components", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id").notNull().references(() => subjects.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  maxMarks: integer("max_marks").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const marks = pgTable(
  "marks",
  {
    studentId: integer("student_id").notNull().references(() => students.id),
    componentId: integer("component_id").notNull().references(() => assessmentComponents.id),
    score: numeric("score", { precision: 5, scale: 1, mode: "number" }),
    absent: boolean("absent").notNull().default(false),
    updatedByUserId: integer("updated_by_user_id").notNull().references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.componentId] })],
);

/** Workflow state of the internal-marks sheet for one subject + batch. */
export const markSheets = pgTable("mark_sheets", {
  assignmentId: integer("assignment_id")
    .primaryKey()
    .references(() => teachingAssignments.id),
  status: text("status", { enum: ["draft", "submitted", "locked"] }).notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedByUserId: integer("locked_by_user_id").references(() => users.id),
});

// ── Fees ───────────────────────────────────────────────────────────────────

/** Sequential receipt numbers for accounts and Tally (a rolled-back payment may skip one; audit explains it). */
export const receiptSeq = pgSequence("receipt_seq", { startWith: 1001 });

export const feeStructures = pgTable(
  "fee_structures",
  {
    id: serial("id").primaryKey(),
    programmeId: integer("programme_id").notNull().references(() => programmes.id),
    category: text("category", { enum: ["GEN", "OBC", "SC", "ST", "EWS"] }).notNull(),
    academicYear: text("academic_year").notNull(),
    heads: jsonb("heads").$type<{ head: string; amount: number }[]>().notNull(),
    total: integer("total").notNull(),
  },
  (t) => [uniqueIndex("fee_structure_unique").on(t.programmeId, t.category, t.academicYear)],
);

export const scholarships = pgTable("scholarships", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id),
  name: text("name").notNull(),
  amount: integer("amount").notNull(),
  academicYear: text("academic_year").notNull(),
});

export const feeInvoices = pgTable(
  "fee_invoices",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => students.id),
    structureId: integer("structure_id").notNull().references(() => feeStructures.id),
    academicYear: text("academic_year").notNull(),
    gross: integer("gross").notNull(),
    concession: integer("concession").notNull().default(0),
    dueDate: date("due_date").notNull(),
  },
  (t) => [uniqueIndex("invoice_unique").on(t.studentId, t.academicYear)],
);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: integer("invoice_id").notNull().references(() => feeInvoices.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  amount: integer("amount").notNull(),
  mode: text("mode", { enum: ["online_test", "bank_counter"] }).notNull(),
  status: text("status", { enum: ["pending", "success", "failed"] }).notNull(),
  /** Gateway / bank reference. Unique so a replayed callback cannot double-credit. */
  reference: text("reference").unique(),
  receiptNo: text("receipt_no").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

// ── AI, automation, audit ──────────────────────────────────────────────────

/** An at-risk flag *is* a mentor task. It never changes academic records. */
export const riskFlags = pgTable(
  "risk_flags",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => students.id),
    mentorFacultyId: integer("mentor_faculty_id").references(() => faculty.id),
    score: integer("score").notNull(),
    level: text("level", { enum: ["high", "medium"] }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    features: jsonb("features").$type<Record<string, number | null>>().notNull(),
    status: text("status", { enum: ["open", "in_progress", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("risk_student_idx").on(t.studentId)],
);

/** Mock outbound messages (SMS/WhatsApp gateway is out of scope). */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  kind: text("kind", { enum: ["shortage", "fee_reminder"] }).notNull(),
  lang: text("lang", { enum: ["en", "or"] }).notNull(),
  toPhone: text("to_phone").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["sent_mock", "skipped_no_consent"] }).notNull(),
  /** e.g. shortage:123:2026-W44 — one alert per student per week. */
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    campusId: integer("campus_id").notNull().references(() => campuses.id),
    actorUserId: integer("actor_user_id").references(() => users.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

export const assistantQueries = pgTable("assistant_queries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  question: text("question").notNull(),
  spec: jsonb("spec"),
  engine: text("engine", { enum: ["llm", "rules", "none"] }).notNull(),
  rowCount: integer("row_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
