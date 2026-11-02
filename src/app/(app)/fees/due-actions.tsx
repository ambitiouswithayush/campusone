"use client";
import { Copy, ExternalLink, Link2, MessageSquare, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Notice } from "@/components/ui";
import { inr } from "@/lib/format";
import { createLinkAction, recordPaymentAction, remindAction } from "./actions";

export function DueActions({ invoiceId, studentId, due, name, canMessage }: { invoiceId: number; studentId: number; due: number; name: string; canMessage: boolean }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "pay" | "link">(null);
  const [amount, setAmount] = useState(String(due));
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const pay = () =>
    start(async () => {
      setError(null);
      const r = await recordPaymentAction(invoiceId, Number(amount), ref);
      if (!r.ok) return setError(r.error);
      setOpen(null);
      toast(`Receipt ${r.data?.receiptNo} issued`);
      router.refresh();
    });

  const makeLink = () =>
    start(async () => {
      const r = await createLinkAction(invoiceId);
      if (!r.ok) return toast(r.error, "error");
      setLink(r.data!.url);
      setOpen("link");
    });

  const remind = () =>
    start(async () => {
      const r = await remindAction(studentId);
      toast(r.ok ? (r.message ?? "Sent") : r.error, r.ok ? "ok" : "error");
    });

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => { setAmount(String(due)); setRef(""); setError(null); setOpen("pay"); }} title="Record bank payment">
        <Wallet size={14} /> <span className="hidden xl:inline">Record</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={makeLink} disabled={pending} title="Create payment link">
        <Link2 size={14} /> <span className="hidden xl:inline">Link</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={remind} disabled={pending || !canMessage} title={canMessage ? "Send fee reminder to parent" : "No parental consent on record"}>
        <MessageSquare size={14} /> <span className="hidden xl:inline">Remind</span>
      </Button>

      <Dialog
        open={open === "pay"}
        onClose={() => setOpen(null)}
        title={`Record payment · ${name}`}
        footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button variant="primary" onClick={pay} disabled={pending}>Issue receipt</Button></>}
      >
        <div className="space-y-3 text-left">
          <p>Balance due {inr(due)}. Use the reference printed on the bank counter slip.</p>
          <Field label="Amount (₹)">
            <Input type="number" inputMode="numeric" min={1} max={due} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Bank reference" hint="6–30 letters or digits, e.g. SBIN26004512">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} autoCapitalize="characters" />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Dialog>

      <Dialog open={open === "link"} onClose={() => setOpen(null)} title="Payment link (test mode)">
        <div className="space-y-3 text-left">
          <p>Share this with the parent. It collects {inr(due)} in test mode and issues a receipt automatically.</p>
          <div className="flex gap-2">
            <Input readOnly value={link ?? ""} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { navigator.clipboard?.writeText(link ?? ""); toast("Link copied"); }} aria-label="Copy link"><Copy size={15} /></Button>
          </div>
          <a href={link ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            Open as parent <ExternalLink size={13} />
          </a>
        </div>
      </Dialog>
      {node}
    </div>
  );
}
