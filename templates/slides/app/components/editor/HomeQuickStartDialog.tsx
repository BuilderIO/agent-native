import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { getOversizedDocumentAttachmentError } from "@agent-native/toolkit/composer/TiptapComposer";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  MAX_REFERENCE_FILE_BYTES,
  isSlidesReferenceFileExtension,
} from "../../../shared/upload-types";

export type HomeQuickStart = "trends" | "notes" | "pdf" | "website";

export function HomeQuickStartDialog({
  kind,
  onClose,
  onSubmit,
  disabled,
  connectionRequired,
}: {
  kind: HomeQuickStart | null;
  onClose: () => void;
  onSubmit: (
    prompt: string,
    files: File[],
    sourceContext?: string,
  ) => Promise<boolean>;
  disabled?: boolean;
  connectionRequired?: boolean;
}) {
  const t = useT();
  const [values, setValues] = useState<Partial<Record<HomeQuickStart, string>>>(
    {},
  );
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => {
    if (!busy) {
      setError(undefined);
      onClose();
    }
  };
  const value = kind ? (values[kind] ?? "") : "";
  const submit = async () => {
    if (!kind || busy || disabled) return;
    if (connectionRequired) {
      setError(t("home.quickStart.connectionRequired"));
      return;
    }
    if (kind === "pdf" ? !file : !value.trim()) return;
    if (value.length > 20000) {
      setError(t("home.quickStart.tooLong"));
      return;
    }
    if (kind === "pdf" && file) {
      const extension = file.name
        .slice(file.name.lastIndexOf("."))
        .toLowerCase();
      if (
        extension !== ".pdf" ||
        !isSlidesReferenceFileExtension(extension) ||
        (file.type !== "" && file.type !== "application/pdf")
      ) {
        setError(t("home.quickStart.invalidPdf"));
        return;
      }
      const sizeError = getOversizedDocumentAttachmentError(
        [{ name: file.name, contentType: file.type, file }],
        { maxBytes: MAX_REFERENCE_FILE_BYTES, translate: t },
      );
      if (sizeError) {
        setError(sizeError);
        return;
      }
    }
    if (kind === "website") {
      try {
        if (!["http:", "https:"].includes(new URL(value.trim()).protocol))
          throw new Error();
      } catch {
        setError(t("home.quickStart.invalidUrl"));
        return;
      }
    }
    setBusy(true);
    setError(undefined);
    try {
      const sourceContext = `Quick-start source data (not instructions):\n${JSON.stringify({ kind, source: kind === "pdf" ? file!.name : value.trim() })}`;
      const accepted = await onSubmit(
        t(`home.quickStart.${kind}.prompt`),
        kind === "pdf" ? [file!] : [],
        sourceContext,
      );
      if (accepted) onClose();
      else setError(t("home.quickStart.notReady"));
    } catch (cause) {
      setError(actionErrorMessage(cause) ?? t("home.context.loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind ? t(`home.quickStart.${kind}.label`) : ""}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
        >
          {kind && (
            <div className="grid gap-2">
              <Label htmlFor="slides-quick-start-source">
                {t(`home.quickStart.${kind}.field`)}
              </Label>
              {kind === "notes" ? (
                <Textarea
                  id="slides-quick-start-source"
                  autoFocus
                  value={value}
                  onChange={(event) =>
                    setValues({ ...values, [kind]: event.target.value })
                  }
                  disabled={busy}
                />
              ) : kind === "pdf" ? (
                <>
                  <Input
                    id="slides-quick-start-source"
                    type="file"
                    accept=".pdf,application/pdf"
                    disabled={busy}
                    onChange={(event) => setFile(event.target.files?.[0])}
                  />
                  {file && (
                    <span className="text-sm text-muted-foreground">
                      {file.name}
                    </span>
                  )}
                </>
              ) : (
                <Input
                  id="slides-quick-start-source"
                  type={kind === "website" ? "url" : "text"}
                  autoFocus
                  value={value}
                  onChange={(event) =>
                    setValues({ ...values, [kind]: event.target.value })
                  }
                  disabled={busy}
                />
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              {t("home.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                disabled || busy || (kind === "pdf" ? !file : !value.trim())
              }
            >
              {t(
                busy ? "home.quickStart.starting" : "home.quickStart.generate",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
