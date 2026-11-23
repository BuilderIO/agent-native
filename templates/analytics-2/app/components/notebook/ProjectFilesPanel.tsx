import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@agent-native/toolkit/ui/dialog";
import { IconDownload, IconTrash, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { notebookMessages } from "@/i18n/messages/notebook";

type ProjectFile = {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};
type Upload = {
  projectId: string;
  filename: string;
  mimeType: string;
  dataBase64: string;
};
type CsvImport = {
  projectId: string;
  filename: string;
  dataBase64: string;
};
type CsvImportResult = {
  dataset: { id: string; name: string; rowCount: number };
};

const messages = notebookMessages.notebook.projectFiles;

export function ProjectFilesPanel({
  projectId,
  onClose,
  canEdit = true,
}: {
  projectId: string;
  canEdit?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const files = useActionQuery<{ files: ProjectFile[] }>("list-project-files", {
    projectId,
  });
  const upload = useActionMutation<{ file: ProjectFile }, Upload>(
    "upload-project-file",
  );
  const trash = useActionMutation<
    { trashed: boolean },
    { projectId: string; fileId: string }
  >("trash-project-file");
  const section = useRef<HTMLElement>(null);
  const deleteOpener = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const importCsv = useActionMutation<CsvImportResult, CsvImport>(
    "import-project-csv",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<ProjectFile | null>(null);
  const [sort, setSort] = useState<"modified" | "name">("modified");
  const rows = [...(files.data?.files ?? [])].sort((a, b) =>
    sort === "name"
      ? a.filename.localeCompare(b.filename)
      : b.createdAt.localeCompare(a.createdAt),
  );

  async function add(selected: FileList | null) {
    if (!selected?.length) return;
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      for (const file of Array.from(selected)) {
        if (!file.size || file.size > 2 * 1024 * 1024)
          throw new Error(t("notebook.projectFiles.uploadSize"));
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await upload.mutateAsync({
          projectId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: btoa(binary),
        });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("notebook.projectFiles.uploadFailed"),
      );
    } finally {
      await files.refetch();
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function importSelectedCsv(selected: FileList | null) {
    const file = selected?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportResult(null);
      setError(messages.csvRequired);
      if (csvInput.current) csvInput.current.value = "";
      return;
    }
    if (!file.size || file.size > 2 * 1024 * 1024) {
      setImportResult(null);
      setError(messages.csvSize);
      if (csvInput.current) csvInput.current.value = "";
      return;
    }
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await importCsv.mutateAsync({
        projectId,
        filename: file.name,
        dataBase64: btoa(binary),
      });
      setImportResult(
        (result.dataset.rowCount === 1
          ? messages.importedSingular
          : messages.importedPlural
        )
          .replace("{{name}}", result.dataset.name)
          .replace("{{rows}}", String(result.dataset.rowCount)),
      );
    } catch (e) {
      setError(actionErrorMessage(e) ?? messages.importFailed);
    } finally {
      setBusy(false);
      if (csvInput.current) csvInput.current.value = "";
    }
  }

  async function download(file: ProjectFile) {
    setError(null);
    try {
      const result = await callAction<{
        file: ProjectFile;
        dataBase64: string;
      }>("download-project-file", { projectId, fileId: file.id });
      const bytes = Uint8Array.from(atob(result.dataBase64), (c) =>
        c.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.file.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.file.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("notebook.projectFiles.downloadFailed"),
      );
    }
  }

  return (
    <aside className="nb-side-panel" aria-label="Files">
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">Files</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label="Close Files"
          onClick={onClose}
        >
          <IconX size={14} />
        </button>
      </header>
      <section ref={section} tabIndex={-1} className="px-3 py-2 outline-none">
        <h3 className="text-sm font-medium text-foreground">Imported files</h3>
        {canEdit ? (
          <div className="mt-2 flex flex-col gap-2">
            <input
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              aria-label={messages.importCsv}
              onChange={(e) => void importSelectedCsv(e.currentTarget.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => csvInput.current?.click()}
            >
              {busy ? messages.importing : messages.importCsv}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label={t("notebook.projectFiles.uploadFiles")}
              onChange={(e) => void add(e.currentTarget.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy
                ? t("notebook.projectFiles.uploading")
                : t("notebook.projectFiles.uploadFiles")}
            </Button>
          </div>
        ) : null}
        {importResult ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {importResult}
          </p>
        ) : null}
        {error || files.error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error ?? t("notebook.projectFiles.loadFailed")}
            {files.error ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void files.refetch()}
              >
                {t("notebook.projectFiles.retry")}
              </Button>
            ) : null}
          </p>
        ) : null}
        {files.isPending ? (
          <div
            className="mt-3 h-16 animate-pulse bg-muted"
            aria-label="Loading files"
          />
        ) : null}
        {rows.length ? (
          <>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {rows.length} {rows.length === 1 ? "file" : "files"}
              </span>
              <label>
                {t("notebook.projectFiles.sortLabel")}{" "}
                <select
                  aria-label={t("notebook.projectFiles.sortFiles")}
                  value={sort}
                  onChange={(e) =>
                    setSort(e.target.value === "name" ? "name" : "modified")
                  }
                >
                  <option value="modified">
                    {t("notebook.projectFiles.lastModified")}
                  </option>
                  <option value="name">
                    {t("notebook.projectFiles.sortName")}
                  </option>
                </select>
              </label>
            </div>
            <ul className="mt-2">
              {rows.map((file) => (
                <li
                  key={file.id}
                  className="flex min-w-0 items-center gap-1 border-b border-border py-2 text-xs text-foreground"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {file.filename}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Download ${file.filename}`}
                    onClick={() => void download(file)}
                  >
                    <IconDownload size={14} />
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${file.filename}`}
                      onClick={(event) => {
                        deleteOpener.current = event.currentTarget;
                        setConfirmTrash(file);
                      }}
                    >
                      <IconTrash size={14} />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                void (async () => {
                  for (const file of rows) await download(file);
                })()
              }
            >
              Download files
            </Button>
          </>
        ) : null}
      </section>
      <Dialog
        open={confirmTrash !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTrash(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            const opener = deleteOpener.current;
            deleteOpener.current = null;
            if (opener?.isConnected) return;
            event.preventDefault();
            section.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground">{confirmTrash?.filename}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTrash(null)}>
              Cancel
            </Button>
            <Button
              autoFocus
              variant="destructive"
              disabled={trash.isPending}
              onClick={() => {
                if (confirmTrash)
                  void trash
                    .mutateAsync({ projectId, fileId: confirmTrash.id })
                    .then(() => {
                      deleteOpener.current = null;
                      setConfirmTrash(null);
                      return files.refetch();
                    })
                    .catch((e) =>
                      setError(
                        e instanceof Error
                          ? e.message
                          : t("notebook.projectFiles.deleteFailed"),
                      ),
                    );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
