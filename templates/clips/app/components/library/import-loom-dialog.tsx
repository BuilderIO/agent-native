import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconLink, IconLoader2, IconUpload } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSonnerLifecycleToast } from "@/hooks/use-sonner-lifecycle-toast";
import { useUploadVideoPicker } from "@/hooks/use-upload-video-picker";

export interface ImportLoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string | null;
  folderId?: string | null;
  recordHref?: string;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return (
    error.message.replace(/^Action [a-z0-9-]+ failed:\s*/i, "").trim() ||
    fallback
  );
}

export function ImportLoomDialog({
  open,
  onOpenChange,
  spaceId,
  folderId,
  recordHref = "/record",
}: ImportLoomDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { input, openUploadPicker } = useUploadVideoPicker();
  const {
    error: failImportToast,
    info: infoImportToast,
    start: startImportToast,
    success: completeImportToast,
  } = useSonnerLifecycleToast();
  const [loomUrl, setLoomUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = loomUrl.trim();
    if (!url || busy) return;

    setError(null);
    setBusy(true);
    startImportToast(t("importRoute.importingSubtitle"));
    try {
      const result = (await callAction(
        "import-loom-recording" as any,
        {
          url,
          spaceIds: spaceId ? [spaceId] : undefined,
          folderId: folderId ?? undefined,
        } as any,
      )) as {
        recordingId?: string;
        status?: string;
        storageSetupRequired?: boolean;
      };
      if (!result.recordingId) {
        throw new Error(t("recordRoute.couldNotImportLoom"));
      }

      if (result.storageSetupRequired || result.status === "waiting_storage") {
        infoImportToast(t("recordRoute.storageNeededToFinishLoomImport"), {
          description: t("recordRoute.connectStorageToRetryLoom"),
          duration: 12_000,
        });
      } else {
        completeImportToast(t("recordRoute.loomImported"));
      }

      setLoomUrl("");
      onOpenChange(false);
      void navigate(`/r/${encodeURIComponent(result.recordingId)}`);
    } catch (cause) {
      const message = actionErrorMessage(
        cause,
        t("recordRoute.couldNotImportLoom"),
      );
      setError(message);
      failImportToast(t("recordRoute.couldNotImportLoom"), {
        description: message,
        duration: 12_000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && busy) return;
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setLoomUrl("");
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconLink className="size-5 text-primary" />
            {t("importRoute.title")}
          </DialogTitle>
          <DialogDescription>{t("importRoute.helperText")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              autoFocus
              aria-label={t("importRoute.helperText")}
              inputMode="url"
              value={loomUrl}
              onChange={(event) => {
                setLoomUrl(event.target.value);
                setError(null);
              }}
              placeholder={t("importRoute.urlPlaceholder")}
            />
            <Button
              type="submit"
              className="w-full gap-2"
              disabled={busy || !loomUrl.trim()}
            >
              {busy ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconLink className="size-4" />
              )}
              {t("importRoute.cta")}
            </Button>
            {error ? (
              <p
                role="alert"
                className="text-xs leading-relaxed text-destructive"
              >
                {error}
              </p>
            ) : null}
          </form>
          {!busy ? (
            <div className="flex justify-center border-t border-border pt-4">
              <button
                type="button"
                onClick={() => openUploadPicker(recordHref)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <IconUpload className="size-3.5" />
                {t("preRecord.uploadVideo")}
              </button>
            </div>
          ) : null}
        </div>
      </DialogContent>
      {input}
    </Dialog>
  );
}
