import { useEffect, useRef, useState } from "react";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

import { toNotebookError } from "./utils";

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.4)",
};
const panel: React.CSSProperties = {
  width: 420,
  maxWidth: "calc(100vw - 32px)",
  padding: 20,
  borderRadius: 6,
  background: "var(--ws-menu-surface, #1f1f29)",
  boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
  fontSize: 14,
  lineHeight: "20px",
};
const actions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};

export function ConfirmTrashDialog({
  isOpen,
  ...props
}: {
  isOpen: boolean;
  projectTitle: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return isOpen ? <OpenConfirmTrashDialog {...props} /> : null;
}

function OpenConfirmTrashDialog({
  projectTitle,
  onClose,
  onConfirm,
}: {
  projectTitle: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useConfirmDialogBehavior({ onCancel: onClose, confirmRef });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      if (alive.current) onClose();
    } catch (confirmError) {
      if (alive.current) setError(toNotebookError(confirmError).message);
    } finally {
      if (alive.current) setPending(false);
    }
  }

  return (
    <div style={backdrop} role="presentation" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm move to trash"
        style={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Confirm move to trash
        </h2>
        <p style={{ margin: "10px 0 0" }}>
          Are you sure you want to move <strong>{projectTitle}</strong> to
          trash?
        </p>
        {error ? (
          <p role="alert" className="nb-banner nb-banner-danger">
            {error}
          </p>
        ) : null}
        <div style={actions}>
          <button
            type="button"
            className="nb-button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="nb-button nb-button-danger"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? "Moving…" : "Move to trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
