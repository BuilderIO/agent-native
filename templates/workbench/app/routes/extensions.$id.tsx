import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconRefresh,
} from "@tabler/icons-react";
import {
  agentNativePath,
  appPath,
  ShareButton,
} from "@agent-native/core/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToolIframe } from "@/components/tools/tool-iframe";
import { ToolActionsMenu } from "@/components/tools/tool-actions-menu";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Workbench — Custom Tool" }];
}

interface ExtensionDetail {
  id: string;
  name: string;
  description?: string | null;
  ownerEmail?: string | null;
  visibility?: "private" | "org" | "public" | null;
  updatedAt?: string | null;
  canDelete?: boolean | null;
  role?: "owner" | "admin" | "editor" | "viewer" | null;
}

const EXTENSIONS_QUERY_KEY = ["extensions"] as const;
const CUSTOM_TOOLS_QUERY_KEY = ["list-custom-tools"] as const;

/**
 * Single Custom Tool page. The body is a full-width iframe rendering the
 * tool's Alpine.js HTML from `/_agent-native/extensions/:id/render`. The
 * header carries the tool name, owner, and the Edit / Share / Delete /
 * Refresh affordances.
 *
 * The Share popover is the framework's standard `ShareButton`. Per the
 * extensions registration (`allowPublic: false`, `requireOrgMemberForUserShares: true`)
 * the framework will hide the "Public" visibility option and constrain
 * user shares to org members — so the UI here doesn't need any extra
 * guardrails, the popover renders the right options based on policy.
 */
export default function ToolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const [openOverlayCount, setOpenOverlayCount] = useState(0);

  const adjustOverlay = useCallback((open: boolean) => {
    setOpenOverlayCount((c) => Math.max(0, c + (open ? 1 : -1)));
  }, []);

  const toolId = id ?? "";

  // Note the user's current view + selected tool so the agent's context
  // surface knows what's open.
  useEffect(() => {
    if (!toolId) return;
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "extension", extensionId: toolId }),
    }).catch(() => {});
  }, [toolId]);

  const {
    data: tool,
    isLoading,
    error,
  } = useQuery<ExtensionDetail | null>({
    queryKey: ["extension", toolId],
    queryFn: async () => {
      if (!toolId) return null;
      const res = await fetch(
        agentNativePath(
          `/_agent-native/extensions/${encodeURIComponent(toolId)}`,
        ),
      );
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to load tool (${res.status})`);
      return (await res.json()) as ExtensionDetail;
    },
    enabled: !!toolId,
  });

  const handleDelete = useCallback(async () => {
    if (!tool) return;
    const { deleteOrHideExtension, invalidateExtensionRemoval } =
      await import("@agent-native/core/client/extensions");

    const wasShared = tool.canDelete === false;
    try {
      const result = await deleteOrHideExtension({
        id: tool.id,
        canDelete: tool.canDelete,
      });
      // pnpm can resolve a sibling @tanstack/query-core for the helper's
      // QueryClient type — bridge via unknown to keep the call type-safe
      // without dragging the older type into our route.
      invalidateExtensionRemoval(
        queryClient as unknown as Parameters<
          typeof invalidateExtensionRemoval
        >[0],
        tool.id,
      );
      // Mirror the removal into both query keys so the list page is in sync
      // when we navigate back.
      queryClient.setQueryData<ExtensionDetail[]>(
        EXTENSIONS_QUERY_KEY,
        (rows) => (rows ?? []).filter((r) => r.id !== tool.id),
      );
      queryClient.setQueryData<ExtensionDetail[]>(
        CUSTOM_TOOLS_QUERY_KEY,
        (rows) => (rows ?? []).filter((r) => r.id !== tool.id),
      );
      toast.success(
        result.mode === "hidden" || wasShared
          ? `Removed "${tool.name}" from your list`
          : `Deleted "${tool.name}"`,
      );
      navigate("/extensions");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not delete tool";
      toast.error(message);
      throw err;
    }
  }, [tool, navigate, queryClient]);

  const ownerHandle = useMemo(
    () => formatOwnerHandle(tool?.ownerEmail),
    [tool?.ownerEmail],
  );

  if (!toolId) {
    return <NotFoundCard onBack={() => navigate("/extensions")} />;
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
            <div className="h-9 w-20 rounded-md bg-muted animate-pulse" />
            <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex-1 bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <NotFoundCard
        onBack={() => navigate("/extensions")}
        title="Couldn't load this tool"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  if (!tool) {
    return <NotFoundCard onBack={() => navigate("/extensions")} />;
  }

  // The iframe shares a session cookie with the parent and is served by the
  // framework — so the URL is the same in/out of Workbench. Used by both
  // the "Open in new tab" menu item and (eventually) embed deep-links.
  const newTabHref = appPath(`/extensions/${tool.id}`);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="size-8 shrink-0"
              >
                <Link to="/extensions" aria-label="Back to Custom Tools">
                  <IconArrowLeft size={16} />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to Custom Tools</TooltipContent>
          </Tooltip>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className="truncate text-sm font-semibold tracking-tight text-foreground"
                title={tool.name}
              >
                {tool.name}
              </h1>
            </div>
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {tool.description?.trim() ? tool.description : "Custom Tool"}
              {ownerHandle ? (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  <span>by {ownerHandle}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="size-8 cursor-pointer"
              >
                <IconRefresh size={16} />
                <span className="sr-only">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <ShareButton
            resourceType="extension"
            resourceId={tool.id}
            resourceTitle={tool.name}
            onOpenChange={adjustOverlay}
            accessNote={
              <>
                Custom Tools can only be shared inside your organization — they
                run with the viewer's credentials, so cross-org access isn't
                supported.
              </>
            }
          />
          <ToolActionsMenu
            tool={{
              id: tool.id,
              name: tool.name,
              canDelete: tool.canDelete,
            }}
            onDelete={handleDelete}
            openInNewTabHref={newTabHref}
            onOverlayOpenChange={adjustOverlay}
          />
        </div>
      </div>
      <div className={cn("relative flex-1 min-h-0")}>
        <ToolIframe
          toolId={tool.id}
          toolName={tool.name}
          version={tool.updatedAt ?? null}
          refreshKey={refreshKey}
          blockPointerEvents={openOverlayCount}
        />
      </div>
    </div>
  );
}

function NotFoundCard({
  onBack,
  title = "Tool not found",
  description,
}: {
  onBack: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to Custom Tools"
          className="size-8 cursor-pointer"
        >
          <IconArrowLeft size={16} />
        </Button>
        <h1 className="text-sm font-semibold tracking-tight">Custom Tools</h1>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconAlertTriangle size={24} aria-hidden />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {description ??
                "This tool may have been deleted, or you may not have access to it."}
            </p>
          </div>
          <Button onClick={onBack} className="cursor-pointer">
            Back to Custom Tools
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatOwnerHandle(email?: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0];
  return local || email;
}
