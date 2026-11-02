import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { AuthError, requireUser } from "@/lib/auth";
import { buildPack } from "@/lib/pack";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("faculty");
    const pack = await buildPack(await getDb(), user);
    return NextResponse.json(pack, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Could not load your classes." }, { status: 500 });
  }
}
