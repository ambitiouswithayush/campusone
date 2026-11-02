import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser, homeFor } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getUser();
  if (user) redirect(homeFor(user.role));
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo />
          <div>
            <p className="text-[15px] font-semibold leading-tight">CampusOne</p>
            <p className="text-xs text-ink-3">Company A · Bhubaneswar</p>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">Use your college email.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
