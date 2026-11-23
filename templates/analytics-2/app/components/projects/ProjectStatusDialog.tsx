import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useDialogEscape } from "@/components/ui/useDialogEscape";
import type { Project } from "@/lib/model/contracts";

function userVisibleError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.trim();
  if (!message || /^Action\s+[a-z0-9_-]+\s+(failed|timed out)/i.test(message)) {
    return fallback;
  }
  return message;
}

export function ProjectStatusDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const statusesQuery = useActionQuery("list-data-statuses", {});
  const statusesUnreadable =
    statusesQuery.isError || (!statusesQuery.isPending && !statusesQuery.data);
  const statusesReady = !statusesQuery.isPending && !statusesUnreadable;
  const statuses = statusesQuery.data?.statuses ?? [];
  const [statusId, setStatusId] = useState(project.statusId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useDialogEscape(() => {
    if (!pending) onClose();
  });

  async function submit() {
    if (pending || !statusesReady) return;
    setPending(true);
    setError(null);
    try {
      await callAction("update-project", {
        projectId: project.id,
        statusId: statusId === "" ? null : statusId,
      });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      onClose();
    } catch (cause) {
      setError(
        userVisibleError(cause, "The project status could not be saved."),
      );
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
        <h2 id={`${id}-title`}>Set status</h2>
        <p>Choose a status for “{project.title || "Untitled project"}”.</p>
        <label className="ws-projects-transfer-label" htmlFor={`${id}-status`}>
          Status
        </label>
        <select
          id={`${id}-status`}
          className="ws-projects-transfer-input"
          value={statusId}
          disabled={pending || !statusesReady}
          onChange={(event) => setStatusId(event.target.value)}
        >
          <option value="">No status</option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        {statusesUnreadable ? (
          <div role="alert">
            <p className="ws-field-error">Statuses could not be loaded.</p>
            <button
              type="button"
              className="ws-projects-secondary"
              onClick={() => void statusesQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {error != null ? (
          <p className="ws-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ws-projects-import-actions">
          <button
            type="button"
            className="ws-projects-secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ws-projects-primary"
            disabled={pending || !statusesReady}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
