import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowUp, Plus, Search, Star, FileText } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AgentToggleButton } from "@agent-native/core/client";
import { useSendToAgentChat } from "@agent-native/core/client";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { NotionButton } from "./NotionButton";
import { DocumentTreeItem } from "./DocumentTreeItem";
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
  useUpdateDocument,
  buildDocumentTree,
} from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

interface DocumentSidebarProps {
  activeDocumentId: string | null;
}

export function DocumentSidebar({ activeDocumentId }: DocumentSidebarProps) {
  const navigate = useNavigate();
  const { data: documents = [] } = useDocuments();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const { send } = useSendToAgentChat();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tree = buildDocumentTree(documents);
  const favorites = documents.filter((d) => d.isFavorite);

  useEffect(() => {
    if (popoverOpen) {
      setPrompt("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [popoverOpen]);

  const handleCreatePage = useCallback(
    async (parentId?: string) => {
      try {
        const doc = await createDocument.mutateAsync({
          parentId: parentId ?? null,
        });
        navigate(`/${doc.id}`);
      } catch (err) {
        toast.error("Failed to create page", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      }
    },
    [createDocument, navigate],
  );

  function handleSkip() {
    setPopoverOpen(false);
    handleCreatePage();
  }

  function handleSubmitPrompt() {
    if (!prompt.trim()) return;
    setPopoverOpen(false);
    send({
      message: `Create a new document based on this description: ${prompt.trim()}`,
      context:
        "Create the document using db-exec to insert into the documents table with appropriate title and markdown content. After creating, tell the user the document title and a brief summary of what you created.",
    });
  }

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteDocument.mutateAsync(id);
      if (activeDocumentId === id) {
        navigate("/");
      }
    },
    [deleteDocument, activeDocumentId, navigate],
  );

  const handleToggleFavorite = useCallback(
    (id: string, isFavorite: boolean) => {
      updateDocument.mutate({ id, isFavorite });
    },
    [updateDocument],
  );

  const filteredDocuments = searchQuery
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null;

  const newPagePopover = (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-80 p-0 rounded-xl"
    >
      <div className="p-4 pb-3">
        <p className="text-sm font-semibold">New page</p>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitPrompt();
            }
          }}
          placeholder="Describe your page..."
          className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
          rows={4}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <div />
        <div className="flex items-center gap-3">
          <button
            className="text-xs text-blue-400 hover:text-blue-300"
            onClick={handleSkip}
          >
            Skip prompt
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted hover:bg-accent disabled:opacity-30"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim()}
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </PopoverContent>
  );

  return (
    <div className="flex flex-col h-full w-60 border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border">
        <span className="text-base font-semibold tracking-tight text-foreground">
          Documents
        </span>
        <div className="flex items-center gap-1">
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearching(!isSearching)}
            title="Search"
          >
            <Search size={14} />
          </button>
          <AgentToggleButton />
        </div>
      </div>

      {/* Search */}
      {isSearching && (
        <div className="px-3 py-2 border-b border-border">
          <input
            autoFocus
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsSearching(false);
                setSearchQuery("");
              }
            }}
            className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="py-2">
          {/* Search results */}
          {filteredDocuments ? (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Results
              </div>
              {filteredDocuments.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  No pages found
                </div>
              ) : (
                filteredDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded-md",
                      doc.id === activeDocumentId
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    onClick={() => {
                      navigate(`/${doc.id}`);
                      setIsSearching(false);
                      setSearchQuery("");
                    }}
                  >
                    <span className="flex-shrink-0 w-5 text-center">
                      {doc.icon || <FileText size={14} />}
                    </span>
                    <span className="truncate">{doc.title || "Untitled"}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Favorites */}
              {favorites.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Star size={10} />
                    Favorites
                  </div>
                  {favorites.map((doc) => (
                    <button
                      key={doc.id}
                      className={cn(
                        "w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left rounded-md",
                        doc.id === activeDocumentId
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                      onClick={() => navigate(`/${doc.id}`)}
                    >
                      <span className="flex-shrink-0 w-5 text-center">
                        {doc.icon || <FileText size={14} />}
                      </span>
                      <span className="truncate">
                        {doc.title || "Untitled"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Page tree */}
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Pages
                </div>
                {tree.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    No pages yet
                  </div>
                ) : (
                  tree.map((node) => (
                    <DocumentTreeItem
                      key={node.id}
                      node={node}
                      depth={0}
                      activeId={activeDocumentId}
                      onSelect={(id) => navigate(`/${id}`)}
                      onCreateChild={(parentId) => handleCreatePage(parentId)}
                      onDelete={handleDelete}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* New page button — under the list */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground">
                <Plus size={14} className="shrink-0" />
                <span>New page</span>
              </button>
            </PopoverTrigger>
            {newPagePopover}
          </Popover>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-end px-3 py-2 border-t border-border">
        <div className="flex items-center gap-0.5">
          <NotionButton />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
