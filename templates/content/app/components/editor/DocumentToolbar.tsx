import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  ExternalLink,
  Link2Off,
  Loader2,
  Search,
  FileText,
  Plus,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AgentToggleButton } from "@agent-native/core/client";
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

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor">
      <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" />
      <path
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L75.99 3.147C71.717 0.033 69.97 -0.36 63.17 0.227L61.35 0.227zM25.723 19.043c-5.35 0.353 -6.567 0.433 -9.613 -1.993L8.95 11.467c-0.807 -0.777 -0.36 -1.75 1.163 -1.943l52.647 -3.887c4.473 -0.393 6.733 1.167 8.463 2.527l8.723 6.35c0.393 0.273 1.36 1.553 0.193 1.553l-54.637 3.18 0.22 -0.203zM19.457 88.3V35.507c0 -2.723 0.78 -4.017 3.3 -4.21l56.857 -3.307c2.333 -0.193 3.497 1.36 3.497 4.08v52.2c0 2.723 -0.39 5.053 -3.883 5.25l-54.053 3.11c-3.5 0.197 -5.717 -0.967 -5.717 -4.33zM71.9 38.587c0.39 1.75 0 3.5 -1.75 3.7l-2.72 0.533v38.503c-2.333 1.36 -4.473 2.14 -6.247 2.14 -2.913 0 -3.687 -0.78 -5.83 -3.5l-18.043 -28.357v27.39l5.637 1.36s0 3.5 -4.857 3.5l-13.393 0.78c-0.393 -0.78 0 -2.723 1.36 -3.11l3.497 -0.967v-36.17l-4.857 -0.393c-0.393 -1.75 0.583 -4.277 3.3 -4.473l14.367 -0.967 18.8 28.94v-25.64l-4.667 -0.583c-0.39 -2.143 1.163 -3.7 3.11 -3.887l13.297 -0.78z"
        fill="hsl(var(--popover))"
      />
    </svg>
  );
}

interface DocumentToolbarProps {
  documentId: string;
}

export function DocumentToolbar({ documentId }: DocumentToolbarProps) {
  const queryClient = useQueryClient();
  const { data: connection } = useNotionConnection();
  const { data: syncStatus } = useDocumentSyncStatus(documentId);
  const linkDocument = useLinkDocumentToNotion(documentId);
  const unlinkDocument = useUnlinkDocumentFromNotion(documentId);
  const pullDocument = usePullDocumentFromNotion(documentId);
  const pushDocument = usePushDocumentToNotion(documentId);
  const resolveConflict = useResolveDocumentSyncConflict(documentId);

  const createAndLink = useCreateAndLinkNotionPage(documentId);

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const isConnected = connection?.connected ?? false;
  const isLinked = !!syncStatus?.pageId;
  const hasConflict = syncStatus?.hasConflict ?? false;

  const isWorking =
    linkDocument.isPending ||
    unlinkDocument.isPending ||
    pullDocument.isPending ||
    pushDocument.isPending ||
    resolveConflict.isPending ||
    createAndLink.isPending;

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
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
    lastSyncedRef.current = syncStatus.lastSyncedAt;
  }, [syncStatus?.lastSyncedAt, queryClient, documentId]);

  const handleLink = useCallback(
    async (pageId: string) => {
      try {
        await linkDocument.mutateAsync({ pageIdOrUrl: pageId });
        toast.success("Linked to Notion page.");
        setSearchQuery("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to link.");
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
      resolveConflict.mutate(
        { direction },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["document", documentId],
            });
            queryClient.invalidateQueries({
              queryKey: ["document-sync", documentId],
            });
            toast.success(
              direction === "pull"
                ? "Resolved — pulled from Notion."
                : "Resolved — pushed local version.",
            );
            setOpen(false);
          },
          onError: (error) => {
            toast.error(
              error instanceof Error ? error.message : "Resolve failed.",
            );
          },
        },
      );
    },
    [resolveConflict, queryClient, documentId],
  );

  const handleCreateAndLink = useCallback(() => {
    createAndLink.mutate(undefined, {
      onSuccess: () => {
        toast.success("Created and linked to new Notion page.");
        setSearchQuery("");
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to create page.",
        );
      },
    });
  }, [createAndLink]);

  const handleSetup = () => {
    toast.info("Set up Notion in the sidebar first — click the Notion icon.");
    setOpen(false);
  };

  return (
    <div className="absolute top-3 right-4 z-10 flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded hover:bg-accent",
              isLinked
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              isLinked
                ? "Linked to Notion"
                : isConnected
                  ? "Link to Notion"
                  : "Connect Notion"
            }
          >
            {hasConflict ? (
              <div className="relative">
                <NotionIcon className="h-4 w-4" />
                <AlertTriangle
                  size={8}
                  className="absolute -right-1 -top-1 text-amber-500"
                />
              </div>
            ) : (
              <NotionIcon className="h-4 w-4" />
            )}
          </button>
        </PopoverTrigger>

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
              </div>

              {/* Conflict banner */}
              {hasConflict && (
                <div className="px-4 py-2.5 border-b border-amber-500/30 bg-amber-500/10">
                  <p className="text-[11px] text-amber-800 dark:text-amber-200 mb-2">
                    Both sides changed since last sync.
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 h-7 text-xs"
                      onClick={() => handleResolve("pull")}
                      disabled={isWorking}
                    >
                      Use Notion
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 h-7 text-xs"
                      onClick={() => handleResolve("push")}
                      disabled={isWorking}
                    >
                      Use local
                    </Button>
                  </div>
                </div>
              )}

              <div className="p-1.5">
                <button
                  onClick={handlePull}
                  disabled={isWorking}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md disabled:opacity-40"
                >
                  {pullDocument.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={12} />
                  )}
                  Pull from Notion
                </button>
                <button
                  onClick={handlePush}
                  disabled={isWorking}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md disabled:opacity-40"
                >
                  {pushDocument.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine size={12} />
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
                    <ExternalLink size={12} />
                    Open in Notion
                  </a>
                )}
                <button
                  onClick={handleUnlink}
                  disabled={isWorking}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md disabled:opacity-40"
                >
                  <Link2Off size={12} />
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
                  <Search
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
                  <button
                    onClick={handleCreateAndLink}
                    disabled={isWorking}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-md hover:bg-accent disabled:opacity-40"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {createAndLink.isPending ? (
                        <Loader2
                          size={14}
                          className="animate-spin text-muted-foreground"
                        />
                      ) : (
                        <Plus size={14} className="text-muted-foreground" />
                      )}
                    </span>
                    <span className="text-xs font-medium">
                      Create new page in Notion
                    </span>
                  </button>
                </div>

                {searchLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2
                      size={16}
                      className="animate-spin text-muted-foreground"
                    />
                  </div>
                ) : searchResults?.results.length ? (
                  <div className="p-1.5">
                    {searchResults.results.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => handleLink(page.id)}
                        disabled={isWorking}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-md hover:bg-accent disabled:opacity-40"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">
                          {page.icon || (
                            <FileText
                              size={14}
                              className="text-muted-foreground"
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {page.title}
                          </p>
                          {page.lastEditedTime && (
                            <p className="text-[10px] text-muted-foreground">
                              Edited{" "}
                              {new Date(
                                page.lastEditedTime,
                              ).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </button>
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

      <AgentToggleButton />
    </div>
  );
}
