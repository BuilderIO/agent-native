import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertTriangle,
  IconApps,
  IconChevronDown,
  IconCloudUpload,
  IconExternalLink,
  IconRefresh,
  IconRocket,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

const SYNC_POLL_INTERVAL_MS = 8000;
const EDITS_REFETCH_INTERVAL_MS = 10000;
const DEPLOY_POLL_INTERVAL_MS = 6000;

export interface FusionAppBannerProps {
  designId: string;
  status: "building" | "ready" | "error";
  statusMessage?: string;
  previewUrl?: string;
  editorUrl?: string;
  deployedUrl?: string;
}

interface FusionEditsResult {
  edits: unknown[];
  pendingCount: number;
}

interface DeployStatusResult {
  deployId?: string;
  status?: string;
  url?: string;
}

/**
 * Slim, non-blocking banner shown above the canvas for fusion-backed ("full
 * app") designs. Renders only when the design has fusionApp linkage data
 * (see shared/full-app.ts readFusionApp) — invisible otherwise.
 *
 * - "building": polls sync-fusion-app until the container reports ready.
 * - "ready": pending-edit count + apply/push/publish controls.
 * - "error": message + retry.
 *
 * State is communicated inline (this banner's own text), not via toasts —
 * toasts in this app are unreliable for this kind of longer-lived status.
 */
