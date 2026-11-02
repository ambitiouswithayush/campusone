import { getDb } from "@/db";
import { AccessError } from "@/lib/access";
import { audit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth";
import { MarksError, universityCsv } from "@/lib/marks";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("office_admin", "faculty");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
    const db = await getDb();
    const { filename, csv } = await universityCsv(db, user, id);
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "mark_sheet", entityId: id, action: "exported_university_csv" });
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.status });
    if (e instanceof AccessError || e instanceof MarksError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
