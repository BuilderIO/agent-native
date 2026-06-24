import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readClientAppState,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconChevronUp,
  IconMessageCircle,
  IconPhoto,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
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

const TRAY_COLLAPSED_STORAGE_KEY = "assets:generation-tray-collapsed";

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

export function GenerationTray() {
  const queryClient = useQueryClient();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TRAY_COLLAPSED_STORAGE_KEY) === "true";
  });
  const { data: variants } = useQuery({
    queryKey: ["app-state", "asset-variants"],
    queryFn: async ({ signal }) =>
      readClientAppState<AssetVariantState>("asset-variants", { signal }),
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

  useEffect(() => {
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
            queryKey: ["app-state", "asset-variants"],
            refetchType: "active",
          });
        },
      },
    );
  }, [queryClient, refreshGeneration, slots]);

  if (!variants || slots.length === 0) return null;

  const pendingCount = slots.filter((slot) => slot.status === "pending").length;
  const readyCount = slots.filter((slot) => slot.status === "ready").length;
  const failedCount = slots.filter((slot) => slot.status === "failed").length;

  function setTrayCollapsed(next: boolean) {
    setCollapsed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRAY_COLLAPSED_STORAGE_KEY, String(next));
    }
  }

  function clearAllCandidates() {
    dismissSlot.mutate(
      { scope: "all" },
      {
        onSuccess: () => {
          setClearAllOpen(false);
          void queryClient.invalidateQueries({
            queryKey: ["app-state", "asset-variants"],
          });
        },
        onError: (error) =>
          toast.error(error.message || "Could not clear tray."),
      },
    );
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className="fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium shadow-lg transition hover:bg-accent hover:text-accent-foreground"
        onClick={() => setTrayCollapsed(false)}
        aria-label="Open generation tray"
      >
        {pendingCount > 0 ? <Spinner className="h-3.5 w-3.5" /> : null}
        <span className="truncate">
          {pendingCount > 0
            ? `${pendingCount} generating`
            : readyCount > 0
              ? `${readyCount} ready`
              : `${slots.length} candidate${slots.length === 1 ? "" : "s"}`}
        </span>
        <IconChevronUp className="h-3.5 w-3.5 opacity-70" />
      </button>
    );
  }

  return (
    <>
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear generated candidates?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every unsaved candidate from the tray and deletes the
              generated asset rows behind them. Saved library assets are not
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

      <section className="fixed bottom-4 left-4 z-40 flex max-h-[min(560px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-sm font-semibold">
                Generation tray
              </h2>
              <Badge variant="outline">{slots.length}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {libraryTitle || "No brand kit"} / {variants.prompt}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={dismissSlot.isPending}
              onClick={() => setClearAllOpen(true)}
            >
              <IconTrash className="h-3.5 w-3.5" />
              Clear
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Hide generation tray"
              onClick={() => setTrayCollapsed(true)}
            >
              <IconX className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {(pendingCount > 0 || readyCount > 0 || failedCount > 0) && (
          <div className="flex gap-2 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
            {pendingCount > 0 ? <span>{pendingCount} generating</span> : null}
            {readyCount > 0 ? <span>{readyCount} ready</span> : null}
            {failedCount > 0 ? <span>{failedCount} failed</span> : null}
          </div>
        )}
        <div className="min-h-0 overflow-y-auto p-2">
          <div className="flex flex-col gap-2">
            {slots.map((slot) => (
              <GenerationTrayItem
                key={slot.slotId}
                slot={slot}
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
                    },
                    {
                      onSuccess: () => {
                        toast.success("Saved generated asset.");
                        void queryClient.invalidateQueries({
                          queryKey: ["app-state", "asset-variants"],
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
                    { slotId: slot.slotId },
                    {
                      onSuccess: () => {
                        void queryClient.invalidateQueries({
                          queryKey: ["app-state", "asset-variants"],
                        });
                      },
                      onError: (error) =>
                        toast.error(error.message || "Could not dismiss slot."),
                    },
                  );
                }}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function GenerationTrayItem({
  slot,
  prompt,
  libraryTitle,
  isSaving,
  isDismissing,
  onSave,
  onDismiss,
}: {
  slot: AssetVariantState["slots"][number];
  prompt: string;
  libraryTitle: string | null;
  isSaving: boolean;
  isDismissing: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const ready = slot.status === "ready" && Boolean(slot.assetId);
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 rounded-md border border-border/80 bg-muted/20 p-2">
      <div className="aspect-square overflow-hidden rounded-md border border-border bg-background">
        <GenerationSlotPreview slot={slot} />
      </div>
      <div className="min-w-0 space-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {slot.status === "pending" ? <Spinner className="h-3 w-3" /> : null}
            <span className="truncate text-xs font-medium capitalize">
              {slot.status === "pending"
                ? "Generating"
                : slot.status === "ready"
                  ? "Ready"
                  : "Failed"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {libraryTitle || "No brand kit"} / {prompt}
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
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isDismissing}
            onClick={onDismiss}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
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
    return <img src={src} alt="" className="h-full w-full object-cover" />;
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
