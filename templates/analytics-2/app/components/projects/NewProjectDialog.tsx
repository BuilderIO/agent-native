import { useId, useState } from "react";

import { CharacterCount } from "@/components/ui/CharacterCount";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PROJECT_DESCRIPTION_MAX_LENGTH } from "@/lib/model/contracts";

/**
 * New project. The source opens a dialog with a name, a description and a
 * "Create project" action before the project exists; creating straight into an
 * "Untitled project" skipped the name the person wanted to give it.
 */
export function NewProjectDialog({
  pending,
  error,
  onCancel,
  onCreate,
}: {
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (input: { title: string; description: string }) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="ws-projects-import-dialog"
        hideClose
        motion="instant"
        overlayClassName="ws-projects-import-backdrop"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending || !title.trim()) return;
            onCreate({ title: title.trim(), description: description.trim() });
          }}
        >
          <DialogTitle>New project</DialogTitle>
          <label className="ws-projects-transfer-label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input
            id={`${id}-name`}
            className="ws-projects-transfer-input"
            type="text"
            value={title}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label
            className="ws-projects-transfer-label"
            htmlFor={`${id}-description`}
          >
            Description
          </label>
          <textarea
            id={`${id}-description`}
            className="ws-projects-transfer-input ws-new-project-description"
            value={description}
            maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
            placeholder="Add description..."
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
          />
          <CharacterCount
            count={description.length}
            max={PROJECT_DESCRIPTION_MAX_LENGTH}
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
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ws-projects-primary"
              disabled={pending || !title.trim()}
              aria-busy={pending}
            >
              Create project
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