export function FusionAppBanner({
  designId,
  status,
  statusMessage,
  previewUrl,
  editorUrl,
  deployedUrl,
}: FusionAppBannerProps) {
  const syncMutation = useActionMutation("sync-fusion-app");
  const applyEditsMutation = useActionMutation("apply-fusion-edits");
  const pushMutation = useActionMutation("push-fusion-app");
  const deployMutation = useActionMutation("deploy-fusion-app");

  const [deployPending, setDeployPending] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [liveDeployUrl, setLiveDeployUrl] = useState<string | undefined>(
    undefined,
  );
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // ── Building: poll sync-fusion-app on mount + every ~8s while building ────
  const syncMutateRef = useRef(syncMutation.mutate);
  syncMutateRef.current = syncMutation.mutate;
  useEffect(() => {
    if (status !== "building") return;
    syncMutateRef.current({ designId } as any);
    const interval = window.setInterval(() => {
      syncMutateRef.current({ designId } as any);
    }, SYNC_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [designId, status]);

  // ── Ready: pending edits count ─────────────────────────────────────────────
  const { data: editsData } = useActionQuery<FusionEditsResult>(
    "list-fusion-edits",
    { designId, status: "pending" } as any,
    {
      enabled: status === "ready",
      refetchInterval: status === "ready" ? EDITS_REFETCH_INTERVAL_MS : false,
    },
  );
  const pendingCount = editsData?.pendingCount ?? 0;

  // ── Publish: poll get-fusion-deploy-status after triggering a deploy ──────
  const deployStatusQuery = useActionQuery<DeployStatusResult>(
    "get-fusion-deploy-status",
    { designId } as any,
    {
      enabled: deployPending,
      refetchInterval: deployPending ? DEPLOY_POLL_INTERVAL_MS : false,
    },
  );

  useEffect(() => {
    if (!deployPending) return;
    const result = deployStatusQuery.data;
    if (!result?.status) return;
    if (result.status === "live" || result.status === "success") {
      setDeployPending(false);
      setLiveDeployUrl(result.url);
    } else if (result.status === "failed" || result.status === "canceled") {
      setDeployPending(false);
      setDeployError(`Deploy ${result.status}`);
    }
  }, [deployPending, deployStatusQuery.data]);

  if (status === "building") {
    return (
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        <Spinner className="size-3.5 shrink-0" />
        <span className="truncate">
          {
            "Building your app…" /* i18n-ignore fusion app banner, flag-gated feature */
          }
          {statusMessage ? ` ${statusMessage}` : ""}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <IconAlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 truncate text-destructive">
          {
            statusMessage ||
              "Couldn't build your app" /* i18n-ignore fusion app banner, flag-gated feature */
          }
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 cursor-pointer gap-1 px-2 !text-[11px]"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate({ designId } as any)}
        >
          {syncMutation.isPending ? (
            <Spinner className="size-3" />
          ) : (
            <IconRefresh className="size-3" />
          )}
          {"Retry" /* i18n-ignore fusion app banner, flag-gated feature */}
        </Button>
      </div>
    );
  }

  // status === "ready"
  const publishedUrl = liveDeployUrl ?? deployedUrl;

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-muted-foreground/15 px-1.5 py-0.5 !text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <IconApps className="size-3" />
        {"App" /* i18n-ignore fusion app banner, flag-gated feature */}
      </span>

      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
        >
          {"Preview" /* i18n-ignore fusion app banner, flag-gated feature */}
          <IconExternalLink className="size-3" />
        </a>
      )}

      {publishedUrl && (
        <a
          href={publishedUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
        >
          {"Live" /* i18n-ignore fusion app banner, flag-gated feature */}
          <IconExternalLink className="size-3" />
        </a>
      )}

      {deployError && (
        <span className="inline-flex shrink-0 items-center gap-1 text-destructive">
          <IconAlertTriangle className="size-3" />
          {deployError}
        </span>
      )}
      {pushMessage && !pushError && (
        <span className="truncate text-muted-foreground">{pushMessage}</span>
      )}
      {pushError && (
        <span className="truncate text-destructive">{pushError}</span>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
          disabled={pendingCount === 0 || applyEditsMutation.isPending}
          onClick={() => applyEditsMutation.mutate({ designId } as any)}
        >
          {applyEditsMutation.isPending ? <Spinner className="size-3" /> : null}
          {
            `Apply ${pendingCount} edit${pendingCount === 1 ? "" : "s"}` /* i18n-ignore fusion app banner, flag-gated feature */
          }
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
          disabled={pushMutation.isPending}
          onClick={() => {
            setPushMessage(null);
            setPushError(null);
            pushMutation.mutate({ designId } as any, {
              onSuccess: (result: any) => {
                if (result?.ok === false) {
                  setPushError(result?.detail || "Push failed");
                } else {
                  setPushMessage(result?.detail || "Pushed");
                }
              },
              onError: (error: unknown) => {
                setPushError(
                  error instanceof Error ? error.message : "Push failed",
                );
              },
            });
          }}
        >
          {pushMutation.isPending ? (
            <Spinner className="size-3" />
          ) : (
            <IconCloudUpload className="size-3" />
          )}
          {"Push" /* i18n-ignore fusion app banner, flag-gated feature */}
        </Button>

        <Button
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 !text-[11px]"
          disabled={deployMutation.isPending || deployPending}
          onClick={() => {
            setDeployError(null);
            deployMutation.mutate({ designId } as any, {
              onSuccess: (result: any) => {
                // Seed from the immediate response in case the deploy is
                // already terminal (fast/mocked deploys); otherwise the
                // get-fusion-deploy-status poll below takes over.
                const initialStatus = result?.status;
                if (initialStatus === "live" || initialStatus === "success") {
                  setLiveDeployUrl(result?.url);
                } else if (
                  initialStatus === "failed" ||
                  initialStatus === "canceled"
                ) {
                  setDeployError(`Deploy ${initialStatus}`);
                } else {
                  setDeployPending(true);
                }
              },
              onError: (error: unknown) => {
                setDeployError(
                  error instanceof Error ? error.message : "Publish failed",
                );
              },
            });
          }}
        >
          {deployMutation.isPending || deployPending ? (
            <Spinner className="size-3" />
          ) : (
            <IconRocket className="size-3" />
          )}
          {"Publish" /* i18n-ignore fusion app banner, flag-gated feature */}
        </Button>

        {editorUrl && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 cursor-pointer p-0"
                aria-label={
                  "More app actions" /* i18n-ignore fusion app banner, flag-gated feature */
                }
              >
                <IconChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild className="cursor-pointer">
                <a href={editorUrl} target="_blank" rel="noreferrer">
                  <IconExternalLink className="me-2 size-3.5" />
                  {
                    "Open in Builder" /* i18n-ignore fusion app banner, flag-gated feature */
                  }
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
