import { setAgentChatContextItem } from "@agent-native/core/client/agent-chat";
import {
  readClientAppState,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconMessageCircle,
  IconPhoto,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { assetPreviewSources } from "@/lib/asset-preview-sources";

import type {
  AssetVariantState,
  ImageLibrarySummary,
} from "../../../shared/api";

type LibraryListResult = {
  libraries?: ImageLibrarySummary[];
};

type VariantSlot = AssetVariantState["slots"][number];

function variantStateKey(threadId: string | null) {
  return threadId ? `asset-variants:${threadId}` : "asset-variants";
}

// Only reconcile a still-pending slot once it is old enough that the run cannot
// plausibly still be generating. Keep this above the server generation budget
// (IMAGE_GENERATION_REQUEST_TIMEOUT_MS, default 300s) and in step with
// STALE_IMAGE_RUN_MS in refresh-generation-run, so a slow-but-healthy run (e.g.
// gpt-image-2) is not flagged "interrupted" and flipped to an error slot before
// its finished image arrives.
const STALE_PENDING_RUN_MS = 10 * 60 * 1000;

function slotTime(slot: VariantSlot): number {
  const raw = slot.createdAt ?? slot.updatedAt ?? "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function stalePendingRunId(slot: VariantSlot): string | null {
  if (slot.status !== "pending") return null;
  if (!slot.runId) return null;
  const timestamp = slotTime(slot);
  if (!timestamp) return null;
  return Date.now() - timestamp >= STALE_PENDING_RUN_MS ? slot.runId : null;
}

export function GenerationResults({ threadId }: { threadId: string | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [previewSlotId, setPreviewSlotId] = useState<string | null>(null);
  const stateKey = variantStateKey(threadId);
  const stateQueryKey = useMemo(() => ["app-state", stateKey], [stateKey]);
  const { data: variants } = useQuery({
    queryKey: stateQueryKey,
    queryFn: async ({ signal }) => {
      return readClientAppState<AssetVariantState>(stateKey, { signal });
    },
    refetchInterval: (query) => {
      const state = query.state.data as AssetVariantState | undefined;
      const hasPendingSlot = (state?.slots ?? []).some(
        (slot) => slot.status === "pending",
      );
      return hasPendingSlot ? 1000 : false;
    },
  });
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  } as any) as { data?: LibraryListResult };
  const saveGenerated = useActionMutation("save-generated-image");
  const dismissSlot = useActionMutation("dismiss-variant-slots");
  const refreshGeneration = useActionMutation("refresh-generation-run");
  const refreshingRunIds = useRef<Set<string>>(new Set());
  const libraryTitle = useMemo(() => {
    if (!variants?.libraryId) return null;
    return (
      librariesData?.libraries?.find((item) => item.id === variants.libraryId)
        ?.title ?? null
    );
  }, [librariesData?.libraries, variants?.libraryId]);
  const slots = useMemo(
    () =>
      (variants?.slots ?? [])
        .slice()
        .sort(
          (left, right) =>
            slotTime(right) - slotTime(left) ||
            right.slotId.localeCompare(left.slotId),
        ),
    [variants?.slots],
  );
  const belongsToThread = Boolean(
    variants &&
    (threadId ? variants.threadId === threadId : !variants.threadId),
  );

  useEffect(() => {
    if (!belongsToThread) return;
    if (!slots.length || refreshGeneration.isPending) return;
    const runId = slots
      .map(stalePendingRunId)
      .find((id): id is string =>
        Boolean(id && !refreshingRunIds.current.has(id)),
      );
    if (!runId) return;
    refreshingRunIds.current.add(runId);
    refreshGeneration.mutate(
      { runId },
      {
        onSettled: () => {
          window.setTimeout(() => {
            refreshingRunIds.current.delete(runId);
          }, 30_000);
          void queryClient.invalidateQueries({
            queryKey: stateQueryKey,
            refetchType: "active",
          });
        },
      },
    );
  }, [belongsToThread, queryClient, refreshGeneration, slots, stateQueryKey]);

  const previewSlot = useMemo(
    () => slots.find((slot) => slot.slotId === previewSlotId) ?? null,
    [previewSlotId, slots],
  );

  if (!belongsToThread || !variants) return null;
  if (slots.length === 0) return null;

  const pendingCount = slots.filter((slot) => slot.status === "pending").length;
  const readyCount = slots.filter((slot) => slot.status === "ready").length;
  const failedCount = slots.filter((slot) => slot.status === "failed").length;
  const statusSummary = [
    pendingCount > 0
      ? t("library.generatingCount", { count: pendingCount })
      : null,
    readyCount > 0 ? t("library.readyCount", { count: readyCount }) : null,
    failedCount > 0 ? t("library.failedCount", { count: failedCount }) : null,
  ]
    .filter(Boolean)
    .join(" / ");

  function clearAllCandidates() {
    dismissSlot.mutate(
      { threadId, scope: "all" },
      {
        onSuccess: () => {
          setClearAllOpen(false);
          void queryClient.invalidateQueries({
            queryKey: stateQueryKey,
          });
        },
        onError: (error) =>
          toast.error(error.message || t("library.couldNotClearCandidates")),
      },
    );
  }

  function saveSlot(slot: VariantSlot, onDone?: () => void) {
    if (!slot.assetId && !slot.slotId) return;
    saveGenerated.mutate(
      {
        ...(slot.assetId ? { assetId: slot.assetId } : {}),
        ...(slot.slotId ? { slotId: slot.slotId } : {}),
        threadId,
      },
      {
        onSuccess: () => {
          toast.success(t("library.savedGeneratedAsset"));
          void queryClient.invalidateQueries({ queryKey: stateQueryKey });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-library"],
          });
          onDone?.();
        },
        onError: (error) =>
          toast.error(error.message || t("library.couldNotSaveCandidate")),
      },
    );
  }

  function dismissSlotById(slot: VariantSlot, onDone?: () => void) {
    dismissSlot.mutate(
      { slotId: slot.slotId, threadId },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: stateQueryKey });
          onDone?.();
        },
        onError: (error) =>
          toast.error(error.message || t("library.couldNotDismissCandidate")),
      },
    );
  }

  function refineSlot(slot: VariantSlot, variantNumber: number) {
    if (!slot.assetId) return;
    const variantLabel = t("library.variantWithNumber", {
      number: variantNumber,
    });
    setAgentChatContextItem({
      key: "refine-asset:" + slot.assetId,
      title: t("library.refine") + " : " + variantLabel,
      context: [
        "## Assets candidate",
        `Asset ID: ${slot.assetId}`,
        `Run ID: ${slot.runId ?? "unknown"}`,
        `Prompt: ${variants?.prompt ?? ""}`,
        libraryTitle ? `Brand kit: ${libraryTitle}` : "",
        "Use refine-image with assetId when the user describes the change.",
      ]
        .filter(Boolean)
        .join("\n"),
      openSidebar: true,
    });
  }

  return (
    <>
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("library.clearGeneratedCandidatesTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("library.clearGeneratedCandidatesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissSlot.isPending}>
              {t("library.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={dismissSlot.isPending}
              onClick={(event) => {
                event.preventDefault();
                clearAllCandidates();
              }}
            >
              {dismissSlot.isPending ? (
                <>
                  <Spinner className="h-4 w-4" />
                  {t("library.clearing")}
                </>
              ) : (
                t("library.clearCandidates")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GenerationPreviewDialog
        slot={previewSlot}
        slots={slots}
        prompt={variants.prompt}
        libraryTitle={libraryTitle}
        isSaving={saveGenerated.isPending}
        isDismissing={dismissSlot.isPending}
        onOpenChange={(open) => {
          if (!open) setPreviewSlotId(null);
        }}
        onSelect={setPreviewSlotId}
        onSave={(slot) => saveSlot(slot, () => setPreviewSlotId(null))}
        onRefine={(slot, variantNumber) => {
          refineSlot(slot, variantNumber);
          setPreviewSlotId(null);
        }}
        onDismiss={(slot) =>
          dismissSlotById(slot, () => setPreviewSlotId(null))
        }
      />

      <section className="mx-auto mb-4 w-full max-w-[760px] px-4">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-border/80 px-3 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                {pendingCount > 0 ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <IconPhoto className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-semibold">
                    {t("library.generatedCandidatesTitle")}
                  </h2>
                  <Badge variant="secondary" className="shrink-0">
                    {statusSummary}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {libraryTitle || t("library.noBrandKit")} / {variants.prompt}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={dismissSlot.isPending}
              onClick={() => setClearAllOpen(true)}
            >
              <IconTrash className="h-3.5 w-3.5" />
              {t("library.clear")}
            </Button>
          </div>

          <div className="max-h-[min(640px,52vh)] overflow-y-auto p-3">
            <div className="assets-library-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
              {slots.map((slot, index) => (
                <GenerationDraftCard
                  key={slot.slotId}
                  slot={slot}
                  variantNumber={index + 1}
                  isSaving={saveGenerated.isPending}
                  isDismissing={dismissSlot.isPending}
                  onPreview={() => setPreviewSlotId(slot.slotId)}
                  onSave={() => saveSlot(slot)}
                  onRefine={() => refineSlot(slot, index + 1)}
                  onDismiss={() => dismissSlotById(slot)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function GenerationDraftCard({
  slot,
  variantNumber,
  isSaving,
  isDismissing,
  onPreview,
  onSave,
  onRefine,
  onDismiss,
}: {
  slot: VariantSlot;
  variantNumber: number;
  isSaving: boolean;
  isDismissing: boolean;
  onPreview: () => void;
  onSave: () => void;
  onRefine: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const ready = slot.status === "ready" && Boolean(slot.assetId);
  const variantLabel = t("library.variantWithNumber", {
    number: variantNumber,
  });
  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-background transition hover:border-foreground/25 hover:bg-muted/10">
      <div className="group relative">
        <button
          type="button"
          aria-label={t("library.selectAsset", { title: variantLabel })}
          title={variantLabel}
          onClick={() => {
            if (ready) onPreview();
          }}
          className="block w-full text-left focus-visible:outline-none"
        >
          <div className="aspect-[4/3] bg-muted/40">
            <GenerationSlotPreview slot={slot} />
          </div>
        </button>

        {slot.status !== "ready" ? (
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium shadow-sm">
            {slot.status === "pending" ? <Spinner className="h-3 w-3" /> : null}
            <span>
              {slot.status === "pending"
                ? t("library.generating")
                : t("library.failed")}
            </span>
          </div>
        ) : null}

        {ready ? (
          <TooltipProvider>
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("library.save")}
                    disabled={isSaving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSave();
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition hover:bg-primary hover:text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {isSaving ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <IconDeviceFloppy className="h-4 w-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("library.save")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("library.refine")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRefine();
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition hover:bg-primary hover:text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <IconMessageCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("library.refine")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("library.deleteCandidate")}
                    disabled={isDismissing}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDismiss();
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition hover:bg-destructive hover:text-destructive-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("library.deleteCandidate")}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        ) : (
          <button
            type="button"
            aria-label={t("library.deleteCandidate")}
            disabled={isDismissing}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
            className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
        {variantLabel}
      </div>
    </div>
  );
}

function GenerationPreviewDialog({
  slot,
  slots,
  prompt,
  libraryTitle,
  isSaving,
  isDismissing,
  onOpenChange,
  onSelect,
  onSave,
  onRefine,
  onDismiss,
}: {
  slot: VariantSlot | null;
  slots: VariantSlot[];
  prompt: string;
  libraryTitle: string | null;
  isSaving: boolean;
  isDismissing: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (slotId: string) => void;
  onSave: (slot: VariantSlot) => void;
  onRefine: (slot: VariantSlot, variantNumber: number) => void;
  onDismiss: (slot: VariantSlot) => void;
}) {
  const t = useT();
  const previewableSlots = useMemo(
    () =>
      slots.filter((item) => item.status === "ready" && Boolean(item.assetId)),
    [slots],
  );
  const previewIndex = slot
    ? previewableSlots.findIndex((item) => item.slotId === slot.slotId)
    : -1;
  const hasPrev = previewIndex > 0;
  const hasNext =
    previewIndex >= 0 && previewIndex < previewableSlots.length - 1;
  const showPreviousSlot = () => {
    if (hasPrev) onSelect(previewableSlots[previewIndex - 1].slotId);
  };
  const showNextSlot = () => {
    if (hasNext) onSelect(previewableSlots[previewIndex + 1].slotId);
  };
  const sources = slot ? assetPreviewSources(slot, "preview") : [];
  const src = sources[0];
  const variantNumber = slot
    ? slots.findIndex((item) => item.slotId === slot.slotId) + 1
    : 0;
  const variantLabel = t("library.variantWithNumber", {
    number: variantNumber,
  });
  return (
    <Dialog open={Boolean(slot)} onOpenChange={onOpenChange}>
      {slot ? (
        <DialogContent
          hideClose
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") showPreviousSlot();
            if (event.key === "ArrowRight") showNextSlot();
          }}
          className="flex max-h-[85vh] w-[calc(100vw-24px)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">{variantLabel}</DialogTitle>
          <DialogDescription className="sr-only">
            {prompt || t("library.readyToSave")}
          </DialogDescription>

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
            <p className="min-w-0 truncate text-sm font-medium">
              {variantLabel}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                disabled={isSaving || !slot.assetId}
                onClick={() => onSave(slot)}
              >
                {isSaving ? <Spinner className="h-4 w-4" /> : t("library.save")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={!slot.assetId}
                onClick={() => onRefine(slot, variantNumber)}
              >
                <IconMessageCircle className="h-4 w-4" />
                {t("library.refine")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={isDismissing}
                onClick={() => onDismiss(slot)}
                aria-label={t("library.deleteCandidate")}
              >
                {isDismissing ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <IconTrash className="h-4 w-4" />
                )}
              </Button>
              <DialogClose
                aria-label={t("library.closePreview")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconX className="h-4 w-4" />
              </DialogClose>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-4 sm:p-6">
            {src ? (
              <img
                src={src}
                alt={prompt || ""}
                className="max-h-full max-w-full rounded-lg bg-black object-contain"
              />
            ) : (
              <div className="flex h-64 w-full items-center justify-center rounded-lg bg-muted">
                <IconPhoto className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>

          {hasPrev || hasNext ? (
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border/80 py-3">
              <button
                type="button"
                aria-label={t("library.previousImage")}
                onClick={showPreviousSlot}
                disabled={!hasPrev}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label={t("library.nextImage")}
                onClick={showNextSlot}
                disabled={!hasNext}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconChevronRight className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function GenerationSlotPreview({ slot }: { slot: VariantSlot }) {
  const t = useT();
  const sources = assetPreviewSources(slot, "thumbnail");
  const src = sources[0];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain transition group-hover:scale-[1.02]"
      />
    );
  }
  if (slot.status === "failed") {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-destructive">
        {slot.error || t("library.failed")}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <IconPhoto className="h-6 w-6 animate-pulse text-muted-foreground" />
    </div>
  );
}
