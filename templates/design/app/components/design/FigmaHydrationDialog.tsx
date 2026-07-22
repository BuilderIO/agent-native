/**
 * FigmaHydrationDialog — shown after a no-token local-kiwi clipboard import
 * when IMAGE fills couldn't be resolved. Collects a Figma access token, saves
 * it, then calls `hydrate-figma-paste-images` for each imported file to
 * replace the `url("about:blank")` placeholders with real durable images.
 */

import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hydrateImagesFromFig,
  validateFigUploadFile,
} from "@/lib/design-file-upload";
import {
  getFigmaConnectionStatus,
  saveFigmaAccessToken,
} from "@/lib/figma-connection";

interface FigmaHydrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  fileIds: string[];
  imageCount: number;
  onHydrated: () => void;
}

export function FigmaHydrationDialog({
  open,
  onOpenChange,
  designId,
  fileIds,
  imageCount,
  onHydrated,
}: FigmaHydrationDialogProps) {
  const t = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);
  const figInputRef = useRef<HTMLInputElement>(null);

  const screensPlural = fileIds.length === 1 ? "" : "s";
  const imagePlural = imageCount === 1 ? "" : "s";

  useEffect(() => {
    if (!open) return;
    getFigmaConnectionStatus()
      .then((status) => {
        if (status.docsUrl) setDocsUrl(status.docsUrl);
      })
      .catch(() => {});
  }, [open]);

  async function handleFigSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (validateFigUploadFile(file)) {
      setError(t("designEditor.import.figmaHydrationInvalidFig"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await hydrateImagesFromFig({
        designId,
        file,
        fileIds,
        fallbackErrorMessage: t("designEditor.import.figmaHydrationFigError"),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      const totalResolved = result.totalResolved ?? 0;
      onOpenChange(false);
      setToken("");
      onHydrated();
      toast.success(t("designEditor.import.figmaHydrationSuccess"), {
        description: t(
          "designEditor.import.figmaHydrationFigSuccessDescription",
          { count: totalResolved, plural: totalResolved === 1 ? "" : "s" },
        ),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("designEditor.import.figmaHydrationFigError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveFigmaAccessToken(token.trim());
      if (status.docsUrl) setDocsUrl(status.docsUrl);

      let totalResolved = 0;
      for (const fileId of fileIds) {
        const result = await callAction<{
          resolved?: number;
          missing?: number;
        }>("hydrate-figma-paste-images", { fileId });
        totalResolved += result?.resolved ?? 0;
      }

      onOpenChange(false);
      setToken("");
      onHydrated();
      toast.success(t("designEditor.import.figmaHydrationSuccess"), {
        description: t("designEditor.import.figmaHydrationSuccessDescription", {
          count: totalResolved,
          plural: totalResolved === 1 ? "" : "s",
        }),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.genericError");
      const is403 =
        message.includes("403") || message.toLowerCase().includes("forbidden");
      const isServerError = /internal server error/i.test(message);
      setError(
        is403
          ? 'Token rejected (403). In Figma\'s token settings, enable the "File content" and "Current user" scopes, then generate a new token.'
          : isServerError
            ? "Server error — Figma's API may be rate-limited. Wait ~1 minute then try again; repeated retries extend the cooldown."
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("designEditor.import.figmaHydrationDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("designEditor.import.figmaHydrationDialogDescription", {
                count: imageCount,
                plural: imagePlural,
                screensPlural,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-foreground">
                {t("designEditor.import.figmaHydrationFigTitle")}
              </p>
              <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                {t("designEditor.import.figmaHydrationRecommended")}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              {t("designEditor.import.figmaHydrationFigOption")}
            </p>
            <input
              ref={figInputRef}
              type="file"
              accept=".fig"
              className="hidden"
              onChange={(e) => void handleFigSelected(e)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2 w-full"
              disabled={busy}
              onClick={() => figInputRef.current?.click()}
            >
              {t("designEditor.import.figmaHydrationChooseFig")}
            </Button>
          </div>

          <div className="mt-3 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("designEditor.import.figmaHydrationOrToken")}
          </div>

          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="figma-hydration-token" className="text-xs">
                {t("designEditor.import.figmaTokenLabel")}
              </Label>
              {docsUrl ? (
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[10px] font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {t("designEditor.import.figmaTokenDocs")}
                </a>
              ) : null}
            </div>
            <Input
              id="figma-hydration-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("designEditor.import.figmaTokenPlaceholder")}
              autoComplete="new-password"
              aria-invalid={error ? true : undefined}
              className="h-8 text-xs"
              disabled={busy}
            />
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive">
                {error}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {t("designEditor.import.figmaHydrationTokenDescription")}
                </p>
                <p className="text-[10px] leading-snug text-muted-foreground/70">
                  {t("designEditor.import.figmaHydrationRateLimit")}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("home.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy || !token.trim()}>
              {t("designEditor.import.figmaHydrationConnectAndLoad")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
