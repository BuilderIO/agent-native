import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconHistory,
  IconLoader2,
  IconRestore,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import SlideContentRenderer from "@/components/slides-2-runtime/SlideContentRenderer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { Slide } from "@/context/DeckContext";
import {
  useDeckVersion,
  useDeckVersions,
  useRestoreDeckVersion,
} from "@/hooks/use-deck-versions";

import type { DeckVersion, DeckVersionSummary } from "../../../shared/api";

type RestoreDeckVersionResult = {
  id: string;
  title: string;
  slideCount: number;
  restoredVersionId: string;
  updatedAt: string;
  url: string;
};

export interface Slides2HistoryPanelProps {
  deckId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore?: boolean;
  restoreDisabled?: boolean;
  /** Await the active editor's pending writes before the panel restores a version. */
  onBeforeRestore: () => Promise<void>;
  /** Refresh the active editor's in-memory deck after the restore action succeeds. */
  onRestored: (result: RestoreDeckVersionResult) => Promise<void> | void;
}

type Translate = ReturnType<typeof useT>;

function formatRelativeTime(dateString: string, translate: Translate): string {
  const createdAt = new Date(dateString).getTime();
  if (!Number.isFinite(createdAt)) return translate("history.unknownTime");

  const elapsed = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(elapsed / 3_600_000);
  const days = Math.floor(elapsed / 86_400_000);

  if (minutes < 1) return translate("history.justNow");
  if (minutes < 60) return translate("history.minutesAgo", { count: minutes });
  if (hours < 24) return translate("history.hoursAgo", { count: hours });
  if (days < 7) return translate("history.daysAgo", { count: days });
  return new Date(dateString).toLocaleDateString();
}

function slideCountLabel(
  version: Pick<DeckVersionSummary, "slideCount">,
  translate: Translate,
): string {
  return translate("history.slideCount", { count: version.slideCount });
}

function previewText(version: DeckVersionSummary): string {
  return version.slidePreviews
    .map((slide) => slide.textPreview)
    .filter(Boolean)
    .join(" / ");
}

function snapshotSlideForPreview(
  slide: DeckVersion["slides"][number],
  index: number,
): Slide {
  return {
    id: slide.id || `saved-slide-${index + 1}`,
    content: slide.content,
    notes: slide.notes ?? "",
    layout: (slide.layout ?? "blank") as Slide["layout"],
    background: slide.background,
  };
}

