import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  IconChevronDown,
  IconCloudUpload,
  IconExternalLink,
  IconPlayerPlay,
  IconRocket,
  IconWand,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EDITS_REFETCH_INTERVAL_MS = 10000;
const DEPLOY_POLL_INTERVAL_MS = 6000;

export interface FusionAppMenuProps {
  designId: string;
  previewUrl?: string;
  editorUrl?: string;
  deployedUrl?: string;
}

interface FusionEditsResult {
  pendingCount: number;
}

interface DeployStatusResult {
  status?: string;
  url?: string;
}

const isLive = (status?: string) => status === "live" || status === "success";
const isFailed = (status?: string) =>
  status === "failed" || status === "canceled";

/**
 * The editor's top-right Preview / Publish menu for a design backed by a
 * Builder app. Publish deploys the app through Builder (the generic menu's
 * Publish is a waitlist), and Push and agent-queued edits live here too, so
 * the app has one set of controls.
 */
export function FusionAppMenu({
  designId,
  previewUrl,
  editorUrl,
  deployedUrl,
}: FusionAppMenuProps) {
  const applyEditsMutation = useActionMutation("apply-builder-edits");
  const pushMutation = useActionMutation("push-builder-app");
  const deployMutation = useActionMutation("deploy-builder-app");
  const [deployPending, setDeployPending] = useState(false);
  const [liveDeployUrl, setLiveDeployUrl] = useState<string | undefined>();

  const { data: editsData } = useActionQuery<FusionEditsResult>(
    "list-builder-edits",
    { designId, status: "pending" } as any,
    { refetchInterval: EDITS_REFETCH_INTERVAL_MS },
  );
  const pendingCount = editsData?.pendingCount ?? 0;

  const deployStatusQuery = useActionQuery<DeployStatusResult>(
    "get-builder-deploy-status",
    { designId } as any,
    {
      enabled: deployPending,
      refetchInterval: deployPending ? DEPLOY_POLL_INTERVAL_MS : false,
    },
  );
  useEffect(() => {
    if (!deployPending) return;
    const status = deployStatusQuery.data?.status;
    if (isLive(status)) {
      setDeployPending(false);
      setLiveDeployUrl(deployStatusQuery.data?.url);
      toast.success(
        "Your app is live" /* i18n-ignore flag-gated full-app feature */,
      );
    } else if (isFailed(status)) {
      setDeployPending(false);
      toast.error(
        `Publish ${status}` /* i18n-ignore flag-gated full-app feature */,
      );
    }
  }, [deployPending, deployStatusQuery.data]);

  const publishing = deployMutation.isPending || deployPending;
  const publishedUrl = liveDeployUrl ?? deployedUrl;

  const publish = () => {
    deployMutation.mutate({ designId } as any, {
      onSuccess: (result: any) => {
        if (isLive(result?.status)) {
          setLiveDeployUrl(result?.url);
          toast.success(
            "Your app is live" /* i18n-ignore flag-gated full-app feature */,
          );
        } else if (isFailed(result?.status)) {
          toast.error(
            `Publish ${result.status}` /* i18n-ignore flag-gated full-app feature */,
          );
        } else {
          setDeployPending(true);
        }
      },
      onError: (error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Publish failed" /* i18n-ignore flag-gated full-app feature */,
        );
      },
    });
  };

  const push = () => {
    pushMutation.mutate({ designId } as any, {
      onSuccess: (result: any) => {
        if (result?.ok === false) {
          toast.error(
            result?.detail ||
              "Push failed" /* i18n-ignore flag-gated full-app feature */,
          );
        } else {
          toast.success(
            result?.detail ||
              "Pushed" /* i18n-ignore flag-gated full-app feature */,
          );
        }
      },
      onError: (error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Push failed" /* i18n-ignore flag-gated full-app feature */,
        );
      },
    });
  };

  const busy =
    publishing || pushMutation.isPending || applyEditsMutation.isPending;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="relative h-[var(--design-row-height)] cursor-pointer gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-foreground hover:bg-accent hover:text-foreground"
              aria-label={"Preview or publish app" /* i18n-ignore */}
            >
              {busy ? (
                <Spinner className="size-5" />
              ) : (
                <IconPlayerPlay className="size-5" />
              )}
              <IconChevronDown className="size-3 opacity-70" />
              {pendingCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Preview or publish app" /* i18n-ignore */}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="design-editor-app-menu-content z-[100010] w-56"
      >
        <DropdownMenuItem
          disabled={!previewUrl}
          onSelect={() => {
            if (previewUrl) window.open(previewUrl, "_blank", "noopener");
          }}
        >
          <IconExternalLink className="size-4" />
          {"Preview" /* i18n-ignore flag-gated full-app feature */}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={publishing} onSelect={publish}>
          {publishing ? (
            <Spinner className="size-4" />
          ) : (
            <IconRocket className="size-4" />
          )}
          {
            publishing
              ? "Publishing…" /* i18n-ignore flag-gated full-app feature */
              : "Publish" /* i18n-ignore flag-gated full-app feature */
          }
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pushMutation.isPending} onSelect={push}>
          {pushMutation.isPending ? (
            <Spinner className="size-4" />
          ) : (
            <IconCloudUpload className="size-4" />
          )}
          {"Push" /* i18n-ignore flag-gated full-app feature */}
        </DropdownMenuItem>
        {pendingCount > 0 ? (
          <DropdownMenuItem
            disabled={applyEditsMutation.isPending}
            onSelect={() => applyEditsMutation.mutate({ designId } as any)}
          >
            {applyEditsMutation.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <IconWand className="size-4" />
            )}
            {
              `Apply ${pendingCount} queued edit${pendingCount === 1 ? "" : "s"}` /* i18n-ignore flag-gated full-app feature */
            }
          </DropdownMenuItem>
        ) : null}
        {publishedUrl || editorUrl ? <DropdownMenuSeparator /> : null}
        {publishedUrl ? (
          <DropdownMenuItem
            onSelect={() => window.open(publishedUrl, "_blank", "noopener")}
          >
            <IconWorld className="size-4" />
            {"Open live app" /* i18n-ignore flag-gated full-app feature */}
          </DropdownMenuItem>
        ) : null}
        {editorUrl ? (
          <DropdownMenuItem
            onSelect={() =>
              window.open(
                withBuilderUtmTrackingParams(editorUrl, {
                  campaign: "product",
                  content: "fusion_editor",
                }),
                "_blank",
                "noopener",
              )
            }
          >
            <IconExternalLink className="size-4" />
            {"Open in Builder" /* i18n-ignore flag-gated full-app feature */}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
