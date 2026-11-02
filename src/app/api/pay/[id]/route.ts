import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { completeMockPayment, FeeError } from "@/lib/fees";
import { rateLimit } from "@/lib/rate-limit";

/** Stands in for the gateway's server-to-server callback. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!rateLimit(`pay:${id}`, 10, 60_000)) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  const body = z.object({ outcome: z.enum(["success", "failed"]) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const p = await completeMockPayment(await getDb(), id, body.data.outcome);
    return NextResponse.json({ status: p.status, receiptNo: p.receiptNo });
  } catch (e) {
    if (e instanceof FeeError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
