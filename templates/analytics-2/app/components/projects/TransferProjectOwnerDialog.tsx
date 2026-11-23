import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { useDialogEscape } from "@/components/ui/useDialogEscape";
import type { Project } from "@/lib/model/contracts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TransferProjectOwnerDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  useDialogEscape(onClose);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending || !EMAIL.test(email.trim())) return;
    setPending(true);
    setError(null);
    try {
      await callAction("transfer-project-owner", {
        projectId: project.id,
        ownerEmail: email.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      toast.success(t("projectTransfer.done"));
      onClose();
    } catch {
      setError(t("projectTransfer.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <div
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>{t("projectTransfer.title")}</h2>
        <p>
          {t("projectTransfer.body", {
            title: project.title || t("projectTransfer.untitled"),
          })}
        </p>
        <label className="ws-projects-transfer-label" htmlFor={`${id}-email`}>
          {t("projectTransfer.emailLabel")}
        </label>
        <input
          id={`${id}-email`}
          className="ws-projects-transfer-input"
          type="email"
          autoFocus
          value={email}
          disabled={pending}
          placeholder="name@company.com"
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {error != null ? (
          <p className="ws-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ws-projects-import-actions">
          <button
            type="button"
            className="ws-projects-secondary"
            onClick={onClose}
          >
            {t("projectTransfer.cancel")}
          </button>
          <button
            type="button"
            className="ws-projects-primary"
            disabled={pending || !EMAIL.test(email.trim())}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            {t("projectTransfer.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
