"use client";
import { useEffect, useState } from "react";

/** Single transient message; good enough for one-action-at-a-time screens. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.tone === "error" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div
      role="status"
      className={`animate-fade-up fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-md rounded-lg px-4 py-3 text-center text-sm text-white shadow-lg lg:bottom-8 ${msg.tone === "error" ? "bg-danger" : "bg-ink"}`}
    >
      {msg.text}
    </div>
  ) : null;
  return { toast: (text: string, tone: "ok" | "error" = "ok") => setMsg({ text, tone }), node };
}
