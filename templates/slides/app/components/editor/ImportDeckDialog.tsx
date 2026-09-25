import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconFileTypePdf,
  IconPresentation,
  IconBrandGoogle,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
import type { PromptImportSelection, PromptImportSource } from "./PromptDialog";

export function ImportDeckDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (selection: PromptImportSelection) => Promise<boolean | void>;
}) {
  const t = useT();
  const [kind, setKind] = useState<PromptImportSource>("pdf");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (busy || (kind === "google-slides" ? !url.trim() : !file)) return;
    setBusy(true);
    setError(undefined);
    try {
      const done = await onImport(
        kind === "google-slides"
          ? { kind, url: url.trim() }
          : { kind, files: [file!] },
      );
      if (done !== false) onOpenChange(false);
    } catch (cause) {
      setError(
        actionErrorMessage(cause) ?? t("editorToolbar.importFailedDescription"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("home.importDeck")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pdf", "PDF", IconFileTypePdf],
              ["pptx", "PPT", IconPresentation],
              [
                "google-slides",
                t("home.googleSlidesReferenceTitle"),
                IconBrandGoogle,
              ],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              variant={kind === value ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => {
                setKind(value);
                setFile(undefined);
                setError(undefined);
                if (input.current) input.current.value = "";
              }}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {kind === "google-slides" ? (
            <>
              <GoogleDriveConnectionCta />
              <Label htmlFor="slides-import-url">
                {t("home.googleSlidesReferenceUrl")}
              </Label>
              <Input
                id="slides-import-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
              />
            </>
          ) : (
            <>
              <Label htmlFor="slides-import-file">
                {t("editorToolbar.importFile")}
              </Label>
              <Input
                ref={input}
                id="slides-import-file"
                type="file"
                accept={
                  kind === "pdf"
                    ? ".pdf,application/pdf"
                    : ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                }
                onChange={(event) => setFile(event.target.files?.[0])}
                disabled={busy}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                busy || (kind === "google-slides" ? !url.trim() : !file)
              }
            >
              {t(busy ? "editorToolbar.importing" : "home.importDeck")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
