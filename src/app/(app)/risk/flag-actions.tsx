"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Button, Spinner } from "@/components/ui";
import { rescanAction, updateFlagAction } from "./actions";

export function FlagActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "resolved" | "dismissed">(null);
  const [note, setNote] = useState("");

  const update = (s: "in_progress" | "resolved" | "dismissed") =>
    start(async () => {
      const r = await updateFlagAction({ id, status: s, note: s === "in_progress" ? undefined : note });
      if (!r.ok) return toast(r.error, "error");
      toast(r.message ?? "Updated");
      setDialog(null);
      setNote("");
      router.refresh();
    });

  return (
    <div className="flex gap-1.5">
      {status === "open" && <Button size="sm" onClick={() => update("in_progress")} disabled={pending}>Start</Button>}
      <Button size="sm" variant="primary" onClick={() => setDialog("resolved")} disabled={pending}>Resolve</Button>
      <Button size="sm" variant="ghost" onClick={() => setDialog("dismissed")} disabled={pending}>Not at risk</Button>
      {(["resolved", "dismissed"] as const).map((d) => (
        <Dialog
          key={d}
          open={dialog === d}
          onClose={() => setDialog(null)}
          title={d === "resolved" ? "Resolve mentor task" : "Mark as not at risk"}
          footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" disabled={pending || note.trim().length < 5} onClick={() => update(d)}>Save</Button></>}
        >
          <p className="mb-3">{d === "resolved" ? "What was done? (e.g. met parents, remedial classes arranged)" : "Why is the flag wrong? This helps tune the model."}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-lg border border-line-strong p-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
        </Dialog>
      ))}
      {node}
    </div>
  );
}

export function RescanButton() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        onClick={() =>
          start(async () => {
            const r = await rescanAction();
            if (!r.ok) return toast(r.error, "error");
            const d = r.data!;
            toast(`${d.created} new · ${d.refreshed} refreshed · ${d.autoClosed} auto-closed · ${d.insufficient} not enough data`);
            router.refresh();
          })
        }
        disabled={pending}
      >
        {pending ? <Spinner /> : <RefreshCw size={15} />} Re-run scan
      </Button>
      {node}
    </>
  );
}
