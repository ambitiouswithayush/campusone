"use client";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/toast";
import { Button, Spinner } from "@/components/ui";
import { runJobsAction } from "./actions";

export function RunJobs() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        onClick={() =>
          start(async () => {
            const r = await runJobsAction();
            if (!r.ok) return toast(r.error, "error");
            const d = r.data!;
            toast(`${d.shortage.queued} shortage alerts · ${d.fees.queued} fee reminders · ${d.risk.created} new risk flags`);
            router.refresh();
          })
        }
        disabled={pending}
      >
        {pending ? <Spinner /> : <Play size={14} />} Run now
      </Button>
      {node}
    </>
  );
}
