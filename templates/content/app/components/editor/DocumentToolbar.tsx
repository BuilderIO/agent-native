import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowBarDown,
  IconArrowBarUp,
  IconAlertTriangle,
  IconExternalLink,
  IconLinkOff,
  IconLoader2,
  IconSearch,
  IconFileText,
  IconPlus,
  IconHistory,
  IconRefresh,
} from "@tabler/icons-react";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  AgentToggleButton,
  NotificationsBell,
  PresenceBar,
  appPath,
  type CollabUser,
} from "@agent-native/core/client";
import { ShareButton } from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useNotionConnection,
  useDocumentSyncStatus,
  useLinkDocumentToNotion,
  useUnlinkDocumentFromNotion,
  usePullDocumentFromNotion,
  usePushDocumentToNotion,
  useResolveDocumentSyncConflict,
  useSearchNotionPages,
  useCreateAndLinkNotionPage,
} from "@/hooks/use-notion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("notion-logo-icon", className)}>
      <path
        className="notion-logo-icon-face"
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
      />
      <path
        className="notion-logo-icon-mark"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
      />
    </svg>
  );
}

interface DocumentToolbarProps {
  documentId: string;
  documentTitle?: string;
  activeUsers?: CollabUser[];
  agentPresent?: boolean;
  agentActive?: boolean;
  isSaving?: boolean;
  currentUserEmail?: string;
  canEdit?: boolean;
}

