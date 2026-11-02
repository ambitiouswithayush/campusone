import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session helpers (used by middleware and server code). */

export const SESSION_COOKIE = "co_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

export type Role = "faculty" | "office_admin";

export interface SessionUser {
  uid: number;
  name: string;
  role: Role;
  campusId: number;
  facultyId: number | null;
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters (run `npm run setup`).");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const { uid, name, role, campusId, facultyId } = payload as unknown as SessionUser;
    if (typeof uid !== "number" || (role !== "faculty" && role !== "office_admin")) return null;
    return { uid, name, role, campusId, facultyId: facultyId ?? null };
  } catch {
    return null;
  }
}
