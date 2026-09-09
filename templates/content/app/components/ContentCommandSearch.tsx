import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { CommandMenu } from "@agent-native/core/client/navigation";
import {
  IconDatabase,
  IconFileText,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  contentCommandDocumentPath,
  isLocalFileSearchResult,
  searchHighlightParts,
  type CommandSearchDocumentsResponse,
} from "@/lib/content-command-search";

import {
  contentSpaceForStoredSelection,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
} from "./sidebar/select-content-space";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Skeleton } from "./ui/skeleton";

function Highlight({ text, query }: { text: string; query: string }) {
  return searchHighlightParts(text, query).map((part, index) =>
    part.match ? (
      <mark
        key={index}
        className="bg-accent text-accent-foreground font-semibold"
      >
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

function SearchChoice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-full"
          aria-label={label}
        >
          <span className="truncate">
            {choices.find((choice) => choice.value === value)?.label ?? label}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchLoading() {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t("root.commandSearchLoading")}
      className="flex flex-col gap-3 p-3"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function SearchPage({
  query,
  spaceId,
  searchFields,
  documentType,
  modifiedAfter,
  onOpenChange,
}: {
  query: string;
  spaceId: string;
  searchFields: "all" | "title";
  documentType?: "page" | "database";
  modifiedAfter?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { formatDate } = useFormatters();
  const [offset, setOffset] = useState(0);
  const results = useActionQuery<CommandSearchDocumentsResponse>(
    "search-documents",
    {
      query,
      spaceId,
      searchFields,
      documentType,
      modifiedAfter,
      limit: 20,
      offset,
    },
    { retry: false },
  );
  if (results.isFetching) return <SearchLoading />;
  if (results.error)
    return (
      <div role="alert" className="p-3 text-sm">
        {t("root.commandSearchError")}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void results.refetch()}
        >
          {t("root.searchRetry")}
        </Button>
      </div>
    );
  if (!results.data) return <SearchLoading />;
  return (
    <>
      <CommandMenu.Group heading={t("root.commandSearchHeading")}>
        {results.data.documents.length === 0 ? (
          <div role="status" className="p-3 text-sm text-muted-foreground">
            {t("root.commandSearchEmpty")}
          </div>
        ) : null}
        {results.data.documents.map((document) => {
          const Icon =
            document.documentType === "database"
              ? IconDatabase
              : isLocalFileSearchResult(document)
                ? IconFolderOpen
                : IconFileText;
          return (
            <CommandMenu.Item
              key={document.id}
              deferSelect={false}
              className="group items-start py-2"
              onSelect={() => {
                onOpenChange(false);
                void navigate(contentCommandDocumentPath(document.id));
              }}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <Highlight
                    text={document.title || t("sidebar.untitled")}
                    query={query}
                  />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    document.parentTitle,
                    document.sourceKind,
                    t("root.searchModified", {
                      date: formatDate(document.updatedAt),
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {document.snippet ? (
                  <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground group-data-[selected=true]:line-clamp-6">
                    <Highlight text={document.snippet} query={query} />
                  </span>
                ) : null}
                {document.description ? (
                  <span className="hidden mt-1 text-xs text-muted-foreground group-data-[selected=true]:block">
                    {document.description}
                  </span>
                ) : null}
                {document.sourceUpdatedAt ? (
                  <span className="hidden text-xs text-muted-foreground group-data-[selected=true]:block">
                    {t("root.searchSourceUpdated", {
                      date: formatDate(document.sourceUpdatedAt),
                    })}
                  </span>
                ) : null}
              </span>
            </CommandMenu.Item>
          );
        })}
      </CommandMenu.Group>
      {offset > 0 || results.data.pagination.hasMore ? (
        <div
          className="flex justify-between gap-2 p-2"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ")
              event.stopPropagation();
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {t("root.searchPrevious")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!results.data.pagination.hasMore}
            onClick={() => {
              const next = results.data?.pagination.nextOffset;
              if (next != null) setOffset(next);
            }}
          >
            {t("root.searchNext")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ContentCommandSearchResults({
  query,
  onOpenChange,
}: {
  query: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const spaces = useContentSpaces();
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const [chosenSpace, setChosenSpace] = useState<string | null>(null);
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: spaces.data?.spaces ?? [],
    storedSpaceId,
  });
  const space = chosenSpace
    ? spaces.data?.spaces.find((entry) => entry.id === chosenSpace)
    : selectedSpace;
  const [searchFields, setSearchFields] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [modified, setModified] = useState("all");
  const [modifiedAfter, setModifiedAfter] = useState<string>();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <>
      <div
        className="flex flex-wrap gap-2 border-b p-2"
        onKeyDown={(event) => {
          if (event.key !== "Tab" && event.key !== "Escape")
            event.stopPropagation();
        }}
      >
        <SearchChoice
          label={t("root.searchScope")}
          value={space?.id ?? ""}
          choices={(spaces.data?.spaces ?? []).map((entry) => ({
            value: entry.id,
            label: entry.name,
          }))}
          onChange={setChosenSpace}
        />
        <SearchChoice
          label={t("root.searchFields")}
          value={searchFields}
          choices={[
            { value: "all", label: t("root.searchAllText") },
            { value: "title", label: t("root.searchTitleOnly") },
          ]}
          onChange={setSearchFields}
        />
        <SearchChoice
          label={t("root.searchType")}
          value={documentType}
          choices={[
            { value: "all", label: t("root.searchAllTypes") },
            { value: "page", label: t("root.commandDocumentsHeading") },
            { value: "database", label: t("root.commandDatabasesHeading") },
          ]}
          onChange={setDocumentType}
        />
        <SearchChoice
          label={t("root.searchDate")}
          value={modified}
          choices={[
            { value: "all", label: t("root.searchAnyDate") },
            { value: "7", label: t("root.searchPastWeek") },
            { value: "30", label: t("root.searchPastMonth") },
          ]}
          onChange={(value) => {
            setModified(value);
            setModifiedAfter(
              value === "all"
                ? undefined
                : new Date(
                    Date.now() - Number(value) * 86_400_000,
                  ).toISOString(),
            );
          }}
        />
      </div>
      {spaces.error || (!spaces.isLoading && !space) ? (
        <div role="alert" className="p-3 text-sm">
          {t("root.searchScopeUnavailable")}
        </div>
      ) : !space || query.trim() !== debouncedQuery ? (
        <SearchLoading />
      ) : debouncedQuery ? (
        <SearchPage
          key={JSON.stringify([
            debouncedQuery,
            space.id,
            searchFields,
            documentType,
            modifiedAfter,
          ])}
          query={debouncedQuery}
          spaceId={space.id}
          searchFields={searchFields as "all" | "title"}
          documentType={
            documentType === "all"
              ? undefined
              : (documentType as "page" | "database")
          }
          modifiedAfter={modifiedAfter}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </>
  );
}
