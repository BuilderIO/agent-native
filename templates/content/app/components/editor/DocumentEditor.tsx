import { useCallback, useEffect, useRef, useState } from "react";
import { VisualEditor } from "./VisualEditor";
import { DocumentToolbar } from "./DocumentToolbar";
import { useDocument, useUpdateDocument } from "@/hooks/use-documents";
import { Loader2 } from "lucide-react";

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

  // Initialize from fetched document, reset on document switch
  useEffect(() => {
    if (!document) return;
    // When documentId changes, clear stale state from the previous document
    if (prevDocIdRef.current !== documentId) {
      prevDocIdRef.current = documentId;
      isInitializedRef.current = false;
      // Cancel any pending debounced save — it would corrupt lastSavedRef
      // with the old document's values after we've moved on
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

  // Pick up external changes (e.g. Notion pull) — if the server content
  // diverges from what we last saved, an external source changed it.
  useEffect(() => {
    if (!document || !isInitializedRef.current) return;
    const serverTitle = document.title;
    const serverContent = document.content;
    const lastSaved = lastSavedRef.current;

    // If the server state differs from what we last saved, something
    // external (like a Notion pull) updated the document — re-sync.
    if (
      serverTitle !== lastSaved.title ||
      serverContent !== lastSaved.content
    ) {
      // Only apply if the local state hasn't diverged from what was saved
      // (i.e. the user hasn't typed new changes since the last save).
      const localMatchesSaved =
        localTitle === lastSaved.title && localContent === lastSaved.content;
      if (localMatchesSaved) {
        setLocalTitle(serverTitle);
        setLocalContent(serverContent);
        lastSavedRef.current = { title: serverTitle, content: serverContent };
      }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar: Notion sync + Chat toggle */}
      <DocumentToolbar documentId={documentId} />

      {/* Save indicator */}
      {isSaving && (
        <div className="absolute top-12 right-4 flex items-center gap-1.5 text-xs text-muted-foreground z-10">
          <Loader2 size={12} className="animate-spin" />
          Saving...
        </div>
      )}

      {/* Scrollable document area */}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {/* Title */}
        <div className="shrink-0 px-16 pt-16 pb-2">
          <div className="flex items-center gap-3 mb-2">
            {document.icon && <span className="text-4xl">{document.icon}</span>}
          </div>
          <input
            value={localTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            className="w-full text-4xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40"
          />
        </div>

        {/* Editor */}
        <div
          className="flex-1 px-16 pb-16 cursor-text"
          onClick={(e) => {
            // If click is on the wrapper itself (empty space below content),
            // focus the editor at the end — like Notion/Google Docs
            if (e.target === e.currentTarget) {
              const pm = e.currentTarget.querySelector(
                ".ProseMirror",
              ) as HTMLElement | null;
              pm?.focus();
            }
          }}
        >
          <VisualEditor
            documentId={documentId}
            content={localContent}
            onChange={handleContentChange}
            editable
          />
        </div>
      </div>
    </div>
  );
}
