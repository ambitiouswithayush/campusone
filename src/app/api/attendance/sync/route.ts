import { NextResponse, after } from "next/server";
import { getDb } from "@/db";
import { AuthError, requireUser } from "@/lib/auth";
import { runShortageAlerts } from "@/lib/automations";
import { rateLimit } from "@/lib/rate-limit";
import { SyncRequest, syncSessions } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser("faculty", "office_admin");
    if (!rateLimit(`sync:${user.uid}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many sync requests." }, { status: 429 });
    }
    const json = await req.json().catch(() => null);
    const parsed = SyncRequest.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid attendance data.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
    }
    const db = await getDb();
    const { results, touchedStudentIds } = await syncSessions(db, user, parsed.data.sessions);
    // Shortage alerts are an automation, not part of the teacher's wait.
    after(() => runShortageAlerts(db, touchedStudentIds).catch((e) => console.error("shortage alerts", e)));
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Sync failed." }, { status: 500 });
  }
}
