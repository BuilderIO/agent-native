import { useEffect, useRef, useState } from "react";
import {
  Link2,
  RefreshCw,
  Upload,
  AlertTriangle,
  ExternalLink,
  Unplug,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDisconnectNotion,
  useDocumentSyncStatus,
  useLinkDocumentToNotion,
  useNotionConnection,
  usePullDocumentFromNotion,
  usePushDocumentToNotion,
  useResolveDocumentSyncConflict,
  useUnlinkDocumentFromNotion,
} from "@/hooks/use-notion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface NotionSyncBarProps {
  documentId: string;
}

export function NotionSyncBar({ documentId }: NotionSyncBarProps) {
  const queryClient = useQueryClient();
  const { data: connection } = useNotionConnection();
  const { data: syncStatus, isLoading: syncLoading } =
    useDocumentSyncStatus(documentId);
  const linkDocument = useLinkDocumentToNotion(documentId);
  const unlinkDocument = useUnlinkDocumentFromNotion(documentId);
  const pullDocument = usePullDocumentFromNotion(documentId);
  const pushDocument = usePushDocumentToNotion(documentId);
  const resolveConflict = useResolveDocumentSyncConflict(documentId);
  const disconnectNotion = useDisconnectNotion();
  const [pageIdOrUrl, setPageIdOrUrl] = useState("");
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!syncStatus?.lastSyncedAt) return;
    if (
      lastSyncedRef.current &&
      lastSyncedRef.current !== syncStatus.lastSyncedAt
    ) {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
    lastSyncedRef.current = syncStatus.lastSyncedAt;
  }, [syncStatus?.lastSyncedAt, queryClient, documentId]);

  const isWorking =
    linkDocument.isPending ||
    unlinkDocument.isPending ||
    pullDocument.isPending ||
    pushDocument.isPending ||
    resolveConflict.isPending ||
    disconnectNotion.isPending;

  const handleConnect = () => {
    if (!connection?.authUrl) {
      toast.error(
        "Set up Notion first — click the Notion icon in the sidebar.",
      );
      return;
    }
    window.location.href = connection.authUrl;
  };

  const handleLink = async () => {
    if (!pageIdOrUrl.trim()) {
      toast.error("Paste a Notion page URL or page ID.");
      return;
    }
    try {
      await linkDocument.mutateAsync({ pageIdOrUrl });
      setPageIdOrUrl("");
      toast.success("Linked to Notion.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to link page.",
      );
    }
  };

  const handlePull = async () => {
    try {
      await pullDocument.mutateAsync();
      toast.success("Pulled from Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pull failed.");
    }
  };

  const handlePush = async () => {
    try {
      await pushDocument.mutateAsync();
      toast.success("Pushed to Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Push failed.");
    }
  };

  const handleResolve = async (direction: "pull" | "push") => {
    try {
      await resolveConflict.mutateAsync({ direction });
      toast.success(
        direction === "pull"
          ? "Conflict resolved from Notion."
          : "Conflict resolved from local document.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Conflict resolution failed.",
      );
    }
  };

  const handleUnlink = async () => {
    try {
      await unlinkDocument.mutateAsync();
      toast.success("Unlinked from Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unlink.");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectNotion.mutateAsync();
      toast.success("Disconnected Notion workspace.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to disconnect.",
      );
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Notion Sync
            </span>
            {syncStatus?.state === "conflict" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle size={12} />
                Conflict
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!connection?.connected
              ? "Connect a Notion workspace to link this document."
              : syncStatus?.pageId
                ? `Linked to page ${syncStatus.pageId}${syncStatus.lastSyncedAt ? ` • Last synced ${new Date(syncStatus.lastSyncedAt).toLocaleString()}` : ""}`
                : "Paste a Notion page URL or page ID to link this document."}
          </p>
          {syncStatus?.lastError && (
            <p className="mt-1 text-xs text-destructive">
              {syncStatus.lastError}
            </p>
          )}
          {syncStatus?.warnings?.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {syncStatus.warnings[0]}
            </p>
          ) : null}
        </div>

        {!connection?.connected ? (
          <Button size="sm" onClick={handleConnect}>
            Connect Notion
          </Button>
        ) : (
          <>
            {!syncStatus?.pageId ? (
              <>
                <Input
                  value={pageIdOrUrl}
                  onChange={(e) => setPageIdOrUrl(e.target.value)}
                  placeholder="Notion page URL or page ID"
                  className="h-8 w-[260px]"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleLink}
                  disabled={isWorking}
                >
                  <Link2 size={14} className="mr-1" />
                  Link Page
                </Button>
              </>
            ) : (
              <>
                {syncStatus.pageUrl && (
                  <a
                    href={syncStatus.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={13} />
                    Open
                  </a>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handlePull}
                  disabled={isWorking || syncLoading}
                >
                  <RefreshCw size={14} className="mr-1" />
                  Pull
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handlePush}
                  disabled={isWorking || syncLoading}
                >
                  <Upload size={14} className="mr-1" />
                  Push
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleUnlink}
                  disabled={isWorking}
                >
                  Unlink
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDisconnect}
              disabled={isWorking}
            >
              <Unplug size={14} className="mr-1" />
              Disconnect
            </Button>
          </>
        )}
      </div>

      {syncStatus?.hasConflict && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="mr-auto text-xs text-amber-800 dark:text-amber-200">
            Local and Notion changed since the last sync. Choose which version
            wins.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleResolve("pull")}
            disabled={isWorking}
          >
            {resolveConflict.isPending ? (
              <Loader2 size={14} className="animate-spin mr-1" />
            ) : null}
            Pull from Notion
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleResolve("push")}
            disabled={isWorking}
          >
            {resolveConflict.isPending ? (
              <Loader2 size={14} className="animate-spin mr-1" />
            ) : null}
            Push local
          </Button>
        </div>
      )}
    </div>
  );
}
