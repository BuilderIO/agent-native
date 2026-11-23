import { useId, useRef, useState, type ChangeEvent } from "react";

import { useDialogEscape } from "@/components/ui/useDialogEscape";

import "./projects.css";

import {
  parseIpynbProject,
  type ImportedNotebook,
} from "@/lib/notebook-ipynb-import";

export interface ImportProjectDialogProps {
  onClose: () => void;
  onImport: (notebook: ImportedNotebook, title: string) => Promise<void>;
}

/**
 * The Import project entry accepts a project archive or a Jupyter notebook.
 * The notebook branch is implemented here; the shell supplies the
 * create-project/add-cell caller.
 */
export function ImportProjectDialog({
  onClose,
  onImport,
}: ImportProjectDialogProps) {
  useDialogEscape(onClose);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [notebook, setNotebook] = useState<ImportedNotebook | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setNotebook(null);
    try {
      setNotebook(parseIpynbProject(await file.text()));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This notebook could not be read.",
      );
    }
  }

  async function submit() {
    if (!notebook || pending) return;
    setPending(true);
    setError(null);
    try {
      const title =
        notebook.title ??
        (fileName.replace(/\.ipynb$/i, "").trim() || "Untitled project");
      await onImport(notebook, title);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The project could not be created.",
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
        <h2 id={`${id}-title`}>Upload project</h2>
        {/* A notebook archive is accepted here too; this build reads
            Jupyter notebooks only, so the sentence promises just that. */}
        <p>Upload a Jupyter notebook (.ipynb) file to create a new project.</p>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept=".ipynb,application/x-ipynb+json"
          onChange={(event) => void pick(event)}
        />
        {fileName ? (
          <p className="ws-projects-import-file">{fileName}</p>
        ) : null}
        {notebook ? (
          <p className="ws-projects-import-summary">
            {notebook.cells.length} cell
            {notebook.cells.length === 1 ? "" : "s"} ready
            {notebook.title ? ` from “${notebook.title}”` : ""}.
          </p>
        ) : null}
        {error ? (
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
            Cancel
          </button>
          <button
            type="button"
            className="ws-projects-primary"
            disabled={!notebook || pending}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
