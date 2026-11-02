"use client";
import { useEffect } from "react";

/** Registers the offline worker in production builds (dev rebuilds make caching confusing). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed", e));
  }, []);
  return null;
}
