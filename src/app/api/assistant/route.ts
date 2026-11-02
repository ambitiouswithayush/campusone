import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { ask } from "@/lib/assistant/execute";
import { AuthError, requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser("office_admin");
    if (!rateLimit(`ask:${user.uid}`, 20, 60_000)) return NextResponse.json({ error: "Too many questions — wait a minute." }, { status: 429 });
    const body = z.object({ question: z.string().trim().min(3, "Ask a question.").max(300) }).safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
    const answer = await ask(await getDb(), user, body.data.question);
    return NextResponse.json(answer);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "The assistant failed. Try again." }, { status: 500 });
  }
}
