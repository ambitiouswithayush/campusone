"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { riskFlags, students } from "@/db/schema";
import { act, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { runRiskScan } from "@/lib/risk";

const Update = z.object({
  id: z.number().int().positive(),
  status: z.enum(["in_progress", "resolved", "dismissed"]),
  note: z.string().trim().max(500).optional(),
});

export async function updateFlagAction(input: z.input<typeof Update>) {
  return act(async () => {
    const user = await requireUser("faculty", "office_admin");
    const { id, status, note } = Update.parse(input);
    if (status !== "in_progress" && (!note || note.length < 5)) throw new UserError("Add a short note so the next person knows what happened.");
    const db = await getDb();
    const [row] = await db.select({ f: riskFlags, campusId: students.campusId }).from(riskFlags).innerJoin(students, eq(students.id, riskFlags.studentId)).where(eq(riskFlags.id, id));
    if (!row || row.campusId !== user.campusId) throw new UserError("Task not found.");
    if (user.role === "faculty" && row.f.mentorFacultyId !== user.facultyId) throw new UserError("Only the student's mentor can update this task.");
    await db
      .update(riskFlags)
      .set({ status, note: note ?? row.f.note, closedAt: status === "in_progress" ? null : new Date() })
      .where(eq(riskFlags.id, id));
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "risk_flag", entityId: id, action: status, before: { status: row.f.status }, reason: note ?? null });
    revalidatePath("/risk");
  }, input.status === "dismissed" ? "Dismissed — the model won't re-raise this for 14 days unless things get worse." : "Updated.");
}

export async function rescanAction() {
  return act(async () => {
    const user = await requireUser("office_admin");
    const r = await runRiskScan(await getDb(), user.campusId);
    revalidatePath("/risk");
    return r;
  });
}
