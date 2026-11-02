import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-ink-3">404</p>
        <h1 className="mt-1 text-lg font-semibold">Not found, or not yours to see</h1>
        <p className="mt-1 text-sm text-ink-2">Records outside your campus or classes are hidden.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">Go home</Link>
      </div>
    </main>
  );
}
