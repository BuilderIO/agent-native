import { useCallback, useEffect, useRef, useState } from "react";
import { VisualEditor } from "./VisualEditor";
import { DocumentToolbar } from "./DocumentToolbar";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const TAB_ID = generateTabId();

interface DocumentEditorProps {
  documentId: string;
}

export function DocumentEditor({ documentId }: DocumentEditorProps) {
  const { data: document, isLoading } = useDocument(documentId);
  const updateDocument = useUpdateDocument();
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
    }
  }, [document, documentId]);

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
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [documentId, updateDocument],
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

  const [showComments, setShowComments] = useState(false);
  const isMobile = useIsMobile();

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

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <DocumentToolbar
          documentId={documentId}
          showComments={showComments}
          onToggleComments={() => setShowComments(!showComments)}
        />

        {/* Save indicator + Presence bar */}
        {(isSaving || activeUsers.length > 0) && (
          <div className="absolute top-12 right-4 flex items-center gap-2 z-10">
            {activeUsers.length > 0 && (
              <div className="flex -space-x-2">
                {activeUsers.map((u, i) => (
                  <Tooltip key={`${u.email}-${i}`}>
                    <TooltipTrigger asChild>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium text-white border-2 border-background cursor-default"
                        style={{ backgroundColor: u.color }}
                      >
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <span>{u.name}</span>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
            {isSaving && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconLoader2 size={12} className="animate-spin" />
                Saving...
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
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
              placeholder="Untitled"
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
            />
          </div>
        </div>
      </div>

      {isMobile ? (
        <Sheet
          open={showComments}
          onOpenChange={(open) => setShowComments(open)}
        >
          <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
            <CommentsSidebar
              documentId={documentId}
              onClose={() => setShowComments(false)}
            />
          </SheetContent>
        </Sheet>
      ) : (
        showComments && (
          <CommentsSidebar
            documentId={documentId}
            onClose={() => setShowComments(false)}
          />
        )
      )}
    </div>
  );
}
