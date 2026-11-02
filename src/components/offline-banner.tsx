"use client";
import { WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useOnline } from "@/lib/offline/use-online";

export function OfflineBanner() {
  const online = useOnline();
  const pathname = usePathname();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-ink px-4 py-2 text-xs text-white">
      <WifiOff size={14} />
      {pathname.startsWith("/today")
        ? "Offline — attendance is saved on this phone and will sync automatically."
        : "You're offline. This page needs a connection; attendance still works offline."}
    </div>
  );
}
