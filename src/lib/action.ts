import { ZodError } from "zod";
import { AccessError } from "./access";
import { AuthError } from "./auth";
import { FeeError } from "./fees";
import { MarksError } from "./marks";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Run a server action body and turn expected failures into a message the UI can show. */
export async function act<T>(fn: () => Promise<T | void>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data: data ?? undefined, message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof AuthError || e instanceof AccessError || e instanceof MarksError || e instanceof FeeError || e instanceof UserError) {
      return { ok: false, error: e.message };
    }
    // Next.js uses thrown errors for redirects; let those through.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export class UserError extends Error {}
