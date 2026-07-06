import {
  readClientAppState,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconMessageCircle, IconPhoto, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { assetPreviewSources } from "@/lib/asset-preview-sources";

import type {
  AssetVariantState,
  ImageLibrarySummary,
} from "../../../shared/api";

type LibraryListResult = {
  libraries?: ImageLibrarySummary[];
};

function variantStateKey(threadId: string | null) {
  return threadId ? `asset-variants:${threadId}` : "asset-variants";
}

function slotTime(slot: AssetVariantState["slots"][number]): number {
  const raw = slot.createdAt ?? slot.updatedAt ?? "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function stalePendingRunId(
  slot: AssetVariantState["slots"][number],
): string | null {
  if (slot.status !== "pending") return null;
  if (!slot.runId) return null;
  const timestamp = slotTime(slot);
  if (!timestamp) return null;
  return Date.now() - timestamp >= 2 * 60 * 1000 ? slot.runId : null;
}

export function GenerationResults({ threadId }: { threadId: string | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const stateKey = variantStateKey(threadId);
  const stateQueryKey = useMemo(() => ["app-state", stateKey], [stateKey]);
  const { data: variants } = useQuery({
    queryKey: stateQueryKey,
    queryFn: async ({ signal }) => {
      return readClientAppState<AssetVariantState>(stateKey, { signal });
    },
    refetchInterval: 1000,
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
            <div
              className={
                slots.length === 1
                  ? "grid grid-cols-1 gap-3"
                  : "grid grid-cols-1 gap-3 sm:grid-cols-2"
              }
            >
              {slots.map((slot, index) => (
                <GenerationResultItem
                  key={slot.slotId}
                  slot={slot}
                  index={index}
                  prompt={variants.prompt}
                  libraryTitle={libraryTitle}
                  isSaving={saveGenerated.isPending}
                  isDismissing={dismissSlot.isPending}
                  onSave={() => {
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
                          void queryClient.invalidateQueries({
                            queryKey: stateQueryKey,
                          });
                          void queryClient.invalidateQueries({
                            queryKey: ["action", "get-library"],
                          });
                        },
                        onError: (error) =>
                          toast.error(
                            error.message || t("library.couldNotSaveCandidate"),
                          ),
                      },
                    );
                  }}
                  onDismiss={() => {
                    dismissSlot.mutate(
                      { slotId: slot.slotId, threadId },
                      {
                        onSuccess: () => {
                          void queryClient.invalidateQueries({
                            queryKey: stateQueryKey,
                          });
                        },
                        onError: (error) =>
                          toast.error(
                            error.message ||
                              t("library.couldNotDismissCandidate"),
                          ),
                      },
                    );
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function GenerationResultItem({
  slot,
  index,
  prompt,
  libraryTitle,
  isSaving,
  isDismissing,
  onSave,
  onDismiss,
}: {
  slot: AssetVariantState["slots"][number];
  index: number;
  prompt: string;
  libraryTitle: string | null;
  isSaving: boolean;
  isDismissing: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const ready = slot.status === "ready" && Boolean(slot.assetId);
  const t = useT();
  return (
    <article className="overflow-hidden rounded-lg border border-border/80 bg-background/70">
      <div className="relative aspect-[16/10] overflow-hidden bg-muted/40">
        <GenerationSlotPreview slot={slot} />
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium shadow-sm">
          {slot.status === "pending" ? <Spinner className="h-3 w-3" /> : null}
          <span>
            {slot.status === "pending"
              ? t("library.generating")
              : slot.status === "ready"
                ? t("library.candidateWithNumber", { number: index + 1 })
                : t("library.failed")}
          </span>
        </div>
      </div>
      <div className="space-y-2 p-2.5">
        <div className="min-w-0 text-xs">
          <div className="truncate font-medium">
            {slot.status === "ready"
              ? t("library.readyToSave")
              : slot.status === "pending"
                ? t("library.stillRendering")
                : t("library.generationFailed")}
          </div>
          <div className="mt-0.5 truncate text-muted-foreground">
            {libraryTitle || t("library.noBrandKit")}
            {prompt ? ` / ${prompt}` : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!ready || isSaving}
            onClick={onSave}
          >
            {isSaving ? <Spinner className="h-3 w-3" /> : t("library.save")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!slot.assetId}
            onClick={() =>
              sendToAgentChat({
                message: `Refine generated asset ${slot.assetId}: `,
                context: [
                  "## Assets candidate",
                  `Asset ID: ${slot.assetId}`,
                  `Run ID: ${slot.runId ?? "unknown"}`,
                  `Prompt: ${prompt}`,
                  libraryTitle ? `Brand kit: ${libraryTitle}` : "",
                  "Use refine-image with assetId when the user describes the change.",
                ]
                  .filter(Boolean)
                  .join("\n"),
                submit: false,
                openSidebar: true,
              })
            }
          >
            <IconMessageCircle className="h-3.5 w-3.5" />
            {t("library.refine")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={isDismissing}
            onClick={onDismiss}
            aria-label={t("library.deleteCandidate")}
          >
            <IconTrash className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function GenerationSlotPreview({
  slot,
}: {
  slot: AssetVariantState["slots"][number];
}) {
  const t = useT();
  const sources = assetPreviewSources(slot, "thumbnail");
  const src = sources[0];
  if (src) {
    return <img src={src} alt="" className="h-full w-full object-contain" />;
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
