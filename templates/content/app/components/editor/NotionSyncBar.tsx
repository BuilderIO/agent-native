import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  IconLink,
  IconRefresh,
  IconUpload,
  IconAlertTriangle,
  IconExternalLink,
  IconPlugOff,
  IconLoader2,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  useDisconnectNotion,
  useDocumentSyncStatus,
  useLinkDocumentToNotion,
  useNotionConnection,
  openNotionOAuthUrl,
  usePullDocumentFromNotion,
  usePushDocumentToNotion,
  useResolveDocumentSyncConflict,
  useUnlinkDocumentFromNotion,
} from "@/hooks/use-notion";

interface NotionSyncBarProps {
  documentId: string;
}

export function NotionSyncBar({ documentId }: NotionSyncBarProps) {
  const t = useT();
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
      queryClient.invalidateQueries({ queryKey: ["action"] });
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

  const handleConnect = async () => {
    if (connection?.error === "missing_credentials") {
      toast.error(t("editor.toolbar.setUpNotionFirst"));
      return;
    }
    try {
      window.location.href = await openNotionOAuthUrl();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.setUpNotionFirst"),
      );
    }
  };

  const handleLink = async () => {
    if (!pageIdOrUrl.trim()) {
      toast.error(t("editor.toolbar.pasteNotionPageUrlOrId"));
      return;
    }
    try {
      await linkDocument.mutateAsync({ documentId, pageIdOrUrl });
      setPageIdOrUrl("");
      toast.success(t("editor.toolbar.linkedToNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.failedToLinkPage"),
      );
    }
  };

  const handlePull = async () => {
    try {
      await pullDocument.mutateAsync({ documentId });
      toast.success(t("editor.toolbar.pulledFromNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("editor.toolbar.pullFailed"),
      );
    }
  };

  const handlePush = async () => {
    try {
      await pushDocument.mutateAsync({ documentId });
      toast.success(t("editor.toolbar.pushedToNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("editor.toolbar.pushFailed"),
      );
    }
  };

  const handleResolve = async (direction: "pull" | "push") => {
    try {
      await resolveConflict.mutateAsync({ documentId, direction });
      toast.success(
        direction === "pull"
          ? t("editor.toolbar.conflictResolvedFromNotion")
          : t("editor.toolbar.conflictResolvedFromLocalDocument"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.conflictResolutionFailed"),
      );
    }
  };

  const handleUnlink = async () => {
    try {
      await unlinkDocument.mutateAsync({ documentId });
      toast.success(t("editor.toolbar.unlinkedFromNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.unlinkFailed"),
      );
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectNotion.mutateAsync({});
      toast.success(t("editor.toolbar.disconnectedNotionWorkspace"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.failedToDisconnect"),
      );
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {t("editor.toolbar.notionSync")}
            </span>
            {syncStatus?.state === "conflict" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <IconAlertTriangle size={12} />
                {t("editor.toolbar.conflict")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!connection?.connected
              ? t("editor.toolbar.connectNotionWorkspaceToLink")
              : syncStatus?.pageId
                ? syncStatus.lastSyncedAt
                  ? t("editor.toolbar.linkedToPageLastSynced", {
                      pageId: syncStatus.pageId,
                      date: new Date(syncStatus.lastSyncedAt).toLocaleString(),
                    })
                  : t("editor.toolbar.linkedToPage", {
                      pageId: syncStatus.pageId,
                    })
                : t("editor.toolbar.pasteNotionPageUrlOrIdToLink")}
          </p>
          {syncStatus?.lastError && (
            <p className="mt-1 text-xs text-destructive">
              {syncStatus.lastError}
            </p>
          )}
          {syncStatus?.warnings?.length ? (
            <div className="mt-1 space-y-1">
              {syncStatus.warnings.slice(0, 3).map((warning, index) => (
                <p
                  key={`${warning}-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {!connection?.connected ? (
          <Button size="sm" onClick={handleConnect}>
            {t("editor.toolbar.connectNotion")}
          </Button>
        ) : (
          <>
            {!syncStatus?.pageId ? (
              <>
                <Input
                  value={pageIdOrUrl}
                  onChange={(e) => setPageIdOrUrl(e.target.value)}
                  placeholder={t("editor.toolbar.notionPageUrlOrId")}
                  className="h-8 w-full sm:w-[260px]"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleLink}
                  disabled={isWorking}
                >
                  <IconLink size={14} className="mr-1" />
                  {t("editor.toolbar.linkPage")}
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
                    <IconExternalLink size={13} />
                    {t("editor.toolbar.open")}
                  </a>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handlePull}
                  disabled={isWorking || syncLoading}
                >
                  <IconRefresh size={14} className="mr-1" />
                  {t("editor.toolbar.pull")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handlePush}
                  disabled={isWorking || syncLoading}
                >
                  <IconUpload size={14} className="mr-1" />
                  {t("editor.toolbar.push")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleUnlink}
                  disabled={isWorking}
                >
                  {t("editor.toolbar.unlink")}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDisconnect}
              disabled={isWorking}
            >
              <IconPlugOff size={14} className="mr-1" />
              {t("editor.toolbar.disconnect")}
            </Button>
          </>
        )}
      </div>

      {syncStatus?.hasConflict && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="mr-auto text-xs text-amber-800 dark:text-amber-200">
            {t("editor.toolbar.localAndNotionChanged")}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleResolve("pull")}
            disabled={isWorking}
          >
            {resolveConflict.isPending ? (
              <IconLoader2 size={14} className="animate-spin mr-1" />
            ) : null}
            {t("editor.toolbar.pullFromNotion")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleResolve("push")}
            disabled={isWorking}
          >
            {resolveConflict.isPending ? (
              <IconLoader2 size={14} className="animate-spin mr-1" />
            ) : null}
            {t("editor.toolbar.pushLocal")}
          </Button>
        </div>
      )}
    </div>
  );
}
