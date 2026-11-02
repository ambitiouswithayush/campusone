"use client";
import { useActionState, useRef } from "react";
import { Button, Field, Input, Notice, Spinner } from "@/components/ui";
import { login, type LoginState } from "./actions";

const DEMO = [
  { email: "priya.das@campusone.test", label: "Faculty", who: "Dr. Priya Das · CSE" },
  { email: "admin@campusone.test", label: "Office admin", who: "Sunita Mahapatra · Engineering" },
  { email: "rakesh.sahu@campusone.test", label: "Faculty", who: "Rakesh Sahu · Mechanical" },
];

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  return (
    <>
      <form action={action} className="mt-6 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Email">
          <Input ref={email} name="email" type="email" autoComplete="username" required defaultValue={state.email} placeholder="name@campusone.test" />
        </Field>
        <Field label="Password">
          <Input ref={password} name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state.error && <Notice tone="danger">{state.error}</Notice>}
        <Button type="submit" variant="primary" className="w-full" size="lg" disabled={pending}>
          {pending ? <Spinner /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-8 rounded-xl border border-dashed border-line-strong p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Demo accounts · password Demo@2026</p>
        <div className="mt-3 space-y-1.5">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                if (email.current) email.current.value = d.email;
                if (password.current) password.current.value = "Demo@2026";
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface"
            >
              <span className="text-ink">{d.who}</span>
              <span className="text-xs text-ink-3">{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
