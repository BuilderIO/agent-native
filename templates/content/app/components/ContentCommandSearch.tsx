import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { CommandMenu } from "@agent-native/core/client/navigation";
import { parseSearchQuery, searchQueryNeedles } from "@shared/search-query";
import {
  IconDatabase,
  IconFileText,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Calendar } from "./ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Skeleton } from "./ui/skeleton";

// Sentinel scope value for searching every authorized space at once; the
// request simply omits spaceId, and the server still scopes by access.
const ALL_SPACES = "all";

function Highlight({ text, needles }: { text: string; needles: string[] }) {
  return searchHighlightParts(text, needles).map((part, index) =>
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
  focusInput,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  focusInput: () => void;
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
      <DropdownMenuContent
        onCloseAutoFocus={(event) => {
          // Without this, focus lands back on the trigger inside the filter
          // toolbar, whose key handler swallows arrows and Enter before the
          // command menu sees them.
          event.preventDefault();
          focusInput();
        }}
      >
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

// Radix portals DropdownMenuContent to document.body, so focus restoration
// from a filter menu's close event cannot walk up to the picker dialog from
// that element; walk up from the filter toolbar (which lives inside the
// dialog) instead of searching the document, where another mounted dialog
// could win document order.
function focusSearchInput(control: HTMLElement | null) {
  control
    ?.closest('[role="dialog"]')
    ?.querySelector<HTMLInputElement>('[role="combobox"]')
    ?.focus();
}

// sourceUpdatedAt is persisted as text and may hold a bare epoch number or
// another unparseable form; normalize it or drop the freshness line rather
// than letting formatDate throw.
function normalizeTimestamp(value: string): string | null {
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function DateSearchChoice({
  label,
  triggerLabel,
  presetValue,
  selectedDay,
  onSelectPreset,
  onPickDay,
  focusInput,
}: {
  label: string;
  triggerLabel: string;
  presetValue: "all" | "7" | "30";
  selectedDay?: Date;
  onSelectPreset: (value: "all" | "7" | "30") => void;
  onPickDay: (day: Date) => void;
  focusInput: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const presets = [
    { value: "all" as const, label: t("root.searchAnyDate") },
    { value: "7" as const, label: t("root.searchPastWeek") },
    { value: "30" as const, label: t("root.searchPastMonth") },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-full"
          aria-label={label}
        >
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusInput();
        }}
      >
        <div className="flex gap-1 pb-2">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              variant={presetValue === preset.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                onSelectPreset(preset.value);
                setOpen(false);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selectedDay}
          onSelect={(day) => {
            if (day) {
              onPickDay(day);
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function SearchPage({
  query,
  needles,
  spaceId,
  searchFields,
  documentType,
  modifiedAfter,
  onOpenChange,
}: {
  query: string;
  needles: string[];
  spaceId?: string;
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
          onClick={(event) => {
            focusSearchInput(event.currentTarget);
            void results.refetch();
          }}
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
          const sourceUpdated = document.sourceUpdatedAt
            ? normalizeTimestamp(document.sourceUpdatedAt)
            : null;
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
                    needles={needles}
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
                    <Highlight text={document.snippet} needles={needles} />
                  </span>
                ) : null}
                {document.description ? (
                  <span className="hidden mt-1 text-xs text-muted-foreground group-data-[selected=true]:block">
                    {document.description}
                  </span>
                ) : null}
                {sourceUpdated ? (
                  <span className="hidden text-xs text-muted-foreground group-data-[selected=true]:block">
                    {t("root.searchSourceUpdated", {
                      date: formatDate(sourceUpdated),
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
          onClick={(event) => {
            focusSearchInput(event.currentTarget);
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
  const { formatDate } = useFormatters();
  const spaces = useContentSpaces();
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: spaces.data?.spaces ?? [],
    storedSpaceId,
  });
  // null follows the sidebar's selected space; "all" searches every
  // authorized space; a space id pins the search to that space.
  const searchingAll = chosenScope === ALL_SPACES;
  const scopeId =
    chosenScope && chosenScope !== ALL_SPACES ? chosenScope : selectedSpace?.id;
  const [searchFields, setSearchFields] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [modified, setModified] = useState("all");
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [modifiedAfter, setModifiedAfter] = useState<string>();
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const highlightNeedles = useMemo(() => {
    const parsed = parseSearchQuery(debouncedQuery);
    return parsed.empty ? [] : searchQueryNeedles(parsed);
  }, [debouncedQuery]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const focusPickerInput = () => focusSearchInput(toolbarRef.current);
  const dateTriggerLabel = pickedDay
    ? formatDate(new Date(`${pickedDay}T00:00:00`))
    : modified === "7"
      ? t("root.searchPastWeek")
      : modified === "30"
        ? t("root.searchPastMonth")
        : t("root.searchAnyDate");

  const applyPreset = (value: "all" | "7" | "30") => {
    setPickedDay(null);
    setModified(value);
    setModifiedAfter(
      value === "all"
        ? undefined
        : new Date(Date.now() - Number(value) * 86_400_000).toISOString(),
    );
  };

  return (
    <>
      <div
        ref={toolbarRef}
        className="flex flex-wrap gap-2 border-b p-2"
        onKeyDown={(event) => {
          if (event.key !== "Tab" && event.key !== "Escape")
            event.stopPropagation();
        }}
      >
        <SearchChoice
          label={t("root.searchScope")}
          value={searchingAll ? ALL_SPACES : (scopeId ?? "")}
          choices={[
            { value: ALL_SPACES, label: t("root.searchAllWorkspaces") },
            ...(spaces.data?.spaces ?? []).map((entry) => ({
              value: entry.id,
              label: entry.name,
            })),
          ]}
          onChange={setChosenScope}
          focusInput={focusPickerInput}
        />
        <SearchChoice
          label={t("root.searchFields")}
          value={searchFields}
          choices={[
            { value: "all", label: t("root.searchAllText") },
            { value: "title", label: t("root.searchTitleOnly") },
          ]}
          onChange={setSearchFields}
          focusInput={focusPickerInput}
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
          focusInput={focusPickerInput}
        />
        <DateSearchChoice
          label={t("root.searchDate")}
          triggerLabel={dateTriggerLabel}
          presetValue={pickedDay ? "all" : (modified as "all" | "7" | "30")}
          selectedDay={
            pickedDay ? new Date(`${pickedDay}T00:00:00`) : undefined
          }
          onSelectPreset={applyPreset}
          focusInput={focusPickerInput}
          onPickDay={(day) => {
            setModified("all");
            setPickedDay(
              `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
            );
            setModifiedAfter(
              new Date(
                day.getFullYear(),
                day.getMonth(),
                day.getDate(),
              ).toISOString(),
            );
          }}
        />
      </div>
      {!searchingAll && (spaces.error || (!spaces.isLoading && !scopeId)) ? (
        <div role="alert" className="p-3 text-sm">
          {t("root.searchScopeUnavailable")}
        </div>
      ) : (!searchingAll && !scopeId) || query.trim() !== debouncedQuery ? (
        <SearchLoading />
      ) : debouncedQuery ? (
        <SearchPage
          key={JSON.stringify([
            debouncedQuery,
            searchingAll ? ALL_SPACES : scopeId,
            searchFields,
            documentType,
            modifiedAfter,
          ])}
          query={debouncedQuery}
          needles={highlightNeedles}
          spaceId={searchingAll ? undefined : scopeId}
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
