import { useEffect, useState, useMemo, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useCreateProject, useProjects } from "@/hooks/use-projects";
import { useBuilderAuth } from "@/components/builder/BuilderAuthContext";
import { useBuilderArticles, useBuilderDocs } from "@/hooks/use-builder";
import { builderToMarkdown } from "@/lib/builder-to-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
  defaultGroup?: string | null;
  initialMode?: "new" | "builder";
  initialBuilderHandle?: string | null;
  initialName?: string | null;
}

const formatGroupLabel = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
  defaultGroup,
  initialMode,
  initialBuilderHandle,
  initialName,
}: NewProjectDialogProps) {
  const [mode, setMode] = useState<"new" | "builder">("new");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string | undefined>(undefined);
  const [builderHandle, setBuilderHandle] = useState<string>("");
  const [builderComboboxOpen, setBuilderComboboxOpen] = useState(false);
  const [isFetchingArticle, setIsFetchingArticle] = useState(false);
  const [contentType, setContentType] = useState<"articles" | "docs">(
    "articles",
  );

  const { data } = useProjects();
  const createMutation = useCreateProject();

  const { isConnected, auth } = useBuilderAuth();
  const { data: builderArticles, isLoading: isLoadingArticles } =
    useBuilderArticles();
  const { data: builderDocs, isLoading: isLoadingDocs } = useBuilderDocs();

  const [searchQuery, setSearchQuery] = useState("");

  // Fix command menu scroll issue when search query changes
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // When the query changes, reset scroll position instantly
    if (listRef.current) {
      // Small timeout to allow React to flush DOM updates
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTop = 0;
        }
      }, 0);
    }
  }, [searchQuery]);

  const groups = data?.groups ?? [];
  const showOwnerSelect = groups.length > 0 && !defaultGroup;

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setMode(initialMode ?? "new");
    setName(initialName ?? "");
    setBuilderHandle(initialBuilderHandle ?? "");
    setContentType(initialMode === "builder" ? "articles" : "docs");
    if (defaultGroup) {
      setGroup(defaultGroup);
      return;
    }
    if (!group && groups.length > 0) {
      setGroup(groups[0]);
    }
  }, [open, defaultGroup, groups, group]);

  // Auto-select Documentation when switching to builder mode
  useEffect(() => {
    if (mode === "builder") {
      setContentType("docs");
    }
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let blocksString: string | undefined;
    let fullData: any;

    if (mode === "builder" && builderHandle) {
      try {
        setIsFetchingArticle(true);
        const model =
          contentType === "articles" ? "blog-article" : "docs-content";
        console.log(
          `[NewProject] Fetching ${model} with handle:`,
          builderHandle,
        );

        const res = await authFetch("/api/builder/fetch-article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: auth?.apiKey,
            handle: builderHandle,
            model,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          console.error(`[NewProject] Fetch failed:`, errorData);
          throw new Error(
            `Failed to fetch ${contentType === "articles" ? "article" : "doc"} from Builder: ${errorData.error || res.statusText}`,
          );
        }

        const articleData = await res.json();

        // Merge the root-level url into fullData for server use
        fullData = {
          ...articleData.fullData,
          url: articleData.url || articleData.fullData?.url,
        };
        if (articleData.blocks && Array.isArray(articleData.blocks)) {
          console.log(
            `[NewProject] Converting ${articleData.blocks.length} blocks to markdown`,
          );
          blocksString = builderToMarkdown(articleData.blocks);
          console.log(
            `[NewProject] Markdown length:`,
            blocksString?.length || 0,
          );
        } else if (fullData?.blocks && Array.isArray(fullData.blocks)) {
          console.log(
            `[NewProject] Converting ${fullData.blocks.length} blocks from fullData to markdown`,
          );
          blocksString = builderToMarkdown(fullData.blocks);
          console.log(
            `[NewProject] Markdown length:`,
            blocksString?.length || 0,
          );
        } else {
          console.warn(`[NewProject] No blocks found in response`);
        }
      } catch (err) {
        console.error("[NewProject] Failed to fetch content blocks:", err);
        fullData = selectedContent?.data;
      } finally {
        setIsFetchingArticle(false);
      }
    }

    const result = await createMutation.mutateAsync({
      name: name.trim(),
      group,
      builderHandle:
        mode === "builder" && builderHandle ? builderHandle : undefined,
      builderModel:
        mode === "builder"
          ? contentType === "articles"
            ? "blog-article"
            : "docs-content"
          : undefined,
      fullData,
      blocksString,
    });
    setName("");
    setBuilderHandle("");
    onCreated(result.slug);
  };

  const selectedArticle = useMemo(() => {
    return builderArticles?.find((a) => a.data?.handle === builderHandle);
  }, [builderArticles, builderHandle]);

  const selectedDoc = useMemo(() => {
    return builderDocs?.find((d) => d.id === builderHandle);
  }, [builderDocs, builderHandle]);

  const selectedContent =
    contentType === "articles" ? selectedArticle : selectedDoc;

  // Sort docs by most recently edited (lastUpdated)
  const sortedContentList = useMemo(() => {
    if (contentType === "articles") return builderArticles;
    if (!builderDocs) return builderDocs;

    return [...builderDocs].sort((a, b) => {
      const timeA = a.lastUpdated || 0;
      const timeB = b.lastUpdated || 0;
      return timeB - timeA; // Most recent first
    });
  }, [contentType, builderArticles, builderDocs]);

  const contentList = sortedContentList;
  const isLoadingContent =
    contentType === "articles" ? isLoadingArticles : isLoadingDocs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Create a new project for your content. Each project has a draft
              and space for research resources.
            </DialogDescription>
          </DialogHeader>

          {isConnected && (
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as "new" | "builder")}
              className="mt-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="new">Blank Project</TabsTrigger>
                <TabsTrigger value="builder">From Builder Content</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="py-4 space-y-4">
            {showOwnerSelect && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Workspace
                </label>
                <Select
                  value={group?.split("/")[0] || ""}
                  onValueChange={(ws) => setGroup(ws)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((groupName) => (
                      <SelectItem key={groupName} value={groupName}>
                        {formatGroupLabel(groupName)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Folder path within workspace (optional) */}
            {group && data?.folders?.[group.split("/")[0]]?.length ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Folder (optional)
                </label>
                <Select
                  value={group.includes("/") ? group : "__root__"}
                  onValueChange={(v) => {
                    const ws = group.split("/")[0];
                    setGroup(v === "__root__" ? ws : `${ws}/${v}`);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Root" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">Root</SelectItem>
                    {data.folders[group.split("/")[0]].map((folderPath) => (
                      <SelectItem key={folderPath} value={folderPath}>
                        {folderPath
                          .split("/")
                          .map((s) =>
                            s
                              .split("-")
                              .map((w) =>
                                w ? w[0].toUpperCase() + w.slice(1) : w,
                              )
                              .join(" "),
                          )
                          .join(" / ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {mode === "builder" ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Content Type
                  </label>
                  <Select
                    value={contentType}
                    onValueChange={(v: "articles" | "docs") => {
                      setContentType(v);
                      setBuilderHandle("");
                      setName("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="articles">Blog Articles</SelectItem>
                      <SelectItem value="docs">Documentation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Select {contentType === "articles" ? "Article" : "Doc"}
                  </label>
                  <Popover
                    open={builderComboboxOpen}
                    onOpenChange={setBuilderComboboxOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={builderComboboxOpen}
                        className="w-full justify-between font-normal"
                        disabled={isLoadingContent}
                      >
                        {isLoadingContent
                          ? `Loading ${contentType}...`
                          : selectedContent
                            ? selectedContent.data?.title ||
                              selectedContent.name
                            : `Select ${contentType === "articles" ? "article" : "doc"}...`}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder={`Search ${contentType}...`}
                          value={searchQuery}
                          onValueChange={setSearchQuery}
                        />
                        <CommandEmpty>No {contentType} found.</CommandEmpty>
                        <CommandList ref={listRef}>
                          <CommandGroup>
                            {contentList?.map((item: any) => {
                              // For articles, use handle; for docs, always use ID for reliable fetching
                              const identifier =
                                contentType === "articles"
                                  ? item.data?.handle || item.id
                                  : item.id;
                              if (!identifier) return null;
                              return (
                                <CommandItem
                                  key={item.id}
                                  value={item.data?.title || item.name}
                                  onSelect={() => {
                                    setBuilderHandle(identifier);
                                    setName(
                                      item.data?.title ||
                                        item.name ||
                                        "Untitled",
                                    );
                                    setBuilderComboboxOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      builderHandle === identifier
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  {item.data?.title || item.name}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Project Name
                  </label>
                  <Input
                    placeholder="My blog post topic..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Project Name
                </label>
                <Input
                  autoFocus
                  placeholder="My blog post topic..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !name.trim() ||
                createMutation.isPending ||
                isFetchingArticle ||
                (mode === "builder" && !builderHandle)
              }
            >
              {createMutation.isPending || isFetchingArticle
                ? "Creating..."
                : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
