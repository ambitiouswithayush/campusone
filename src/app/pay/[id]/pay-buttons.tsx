"use client";
import { CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Spinner, buttonClass } from "@/components/ui";

export function PayButtons({ id, status, receiptPath }: { id: string; status: "pending" | "success" | "failed"; receiptPath: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "success" | "failed">(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (outcome: "success" | "failed") => {
    setBusy(outcome);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Payment failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(null);
    }
  };

  if (status === "success") {
    return (
      <div className="mt-6 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={36} />
        <p className="mt-2 text-sm font-medium">Payment received</p>
        {receiptPath && <a href={receiptPath} className={buttonClass("primary") + " mt-4 w-full"}>View receipt</a>}
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="mt-6 text-center">
        <XCircle className="mx-auto text-danger" size={36} />
        <p className="mt-2 text-sm font-medium">Payment failed or the link expired</p>
        <p className="mt-1 text-xs text-ink-3">Ask the college office for a new link. You were not charged.</p>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-2">
      <Button variant="primary" size="lg" className="w-full" onClick={() => go("success")} disabled={!!busy}>
        {busy === "success" && <Spinner />} Pay now
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => go("failed")} disabled={!!busy}>
        Simulate a failed payment
      </Button>
      {error && <p className="text-center text-xs text-danger">{error}</p>}
    </div>
  );
}
