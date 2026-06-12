import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent } from "react";
import { useNavigate } from "react-router";
import { IconArrowLeft, IconDatabase } from "@tabler/icons-react";
import { VisualEditor } from "./VisualEditor";
import { DocumentToolbar } from "./DocumentToolbar";
import { DocumentDatabase } from "./DocumentDatabase";
import { DocumentProperties } from "./DocumentProperties";
import { NotionConflictBanner } from "./NotionConflictBanner";
import { EmojiPicker } from "./EmojiPicker";
import {
  useDocument,
  useDocuments,
  useUpdateDocument,
} from "@/hooks/use-documents";
import { useDocumentSyncStatus } from "@/hooks/use-notion";
import {
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  useSession,
  appApiPath,
  agentNativePath,
  type CollabUser,
} from "@agent-native/core/client";
import { CommentsSidebar } from "./CommentsSidebar";
import { useComments } from "@/hooks/use-comments";
import type { CommentTextAnchor } from "./comment-anchors";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useQueryClient } from "@tanstack/react-query";
import { IconLock } from "@tabler/icons-react";
import { BlockRegistryProvider } from "@agent-native/core/blocks";
import {
  contentBlockRegistry,
  createContentBlockRenderContext,
} from "@/blocks/contentBlockRegistry";
import type { Document, DocumentSyncStatus } from "@shared/api";
import type { NotionPageLink } from "./VisualEditor";
import { toast } from "sonner";
import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";
import { cn } from "@/lib/utils";
import {
  canWriteLinkedLocalSource,
  readDocumentFromLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "@/lib/local-content-source-files";

const TAB_ID = generateTabId();

interface DocumentEditorProps {
  documentId: string;
}

function DocumentEditorSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-3xl px-4 pt-14 pb-16 sm:px-8 md:px-16 md:pt-16">
          <Skeleton className="mb-4 h-12 w-12 rounded-lg" />
          <Skeleton className="h-11 w-2/3 rounded-md" />
          <div className="space-y-3 pt-12">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-3 pt-8">
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-7/12" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentUnavailable({ onOpenHome }: { onOpenHome: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <IconLock size={22} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">
          Document unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This page may have been deleted, or it has not been shared with your
          account.
        </p>
        <Button className="mt-6" variant="outline" onClick={onOpenHome}>
          Go to documents
        </Button>
      </div>
    </div>
  );
}

/**
 * Outer wrapper: gates the editor on the document fetch so collab + comments
 * only mount once we know the doc exists. Otherwise an invalid id triggers
 * an infinite spinner plus repeating 404/403 polls in the console.
 */
export function DocumentEditor({ documentId }: DocumentEditorProps) {
  const { data: document, isError } = useDocument(documentId);
  const navigate = useNavigate();

  if (isError && !document) {
    return <DocumentUnavailable onOpenHome={() => navigate("/")} />;
  }

  // If we have a doc (real or optimistic from create) render the editor —
  // an `isError` blip during a just-fired create shouldn't flash "not found".
  if (!document) {
    return <DocumentEditorSkeleton />;
  }

  return <DocumentEditorBody documentId={documentId} document={document} />;
}

interface DocumentEditorBodyProps {
  documentId: string;
  document: Document;
}

export function documentEditorTitleRegionClassName(hasDatabase: boolean) {
  if (hasDatabase) {
    return cn(
      "shrink-0 w-full max-w-none px-4 pt-14 pb-2 sm:px-8 sm:pt-7 lg:px-10 group/title",
    );
  }

  return cn(
    "shrink-0 w-full max-w-3xl mx-auto px-4 pt-14 sm:px-8 md:px-16 md:pt-16 group/title",
    "pb-8",
  );
}

export function documentEditorDatabaseRegionClassName() {
  return "shrink-0 min-w-0 w-full max-w-none px-4 pb-8 sm:px-8 lg:px-10";
}

export function documentEditorDefaultIconKind(
  document: Pick<Document, "database">,
) {
  return document.database ? "database" : null;
}

