import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readClientAppState,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import { IconMessageCircle, IconPhoto, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
  const queryClient = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const stateKey = variantStateKey(threadId);
  const stateQueryKey = useMemo(() => ["app-state", stateKey], [stateKey]);
  const { data: variants } = useQuery({
    queryKey: stateQueryKey,
    queryFn: async ({ signal }) =>
      readClientAppState<AssetVariantState>(stateKey, { signal }),
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
    pendingCount > 0 ? `${pendingCount} generating` : null,
    readyCount > 0 ? `${readyCount} ready` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
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
          toast.error(error.message || "Could not clear candidates."),
      },
    );
  }

  return (
    <>
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear generated candidates?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every unsaved candidate from the thread and deletes
              the generated asset rows behind them. Saved library assets are not
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissSlot.isPending}>
              Cancel
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
                  Clearing...
                </>
              ) : (
                "Clear candidates"
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
                    Generated candidates
                  </h2>
                  <Badge variant="secondary" className="shrink-0">
                    {statusSummary}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {libraryTitle || "No brand kit"} / {variants.prompt}
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
              Clear
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
                          toast.success("Saved generated asset.");
                          void queryClient.invalidateQueries({
                            queryKey: stateQueryKey,
                          });
                          void queryClient.invalidateQueries({
                            queryKey: ["action", "get-library"],
                          });
                        },
                        onError: (error) =>
                          toast.error(error.message || "Could not save asset."),
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
                            error.message || "Could not dismiss slot.",
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
  return (
    <article className="overflow-hidden rounded-lg border border-border/80 bg-background/70">
      <div className="relative aspect-[16/10] overflow-hidden bg-muted/40">
        <GenerationSlotPreview slot={slot} />
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium shadow-sm">
          {slot.status === "pending" ? <Spinner className="h-3 w-3" /> : null}
          <span>
            {slot.status === "pending"
              ? "Generating"
              : slot.status === "ready"
                ? `Candidate ${index + 1}`
                : "Failed"}
          </span>
        </div>
      </div>
      <div className="space-y-2 p-2.5">
        <div className="min-w-0 text-xs">
          <div className="truncate font-medium">
            {slot.status === "ready"
              ? "Ready to save"
              : slot.status === "pending"
                ? "Still rendering"
                : "Generation failed"}
          </div>
          <div className="mt-0.5 truncate text-muted-foreground">
            {libraryTitle || "No brand kit"}
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
            {isSaving ? <Spinner className="h-3 w-3" /> : "Save"}
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
            Refine
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={isDismissing}
            onClick={onDismiss}
            aria-label="Delete candidate"
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
  const sources = assetPreviewSources(slot, "thumbnail");
  const src = sources[0];
  if (src) {
    return <img src={src} alt="" className="h-full w-full object-contain" />;
  }
  if (slot.status === "failed") {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-destructive">
        {slot.error || "Failed"}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <IconPhoto className="h-6 w-6 animate-pulse text-muted-foreground" />
    </div>
  );
}
