"use client";
import clsx from "clsx";
import {
  BarChart3,
  BookOpenCheck,
  CalendarCheck,
  HeartHandshake,
  IndianRupee,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  Settings2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/login/actions";
import type { Role } from "@/lib/session";
import { Logo } from "./logo";
import { OfflineBanner } from "./offline-banner";
import { clearOfflineData } from "@/lib/offline/store";

interface NavItem { href: string; label: string; icon: typeof Users }

const NAV: Record<Role, NavItem[]> = {
  faculty: [
    { href: "/today", label: "Attendance", icon: CalendarCheck },
    { href: "/marks", label: "Marks", icon: BookOpenCheck },
    { href: "/students", label: "Students", icon: Users },
    { href: "/risk", label: "Mentees", icon: HeartHandshake },
  ],
  office_admin: [
    { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/students", label: "Students", icon: Users },
    { href: "/marks", label: "Marks", icon: BookOpenCheck },
    { href: "/fees", label: "Fees", icon: IndianRupee },
    { href: "/risk", label: "At-risk", icon: HeartHandshake },
    { href: "/ask", label: "Ask", icon: MessageSquareText },
    { href: "/setup", label: "Setup", icon: Settings2 },
  ],
};

export function Shell({ role, name, campus, children }: { role: Role; name: string; campus: string; children: ReactNode }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const items = NAV[role];
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const signOut = async () => {
    // Shared staff-room phones: wipe cached rosters and pages before leaving.
    try {
      await clearOfflineData();
    } catch {
      return; // teacher chose to keep unsynced attendance
    }
    await logout();
  };

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Logo size={28} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">CampusOne</p>
            <p className="truncate text-xs text-ink-3">{campus}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active(i.href) ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-2 hover:bg-canvas hover:text-ink",
              )}
            >
              <i.icon size={17} strokeWidth={1.8} />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-ink-3">{role === "faculty" ? "Faculty" : "Office admin"}</p>
          </div>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-canvas hover:text-ink">
            <LogOut size={17} strokeWidth={1.8} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-sm font-semibold">CampusOne</span>
          </div>
          <span className="max-w-[50%] truncate text-xs text-ink-3">{name}</span>
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg">
          {primary.map((i) => (
            <Link key={i.href} href={i.href} className={clsx("flex flex-1 flex-col items-center gap-1 py-2 text-[11px]", active(i.href) ? "text-accent" : "text-ink-3")}>
              <i.icon size={20} strokeWidth={active(i.href) ? 2.1 : 1.8} />
              {i.label}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-ink-3">
            <MoreHorizontal size={20} strokeWidth={1.8} />
            More
          </button>
        </div>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMore(false)} />
          <div className="animate-fade-up absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">{name}</p>
              <button onClick={() => setMore(false)} className="rounded-lg p-2 text-ink-3 hover:bg-canvas" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {overflow.map((i) => (
              <Link key={i.href} href={i.href} onClick={() => setMore(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-canvas">
                <i.icon size={18} strokeWidth={1.8} /> {i.label}
              </Link>
            ))}
            <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-ink-2 hover:bg-canvas">
              <LogOut size={18} strokeWidth={1.8} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
