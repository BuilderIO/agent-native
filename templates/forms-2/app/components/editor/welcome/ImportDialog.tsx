import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconUpload } from "@tabler/icons-react";
import { useRef, useState, type DragEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  ImportError,
  MAX_TEXT_IMPORT_BYTES,
  importKindOf,
  parseImportText,
  type ParsedImport,
} from "../import/import-parse";

const MAX_AGENT_IMPORT_BYTES = 10_000_000;
const ACCEPT =
  ".csv,.md,.markdown,.txt,.json,.pdf,.doc,.docx,image/*,text/plain";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImportDialog({
  open,
  onOpenChange,
  formId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  onImported: (parsed: ParsedImport) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
    setError(null);
    const kind = importKindOf(file.name, file.type);
    if (!kind) return setError(t("forms.import.unsupported"));
    const limit =
      kind === "text" ? MAX_TEXT_IMPORT_BYTES : MAX_AGENT_IMPORT_BYTES;
    if (file.size > limit)
      return setError(
        t("forms.import.tooLarge", { size: Math.floor(limit / 1_000_000) }),
      );
    setBusy(true);
    try {
      if (kind === "text") {
        onImported(parseImportText(file.name, await file.text()));
        return;
      }
      const url = await readAsDataUrl(file);
      sendToAgentChat({
        message: t("forms.import.agentPrompt", { id: formId, name: file.name }),
        attachments: [
          {
            type: file.type.startsWith("image/") ? "image" : "file",
            name: file.name,
            mediaType: file.type,
            contentType: file.type,
            url,
          },
        ],
        submit: true,
        openSidebar: true,
      });
      onOpenChange(false);
    } catch (failure) {
      // coercion-ok: any read or parse failure is shown as the matching import error.
      setError(
        failure instanceof ImportError && failure.reason === "noQuestions"
          ? t("forms.import.noQuestions")
          : t("forms.import.unreadable"),
      );
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handle(file);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("forms.start.importForm")}</DialogTitle>
          <DialogDescription>{t("forms.import.description")}</DialogDescription>
        </DialogHeader>
        <section aria-label={t("forms.import.fromFile")} className="grid gap-3">
          <h3 className="text-sm font-semibold">
            {t("forms.import.fromFile")}
          </h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input text-sm text-muted-foreground transition-colors hover:bg-accent/50",
              dragging && "bg-accent/60",
            )}
          >
            <IconUpload aria-hidden className="size-5" />
            <span className="font-medium text-foreground">
              {t("forms.import.chooseFile")}
            </span>
            <span className="text-xs">{t("forms.import.fileTypes")}</span>
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept={ACCEPT}
            aria-label={t("forms.import.chooseFile")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handle(file);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("forms.import.agentNote")}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
