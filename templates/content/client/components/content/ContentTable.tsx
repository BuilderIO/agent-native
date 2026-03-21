import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { NewProjectDialog } from "@/components/sidebar/NewProjectDialog";
import { ContentTableToolbar } from "@/components/content/ContentTableToolbar";
import {
  SortableTableHead,
  type SortDirection,
} from "@/components/content/SortableTableHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import {
  useBuilderBlogIndex,
  useBuilderDocsIndex,
  useCreateProjectFromBuilder,
  useCreateProjectFromDocs,
} from "@/hooks/use-builder";
import { useProjects, workspaceUrl } from "@/hooks/use-projects";
import type { BuilderBlogIndexItem, BuilderDocsIndexItem } from "@shared/api";

interface ContentTableProps {
  filter: "blog" | "docs";
}

type BlogSortColumn = "title" | "author" | "publishedAt" | "topic";
type DocsSortColumn = "title" | "referenceNumber";
type ContentSortColumn = BlogSortColumn | DocsSortColumn;

function compareText(a?: string, b?: string) {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";

  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareDate(a?: string, b?: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  return new Date(a).getTime() - new Date(b).getTime();
}

function applySortDirection(value: number, direction: SortDirection) {
  return direction === "asc" ? value : -value;
}

function matchesSearch(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

function matchesSelectedTags(rowTags: string[], selectedTags: string[]) {
  if (selectedTags.length === 0) {
    return true;
  }

  const normalizedRowTags = rowTags.map(normalizeTag);

  return selectedTags.some((tag) =>
    normalizedRowTags.includes(normalizeTag(tag)),
  );
}

function getUniqueValues(values: Array<string | undefined>) {
  const uniqueValues = new Map<string, string>();

  values.forEach((value) => {
    const trimmedValue = value?.trim();
    if (!trimmedValue) {
      return;
    }

    const normalizedValue = trimmedValue.toLowerCase();
    if (!uniqueValues.has(normalizedValue)) {
      uniqueValues.set(normalizedValue, trimmedValue);
    }
  });

  return Array.from(uniqueValues.values()).sort((a, b) => compareText(a, b));
}

function renderEmptyState({
  columnCount,
  message,
  showReset,
  onReset,
}: {
  columnCount: number;
  message: string;
  showReset: boolean;
  onReset: () => void;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={columnCount}
        className="h-24 text-center text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-2">
          <span>{message}</span>
          {showReset && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={onReset}
            >
              Clear filters
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ContentTable({ filter }: ContentTableProps) {
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const blogQuery = useBuilderBlogIndex(filter === "blog");
  const docsQuery = useBuilderDocsIndex(filter === "docs");
  const createFromBuilder = useCreateProjectFromBuilder();
  const createFromDocs = useCreateProjectFromDocs();

  const [pendingBlogArticle, setPendingBlogArticle] =
    useState<BuilderBlogIndexItem | null>(null);
  const [pendingDocsEntry, setPendingDocsEntry] =
    useState<BuilderDocsIndexItem | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<ContentSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showRedirectOnly, setShowRedirectOnly] = useState(false);
  const [showNoIndexOnly, setShowNoIndexOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const isBlogView = filter === "blog";
  const isLoading = isBlogView ? blogQuery.isLoading : docsQuery.isLoading;
  const error = isBlogView ? blogQuery.error : docsQuery.error;

  const resetFilters = () => {
    setSortColumn(null);
    setSortDirection(null);
    setSearchQuery("");
    setSelectedCategories([]);
    setSelectedAuthors([]);
    setSelectedTags([]);
    setShowRedirectOnly(false);
    setShowNoIndexOnly(false);
    setCurrentPage(1);
  };

  useEffect(() => {
    resetFilters();
  }, [filter]);

  const blogArticles = blogQuery.data || [];
  const docsEntries = docsQuery.data || [];

  const blogCategoryOptions = useMemo(
    () => getUniqueValues(blogArticles.map((article) => article.topic)),
    [blogArticles],
  );
  const blogAuthorOptions = useMemo(
    () =>
      getUniqueValues(blogArticles.flatMap((article) => article.authorNames)),
    [blogArticles],
  );
  const blogTagOptions = useMemo(
    () => getUniqueValues(blogArticles.flatMap((article) => article.tags)),
    [blogArticles],
  );
  const docsTagOptions = useMemo(
    () => getUniqueValues(docsEntries.flatMap((entry) => entry.tags)),
    [docsEntries],
  );

  const visibleBlogArticles = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filteredArticles = blogArticles.filter((article) => {
      if (
        normalizedQuery &&
        !matchesSearch(article.title, normalizedQuery) &&
        !article.authorNames.some((author) =>
          matchesSearch(author, normalizedQuery),
        )
      ) {
        return false;
      }

      if (
        selectedCategories.length > 0 &&
        !selectedCategories.includes(article.topic || "")
      ) {
        return false;
      }

      if (
        selectedAuthors.length > 0 &&
        !article.authorNames.some((author) => selectedAuthors.includes(author))
      ) {
        return false;
      }

      if (!matchesSelectedTags(article.tags, selectedTags)) {
        return false;
      }

      return true;
    });

    if (!sortColumn || !sortDirection) {
      return filteredArticles;
    }

    return [...filteredArticles].sort((left, right) => {
      switch (sortColumn) {
        case "title":
          return applySortDirection(
            compareText(left.title, right.title),
            sortDirection,
          );
        case "author":
          return applySortDirection(
            compareText(left.authorNames[0], right.authorNames[0]),
            sortDirection,
          );
        case "publishedAt":
          return applySortDirection(
            compareDate(left.publishedAt, right.publishedAt),
            sortDirection,
          );
        case "topic":
          return applySortDirection(
            compareText(left.topic, right.topic),
            sortDirection,
          );
        default:
          return 0;
      }
    });
  }, [
    blogArticles,
    searchQuery,
    selectedCategories,
    selectedAuthors,
    selectedTags,
    sortColumn,
    sortDirection,
  ]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    selectedCategories,
    selectedAuthors,
    selectedTags,
    showRedirectOnly,
    showNoIndexOnly,
    sortColumn,
    sortDirection,
  ]);

  const visibleDocsEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filteredEntries = docsEntries.filter((entry) => {
      if (normalizedQuery && !matchesSearch(entry.title, normalizedQuery)) {
        return false;
      }

      if (!matchesSelectedTags(entry.tags, selectedTags)) {
        return false;
      }

      if (showRedirectOnly && !entry.redirectToUrl) {
        return false;
      }

      if (showNoIndexOnly && !entry.addNoIndex) {
        return false;
      }

      return true;
    });

    if (!sortColumn || !sortDirection) {
      return filteredEntries;
    }

    return [...filteredEntries].sort((left, right) => {
      switch (sortColumn) {
        case "title":
          return applySortDirection(
            compareText(left.title, right.title),
            sortDirection,
          );
        case "referenceNumber":
          return applySortDirection(
            compareText(left.referenceNumber, right.referenceNumber),
            sortDirection,
          );
        default:
          return 0;
      }
    });
  }, [
    docsEntries,
    searchQuery,
    selectedTags,
    showRedirectOnly,
    showNoIndexOnly,
    sortColumn,
    sortDirection,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedCategories.length > 0 ||
    selectedAuthors.length > 0 ||
    selectedTags.length > 0 ||
    showRedirectOnly ||
    showNoIndexOnly ||
    sortColumn !== null;

  const handleSort = (column: ContentSortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    setSortColumn(null);
    setSortDirection(null);
  };

  const handleBlogArticleSelect = async (article: BuilderBlogIndexItem) => {
    if (article.linkedProjectSlug) {
      const ws = article.linkedProjectSlug.split("/")[0];
      const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
      navigate(workspaceUrl(article.linkedProjectSlug, prefixed));
      return;
    }

    if (!article.inferredWorkspace) {
      setPendingBlogArticle(article);
      return;
    }

    try {
      setCreatingId(article.handle);
      const result = await createFromBuilder.mutateAsync({
        handle: article.handle,
        name: article.title,
        group: article.inferredWorkspace,
      });
      const ws = result.slug.split("/")[0];
      const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
      navigate(workspaceUrl(result.slug, prefixed));
    } catch (createError) {
      toast({
        title: "Failed to create project",
        description:
          createError instanceof Error
            ? createError.message
            : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingId(null);
    }
  };

  const handleDocsEntrySelect = async (entry: BuilderDocsIndexItem) => {
    if (entry.linkedProjectSlug) {
      const ws = entry.linkedProjectSlug.split("/")[0];
      const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
      navigate(workspaceUrl(entry.linkedProjectSlug, prefixed));
      return;
    }

    if (!entry.linkedWorkspace) {
      setPendingDocsEntry(entry);
      return;
    }

    try {
      setCreatingId(entry.id);
      const result = await createFromDocs.mutateAsync({
        docsId: entry.id,
        name: entry.title,
        group: entry.linkedWorkspace,
      });
      const ws = result.slug.split("/")[0];
      const prefixed = !!projectsData?.groupMeta?.[ws]?.prefixed;
      navigate(workspaceUrl(result.slug, prefixed));
    } catch (createError) {
      toast({
        title: "Failed to create project",
        description:
          createError instanceof Error
            ? createError.message
            : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="animate-pulse text-muted-foreground">
          Loading content...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-destructive">Failed to load content</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto bg-background p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {isBlogView ? "Blog Content" : "Documentation"}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {isBlogView
                  ? "All Builder blog entries across workspaces."
                  : "All Builder docs entries across workspaces."}
              </p>
            </div>
            <Tabs
              value={filter}
              onValueChange={(value) =>
                navigate(value === "docs" ? "/docs" : "/blog")
              }
            >
              <TabsList>
                <TabsTrigger value="blog">Blog</TabsTrigger>
                <TabsTrigger value="docs">Docs</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {isBlogView ? (
            <ContentTableToolbar
              kind="blog"
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              categoryOptions={blogCategoryOptions}
              selectedCategories={selectedCategories}
              onSelectedCategoriesChange={setSelectedCategories}
              authorOptions={blogAuthorOptions}
              selectedAuthors={selectedAuthors}
              onSelectedAuthorsChange={setSelectedAuthors}
              tagOptions={blogTagOptions}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              resultCount={visibleBlogArticles.length}
              onReset={resetFilters}
            />
          ) : (
            <ContentTableToolbar
              kind="docs"
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              tagOptions={docsTagOptions}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              showRedirectOnly={showRedirectOnly}
              onShowRedirectOnlyChange={setShowRedirectOnly}
              showNoIndexOnly={showNoIndexOnly}
              onShowNoIndexOnlyChange={setShowNoIndexOnly}
              resultCount={visibleDocsEntries.length}
              onReset={resetFilters}
            />
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                {isBlogView ? (
                  <TableRow>
                    <SortableTableHead
                      column="title"
                      label="Title"
                      sortColumn={sortColumn as BlogSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      column="author"
                      label="Author"
                      className="min-w-[136px]"
                      sortColumn={sortColumn as BlogSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      column="publishedAt"
                      label="Publish date"
                      className="min-w-[124px] whitespace-nowrap"
                      sortColumn={sortColumn as BlogSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      column="topic"
                      label="Category"
                      className="min-w-[96px]"
                      sortColumn={sortColumn as BlogSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="min-w-[140px] whitespace-normal break-normal leading-snug [text-wrap:balance]">
                      Tags
                    </TableHead>
                  </TableRow>
                ) : (
                  <TableRow>
                    <SortableTableHead
                      column="title"
                      label="Title"
                      sortColumn={sortColumn as DocsSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      column="referenceNumber"
                      label="Reference"
                      className="min-w-[120px]"
                      sortColumn={sortColumn as DocsSortColumn | null}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="min-w-[140px] whitespace-normal break-normal leading-snug [text-wrap:balance]">
                      Tags
                    </TableHead>
                    <TableHead className="min-w-[92px] whitespace-normal break-normal leading-snug [text-wrap:balance]">
                      Redirect
                    </TableHead>
                    <TableHead className="min-w-[92px] whitespace-normal break-normal leading-snug [text-wrap:balance]">
                      No index
                    </TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isBlogView
                  ? blogArticles.length === 0
                    ? renderEmptyState({
                        columnCount: 5,
                        message: "No Builder blog content found.",
                        showReset: false,
                        onReset: resetFilters,
                      })
                    : visibleBlogArticles.length === 0
                      ? renderEmptyState({
                          columnCount: 5,
                          message: "No results match your filters.",
                          showReset: hasActiveFilters,
                          onReset: resetFilters,
                        })
                      : visibleBlogArticles
                          .slice(
                            (currentPage - 1) * PAGE_SIZE,
                            currentPage * PAGE_SIZE,
                          )
                          .map((article) => {
                            const isCreating = creatingId === article.handle;
                            const authorLabel = article.authorNames.length
                              ? article.authorNames.join(", ")
                              : "—";

                            return (
                              <TableRow
                                key={article.id}
                                className="hover:bg-muted/50"
                              >
                                <TableCell className="max-w-[340px]">
                                  <button
                                    type="button"
                                    className="max-w-full truncate text-left font-medium text-foreground hover:underline disabled:cursor-wait disabled:opacity-60"
                                    title={article.title}
                                    disabled={isCreating}
                                    onClick={() =>
                                      void handleBlogArticleSelect(article)
                                    }
                                  >
                                    {isCreating
                                      ? "Creating project..."
                                      : article.title}
                                  </button>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {authorLabel}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {article.publishedAt
                                    ? format(
                                        new Date(article.publishedAt),
                                        "MMM d, yyyy",
                                      )
                                    : "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap capitalize text-muted-foreground">
                                  {article.topic || "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 whitespace-nowrap">
                                    {article.tags.slice(0, 3).map((tag) => (
                                      <Badge
                                        key={tag}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                    {article.tags.length > 3 && (
                                      <span className="pl-1 text-xs text-muted-foreground">
                                        +{article.tags.length - 3}
                                      </span>
                                    )}
                                    {article.tags.length === 0 && (
                                      <span className="text-muted-foreground">
                                        —
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                  : docsEntries.length === 0
                    ? renderEmptyState({
                        columnCount: 5,
                        message: "No Builder docs content found.",
                        showReset: false,
                        onReset: resetFilters,
                      })
                    : visibleDocsEntries.length === 0
                      ? renderEmptyState({
                          columnCount: 5,
                          message: "No results match your filters.",
                          showReset: hasActiveFilters,
                          onReset: resetFilters,
                        })
                      : visibleDocsEntries
                          .slice(
                            (currentPage - 1) * PAGE_SIZE,
                            currentPage * PAGE_SIZE,
                          )
                          .map((entry) => {
                            const isCreating = creatingId === entry.id;

                            return (
                              <TableRow
                                key={entry.id}
                                className="hover:bg-muted/50"
                              >
                                <TableCell className="max-w-[380px]">
                                  <button
                                    type="button"
                                    className="max-w-full truncate text-left font-medium text-foreground hover:underline disabled:cursor-wait disabled:opacity-60"
                                    title={entry.title}
                                    disabled={isCreating}
                                    onClick={() =>
                                      void handleDocsEntrySelect(entry)
                                    }
                                  >
                                    {isCreating
                                      ? "Creating project..."
                                      : entry.title}
                                  </button>
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                                  {entry.referenceNumber || "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 whitespace-nowrap">
                                    {entry.tags.slice(0, 3).map((tag) => (
                                      <Badge
                                        key={tag}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                    {entry.tags.length > 3 && (
                                      <span className="pl-1 text-xs text-muted-foreground">
                                        +{entry.tags.length - 3}
                                      </span>
                                    )}
                                    {entry.tags.length === 0 && (
                                      <span className="text-muted-foreground">
                                        —
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {entry.redirectToUrl ? (
                                    <Badge
                                      variant="destructive"
                                      className="text-xs"
                                    >
                                      Redirect
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {entry.addNoIndex ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      No index
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          {(() => {
            const totalItems = isBlogView
              ? visibleBlogArticles.length
              : visibleDocsEntries.length;
            const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
            const startItem =
              totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
            const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

            return totalItems > 0 ? (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {startItem}–{endItem} of {totalItems} result
                  {totalItems === 1 ? "" : "s"}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                      className="h-8 gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="h-8 gap-1"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ) : null;
          })()}
        </div>
      </div>

      <NewProjectDialog
        open={!!pendingBlogArticle}
        onOpenChange={(open) => {
          if (!open) setPendingBlogArticle(null);
        }}
        onCreated={(slug) => {
          setPendingBlogArticle(null);
          navigate(`/${slug}`);
        }}
        initialMode="builder"
        initialBuilderHandle={pendingBlogArticle?.handle}
        initialName={pendingBlogArticle?.title}
      />

      <NewProjectDialog
        open={!!pendingDocsEntry}
        onOpenChange={(open) => {
          if (!open) setPendingDocsEntry(null);
        }}
        onCreated={(slug) => {
          setPendingDocsEntry(null);
          navigate(`/${slug}`);
        }}
        initialName={pendingDocsEntry?.title}
      />
    </>
  );
}
