/**
 * FigmaHydrationDialog — shown after a no-token local-kiwi clipboard import
 * when IMAGE fills couldn't be resolved. Collects a Figma access token, saves
 * it, then calls `hydrate-figma-paste-images` for each imported file to
 * replace the `url("about:blank")` placeholders with real durable images.
 */

import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
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
  getFigmaConnectionStatus,
  saveFigmaAccessToken,
} from "@/lib/figma-connection";

interface FigmaHydrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileIds: string[];
  imageCount: number;
  onHydrated: () => void;
}

export function FigmaHydrationDialog({
  open,
  onOpenChange,
  fileIds,
  imageCount,
  onHydrated,
}: FigmaHydrationDialogProps) {
  const t = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);

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

          <div className="mt-4 space-y-2">
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
              <p className="text-[10px] leading-snug text-muted-foreground">
                {t("designEditor.import.figmaTokenDescription")}
              </p>
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
