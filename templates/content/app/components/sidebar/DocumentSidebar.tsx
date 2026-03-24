import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Search, Star, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AgentToggleButton } from "@agent-native/core/client";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const tree = buildDocumentTree(documents);
  const favorites = documents.filter((d) => d.isFavorite);

  const handleCreatePage = useCallback(
    async (parentId?: string) => {
      const doc = await createDocument.mutateAsync({
        parentId: parentId ?? null,
      });
      navigate(`/${doc.id}`);
    },
    [createDocument, navigate],
  );

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

  return (
    <div className="flex flex-col h-full w-60 border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1">
          <AgentToggleButton />
          <span className="text-sm font-semibold text-foreground">
            Documents
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearching(!isSearching)}
            title="Search"
          >
            <Search size={14} />
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => handleCreatePage()}
            title="New page"
          >
            <Plus size={14} />
          </button>
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
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={() => handleCreatePage()}
        >
          <Plus size={14} className="mr-1" />
          New page
        </Button>
        <ThemeToggle />
      </div>
    </div>
  );
}
