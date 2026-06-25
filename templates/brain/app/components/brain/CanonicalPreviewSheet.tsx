import { useT } from "@agent-native/core/client";
import { IconAlertTriangle, IconBook, IconFileText } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export interface CanonicalPreviewData {
  source: "knowledge" | "proposal";
  knowledgeId: string | null;
  proposalId?: string | null;
  title: string;
  path: string;
  pathExact: boolean;
  contentType: "text/markdown";
  markdown: string;
  canPublish: boolean;
  alreadyPublishedPath?: string | null;
  warnings?: string[];
}

export function CanonicalPreviewSheet({
  open,
  onOpenChange,
  preview,
  loading,
  error,
  operation = "publish",
  primaryLabel,
  onPrimaryAction,
  primaryDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: CanonicalPreviewData | null;
  loading?: boolean;
  error?: string | null;
  operation?: "publish" | "unpublish";
  primaryLabel: string;
  onPrimaryAction?: () => void | Promise<void>;
  primaryDisabled?: boolean;
}) {
  const t = useT();
  const warnings = preview?.warnings ?? [];
  const intent =
    operation === "unpublish"
      ? t("canonicalPreview.unpublishIntent")
      : t("canonicalPreview.publishIntent");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <IconBook className="size-5 text-muted-foreground" />
            <SheetTitle>{t("canonicalPreview.title")}</SheetTitle>
          </div>
          <SheetDescription>{intent}</SheetDescription>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
          {preview ? (
            <>
              <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <IconFileText className="size-3" />
                    Markdown
                  </Badge>
                  {preview.pathExact ? null : (
                    <Badge variant="outline">
                      {t("canonicalPreview.pathSuffixAssigned")}
                    </Badge>
                  )}
                  {preview.alreadyPublishedPath ? (
                    <Badge variant="outline">
                      {t("canonicalPreview.currentlyPublished")}
                    </Badge>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {t("canonicalPreview.workspacePath")}
                  </div>
                  <code className="break-all rounded-sm bg-background px-2 py-1 text-xs text-foreground">
                    {preview.path}
                  </code>
                </div>
              </div>

              {warnings.length ? (
                <div className="grid gap-2 rounded-md border border-border bg-background p-3">
                  {warnings.map((warning) => (
                    <div
                      key={warning}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <Textarea
                readOnly
                value={preview.markdown}
                className="min-h-[22rem] resize-none font-mono text-xs leading-5"
                aria-label={t("canonicalPreview.markdownPreviewLabel")}
              />
            </>
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              {loading
                ? t("canonicalPreview.building")
                : t("canonicalPreview.empty")}
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <SheetFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("canonicalPreview.cancel")}
          </Button>
          <Button
            type="button"
            disabled={
              loading || primaryDisabled || !preview || !preview.canPublish
            }
            onClick={() => void onPrimaryAction?.()}
          >
            {primaryLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
