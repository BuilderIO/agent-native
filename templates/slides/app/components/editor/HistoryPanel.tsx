import { useT } from "@agent-native/core/client";
import { toast } from "@agent-native/toolkit/hooks/use-toast";
import { Button } from "@agent-native/toolkit/ui/button";
import { ScrollArea } from "@agent-native/toolkit/ui/scroll-area";
import { Separator } from "@agent-native/toolkit/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@agent-native/toolkit/ui/sheet";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowLeft,
  IconHistory,
  IconLoader2,
  IconRestore,
} from "@tabler/icons-react";
import { useMemo, useState, type RefObject } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import {
  useDeckVersion,
  useDeckVersions,
  useRestoreDeckVersion,
} from "@/hooks/use-deck-versions";
import type { AspectRatio } from "@/lib/aspect-ratios";

import type { DeckVersionSummary } from "../../../shared/api";

interface HistoryPanelProps {
  deckId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore?: boolean;
  anchorRef?: RefObject<HTMLButtonElement | null>;
}

type Translate = ReturnType<typeof useT>;

function formatRelativeTime(dateStr: string, translate: Translate): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return translate("history.unknownTime");
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return translate("history.justNow");
  if (diffMin < 60) return translate("history.minutesAgo", { count: diffMin });
  if (diffHr < 24) return translate("history.hoursAgo", { count: diffHr });
  if (diffDay < 7) return translate("history.daysAgo", { count: diffDay });
  return new Date(dateStr).toLocaleDateString();
}

function slideLabel(
  version: Pick<DeckVersionSummary, "slideCount">,
  translate: Translate,
): string {
  return translate("history.slideCount", { count: version.slideCount });
}

function normalizeSlides(slides: DeckVersionSummary["slidePreviews"]): string {
  return slides
    .map((slide) => slide.textPreview)
    .filter(Boolean)
    .join(" / ");
}

export default function HistoryPanel({
  deckId,
  open,
  onOpenChange,
  canRestore = true,
}: HistoryPanelProps) {
  const t = useT();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const versionsQuery = useDeckVersions(open ? deckId : null);
  const versionQuery = useDeckVersion(open ? deckId : null, selectedVersionId);
  const restoreVersion = useRestoreDeckVersion();

  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versionQuery.data;
  const selectedSlides = useMemo(
    () =>
      (selectedVersion?.slides ?? []).map((slide) => ({
        notes: "",
        layout: "blank",
        ...slide,
      })) as Slide[],
    [selectedVersion?.slides],
  );

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedVersionId(null);
    onOpenChange(nextOpen);
  };

  const handleRestore = async () => {
    if (!selectedVersionId) return;
    try {
      await restoreVersion.mutateAsync({
        deckId,
        versionId: selectedVersionId,
      });
      toast({
        title: t("history.versionRestored"),
        description: t("history.versionRestoredDescription"),
      });
      handleClose(false);
    } catch (error) {
      toast({
        title: t("history.restoreFailed"),
        description:
          error instanceof Error
            ? error.message
            : t("history.restoreFailedDescription"),
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[92vw] max-w-[640px] p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="flex items-center gap-2 text-sm font-medium">
            {selectedVersionId ? (
              <button
                type="button"
                onClick={() => setSelectedVersionId(null)}
                className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconArrowLeft size={15} />
                <span>{t("history.backToSavedVersions")}</span>
              </button>
            ) : (
              <>
                <IconHistory size={16} className="text-[#609FF8]" />
                <span>{t("history.savedVersions")}</span>
              </>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("history.description")}
          </SheetDescription>
        </SheetHeader>

        <Separator className="mt-3" />

        {selectedVersionId ? (
          <div className="flex h-[calc(100%-60px)] flex-col">
            <div className="border-b border-border px-4 py-3">
              {versionQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ) : (
                <>
                  <p className="truncate text-sm font-medium">
                    {selectedVersion?.title || t("history.untitled")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedVersion
                      ? `${new Date(selectedVersion.createdAt).toLocaleString()} · ${slideLabel(selectedVersion, t)}`
                      : t("history.snapshotUnavailable")}
                  </p>
                </>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                {versionQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      className="aspect-video w-full rounded-lg"
                    />
                  ))
                ) : selectedSlides.length ? (
                  selectedSlides.map((slide, index) => (
                    <div key={slide.id || index} className="min-w-0">
                      <SlideRenderer
                        slide={slide}
                        aspectRatio={
                          (selectedVersion?.aspectRatio ?? undefined) as
                            | AspectRatio
                            | undefined
                        }
                        className="border border-border bg-black"
                      />
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                        {t("history.slideNumber", { number: index + 1 })}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-full py-12 text-center text-xs text-muted-foreground">
                    {t("history.noSlidesInSnapshot")}
                  </div>
                )}
              </div>
            </ScrollArea>

            {canRestore ? (
              <div className="border-t border-border p-3">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleRestore}
                  disabled={restoreVersion.isPending || versionQuery.isLoading}
                >
                  {restoreVersion.isPending ? (
                    <IconLoader2 size={15} className="mr-1.5 animate-spin" />
                  ) : (
                    <IconRestore size={15} className="mr-1.5" />
                  )}
                  {t("history.restoreThisVersion")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <ScrollArea className="h-[calc(100%-60px)]">
            {versionsQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-md" />
                ))}
              </div>
            ) : versions.length ? (
              <div className="p-2">
                {versions.map((version) => {
                  const preview = normalizeSlides(version.slidePreviews);
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedVersionId(version.id)}
                      className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-[#609FF8]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {version.title || t("history.untitled")}
                            </p>
                            <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                              {slideLabel(version, t)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatRelativeTime(version.createdAt, t)}
                            {version.label ? ` · ${version.label}` : ""}
                          </p>
                          {preview ? (
                            <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                              {preview}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <IconHistory
                  size={24}
                  className="mx-auto mb-3 text-muted-foreground/60"
                />
                <p className="text-sm font-medium">
                  {t("history.noSavedVersions")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("history.noSavedVersionsDescription")}
                </p>
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
