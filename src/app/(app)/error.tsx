"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button, Card, EmptyState, LinkButton } from "@/components/ui";

/** A page failed on the server (database unreachable, unexpected bug). The shell and menu stay usable. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle size={22} />}
        title="This page couldn't load"
        body={
          <>
            Nothing you entered was lost. Check your connection and try again; if it keeps happening, tell the office
            {error.digest ? <> and quote <span className="font-mono text-ink-2">{error.digest}</span></> : null}.
          </>
        }
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={reset}>Try again</Button>
            <LinkButton href="/">Go home</LinkButton>
          </div>
        }
      />
    </Card>
  );
}