export function DocumentToolbar({
  documentId,
  documentTitle,
  activeUsers,
  agentPresent,
  agentActive,
  isSaving,
  currentUserEmail,
  canEdit = true,
}: DocumentToolbarProps) {
  const queryClient = useQueryClient();
  const [autoSync, setAutoSync] = useLocalStorage(
    `notion-auto-sync:${documentId}`,
    false,
  );
  const { data: connection } = useNotionConnection();
  const { data: syncStatus } = useDocumentSyncStatus(documentId, { autoSync });
  const linkDocument = useLinkDocumentToNotion(documentId);
  const unlinkDocument = useUnlinkDocumentFromNotion(documentId);
  const pullDocument = usePullDocumentFromNotion(documentId);
  const pushDocument = usePushDocumentToNotion(documentId);
  const resolveConflict = useResolveDocumentSyncConflict(documentId);

  const createAndLink = useCreateAndLinkNotionPage(documentId);

  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [resolvingDirection, setResolvingDirection] = useState<
    "pull" | "push" | null
  >(null);
  const [linkingPageId, setLinkingPageId] = useState<string | null>(null);
  const [creatingParentPageId, setCreatingParentPageId] = useState<
    string | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isConnected = connection?.connected ?? false;
  const isLinked = !!syncStatus?.pageId;
  const hasConflict = syncStatus?.hasConflict ?? false;
  const requiresExplicitCreateParent = connection?.mode === "api_key";

  const isWorking =
    linkDocument.isPending ||
    unlinkDocument.isPending ||
    pullDocument.isPending ||
    pushDocument.isPending ||
    resolveConflict.isPending ||
    createAndLink.isPending;
  const shareUrl =
    typeof window === "undefined"
      ? `/p/${documentId}`
      : `${window.location.origin}${appPath(`/p/${documentId}`)}`;

  const { data: searchResults, isLoading: searchLoading } =
    useSearchNotionPages(debouncedQuery, open && isConnected && !isLinked);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Auto-focus search on open
  useEffect(() => {
    if (open && !isLinked) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [open, isLinked]);

  // Refresh document data after sync
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

  const handleLink = useCallback(
    async (pageId: string) => {
      setLinkingPageId(pageId);
      try {
        await linkDocument.mutateAsync({ pageIdOrUrl: pageId });
        toast.success("Linked to Notion page.");
        setSearchQuery("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to link.");
      } finally {
        setLinkingPageId(null);
      }
    },
    [linkDocument],
  );

  const handlePull = useCallback(async () => {
    try {
      await pullDocument.mutateAsync();
      toast.success("Pulled from Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pull failed.");
    }
  }, [pullDocument]);

  const handlePush = useCallback(async () => {
    try {
      await pushDocument.mutateAsync();
      toast.success("Pushed to Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Push failed.");
    }
  }, [pushDocument]);

  const handleUnlink = useCallback(async () => {
    try {
      await unlinkDocument.mutateAsync();
      toast.success("Unlinked from Notion.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unlink failed.");
    }
  }, [unlinkDocument]);

  const handleResolve = useCallback(
    (direction: "pull" | "push") => {
      setResolvingDirection(direction);
      resolveConflict.mutate(
        { direction },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["action"] });
            queryClient.invalidateQueries({
              queryKey: ["document-sync", documentId],
            });
            toast.success(
              direction === "pull"
                ? "Resolved — pulled from Notion."
                : "Resolved — pushed local version.",
            );
            setResolvingDirection(null);
            setOpen(false);
          },
          onError: (error) => {
            setResolvingDirection(null);
            toast.error(
              error instanceof Error ? error.message : "Resolve failed.",
            );
          },
        },
      );
    },
    [resolveConflict, queryClient, documentId],
  );

  const handleCreateAndLink = useCallback(
    (parentPageIdOrUrl?: string) => {
      if (parentPageIdOrUrl) setCreatingParentPageId(parentPageIdOrUrl);
      createAndLink.mutate(
        parentPageIdOrUrl ? { parentPageIdOrUrl } : undefined,
        {
          onSuccess: () => {
            toast.success("Created and linked to new Notion page.");
            setSearchQuery("");
          },
          onError: (error) => {
            toast.error(
              error instanceof Error ? error.message : "Failed to create page.",
            );
          },
          onSettled: () => setCreatingParentPageId(null),
        },
      );
    },
    [createAndLink],
  );

  const handleSetup = () => {
    toast.info("Set up Notion in the sidebar first — click the Notion icon.");
    setOpen(false);
  };

  return (
    <>
      <div
        aria-hidden={!isSaving}
        className={cn(
          "pointer-events-none absolute top-3 left-4 z-10 flex items-center gap-1 text-xs text-muted-foreground/70 transition-opacity duration-200 sm:top-4 sm:left-6",
          isSaving ? "opacity-100" : "opacity-0",
        )}
      >
        <IconLoader2 size={12} className="animate-spin" />
        <span>Saving</span>
      </div>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-xl border border-border/70 bg-background/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:top-3 sm:right-4 sm:gap-1">
        {/* Presence — shared PresenceBar (agent + collaborator avatars) */}
        <PresenceBar
          activeUsers={activeUsers ?? []}
          agentPresent={agentPresent}
          agentActive={agentActive}
          currentUserEmail={currentUserEmail}
          className="mr-1"
        />
        <ShareButton
          resourceType="document"
          resourceId={documentId}
          resourceTitle={documentTitle}
          shareUrl={shareUrl}
          variant="compact"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <IconHistory size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Version history</TooltipContent>
        </Tooltip>

        <VersionHistoryPanel
          documentId={documentId}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEdit}
        />

        {canEdit ? (
          <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent",
                      isLinked
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {hasConflict ? (
                      <div className="relative">
                        <NotionIcon className="h-4 w-4" />
                        <IconAlertTriangle
                          size={8}
                          className="absolute -right-1 -top-1 text-amber-500"
                        />
                      </div>
                    ) : isLinked && autoSync ? (
                      <div className="relative">
                        <NotionIcon className="h-4 w-4" />
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                      </div>
                    ) : (
                      <NotionIcon className="h-4 w-4" />
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {isLinked
                  ? "Linked to Notion"
                  : isConnected
                    ? "Link to Notion"
                    : "Connect Notion"}
              </TooltipContent>
            </Tooltip>

            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={4}
              className="w-80 p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {!isConnected ? (
                /* ─── Not connected ─── */
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <NotionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm font-medium">Connect Notion</p>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Set up Notion to sync this document.
                  </p>
                  <Button size="sm" className="w-full" onClick={handleSetup}>
                    Set up Notion
                  </Button>
                </div>
              ) : isLinked ? (
                /* ─── Linked — show sync actions ─── */
                <div>
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <NotionIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-medium truncate">
                        Linked to Notion
                      </span>
                      {autoSync && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          <IconRefresh size={9} />
                          Auto
                        </span>
                      )}
                    </div>
                    {syncStatus?.lastSyncedAt && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Last synced{" "}
                        {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                      </p>
                    )}
                    {syncStatus?.lastError && (
                      <p className="mt-1 text-[10px] text-destructive">
                        {syncStatus.lastError}
                      </p>
                    )}
                    {syncStatus?.warnings?.length ? (
                      <div className="mt-1.5 space-y-1">
                        {syncStatus.warnings
                          .slice(0, 3)
                          .map((warning, index) => (
                            <p
                              key={`${warning}-${index}`}
                              className="text-[10px] text-muted-foreground"
                            >
                              {warning}
                            </p>
                          ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Conflict is shown via NotionConflictBanner above the title */}

                  <div className="p-1.5">
                    <button
                      onClick={() => setAutoSync(!autoSync)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded-md"
                    >
                      <IconRefresh
                        size={12}
                        className={
                          autoSync
                            ? "text-emerald-500"
                            : "text-muted-foreground"
                        }
                      />
                      <span
                        className={
                          autoSync
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        Auto-sync
                      </span>
                      <span
                        className={cn(
                          "ml-auto h-4 w-7 rounded-full relative",
                          autoSync
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white",
                            autoSync ? "right-0.5" : "left-0.5",
                          )}
                        />
                      </span>
                    </button>
                    <button
                      onClick={handlePull}
                      disabled={isWorking}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md disabled:opacity-40"
                    >
                      {pullDocument.isPending ? (
                        <IconLoader2 size={12} className="animate-spin" />
                      ) : (
                        <IconArrowBarDown size={12} />
                      )}
                      Pull from Notion
                    </button>
                    <button
                      onClick={handlePush}
                      disabled={isWorking}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md disabled:opacity-40"
                    >
                      {pushDocument.isPending ? (
                        <IconLoader2 size={12} className="animate-spin" />
                      ) : (
                        <IconArrowBarUp size={12} />
                      )}
                      Push to Notion
                    </button>
                    {syncStatus?.pageUrl && (
                      <a
                        href={syncStatus.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
                      >
                        <IconExternalLink size={12} />
                        Open in Notion
                      </a>
                    )}
                    <button
                      onClick={handleUnlink}
                      disabled={isWorking}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md disabled:opacity-40"
                    >
                      <IconLinkOff size={12} />
                      Unlink
                    </button>
                  </div>
                </div>
              ) : (
                /* ─── Not linked — show search ─── */
                <div>
                  <div className="p-3 pb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <NotionIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        Link to Notion page
                      </span>
                    </div>
                    <div className="relative">
                      <IconSearch
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search Notion pages..."
                        className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto border-t border-border">
                    {/* Create new page option */}
                    <div className="p-1.5 border-b border-border">
                      {requiresExplicitCreateParent ? (
                        <p className="px-2.5 py-2 text-xs text-muted-foreground">
                          Notion API-key connections need a parent page shared
                          with the integration. Pick where to create this page.
                        </p>
                      ) : (
                        <button
                          onClick={() => handleCreateAndLink()}
                          disabled={isWorking}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-md hover:bg-accent disabled:opacity-40"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {createAndLink.isPending ? (
                              <IconLoader2
                                size={14}
                                className="animate-spin text-muted-foreground"
                              />
                            ) : (
                              <IconPlus
                                size={14}
                                className="text-muted-foreground"
                              />
                            )}
                          </span>
                          <span className="text-xs font-medium">
                            Create new page in Notion
                          </span>
                        </button>
                      )}
                    </div>

                    {searchLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <IconLoader2
                          size={16}
                          className="animate-spin text-muted-foreground"
                        />
                      </div>
                    ) : searchResults?.results.length ? (
                      <div className="p-1.5">
                        {searchResults.results.map((page) => (
                          <div
                            key={page.id}
                            className="flex items-center gap-1 rounded-md hover:bg-accent"
                          >
                            <button
                              onClick={() => handleLink(page.id)}
                              disabled={isWorking}
                              className="min-w-0 flex-1 flex items-center gap-2.5 px-2.5 py-2 text-left rounded-md disabled:opacity-40"
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">
                                {linkingPageId === page.id ? (
                                  <IconLoader2
                                    size={14}
                                    className="animate-spin text-muted-foreground"
                                  />
                                ) : (
                                  page.icon || (
                                    <IconFileText
                                      size={14}
                                      className="text-muted-foreground"
                                    />
                                  )
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {page.title}
                                </p>
                                {linkingPageId === page.id ? (
                                  <p className="text-[10px] text-muted-foreground">
                                    Importing from Notion…
                                  </p>
                                ) : page.lastEditedTime ? (
                                  <p className="text-[10px] text-muted-foreground">
                                    Edited{" "}
                                    {new Date(
                                      page.lastEditedTime,
                                    ).toLocaleDateString()}
                                  </p>
                                ) : null}
                              </div>
                            </button>
                            {requiresExplicitCreateParent && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleCreateAndLink(page.id)}
                                    disabled={isWorking}
                                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
                                    aria-label={`Create new page inside ${page.title}`}
                                  >
                                    {creatingParentPageId === page.id ? (
                                      <IconLoader2
                                        size={13}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <IconPlus size={13} />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Create new page inside this page
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : debouncedQuery || searchResults ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        No pages found
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        ) : null}

        <NotificationsBell />
        <AgentToggleButton />
      </div>
    </>
  );
}
