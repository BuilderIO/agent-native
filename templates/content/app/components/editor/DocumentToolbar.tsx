import {
  AgentToggleButton,
  PresenceBar,
  appPath,
  useActionMutation,
  useT,
  type CollabUser,
} from "@agent-native/core/client";
import { ShareButton } from "@agent-native/core/client";
import type { DocumentSourceInfo } from "@shared/api";
import {
  IconArrowBarDown,
  IconArrowBarUp,
  IconAlertTriangle,
  IconCopy,
  IconDownload,
  IconDotsVertical,
  IconExternalLink,
  IconFileTypeHtml,
  IconFileTypePdf,
  IconLinkOff,
  IconLoader2,
  IconMarkdown,
  IconSearch,
  IconFileText,
  IconFolderOpen,
  IconPlus,
  IconHistory,
  IconLink,
  IconRefresh,
  IconShare3,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/use-local-storage";
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
import {
  localSourceAbsolutePath,
  revealLinkedLocalSourceFile,
} from "@/lib/local-content-source-files";
import { cn } from "@/lib/utils";

import { VersionHistoryPanel } from "./VersionHistoryPanel";

type ExportFormat = "pdf" | "markdown" | "html";

interface ExportDocumentResult {
  filename: string;
  mimeType: string;
  content: string;
  format: ExportFormat;
  print: boolean;
}

function downloadExportFile(result: ExportDocumentResult) {
  const blob = new Blob([result.content], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = result.filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printExportHtml(result: ExportDocumentResult) {
  const iframe = window.document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  window.document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error("Could not open the print preview.");
  }

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };

  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  frameDocument.open();
  frameDocument.write(result.content);
  frameDocument.close();

  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 100);

  window.setTimeout(cleanup, 60_000);
}

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