export function databaseMembershipDatabaseTitle(
  membership: Document["databaseMembership"],
) {
  return membership?.databaseTitle?.trim() || "Untitled database";
}

function DatabaseMembershipBreadcrumb({
  document,
  onOpenDatabase,
}: {
  document: Document;
  onOpenDatabase: (databaseDocumentId: string) => void;
}) {
  const membership = document.databaseMembership;
  if (!membership) return null;

  const databaseTitle = databaseMembershipDatabaseTitle(membership);

  return (
    <div className="mb-3 -ml-1 flex min-w-0 items-center">
      <button
        type="button"
        aria-label={`Open database ${databaseTitle}`}
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenDatabase(membership.databaseDocumentId)}
      >
        <IconArrowLeft className="size-3.5 shrink-0" />
        <IconDatabase className="size-4 shrink-0" />
        <span className="truncate">{databaseTitle}</span>
      </button>
    </div>
  );
}

function DocumentEditorBody({ documentId, document }: DocumentEditorBodyProps) {
  const updateDocument = useUpdateDocument();
  const queryClient = useQueryClient();
  // The block render context (asset/upload resolvers, inline markdown reader,
  // panel popover) is stable for the editor's lifetime. Created once here and
  // provided alongside the content block registry so every registry block in the
  // editor subtree renders through the same wiring.
  const blockRenderContext = useMemo(
    () => createContentBlockRenderContext({ documentId }),
    [documentId],
  );
  const navigate = useNavigate();
  const { data: documents = [] } = useDocuments();
  // Shared with DocumentToolbar via the same localStorage key — both read it.
  const [autoSync] = useLocalStorage(`notion-auto-sync:${documentId}`, false);
  const canEdit = document.canEdit ?? true;
  const isLocalFileDocument = document.source?.mode === "local-files";
  const isLinkedLocalSourceDocument = canWriteLinkedLocalSource(
    documentId,
    document.source,
  );
  // Polls Notion sync status to drive the conflict banner / sync bar and the
  // push-on-save path below (read via the query cache, not this return value).
  useDocumentSyncStatus(canEdit && !isLocalFileDocument ? documentId : null, {
    autoSync,
  });
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [localContentUpdatedAt, setLocalContentUpdatedAt] = useState<
    string | null
  >(document.updatedAt ?? null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate freshness watermarks for title and content so that a content save
  // never suppresses adopting a newer external title and vice versa.
  const lastSavedTitleRef = useRef<{ title: string; updatedAt: string | null }>(
    { title: "", updatedAt: null },
  );
  const lastSavedContentRef = useRef<{
    content: string;
    updatedAt: string | null;
  }>({ content: "", updatedAt: null });
  const isInitializedRef = useRef(false);
  const prevDocIdRef = useRef<string | null>(null);
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;
  const localSourceWriteErrorShownRef = useRef(false);
  const documentUpdatedAtRef = useRef<string | null>(
    document.updatedAt ?? null,
  );
  documentUpdatedAtRef.current = document.updatedAt ?? null;
  const titleFocusedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusTitleRef = useRef(false);
  const notionPageLinks = useMemo<NotionPageLink[]>(
    () =>
      documents.flatMap((doc) =>
        doc.notionPageId
          ? [
              {
                notionPageId: doc.notionPageId,
                documentId: doc.id,
                title: doc.title || "Untitled",
                icon: doc.icon,
              },
            ]
          : [],
      ),
    [documents],
  );
  const handleOpenNotionPageLink = useCallback(
    (linkedDocumentId: string) => {
      navigate(`/page/${linkedDocumentId}`, { flushSync: true });
    },
    [navigate],
  );

  // Per-field freshness: an external write is authoritative when the server
  // updatedAt is newer than the last value this client saved for THAT field.
  // Separate watermarks prevent a content save from suppressing adoption of a
  // newer external title, and vice versa (the original shared-watermark bug).
  const titleExternalIsNewer =
    !lastSavedTitleRef.current.updatedAt ||
    (!!document.updatedAt &&
      document.updatedAt > lastSavedTitleRef.current.updatedAt);
  const contentExternalIsNewer =
    !lastSavedContentRef.current.updatedAt ||
    (!!document.updatedAt &&
      document.updatedAt > lastSavedContentRef.current.updatedAt);

  useLayoutEffect(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [localTitle]);

  // Current user info for cursor labels
  const { session } = useSession();
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
      }
    : undefined;

  // Collaborative editing — stable Y.Doc per document, always-on
  const {
    ydoc,
    awareness,
    isLoading: collabLoading,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: isLocalFileDocument ? "" : documentId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  // Initialize from fetched document, reset on document switch
  useEffect(() => {
    if (!document) return;
    if (prevDocIdRef.current !== documentId) {
      prevDocIdRef.current = documentId;
      isInitializedRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    }
    if (!isInitializedRef.current) {
      setLocalTitle(document.title);
      setLocalContent(document.content);
      setLocalContentUpdatedAt(document.updatedAt ?? null);
      lastSavedTitleRef.current = {
        title: document.title,
        updatedAt: document.updatedAt ?? null,
      };
      lastSavedContentRef.current = {
        content: document.content,
        updatedAt: document.updatedAt ?? null,
      };
      isInitializedRef.current = true;
      if (!document.title) {
        shouldFocusTitleRef.current = true;
      }
    }
  }, [document, documentId]);

  useEffect(() => {
    if (!isInitializedRef.current || !isLinkedLocalSourceDocument) {
      return;
    }

    let cancelled = false;
    readDocumentFromLinkedLocalSource(document)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          toast.error("Could not read local source file", {
            description: result.error,
          });
          return;
        }

        const fileDocument = result.document;
        setLocalTitle(fileDocument.title);
        setLocalContent(fileDocument.content);
        setLocalContentUpdatedAt(result.updatedAt);
        lastSavedTitleRef.current = {
          title: fileDocument.title,
          updatedAt: result.updatedAt,
        };
        lastSavedContentRef.current = {
          content: fileDocument.content,
          updatedAt: result.updatedAt,
        };
        queryClient.setQueryData(
          ["action", "get-document", { id: documentId }],
          (old: Document | undefined) =>
            old && typeof old === "object" ? { ...old, ...fileDocument } : old,
        );
        queryClient.setQueryData(
          ["action", "list-documents", undefined],
          (old: any) => {
            const docs = old?.documents ?? (Array.isArray(old) ? old : null);
            if (!Array.isArray(docs)) return old;
            const nextDocs = docs.map((doc: Document) =>
              doc.id === documentId ? { ...doc, ...fileDocument } : doc,
            );
            return Array.isArray(old)
              ? nextDocs
              : { ...old, documents: nextDocs };
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error("Could not read local source file", {
          description:
            error instanceof Error ? error.message : "Something went wrong",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    documentId,
    document.source?.path,
    isLinkedLocalSourceDocument,
    queryClient,
  ]);

  // NOTE: External body changes (agent edit, Notion pull, update-document) are
  // reconciled into the editor by VisualEditor via its content prop + the
  // updatedAt gate. The effects below keep DocumentEditor's own mirror
  // (localTitle for the title field, localContent for export/toolbar) in step.

  // Pick up external title changes (agent edit, Notion pull). Adopt when this
  // client has no unsaved local title edit, OR when the server value is a
  // genuinely newer external write — but never yank a title the user is
  // actively editing.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const serverTitle = document.title;
    const lastSaved = lastSavedTitleRef.current;
    if (serverTitle === lastSaved.title) return;
    const adopt =
      localTitle === lastSaved.title ||
      (titleExternalIsNewer && !titleFocusedRef.current);
    if (adopt) {
      setLocalTitle(serverTitle);
      lastSavedTitleRef.current = {
        title: serverTitle,
        updatedAt: document.updatedAt ?? lastSaved.updatedAt,
      };
    }
  }, [document, isLinkedLocalSourceDocument, titleExternalIsNewer, localTitle]);

  // Pick up external body changes for the export/toolbar mirror. Adopt when
  // there's no unsaved local divergence, or when the server is genuinely newer;
  // clear any pending save so a stale autosave can't overwrite the fresh body.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const serverContent = document.content;
    const lastSaved = lastSavedContentRef.current;
    if (serverContent === lastSaved.content) return;
    const adopt = localContent === lastSaved.content || contentExternalIsNewer;
    if (adopt) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setLocalContent(serverContent);
      lastSavedContentRef.current = {
        content: serverContent,
        updatedAt: document.updatedAt ?? lastSaved.updatedAt,
      };
    }
  }, [
    document,
    isLinkedLocalSourceDocument,
    contentExternalIsNewer,
    localContent,
  ]);

  // When polling/SSE refetches confirm the server now matches local editor
  // state, acknowledge it as saved (and adopt its updatedAt watermark). This
  // keeps later agent/action updates from being mistaken for conflicts with
  // stale "unsaved" local text.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (isLinkedLocalSourceDocument) return;
    const titleMatchesLocal = document.title === localTitle;
    const contentMatchesLocal = document.content === localContent;

    if (titleMatchesLocal) {
      lastSavedTitleRef.current = {
        title: document.title,
        updatedAt: document.updatedAt ?? lastSavedTitleRef.current.updatedAt,
      };
    }
    if (contentMatchesLocal) {
      lastSavedContentRef.current = {
        content: document.content,
        updatedAt: document.updatedAt ?? lastSavedContentRef.current.updatedAt,
      };
    }
  }, [document, isLinkedLocalSourceDocument, localTitle, localContent]);

  const persistDocumentUpdates = useCallback(
    async (updates: {
      title?: string;
      content?: string;
      icon?: string | null;
    }): Promise<Document> => {
      const localSource = document.source;
      const isLinkedLocalSource = canWriteLinkedLocalSource(
        documentId,
        localSource,
      );
      const nextSavedAt = new Date().toISOString();
      const fileFirstDocument: Document = {
        ...document,
        title: updates.title ?? localTitleRef.current,
        content: updates.content ?? localContentRef.current,
        icon: updates.icon !== undefined ? updates.icon : document.icon,
        updatedAt: nextSavedAt,
        source: localSource,
      };

      if (isLinkedLocalSource) {
        const result = await writeDocumentToLinkedLocalSource(
          fileFirstDocument,
          localSource,
        );
        if (!result.ok) {
          if (!localSourceWriteErrorShownRef.current) {
            toast.error("Could not save local file", {
              description: result.error,
            });
            localSourceWriteErrorShownRef.current = true;
          }
          throw new Error(result.error);
        }
        localSourceWriteErrorShownRef.current = false;
        setLocalContentUpdatedAt(nextSavedAt);
      }

      try {
        return await updateDocument.mutateAsync({
          id: documentId,
          ...updates,
        });
      } catch (error) {
        if (!isLinkedLocalSource) throw error;
        toast.warning("Local file saved, but history was not updated", {
          description:
            error instanceof Error ? error.message : "Something went wrong",
        });
        queryClient.setQueryData(
          ["action", "get-document", { id: documentId }],
          fileFirstDocument,
        );
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        return fileFirstDocument;
      }
    },
    [document, documentId, queryClient, updateDocument],
  );

  const debouncedSave = useCallback(
    (title: string, content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        // Never clobber a newer server version (e.g. an agent edit we haven't
        // reconciled into the editor yet) with the editor's current — possibly
        // stale — content. Guard per-field using the field's own watermark.
        const titleIsStale =
          !isLinkedLocalSourceDocument &&
          documentUpdatedAtRef.current &&
          lastSavedTitleRef.current.updatedAt &&
          documentUpdatedAtRef.current > lastSavedTitleRef.current.updatedAt;
        const contentIsStale =
          !isLinkedLocalSourceDocument &&
          documentUpdatedAtRef.current &&
          lastSavedContentRef.current.updatedAt &&
          documentUpdatedAtRef.current > lastSavedContentRef.current.updatedAt;

        const updates: Record<string, string> = {};
        if (title !== lastSavedTitleRef.current.title && !titleIsStale)
          updates.title = title;
        if (content !== lastSavedContentRef.current.content && !contentIsStale)
          updates.content = content;
        if (Object.keys(updates).length === 0) return;

        const saved = await persistDocumentUpdates(updates);
        // Adopt the server updatedAt per saved field.
        const savedAt = saved?.updatedAt ?? new Date().toISOString();
        if (updates.title !== undefined) {
          lastSavedTitleRef.current = { title, updatedAt: savedAt };
        }
        if (updates.content !== undefined) {
          lastSavedContentRef.current = { content, updatedAt: savedAt };
        }

        // Push-on-save: when auto-sync is on, trigger a Notion push
        // immediately after the save lands in SQL. This eliminates the
        // off-by-one race where a fixed-interval poll could fire between
        // the debounce and the next save, reading the previous content.
        // Pulls remain driven by the polling refetch in useDocumentSyncStatus.
        if (autoSync) {
          const status = queryClient.getQueryData<DocumentSyncStatus>([
            "document-sync",
            documentId,
          ]);
          if (status?.pageId && !status.hasConflict) {
            try {
              const res = await fetch(
                appApiPath(`/api/documents/${documentId}/notion/push`),
                { method: "POST" },
              );
              if (res.ok) {
                const next = (await res.json()) as DocumentSyncStatus;
                queryClient.setQueryData(["document-sync", documentId], next);
              }
            } catch {
              // Non-fatal — next polling refetch will surface any error.
            }
          }
        }
      }, 500);
    },
    [
      documentId,
      autoSync,
      isLinkedLocalSourceDocument,
      persistDocumentUpdates,
      queryClient,
    ],
  );

  // Collab-aware ingest flush: the `pull-document` action writes a one-shot
  // `flush-request-<id>` app-state key when an external agent wants to ingest
  // the document while a live collab session is open. The DB column can lag
  // the in-memory Y.Doc, so the open editor is the only place that can
  // serialize the live content through its existing serializer. On seeing the
  // key we force an immediate (non-debounced) save of the current editor
  // state, then delete the key so `pull-document` knows the flush landed.
  useEffect(() => {
    if (!canEdit || isLocalFileDocument) return;
    let active = true;
    const flushKey = `flush-request-${documentId}`;
    const flushPath = agentNativePath(
      `/_agent-native/application-state/${flushKey}`,
    );

    async function poll() {
      try {
        const res = await fetch(flushPath);
        if (res.ok) {
          const pending = (await res.json()) as { id?: string } | null;
          if (pending && active) {
            const title = localTitleRef.current;
            const content = localContentRef.current;
            const updates: Record<string, string> = {};
            if (title !== lastSavedTitleRef.current.title)
              updates.title = title;
            if (content !== lastSavedContentRef.current.content) {
              updates.content = content;
            }
            try {
              if (Object.keys(updates).length > 0) {
                const saved = await persistDocumentUpdates(updates);
                const savedAt = saved?.updatedAt ?? new Date().toISOString();
                if (updates.title !== undefined) {
                  lastSavedTitleRef.current = { title, updatedAt: savedAt };
                }
                if (updates.content !== undefined) {
                  lastSavedContentRef.current = {
                    content,
                    updatedAt: savedAt,
                  };
                }
              }
            } finally {
              // Acknowledge the flush even if nothing changed — the SQL row is
              // already current, and pull-document is waiting on this delete.
              await fetch(flushPath, {
                method: "DELETE",
                headers: { "X-Agent-Native-CSRF": "1" },
              }).catch(() => {});
            }
          }
        }
      } catch {
        // Ignore — next tick retries.
      }
      if (active) setTimeout(poll, 600);
    }

    const timer = setTimeout(poll, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canEdit, documentId, isLocalFileDocument, persistDocumentUpdates]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      if (!canEdit) return;
      setLocalTitle(newTitle);
      debouncedSave(newTitle, localContentRef.current);
    },
    [canEdit, debouncedSave],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!canEdit) return;
      setLocalContent(newContent);
      debouncedSave(localTitleRef.current, newContent);
    },
    [canEdit, debouncedSave],
  );

  // Comments state — pending comment from text selection
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
    offsetTop: number;
    anchor?: CommentTextAnchor;
    range?: { from: number; to: number };
  } | null>(null);
  // The thread whose highlight + card are currently focused (click an inline
  // highlight to focus its card; hover a card to emphasize its highlight).
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const { data: threads } = useComments(
    isLocalFileDocument ? null : documentId,
  );
  const hasComments =
    !isLocalFileDocument &&
    canEdit &&
    ((threads?.length ?? 0) > 0 || !!pendingComment);
  const isMobile = useIsMobile();

  const handleComment = useCallback(
    (
      quotedText: string,
      offsetTop: number,
      anchor?: CommentTextAnchor,
      range?: { from: number; to: number },
    ) => {
      setPendingComment({ quotedText, offsetTop, anchor, range });
      setActiveThreadId(null);
    },
    [],
  );

  const focusTitleEnd = useCallback(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, []);

  const joinFirstBodyBlockToTitle = useCallback(
    (text: string) => {
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed) {
        const currentTitle = localTitleRef.current.trim();
        const nextTitle = currentTitle ? `${currentTitle} ${trimmed}` : trimmed;
        handleTitleChange(nextTitle);
      }
      requestAnimationFrame(focusTitleEnd);
    },
    [focusTitleEnd, handleTitleChange],
  );

  const handleTitlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!canEdit) return;

      const pastedText = event.clipboardData.getData("text/plain");
      if (!pastedText) return;

      event.preventDefault();

      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const pastedTitle = normalizeTitleText(
        stripMarkdownHeadingPrefixFromTitlePaste(pastedText),
      );
      const nextTitle = `${localTitle.slice(0, selectionStart)}${pastedTitle}${localTitle.slice(selectionEnd)}`;
      const nextCaret = selectionStart + pastedTitle.length;

      handleTitleChange(nextTitle);
      requestAnimationFrame(() => {
        titleInputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [canEdit, handleTitleChange, localTitle],
  );

  // Auto-focus title on new empty documents once collab finishes loading
  useEffect(() => {
    if (canEdit && !collabLoading && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  });

  if (!isLocalFileDocument && collabLoading) {
    return <DocumentEditorSkeleton />;
  }

  const sidebar = (
    <CommentsSidebar
      documentId={documentId}
      pendingComment={pendingComment}
      onPendingDone={() => setPendingComment(null)}
      scrollContainerRef={scrollContainerRef}
      activeThreadId={activeThreadId}
      onActiveThreadChange={setActiveThreadId}
      currentUserEmail={session?.email}
    />
  );
  const defaultIconKind = documentEditorDefaultIconKind(document);
  const isDatabasePage = Boolean(document.database);
  const defaultIcon =
    defaultIconKind === "database" && !isDatabasePage ? (
      <IconDatabase className="size-12" aria-hidden="true" />
    ) : undefined;
  const exportTitle = isInitializedRef.current ? localTitle : document.title;
  const exportContent = isInitializedRef.current
    ? localContent
    : document.content;

  return (
    <BlockRegistryProvider
      registry={contentBlockRegistry}
      ctx={blockRenderContext}
    >
      <div
        className="relative flex min-h-0 min-w-0 flex-1"
        data-document-print-root
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DocumentToolbar
            documentId={documentId}
            documentTitle={exportTitle}
            documentContent={exportContent}
            activeUsers={activeUsers}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={session?.email}
            canEdit={canEdit}
            hideFromSearch={document.hideFromSearch}
            source={document.source}
          />

          {!isLocalFileDocument ? (
            <NotionConflictBanner documentId={documentId} canEdit={canEdit} />
          ) : null}

          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col"
            data-document-print-scroll
          >
            <div
              className={documentEditorTitleRegionClassName(
                Boolean(document.database),
              )}
            >
              <DatabaseMembershipBreadcrumb
                document={document}
                onOpenDatabase={(databaseDocumentId) =>
                  navigate(`/page/${databaseDocumentId}`, { flushSync: true })
                }
              />
              {document.icon || !isDatabasePage ? (
                <div className="mb-1">
                  {canEdit ? (
                    <EmojiPicker
                      icon={document.icon}
                      defaultIcon={defaultIcon}
                      defaultIconLabel={
                        defaultIconKind === "database" ? "database" : "page"
                      }
                      onSelect={(emoji) => {
                        void (async () => {
                          await persistDocumentUpdates({ icon: emoji });
                        })();
                      }}
                    />
                  ) : document.icon ? (
                    <div className="p-1 -ml-1 text-5xl leading-none">
                      {document.icon}
                    </div>
                  ) : defaultIconKind === "database" && !isDatabasePage ? (
                    <div className="-ml-1 flex size-14 items-center justify-center rounded-md text-muted-foreground">
                      <IconDatabase className="size-12" aria-hidden="true" />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <textarea
                ref={titleInputRef}
                rows={1}
                wrap="soft"
                value={localTitle}
                onChange={(e) =>
                  handleTitleChange(normalizeTitleText(e.target.value))
                }
                onPaste={handleTitlePaste}
                onFocus={() => {
                  titleFocusedRef.current = true;
                }}
                onBlur={() => {
                  titleFocusedRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const pm = window.document.querySelector(
                      ".ProseMirror",
                    ) as HTMLElement | null;
                    pm?.focus();
                  }
                }}
                aria-label="Document title"
                placeholder="Title"
                readOnly={!canEdit}
                style={{ fieldSizing: "content" } as any}
                className={cn(
                  "block w-full resize-none overflow-hidden break-words border-none bg-transparent p-0 font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40",
                  isDatabasePage ? "text-3xl" : "text-3xl md:text-4xl",
                )}
              />
              {document.databaseMembership && !isLocalFileDocument ? (
                <DocumentProperties documentId={documentId} canEdit={canEdit} />
              ) : null}
            </div>
            {document.database ? (
              <div className={documentEditorDatabaseRegionClassName()}>
                <DocumentDatabase document={document} canEdit={canEdit} />
              </div>
            ) : null}

            <div
              className="flex-1 w-full max-w-3xl mx-auto px-4 pb-16 cursor-text sm:px-8 md:px-16"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  const pm = e.currentTarget.querySelector(
                    ".ProseMirror",
                  ) as HTMLElement | null;
                  pm?.focus();
                }
              }}
            >
              <VisualEditor
                key={documentId}
                documentId={documentId}
                content={isLocalFileDocument ? localContent : document.content}
                contentUpdatedAt={
                  isLocalFileDocument
                    ? (localContentUpdatedAt ?? document.updatedAt)
                    : document.updatedAt
                }
                onChange={handleContentChange}
                ydoc={canEdit && !isLocalFileDocument ? ydoc : null}
                awareness={canEdit && !isLocalFileDocument ? awareness : null}
                user={currentUser}
                editable={canEdit}
                localFileMode={isLocalFileDocument}
                onComment={
                  canEdit && !isLocalFileDocument ? handleComment : undefined
                }
                commentThreads={threads ?? []}
                activeThreadId={activeThreadId}
                pendingHighlight={pendingComment?.range ?? null}
                onActivateThread={
                  canEdit && !isLocalFileDocument
                    ? setActiveThreadId
                    : undefined
                }
                onJoinTitle={joinFirstBodyBlockToTitle}
                notionPageLinks={notionPageLinks}
                onOpenNotionPageLink={handleOpenNotionPageLink}
                notionPageId={document.notionPageId}
              />
            </div>
          </div>
        </div>

        {isMobile && canEdit ? (
          <Sheet
            open={hasComments}
            onOpenChange={(open) => {
              if (!open) setPendingComment(null);
            }}
          >
            <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
              {sidebar}
            </SheetContent>
          </Sheet>
        ) : (
          hasComments && sidebar
        )}
      </div>
    </BlockRegistryProvider>
  );
}
