import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type Role, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 = 403,
  ) {
    super(message);
  }
}

export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** For pages: redirect to login, or to the home screen if the role is not allowed. */
export async function requirePageUser(...roles: Role[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** For server actions and API routes: throw instead of redirecting. */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AuthError("Please sign in again.", 401);
  if (roles.length && !roles.includes(user.role)) throw new AuthError("You do not have access to this.");
  return user;
}

export function homeFor(role: Role): string {
  return role === "faculty" ? "/today" : "/dashboard";
}