export default function Slides2HistoryPanel({
  deckId,
  open,
  onOpenChange,
  canRestore = true,
  restoreDisabled = false,
  onBeforeRestore,
  onRestored,
}: Slides2HistoryPanelProps) {
  const t = useT();
  const [selectedSnapshot, setSelectedSnapshot] = useState<{
    deckId: string;
    versionId: string;
  } | null>(null);
  const [restoreRefreshRecovery, setRestoreRefreshRecovery] = useState<{
    deckId: string;
    result: RestoreDeckVersionResult;
  } | null>(null);
  const [refreshingRestoredDeck, setRefreshingRestoredDeck] = useState(false);
  const currentRecovery =
    restoreRefreshRecovery?.deckId === deckId ? restoreRefreshRecovery : null;
  const selectedVersionId =
    selectedSnapshot?.deckId === deckId ? selectedSnapshot.versionId : null;

  useEffect(() => {
    if (currentRecovery) return;
    setSelectedSnapshot(null);
    if (restoreRefreshRecovery) setRestoreRefreshRecovery(null);
  }, [currentRecovery, deckId, open, restoreRefreshRecovery]);

  const versionsQuery = useDeckVersions(open ? deckId : null);
  const versionQuery = useDeckVersion(open ? deckId : null, selectedVersionId);
  const restoreVersion = useRestoreDeckVersion();

  const versions = Array.isArray(versionsQuery.data?.versions)
    ? versionsQuery.data.versions
    : [];
  const versionsLoadFailed =
    versionsQuery.isError ||
    (versionsQuery.isSuccess && !Array.isArray(versionsQuery.data?.versions));
  const selectedVersion = versionQuery.data;
  const hasSnapshotSlides = Array.isArray(selectedVersion?.slides);
  const versionLoadFailed =
    (versionQuery.isError || versionQuery.isSuccess) && !hasSnapshotSlides;
  const selectedSlides = useMemo(
    () =>
      (selectedVersion?.slides ?? []).map((slide, index) =>
        snapshotSlideForPreview(slide, index),
      ),
    [selectedVersion?.slides],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !currentRecovery) setSelectedSnapshot(null);
    onOpenChange(nextOpen);
  };

  const refreshRestoredDeck = async (recovery: {
    deckId: string;
    result: RestoreDeckVersionResult;
  }) => {
    setRefreshingRestoredDeck(true);
    try {
      await onRestored(recovery.result);
    } catch {
      setRestoreRefreshRecovery(recovery);
      return;
    } finally {
      setRefreshingRestoredDeck(false);
    }

    setRestoreRefreshRecovery(null);
    toast.success(t("history.versionRestored"), {
      description: t("history.versionRestoredDescription"),
    });
    handleOpenChange(false);
  };

  const handleRestore = async () => {
    if (
      !selectedVersionId ||
      !hasSnapshotSlides ||
      restoreVersion.isPending ||
      restoreDisabled ||
      currentRecovery
    ) {
      return;
    }

    try {
      await onBeforeRestore();
    } catch (error) {
      toast.error(t("history.restoreFailed"), {
        description:
          actionErrorMessage(error) ??
          (error instanceof Error
            ? error.message
            : t("history.restoreFailedDescription")),
      });
      return;
    }

    let restored: RestoreDeckVersionResult;
    try {
      restored = await restoreVersion.mutateAsync({
        deckId,
        versionId: selectedVersionId,
      });
    } catch (error) {
      toast.error(t("history.restoreFailed"), {
        description:
          actionErrorMessage(error) ?? t("history.restoreFailedDescription"),
      });
      return;
    }

    const recovery = { deckId, result: restored };
    setRestoreRefreshRecovery(recovery);
    await refreshRestoredDeck(recovery);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-[92vw] max-w-[640px] p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="flex items-center gap-2 text-sm font-medium">
            {selectedVersionId ? (
              <button
                type="button"
                onClick={() => setSelectedSnapshot(null)}
                disabled={Boolean(currentRecovery)}
                className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconArrowLeft size={15} />
                <span>{t("history.backToSavedVersions")}</span>
              </button>
            ) : (
              <>
                <IconHistory size={16} className="text-primary" />
                <span>{t("history.savedVersions")}</span>
              </>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("history.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 border-t border-border" />

        {selectedVersionId ? (
          <div className="flex h-[calc(100%-60px)] flex-col">
            <div className="border-b border-border px-4 py-3">
              {versionQuery.isLoading && !selectedVersion ? (
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
                      ? `${new Date(selectedVersion.createdAt).toLocaleString()} · ${slideCountLabel(selectedVersion, t)}`
                      : t("history.snapshotUnavailable")}
                  </p>
                </>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                {versionQuery.isLoading && !selectedVersion ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      className="aspect-video w-full rounded-lg"
                    />
                  ))
                ) : versionLoadFailed ? (
                  <div
                    role="alert"
                    className="col-span-full flex flex-col items-center gap-3 py-12 text-center text-xs text-muted-foreground"
                  >
                    <p>{t("history.snapshotLoadFailed")}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void versionQuery.refetch()}
                      disabled={versionQuery.isFetching}
                    >
                      {t("history.retry")}
                    </Button>
                  </div>
                ) : selectedSlides.length ? (
                  selectedSlides.map((slide, index) => (
                    <div key={slide.id} className="min-w-0">
                      <div
                        className={
                          /* guard:allow-raw-color — preserve the slide preview stage behind transparent content. */
                          "aspect-video overflow-hidden rounded border border-border bg-black"
                        }
                      >
                        {/* Use the snapshot's stored render, never the active slide's source runtime. */}
                        <SlideContentRenderer
                          slide={slide}
                          slidePosition={{
                            number: index + 1,
                            count: selectedSlides.length,
                          }}
                          aspectRatio={
                            selectedVersion?.aspectRatio ?? undefined
                          }
                        />
                      </div>
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

            {currentRecovery ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 border-t border-border p-3 text-xs text-muted-foreground"
              >
                <span>{t("history.restoreRefreshFailed")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshRestoredDeck(currentRecovery)}
                  disabled={refreshingRestoredDeck}
                >
                  {refreshingRestoredDeck ? (
                    <IconLoader2 size={14} className="mr-1.5 animate-spin" />
                  ) : null}
                  {t("history.retry")}
                </Button>
              </div>
            ) : canRestore ? (
              <div className="border-t border-border p-3">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void handleRestore()}
                  disabled={
                    restoreVersion.isPending ||
                    restoreDisabled ||
                    versionQuery.isLoading ||
                    versionLoadFailed ||
                    !hasSnapshotSlides
                  }
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
            {currentRecovery ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground"
              >
                <span>{t("history.restoreRefreshFailed")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshRestoredDeck(currentRecovery)}
                  disabled={refreshingRestoredDeck}
                >
                  {refreshingRestoredDeck ? (
                    <IconLoader2 size={14} className="mr-1.5 animate-spin" />
                  ) : null}
                  {t("history.retry")}
                </Button>
              </div>
            ) : null}
            {versionsLoadFailed ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground"
              >
                <span>{t("history.loadFailed")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void versionsQuery.refetch()}
                  disabled={versionsQuery.isFetching}
                >
                  {t("history.retry")}
                </Button>
              </div>
            ) : null}
            {versionsQuery.isLoading && !versionsQuery.data ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-md" />
                ))}
              </div>
            ) : versions.length ? (
              <div className="p-2">
                {versions.map((version) => {
                  const preview = previewText(version);
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() =>
                        setSelectedSnapshot({ deckId, versionId: version.id })
                      }
                      className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {version.title || t("history.untitled")}
                            </p>
                            <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                              {slideCountLabel(version, t)}
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
            ) : versionsLoadFailed ? null : (
              <div className="px-6 py-14 text-center">
                <IconHistory
                  size={24}
                  className="mx-auto mb-3 text-muted-foreground/60"
                />
                <p className="text-sm font-medium">
                  {t("history.noSavedVersions")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
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
