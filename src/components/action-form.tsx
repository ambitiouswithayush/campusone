"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Notice } from "./ui";

type State = { ok: boolean; error?: string; message?: string } | null;

/** A form bound to a server action that shows its error or success inline and resets on success. */
export function ActionForm({ action, children, className }: { action: (prev: State, form: FormData) => Promise<State>; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && !state.ok && <Notice tone="danger" className="col-span-full mt-1">{state.error}</Notice>}
      {state?.ok && state.message && <Notice tone="ok" className="col-span-full mt-1">{state.message}</Notice>}
    </form>
  );
}
