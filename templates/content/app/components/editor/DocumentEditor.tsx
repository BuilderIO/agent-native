import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent } from "react";
import { useNavigate } from "react-router";
import { VisualEditor } from "./VisualEditor";
import { DocumentToolbar } from "./DocumentToolbar";
import { NotionConflictBanner } from "./NotionConflictBanner";
import { EmojiPicker } from "./EmojiPicker";
import { useDocument, useUpdateDocument } from "@/hooks/use-documents";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useQueryClient } from "@tanstack/react-query";
import type { Document, DocumentSyncStatus } from "@shared/api";
import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";

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

/**
 * Outer wrapper: gates the editor on the document fetch so collab + comments
 * only mount once we know the doc exists. Otherwise an invalid id triggers
 * an infinite spinner plus repeating 404/403 polls in the console.
 */
export function DocumentEditor({ documentId }: DocumentEditorProps) {
  const { data: document, isError } = useDocument(documentId);
  const navigate = useNavigate();

  // If the page id in the URL points at a deleted/inaccessible document,
  // bounce back to the landing page instead of rendering a dead-end empty
  // state that the user has to escape by editing the URL by hand.
  useEffect(() => {
    if (isError && !document) navigate("/", { replace: true });
  }, [isError, document, navigate]);

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

function DocumentEditorBody({ documentId, document }: DocumentEditorBodyProps) {
  const updateDocument = useUpdateDocument();
  const queryClient = useQueryClient();
  // Shared with DocumentToolbar via the same localStorage key — both read it.
  const [autoSync] = useLocalStorage(`notion-auto-sync:${documentId}`, false);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ title: "", content: "" });
  const isInitializedRef = useRef(false);
  const prevDocIdRef = useRef<string | null>(null);
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusTitleRef = useRef(false);
  const canEdit = document.canEdit ?? true;

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
    docId: documentId,
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
      lastSavedRef.current = {
        title: document.title,
        content: document.content,
      };
      isInitializedRef.current = true;
      if (!document.title) {
        shouldFocusTitleRef.current = true;
      }
    }
  }, [document, documentId]);

  // NOTE: External content changes (Notion pull, update-document action) are
  // synced into the editor via VisualEditor's content prop. The old approach
  // of calling /collab/{docId}/text wrote to Y.Text("content") which is a
  // different Yjs shared type than the Y.XmlFragment("default") that TipTap
  // uses — so those updates never reached the editor.

  // Pick up external title changes (e.g. Notion pull)
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    const serverTitle = document.title;
    const lastSaved = lastSavedRef.current;
    if (serverTitle !== lastSaved.title) {
      if (localTitle === lastSaved.title) {
        setLocalTitle(serverTitle);
        lastSavedRef.current = { ...lastSavedRef.current, title: serverTitle };
      }
    }
  }, [document, localTitle]);

  // When polling/SSE refetches confirm that the server now matches the local
  // editor state, acknowledge it as saved. This keeps later agent/action
  // updates from being mistaken for conflicts with stale "unsaved" local text.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    if (document.title === localTitle && document.content === localContent) {
      lastSavedRef.current = {
        title: document.title,
        content: document.content,
      };
    }
  }, [document, localTitle, localContent]);

  const debouncedSave = useCallback(
    (title: string, content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const updates: Record<string, string> = {};
        if (title !== lastSavedRef.current.title) updates.title = title;
        if (content !== lastSavedRef.current.content) updates.content = content;
        if (Object.keys(updates).length === 0) return;

        setIsSaving(true);
        try {
          await updateDocument.mutateAsync({ id: documentId, ...updates });
          lastSavedRef.current = { title, content };

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
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [documentId, updateDocument, autoSync, queryClient],
  );

  // Collab-aware ingest flush: the `pull-document` action writes a one-shot
  // `flush-request-<id>` app-state key when an external agent wants to ingest
  // the document while a live collab session is open. The DB column can lag
  // the in-memory Y.Doc, so the open editor is the only place that can
  // serialize the live content through its existing serializer. On seeing the
  // key we force an immediate (non-debounced) save of the current editor
  // state, then delete the key so `pull-document` knows the flush landed.
  useEffect(() => {
    if (!canEdit) return;
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
            if (title !== lastSavedRef.current.title) updates.title = title;
            if (content !== lastSavedRef.current.content) {
              updates.content = content;
            }
            try {
              if (Object.keys(updates).length > 0) {
                await updateDocument.mutateAsync({
                  id: documentId,
                  ...updates,
                });
                lastSavedRef.current = { title, content };
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
  }, [canEdit, documentId, updateDocument]);

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
  } | null>(null);
  const { data: threads } = useComments(documentId);
  const hasComments =
    canEdit &&
    ((threads?.some((t) => !t.resolved) ?? false) || !!pendingComment);
  const isMobile = useIsMobile();

  const handleComment = useCallback((quotedText: string, offsetTop: number) => {
    setPendingComment({ quotedText, offsetTop });
  }, []);

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

  if (collabLoading) {
    return <DocumentEditorSkeleton />;
  }

  const sidebar = (
    <CommentsSidebar
      documentId={documentId}
      pendingComment={pendingComment}
      onPendingDone={() => setPendingComment(null)}
      scrollContainerRef={scrollContainerRef}
    />
  );

  return (
    <div className="relative flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <DocumentToolbar
          documentId={documentId}
          documentTitle={localTitle || document.title}
          activeUsers={activeUsers}
          agentPresent={agentPresent}
          agentActive={agentActive}
          isSaving={isSaving}
          currentUserEmail={session?.email}
          canEdit={canEdit}
          hideFromSearch={document.hideFromSearch}
        />

        <NotionConflictBanner documentId={documentId} canEdit={canEdit} />

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto flex flex-col"
        >
          <div className="shrink-0 w-full max-w-3xl mx-auto px-4 pt-14 pb-8 sm:px-8 md:px-16 md:pt-16 group/title">
            <div className="mb-1">
              {canEdit ? (
                <EmojiPicker
                  icon={document.icon}
                  onSelect={(emoji) => {
                    updateDocument.mutate({ id: documentId, icon: emoji });
                  }}
                />
              ) : document.icon ? (
                <div className="p-1 -ml-1 text-5xl leading-none">
                  {document.icon}
                </div>
              ) : null}
            </div>
            <textarea
              ref={titleInputRef}
              rows={1}
              wrap="soft"
              value={localTitle}
              onChange={(e) =>
                handleTitleChange(normalizeTitleText(e.target.value))
              }
              onPaste={handleTitlePaste}
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
              className="block w-full resize-none overflow-hidden break-words border-none bg-transparent p-0 text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40 md:text-4xl"
            />
          </div>

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
              content={document.content}
              onChange={handleContentChange}
              ydoc={canEdit ? ydoc : null}
              user={currentUser}
              editable={canEdit}
              onComment={canEdit ? handleComment : undefined}
              onJoinTitle={joinFirstBodyBlockToTitle}
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
  );
}
