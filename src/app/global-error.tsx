"use client";

import "./globals.css";

/** Last resort when the root layout itself fails (for example the database is down while loading the shell). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-dvh items-center justify-center px-6 text-center">
          <div>
            <h1 className="text-lg font-semibold text-ink">CampusOne is having trouble</h1>
            <p className="mt-1 max-w-sm text-sm text-ink-2">
              The server couldn&apos;t be reached. Attendance saved on your phone is safe and will sync later.
              {error.digest ? <> Reference <span className="font-mono">{error.digest}</span>.</> : null}
            </p>
            <button onClick={reset} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Try again</button>
          </div>
        </main>
      </body>
    </html>
  );
}
