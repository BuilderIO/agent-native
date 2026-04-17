import { useCallback, useEffect, useRef, useState } from "react";
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
  type CollabUser,
} from "@agent-native/core/client";
import { IconLoader2 } from "@tabler/icons-react";
import { CommentsSidebar } from "./CommentsSidebar";
import { useComments } from "@/hooks/use-comments";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useQueryClient } from "@tanstack/react-query";
import type { DocumentSyncStatus } from "@shared/api";

const TAB_ID = generateTabId();

interface DocumentEditorProps {
  documentId: string;
}

export function DocumentEditor({ documentId }: DocumentEditorProps) {
  const { data: document, isLoading } = useDocument(documentId);
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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusTitleRef = useRef(false);

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
                  `/api/documents/${documentId}/notion/push`,
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

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setLocalTitle(newTitle);
      debouncedSave(newTitle, localContentRef.current);
    },
    [debouncedSave],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      setLocalContent(newContent);
      debouncedSave(localTitleRef.current, newContent);
    },
    [debouncedSave],
  );

  // Comments state — pending comment from text selection
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
    offsetTop: number;
  } | null>(null);
  const { data: threads } = useComments(documentId);
  const hasComments =
    (threads?.some((t) => !t.resolved) ?? false) || !!pendingComment;
  const isMobile = useIsMobile();

  const handleComment = useCallback((quotedText: string, offsetTop: number) => {
    setPendingComment({ quotedText, offsetTop });
  }, []);

  // Auto-focus title on new empty documents once loading is done
  useEffect(() => {
    if (!isLoading && !collabLoading && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  });

  if (isLoading || collabLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconLoader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Document not found
      </div>
    );
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
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <DocumentToolbar
          documentId={documentId}
          documentTitle={localTitle || document.title}
          activeUsers={activeUsers}
          agentActive={agentActive}
          isSaving={isSaving}
          currentUserEmail={session?.email}
        />

        <NotionConflictBanner documentId={documentId} />

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto flex flex-col"
        >
          <div className="shrink-0 px-4 pt-14 pb-2 sm:px-8 md:px-16 md:pt-16 group/title">
            <div className="mb-1">
              <EmojiPicker
                icon={document.icon}
                onSelect={(emoji) => {
                  updateDocument.mutate({ id: documentId, icon: emoji });
                }}
              />
            </div>
            <input
              ref={titleInputRef}
              value={localTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pm = window.document.querySelector(
                    ".ProseMirror",
                  ) as HTMLElement | null;
                  pm?.focus();
                }
              }}
              placeholder="Title"
              className="w-full text-3xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40 md:text-4xl"
            />
          </div>

          <div
            className="flex-1 px-4 pb-16 cursor-text sm:px-8 md:px-16"
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
              ydoc={ydoc}
              user={currentUser}
              editable
              onComment={handleComment}
            />
          </div>
        </div>
      </div>

      {isMobile ? (
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
