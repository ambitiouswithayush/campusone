"use server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { homeFor } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/session";

const LoginInput = z.object({
  email: z.email("Enter a valid email.").max(120).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().max(200).optional(),
});

export type LoginState = { error?: string; email?: string };

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };
  const { email, password, next } = parsed.data;

  if (!rateLimit(`login:${email}`, 8, 10 * 60_000)) {
    return { error: "Too many attempts. Wait 10 minutes or ask the office to reset your password.", email };
  }
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // Compare even when the user is unknown so response time does not reveal which emails exist.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok) return { error: "Email or password is incorrect.", email };

  const token = await signSession({ uid: user.id, name: user.name, role: user.role, campusId: user.campusId, facultyId: user.facultyId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  redirect(safeNext ?? homeFor(user.role));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
