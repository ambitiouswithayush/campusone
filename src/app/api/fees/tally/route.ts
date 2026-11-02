import { z } from "zod";
import { getDb } from "@/db";
import { audit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth";
import { tallyXml } from "@/lib/fees";

export async function GET(req: Request) {
  try {
    const user = await requireUser("office_admin");
    const url = new URL(req.url);
    const q = z.object({ from: z.iso.date(), to: z.iso.date() }).safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
    if (!q.success || q.data.from > q.data.to) return new Response("Give from and to dates (YYYY-MM-DD).", { status: 400 });
    const db = await getDb();
    const { xml, count } = await tallyXml(db, user, q.data.from, q.data.to);
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "fees", entityId: `${q.data.from}..${q.data.to}`, action: "tally_export", after: { vouchers: count } });
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="tally-receipts-${q.data.from}-to-${q.data.to}.xml"` },
    });
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
