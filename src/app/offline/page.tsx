import { Logo } from "@/components/logo";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mb-5 flex justify-center"><Logo /></div>
        <h1 className="text-lg font-semibold">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-ink-2">This page hasn&apos;t been saved on this device yet. Attendance works offline once you have opened it with a connection.</p>
        <a href="/today" className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Open attendance</a>
      </div>
    </main>
  );
}
