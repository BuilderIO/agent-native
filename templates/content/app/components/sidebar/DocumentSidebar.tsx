import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import {
  IconPlus,
  IconSearch,
  IconStar,
  IconFileText,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function DocumentSidebar({
  activeDocumentId,
  collapsed,
  onToggleCollapsed,
}: DocumentSidebarProps) {
  const navigate = useNavigate();
  const { data: documents = [], isLoading } = useDocuments();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const tree = buildDocumentTree(documents);
  const favorites = documents.filter((d) => d.isFavorite);

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

  if (collapsed) {
    return (
      <div className="flex flex-col h-full w-10 border-r border-border bg-muted/30 items-center py-3 gap-2">
        <button
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapsed}
          title="Expand sidebar"
        >
          <IconLayoutSidebarLeftExpand size={16} />
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onClick={() => handleCreatePage()}
          title="New page"
        >
          <IconPlus size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-60 border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border">
        <span className="text-base font-semibold tracking-tight text-foreground">
          Documents
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearching(!isSearching)}
            title="Search"
          >
            <IconSearch size={14} />
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={onToggleCollapsed}
            title="Collapse sidebar"
          >
            <IconLayoutSidebarLeftCollapse size={14} />
          </button>
        </div>
      </div>

      {/* IconSearch */}
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
          {/* IconSearch results */}
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
                      {doc.icon || <IconFileText size={14} />}
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
                    <IconStar size={10} />
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
                        {doc.icon || <IconFileText size={14} />}
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
                {isLoading ? (
                  <div className="space-y-1 px-3 py-1">
                    {[70, 55, 85, 60, 45].map((w, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-1 py-1.5"
                      >
                        <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse flex-shrink-0" />
                        <div
                          className="h-3.5 rounded bg-muted animate-pulse"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : tree.length === 0 ? (
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
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            onClick={() => handleCreatePage()}
          >
            <IconPlus size={14} className="shrink-0" />
            <span>New page</span>
          </button>
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
