import { useEffect, useRef, type ReactNode } from "react";
export function ModalDialog({
  labelledBy,
  onCancel,
  children,
}: {
  labelledBy: string;
  onCancel?: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement;
    const focusable = dialog.current?.querySelector<HTMLElement>(
      'button, input, select, [tabindex="0"]',
    );
    focusable?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <div className="ds-modal-backdrop">
      <div
        className="ds-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ) ?? [],
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && window.document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            window.document.activeElement === last
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