function formatEditedLabel(updatedAt?: string | null) {
  if (!updatedAt) return null;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Edited just now";
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.round(diffMs / minute));
    return `Edited ${minutes}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.round(diffMs / hour));
    return `Edited ${hours}h ago`;
  }
  if (diffMs < 7 * day) {
    const days = Math.max(1, Math.round(diffMs / day));
    return `Edited ${days}d ago`;
  }

  return `Edited ${new Date(updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function ToolbarBreadcrumb({
  items,
  currentDocumentId,
  ariaLabel,
  untitledLabel,
  onOpen,
}: {
  items: { id?: string; title: string; icon?: string | null }[];
  currentDocumentId: string;
  ariaLabel: string;
  untitledLabel: string;
  onOpen: (id: string) => void;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex min-w-0 flex-1 items-center gap-1 text-sm text-foreground"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const label = item.title.trim() || untitledLabel;
        const content = (
          <>
            {item.icon ? (
              <span className="shrink-0 text-sm leading-none">{item.icon}</span>
            ) : null}
            <span className="truncate">{label}</span>
          </>
        );

        return (
          <div
            key={`${item.id ?? label}-${index}`}
            className="flex min-w-0 items-center gap-1"
          >
            {item.id && item.id !== currentDocumentId ? (
              <button
                type="button"
                className="flex min-w-0 max-w-48 items-center gap-1 rounded px-1.5 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpen(item.id!)}
              >
                {content}
              </button>
            ) : (
              <span
                className={cn(
                  "flex min-w-0 max-w-56 items-center gap-1 truncate px-1.5 py-1",
                  isLast ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {content}
              </span>
            )}
            {!isLast ? (
              <span className="shrink-0 text-muted-foreground/70">/</span>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

interface DocumentToolbarProps {
  documentId: string;
  documentTitle?: string;
  documentContent?: string;
  breadcrumbItems?: { id?: string; title: string; icon?: string | null }[];
  documentUpdatedAt?: string | null;
  activeUsers?: CollabUser[];
  agentPresent?: boolean;
  agentActive?: boolean;
  currentUserEmail?: string;
  canEdit?: boolean;
  hideFromSearch?: boolean;
  source?: DocumentSourceInfo;
}

export function DocumentToolbar({
  documentId,
  documentTitle,
  documentContent,
  breadcrumbItems = [],
  documentUpdatedAt,
  activeUsers,
  agentPresent,
  agentActive,
  currentUserEmail,
  canEdit = true,
  hideFromSearch = false,
  source,
}: DocumentToolbarProps) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isLocalFileDocument = source?.mode === "local-files";
  const openShareOnLoad =
    !isLocalFileDocument &&
    new URLSearchParams(location.search).get("share") === "1";
  const [autoSync, setAutoSync] = useLocalStorage(
    `notion-auto-sync:${documentId}`,
    false,
  );
  const { data: connection } = useNotionConnection();
  const { data: syncStatus } = useDocumentSyncStatus(
    canEdit && !isLocalFileDocument ? documentId : null,
    {
      autoSync,
    },
  );
  const linkDocument = useLinkDocumentToNotion(documentId);
  const unlinkDocument = useUnlinkDocumentFromNotion(documentId);
  const pullDocument = usePullDocumentFromNotion(documentId);
  const pushDocument = usePushDocumentToNotion(documentId);
  const resolveConflict = useResolveDocumentSyncConflict(documentId);
  const setDocumentDiscoverability = useActionMutation(
    "set-document-discoverability",
  );
  const exportDocument = useActionMutation("export-document");
  const revealLocalSource = useActionMutation("reveal-local-source-file");
  const shareLocalFile = useActionMutation("share-local-file-document");

  const createAndLink = useCreateAndLinkNotionPage(documentId);

  const [open, setOpen] = useState(false);
  const [pendingHideFromSearch, setPendingHideFromSearch] = useState<
    boolean | null
  >(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [linkingPageId, setLinkingPageId] = useState<string | null>(null);
  const [creatingParentPageId, setCreatingParentPageId] = useState<
    string | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  const shareUrl =
    typeof window === "undefined"
      ? `/p/${documentId}`
      : `${window.location.origin}${appPath(`/p/${documentId}`)}`;
  const pageUrl =
    typeof window === "undefined"
      ? `/page/${documentId}`
      : `${window.location.origin}${appPath(`/page/${documentId}`)}`;
  const copyPageUrl = isLocalFileDocument ? pageUrl : shareUrl;
  const effectiveHideFromSearch = pendingHideFromSearch ?? hideFromSearch;
  const editedLabel = formatEditedLabel(documentUpdatedAt);

  const { data: searchResults, isLoading: searchLoading } =
    useSearchNotionPages(debouncedQuery, open && isConnected && !isLinked);

  const handleHideFromSearchChange = useCallback(
    async (next: boolean) => {
      const previous = hideFromSearch;
      setPendingHideFromSearch(next);

      queryClient.setQueryData(
        ["action", "get-document", { id: documentId }],
        (old: any) =>
          old && typeof old === "object"
            ? { ...old, hideFromSearch: next }
            : old,
      );
      queryClient.setQueryData(
        ["action", "list-documents", undefined],
        (old: any) => {
          const docs = old?.documents ?? (Array.isArray(old) ? old : null);
          if (!Array.isArray(docs)) return old;
          const nextDocs = docs.map((doc: any) =>
            doc.id === documentId ? { ...doc, hideFromSearch: next } : doc,
          );
          return Array.isArray(old)
            ? nextDocs
            : { ...old, documents: nextDocs };
        },
      );

      try {
        await setDocumentDiscoverability.mutateAsync({
          id: documentId,
          hideFromSearch: next,
          includeChildren: true,
        });
      } catch (err) {
        setPendingHideFromSearch(previous);
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: documentId }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        toast.error(t("editor.toolbar.failedToUpdateSharing"), {
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
        });
        throw err;
      } finally {
        setPendingHideFromSearch(null);
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: documentId }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      }
    },
    [documentId, hideFromSearch, queryClient, setDocumentDiscoverability, t],
  );

  const handleCopyLocalRelativePath = useCallback(() => {
    const filePath = source?.path;
    if (!filePath) return;
    void navigator.clipboard?.writeText(filePath);
    toast.success(t("editor.toolbar.copiedRelativePath"));
  }, [source?.path, t]);

  const handleCopyLocalAbsolutePath = useCallback(async () => {
    const filePath = await localSourceAbsolutePath(source);
    if (!filePath) {
      toast.error(t("editor.toolbar.absolutePathUnavailable"), {
        description: t("editor.toolbar.absolutePathUnavailableDescription"),
      });
      return;
    }
    void navigator.clipboard?.writeText(filePath);
    toast.success(t("editor.toolbar.copiedAbsolutePath"));
  }, [source, t]);

  const handleCopyPageLink = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      toast.error(t("editor.toolbar.couldNotCopyLink"), {
        description: t("editor.toolbar.clipboardAccessUnavailable"),
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(copyPageUrl);
      toast.success(t("editor.toolbar.copiedPageLink"));
    } catch (error) {
      toast.error(t("editor.toolbar.couldNotCopyLink"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [copyPageUrl, t]);

  const handleRevealLocalPath = useCallback(async () => {
    try {
      const result = await revealLinkedLocalSourceFile(source);
      if (result.ok) {
        toast.success(t("editor.toolbar.revealedLocalFile"));
        return;
      }
      if (source?.absolutePath) {
        await revealLocalSource.mutateAsync({ id: documentId });
        toast.success(t("editor.toolbar.revealedLocalFile"));
        return;
      }
      toast.error(t("editor.toolbar.couldNotRevealLocalFile"), {
        description: result.error,
      });
    } catch (error) {
      toast.error(t("editor.toolbar.couldNotRevealLocalFile"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [documentId, revealLocalSource, source, t]);

  const handleShareLocalFile = useCallback(async () => {
    try {
      const result = (await shareLocalFile.mutateAsync({
        id: documentId,
      })) as { id?: string; title?: string };
      if (!result?.id) {
        throw new Error(t("editor.toolbar.shareableCopyWasNotCreated"));
      }
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      toast.success(t("editor.toolbar.shareableCopyReady"), {
        description: t("editor.toolbar.shareableCopyReadyDescription"),
      });
      navigate(`/page/${result.id}?share=1`);
    } catch (error) {
      toast.error(t("editor.toolbar.couldNotCreateShareableCopy"), {
        description:
          error instanceof Error ? error.message : t("empty.genericError"),
      });
    }
  }, [documentId, navigate, queryClient, shareLocalFile, t]);

  const handleDbShareOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen || !openShareOnLoad) return;
      const params = new URLSearchParams(location.search);
      params.delete("share");
      const nextSearch = params.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, {
        replace: true,
      });
    },
    [location.pathname, location.search, navigate, openShareOnLoad],
  );

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

  const handleLink = useCallback(
    async (pageId: string) => {
      setLinkingPageId(pageId);
      try {
        await linkDocument.mutateAsync({ documentId, pageIdOrUrl: pageId });
        toast.success(t("editor.toolbar.linkedToNotionPage"));
        setSearchQuery("");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("editor.toolbar.failedToLink"),
        );
      } finally {
        setLinkingPageId(null);
      }
    },
    [documentId, linkDocument, t],
  );

  const handlePull = useCallback(async () => {
    try {
      await pullDocument.mutateAsync({ documentId });
      toast.success(t("editor.toolbar.pulledFromNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("editor.toolbar.pullFailed"),
      );
    }
  }, [documentId, pullDocument, t]);

  const handlePush = useCallback(async () => {
    try {
      await pushDocument.mutateAsync({ documentId });
      toast.success(t("editor.toolbar.pushedToNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("editor.toolbar.pushFailed"),
      );
    }
  }, [documentId, pushDocument, t]);

  const handleUnlink = useCallback(async () => {
    try {
      await unlinkDocument.mutateAsync({ documentId });
      // Unlinking removes the toggle UI, but the per-document localStorage
      // flag would otherwise keep saying auto-sync is on — leaving the 2s
      // poll armed forever (see useDocumentSyncStatus) every time this
      // document is reopened, even though there's nothing left to sync.
      setAutoSync(false);
      toast.success(t("editor.toolbar.unlinkedFromNotion"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editor.toolbar.unlinkFailed"),
      );
    }
  }, [documentId, setAutoSync, unlinkDocument, t]);

  const handleCreateAndLink = useCallback(
    (parentPageIdOrUrl?: string) => {
      if (parentPageIdOrUrl) setCreatingParentPageId(parentPageIdOrUrl);
      createAndLink.mutate(
        { documentId, ...(parentPageIdOrUrl ? { parentPageIdOrUrl } : {}) },
        {
          onSuccess: () => {
            toast.success(t("editor.toolbar.createdAndLinkedToNotionPage"));
            setSearchQuery("");
          },
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : t("editor.toolbar.failedToCreatePage"),
            );
          },
          onSettled: () => setCreatingParentPageId(null),
        },
      );
    },
    [createAndLink, documentId, t],
  );

  const handleSetup = () => {
    toast.info(t("editor.toolbar.setUpNotionFirst"));
    setOpen(false);
  };

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        const result = (await exportDocument.mutateAsync({
          id: documentId,
          format,
          title: documentTitle,
          content: documentContent,
        })) as ExportDocumentResult;

        if (result.print) {
          printExportHtml(result);
          toast.success(t("editor.toolbar.printDialogOpened"), {
            description: t("editor.toolbar.printDialogOpenedDescription"),
          });
          return;
        }

        downloadExportFile(result);
        toast.success(
          t(
            format === "markdown"
              ? "editor.toolbar.exportedMarkdown"
              : "editor.toolbar.exportedHtml",
          ),
        );
      } catch (error) {
        toast.error(t("editor.toolbar.exportFailed"), {
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
      }
    },
    [documentContent, documentId, documentTitle, exportDocument, t],
  );

  return (
    <>
      <div className="relative z-10 flex h-12 shrink-0 items-center gap-3 bg-background px-4">
        <ToolbarBreadcrumb
          items={
            breadcrumbItems.length
              ? breadcrumbItems
              : [{ id: documentId, title: documentTitle || "Untitled" }]
          }
          currentDocumentId={documentId}
          ariaLabel={t("editor.toolbar.pageBreadcrumb")}
          untitledLabel={t("sidebar.untitled")}
          onOpen={(id) => navigate(`/page/${id}`, { flushSync: true })}
        />

        <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-1">
          {editedLabel ? (
            <span className="hidden shrink-0 px-2 text-sm text-muted-foreground lg:inline">
              {editedLabel}
            </span>
          ) : null}

          {/* Presence — shared PresenceBar (agent + collaborator avatars) */}
          <PresenceBar
            activeUsers={activeUsers ?? []}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={currentUserEmail}
            className="mr-1"
          />
          {isLocalFileDocument ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 rounded-lg px-3"
              disabled={shareLocalFile.isPending}
              onClick={() => void handleShareLocalFile()}
            >
              {shareLocalFile.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconShare3 className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {t("editor.toolbar.share")}
              </span>
            </Button>
          ) : (
            <>
              <ShareButton
                resourceType="document"
                resourceId={documentId}
                resourceTitle={documentTitle}
                shareUrl={shareUrl}
                defaultOpen={openShareOnLoad}
                onOpenChange={handleDbShareOpenChange}
                visibilityCopy={{
                  org: {
                    description: effectiveHideFromSearch
                      ? t("editor.toolbar.orgLinkCanView")
                      : t("editor.toolbar.orgCanFindAndView"),
                  },
                }}
                hideInSearchControl={{
                  checked: effectiveHideFromSearch,
                  pending: setDocumentDiscoverability.isPending,
                  label: t("editor.toolbar.hideInSearch"),
                  description: t("editor.toolbar.hideInSearchDescription"),
                  onCheckedChange: handleHideFromSearchChange,
                }}
                variant="compact"
              />

              <VersionHistoryPanel
                documentId={documentId}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                canRestore={canEdit}
                activeUsers={activeUsers}
              />
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("editor.toolbar.copyPageLink")}
                onClick={() => void handleCopyPageLink()}
              >
                <IconLink size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editor.toolbar.copyPageLink")}</TooltipContent>
          </Tooltip>

          <DropdownMenu modal={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                    aria-label={t("editor.toolbar.morePageActions")}
                  >
                    <IconDotsVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {t("editor.toolbar.morePageActions")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-60">
              {isLocalFileDocument ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("editor.toolbar.localFile")}
                  </DropdownMenuLabel>
                  <DropdownMenuItem disabled className="min-w-0">
                    <IconFileText className="me-2 h-4 w-4 shrink-0" />
                    <span className="truncate">{source?.path}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={revealLocalSource.isPending}
                    onSelect={() => void handleRevealLocalPath()}
                  >
                    <IconFolderOpen className="me-2 h-4 w-4" />
                    {t("editor.toolbar.revealInFinder")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleCopyLocalRelativePath}>
                    <IconCopy className="me-2 h-4 w-4" />
                    {t("editor.toolbar.copyRelativePath")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void handleCopyLocalAbsolutePath()}
                  >
                    <IconCopy className="me-2 h-4 w-4" />
                    {t("editor.toolbar.copyAbsolutePath")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                      <IconHistory className="me-2 h-4 w-4" />
                      {t("editor.toolbar.versionHistory")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={exportDocument.isPending}>
                      {exportDocument.isPending ? (
                        <IconLoader2 className="me-2 h-4 w-4 animate-spin" />
                      ) : (
                        <IconDownload className="me-2 h-4 w-4" />
                      )}
                      {t("editor.toolbar.export")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      <DropdownMenuItem
                        disabled={exportDocument.isPending}
                        onSelect={() => void handleExport("pdf")}
                      >
                        <IconFileTypePdf className="me-2 h-4 w-4" />
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={exportDocument.isPending}
                        onSelect={() => void handleExport("markdown")}
                      >
                        <IconMarkdown className="me-2 h-4 w-4" />
                        Markdown
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={exportDocument.isPending}
                        onSelect={() => void handleExport("html")}
                      >
                        <IconFileTypeHtml className="me-2 h-4 w-4" />
                        HTML
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {canEdit && !isLocalFileDocument ? (
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                          isLinked
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="me-2 flex h-4 w-4 shrink-0 items-center justify-center">
                          {hasConflict ? (
                            <span className="relative">
                              <NotionIcon className="h-4 w-4" />
                              <IconAlertTriangle
                                size={8}
                                className="absolute -end-1 -top-1 text-amber-500"
                              />
                            </span>
                          ) : isLinked && autoSync ? (
                            <span className="relative">
                              <NotionIcon className="h-4 w-4" />
                              <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                            </span>
                          ) : (
                            <NotionIcon className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-start">
                          {isLinked
                            ? t("editor.toolbar.notionSync")
                            : isConnected
                              ? t("editor.toolbar.linkToNotion")
                              : t("editor.toolbar.connectNotion")}
                        </span>
                      </button>
                    </PopoverTrigger>

                    <PopoverContent
                      side="left"
                      align="start"
                      sideOffset={8}
                      className="w-80 p-0"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      {!isConnected ? (
                        /* ─── Not connected ─── */
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <NotionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <p className="text-sm font-medium">
                              {t("editor.toolbar.connectNotion")}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">
                            {t("editor.toolbar.setUpNotionToSync")}
                          </p>
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={handleSetup}
                          >
                            {t("editor.toolbar.setUpNotion")}
                          </Button>
                        </div>
                      ) : isLinked ? (
                        /* ─── Linked — show sync actions ─── */
                        <div>
                          <div className="px-4 py-3 border-b border-border">
                            <div className="flex items-center gap-2">
                              <NotionIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="text-xs font-medium truncate">
                                {t("editor.toolbar.linkedToNotion")}
                              </span>
                              {autoSync && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                  <IconRefresh size={9} />
                                  {t("editor.toolbar.auto")}
                                </span>
                              )}
                            </div>
                            {syncStatus?.lastSyncedAt && (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {t("editor.toolbar.lastSynced")}{" "}
                                {new Date(
                                  syncStatus.lastSyncedAt,
                                ).toLocaleString()}
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
                                {t("editor.toolbar.autoSync")}
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
                                <IconLoader2
                                  size={12}
                                  className="animate-spin"
                                />
                              ) : (
                                <IconArrowBarDown size={12} />
                              )}
                              {t("editor.toolbar.pullFromNotion")}
                            </button>
                            <button
                              onClick={handlePush}
                              disabled={isWorking}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md disabled:opacity-40"
                            >
                              {pushDocument.isPending ? (
                                <IconLoader2
                                  size={12}
                                  className="animate-spin"
                                />
                              ) : (
                                <IconArrowBarUp size={12} />
                              )}
                              {t("editor.toolbar.pushToNotion")}
                            </button>
                            {syncStatus?.pageUrl && (
                              <a
                                href={syncStatus.pageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
                              >
                                <IconExternalLink size={12} />
                                {t("editor.toolbar.openInNotion")}
                              </a>
                            )}
                            <button
                              onClick={handleUnlink}
                              disabled={isWorking}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md disabled:opacity-40"
                            >
                              <IconLinkOff size={12} />
                              {t("editor.toolbar.unlink")}
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
                                {t("editor.toolbar.linkToNotionPage")}
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
                                placeholder={t(
                                  "editor.toolbar.searchNotionPages",
                                )}
                                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                              />
                            </div>
                          </div>

                          <div className="max-h-64 overflow-y-auto border-t border-border">
                            {/* Create new page option */}
                            <div className="p-1.5 border-b border-border">
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
                                  {t("editor.toolbar.createNewPageInNotion")}
                                </span>
                              </button>
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
                                            {t(
                                              "editor.toolbar.importingFromNotion",
                                            )}
                                          </p>
                                        ) : page.lastEditedTime ? (
                                          <p className="text-[10px] text-muted-foreground">
                                            {t("editor.toolbar.edited")}{" "}
                                            {new Date(
                                              page.lastEditedTime,
                                            ).toLocaleDateString()}
                                          </p>
                                        ) : null}
                                      </div>
                                    </button>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          onClick={() =>
                                            handleCreateAndLink(page.id)
                                          }
                                          disabled={isWorking}
                                          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
                                          aria-label={t(
                                            "editor.toolbar.createNewPageInside",
                                            { title: page.title },
                                          )}
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
                                        {t(
                                          "editor.toolbar.createNewPageInsideThisPage",
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                ))}
                              </div>
                            ) : debouncedQuery || searchResults ? (
                              <div className="py-6 text-center text-xs text-muted-foreground">
                                {t("editor.toolbar.noPagesFound")}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <AgentToggleButton />
        </div>
      </div>
    </>
  );
}
