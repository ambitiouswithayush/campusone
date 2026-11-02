"use client";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog> for focus trapping and Esc handling without a library. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30"
    >
      {open && (
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="-m-1.5 rounded-lg p-1.5 text-ink-3 hover:bg-canvas" aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="text-sm text-ink-2">{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
