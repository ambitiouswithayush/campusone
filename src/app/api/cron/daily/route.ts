import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { campuses } from "@/db/schema";
import { runDailyJobs } from "@/lib/jobs";

/** Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const out: Record<string, unknown> = {};
  for (const c of await db.select().from(campuses)) out[c.code] = await runDailyJobs(db, c.id);
  return NextResponse.json(out);
}
