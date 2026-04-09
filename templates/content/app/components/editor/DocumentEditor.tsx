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
  useAvatarUrl,
  uploadAvatar,
  type CollabUser,
} from "@agent-native/core/client";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { CommentsSidebar } from "./CommentsSidebar";
import { useComments } from "@/hooks/use-comments";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const TAB_ID = generateTabId();

function ContentPresenceAvatar({ user }: { user: CollabUser }) {
  const avatarUrl = useAvatarUrl(user.email);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium text-white border-2 border-background cursor-default overflow-hidden"
          style={{ backgroundColor: user.color }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              className="w-full h-full object-cover"
            />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2 p-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden"
          style={{ backgroundColor: user.color }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              className="w-full h-full object-cover"
            />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium leading-tight">{user.name}</span>
          <span className="text-[10px] opacity-60 leading-tight truncate">
            {user.email}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ContentCurrentUserAvatar({ email }: { email: string }) {
  const avatarUrl = useAvatarUrl(email);
  const inputRef = useRef<HTMLInputElement>(null);
  const color = emailToColor(email);
  const name = emailToName(email);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAvatar(file, email);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => inputRef.current?.click()}
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium text-white border-2 border-background cursor-pointer hover:opacity-80 overflow-hidden"
          style={{ backgroundColor: color }}
          aria-label="Update your avatar"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="flex flex-col items-center gap-0.5"
      >
        <span className="text-xs font-medium">{email}</span>
        <span className="text-[10px] opacity-60">Click to update photo</span>
      </TooltipContent>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </Tooltip>
  );
}

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
        <DocumentToolbar documentId={documentId} />

        {/* Save indicator + Agent presence + User presence */}
        {(() => {
          const otherUsers = activeUsers.filter(
            (u) => u.email !== session?.email,
          );
          const hasActivity = isSaving || otherUsers.length > 0 || agentActive;
          return hasActivity || session?.email ? (
            <div className="absolute top-12 right-4 flex items-center gap-2 z-10">
              {agentActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium animate-pulse">
                      <IconSparkles size={14} />
                      AI editing
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    The AI agent is making changes
                  </TooltipContent>
                </Tooltip>
              )}
              {otherUsers.length > 0 && (
                <div className="flex -space-x-2">
                  {otherUsers.map((u, i) => (
                    <ContentPresenceAvatar key={`${u.email}-${i}`} user={u} />
                  ))}
                </div>
              )}
              {isSaving && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconLoader2 size={12} className="animate-spin" />
                  Saving...
                </div>
              )}
              {session?.email && (
                <ContentCurrentUserAvatar email={session.email} />
              )}
            </div>
          ) : null;
        })()}

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
