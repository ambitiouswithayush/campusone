import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { programmes, students } from "@/db/schema";
import { AuthError, requireUser } from "@/lib/auth";
import { invoicesForStudents } from "@/lib/fees";

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export async function GET() {
  try {
    const user = await requireUser("office_admin");
    const db = await getDb();
    const list = await db
      .select({ id: students.id, rollNo: students.rollNo, name: students.name, category: students.category, programme: programmes.name })
      .from(students)
      .innerJoin(programmes, eq(programmes.id, students.programmeId))
      .where(and(eq(students.campusId, user.campusId), eq(students.status, "active")));
    const inv = await invoicesForStudents(db, list.map((s) => s.id));
    const lines = ["RollNo,Name,Programme,Category,NetFee,Paid,Due,DueDate"];
    for (const i of inv.filter((x) => x.due > 0)) {
      const s = list.find((x) => x.id === i.studentId)!;
      lines.push([s.rollNo, s.name, s.programme, s.category, i.gross - i.concession, i.paid, i.due, i.dueDate].map(cell).join(","));
    }
    return new Response(lines.join("\r\n") + "\r\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="fee-dues.csv"' },
    });
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
