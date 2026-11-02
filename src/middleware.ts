import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC = [/^\/login/, /^\/pay\//, /^\/api\/pay\//, /^\/receipt\//, /^\/offline/, /^\/api\/cron\//, /^\/api\/health/];
const ADMIN_ONLY = [/^\/dashboard/, /^\/fees/, /^\/ask/, /^\/setup/, /^\/api\/assistant/];
const FACULTY_ONLY = [/^\/today/, /^\/api\/faculty/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api/");
  if (!user) {
    if (isApi) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const home = user.role === "faculty" ? "/today" : "/dashboard";
  if (pathname === "/") return NextResponse.redirect(new URL(home, req.url));
  const denied =
    (user.role !== "office_admin" && ADMIN_ONLY.some((r) => r.test(pathname))) ||
    (user.role !== "faculty" && FACULTY_ONLY.some((r) => r.test(pathname)));
  if (denied) {
    return isApi ? NextResponse.json({ error: "Not allowed for your role." }, { status: 403 }) : NextResponse.redirect(new URL(home, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|sw.js|manifest.webmanifest|icon.svg|favicon.ico).*)"],
};
