import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useId, useRef, useState } from "react";

import { CharacterCount } from "@/components/ui/CharacterCount";
import { useDialogEscape } from "@/components/ui/useDialogEscape";
import { PROJECT_TITLE_MAX_LENGTH, type Project } from "@/lib/model/contracts";

export function RenameProjectDialog({
  project,
  onRename,
  onClose,
}: {
  project: Project;
  onRename: (projectId: string, title: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  useDialogEscape(onClose);
  const id = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState(project.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const trimmed = title.trim();

  useEffect(() => {
    setTitle(project.title);
    setError(null);
  }, [project.id]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    inputRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        (document.activeElement === null ||
          document.activeElement === document.body ||
          dialog?.contains(document.activeElement))
      ) {
        previous.focus();
      }
    };
  }, []);

  async function submit() {
    if (pending || trimmed === "" || trimmed === project.title.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onRename(project.id, trimmed);
      onClose();
    } catch (cause) {
      setError(
        actionErrorMessage(cause) ??
          (cause instanceof Error
            ? cause.message
            : t("analytics.lists.renameFailed")),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={`${id}-title`}>{t("analytics.lists.actionRename")}</h2>
        <label className="ws-projects-transfer-label" htmlFor={`${id}-input`}>
          {t("analytics.lists.itemName")}
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="ws-projects-transfer-input"
          value={title}
          maxLength={PROJECT_TITLE_MAX_LENGTH}
          disabled={pending}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error != null) setError(null);
          }}
        />
        <CharacterCount count={title.length} max={PROJECT_TITLE_MAX_LENGTH} />
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
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="ws-projects-primary"
            disabled={
              pending || trimmed === "" || trimmed === project.title.trim()
            }
            aria-busy={pending}
          >
            {t("analytics.lists.actionRename")}
          </button>
        </div>
      </form>
    </div>
  );
}
