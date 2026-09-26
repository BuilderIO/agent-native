import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuNestedDialog,
} from "@agent-native/core/client/navigation";
import { parseSearchQuery, searchQueryNeedles } from "@shared/search-query";
import {
  IconDatabase,
  IconFileText,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const ALL_SPACES = "all";

export type ModifiedDateFilter =
  | { kind: "any" }
  | { kind: "preset"; days: 7 | 30 }
  | { kind: "custom"; day: string; modifiedAfter: string };

type DatePreset = "all" | "7" | "30";

export function presetForModifiedDate(
  filter: ModifiedDateFilter,
): DatePreset | undefined {
  if (filter.kind === "any") return "all";
  if (filter.kind === "preset") return String(filter.days) as "7" | "30";
  return undefined;
}

export function modifiedAfterForFilter(
  filter: ModifiedDateFilter,
  now = new Date(),
): string | undefined {
  if (filter.kind === "any") return undefined;
  if (filter.kind === "custom") return filter.modifiedAfter;

  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (filter.days - 1));
  return date.toISOString();
}

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

export function SearchEmptyOption() {
  const t = useT();
  return (
    <div
      role="option"
      aria-disabled="true"
      aria-live="polite"
      className="p-3 text-sm text-muted-foreground"
    >
      {t("root.commandSearchEmpty")}
    </div>
  );
}

function focusSearchInput(control: HTMLElement | null) {
  control
    ?.closest('[role="dialog"]')
    ?.querySelector<HTMLInputElement>('[role="combobox"]')
    ?.focus();
}

function normalizeTimestamp(value: string): string | null {
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function DateSearchChoice({
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
  presetValue?: DatePreset;
  selectedDay?: Date;
  onSelectPreset: (value: DatePreset) => void;
  onPickDay: (day: Date) => void;
  focusInput: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useCommandMenuNestedDialog(open ? () => setOpen(false) : null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const presets = [
    { value: "all" as const, label: t("root.searchAnyDate") },
    { value: "7" as const, label: t("root.searchPastWeek") },
    { value: "30" as const, label: t("root.searchPastMonth") },
  ];
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setPortalContainer(
            triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null,
          );
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          className="max-w-full"
          aria-label={label}
        >
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        className="w-auto p-2"
        align="start"
        aria-label={label}
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
          autoFocus
          defaultMonth={selectedDay ?? new Date()}
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
  renderList,
  staticItems,
}: {
  query: string;
  needles: string[];
  spaceId?: string;
  searchFields: "all" | "title";
  documentType?: "page" | "database";
  modifiedAfter?: string;
  onOpenChange: (open: boolean) => void;
  renderList: (results?: ReactNode) => ReactNode;
  staticItems: ReactNode;
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
  if (results.isFetching)
    return (
      <>
        {renderList(staticItems)}
        <SearchLoading />
      </>
    );
  if (results.error) {
    return (
      <>
        {renderList(staticItems)}
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
      </>
    );
  }
  if (!results.data)
    return (
      <>
        {renderList(staticItems)}
        <SearchLoading />
      </>
    );
  return (
    <>
      {renderList(
        <>
          {results.data.documents.length > 0 ? (
            <CommandMenu.Group heading={t("root.commandSearchHeading")}>
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
                          <Highlight
                            text={document.snippet}
                            needles={needles}
                          />
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
          ) : (
            <SearchEmptyOption />
          )}
          {staticItems}
        </>,
      )}
      {offset > 0 || results.data.pagination.hasMore ? (
        <div
          className="flex justify-between gap-2 border-t p-2"
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
  renderList,
  staticItems,
}: {
  query: string;
  onOpenChange: (open: boolean) => void;
  renderList: (results?: ReactNode) => ReactNode;
  staticItems: ReactNode;
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
  const searchingAll = chosenScope === ALL_SPACES;
  const scopeId =
    chosenScope && chosenScope !== ALL_SPACES ? chosenScope : selectedSpace?.id;
  const [searchFields, setSearchFields] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [modifiedDate, setModifiedDate] = useState<ModifiedDateFilter>({
    kind: "any",
  });
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
  const customDate =
    modifiedDate.kind === "custom"
      ? formatDate(new Date(`${modifiedDate.day}T00:00:00`))
      : null;
  const dateTriggerLabel = customDate
    ? t("root.searchSince", { date: customDate })
    : modifiedDate.kind === "preset" && modifiedDate.days === 7
      ? t("root.searchPastWeek")
      : modifiedDate.kind === "preset" && modifiedDate.days === 30
        ? t("root.searchPastMonth")
        : t("root.searchAnyDate");
  const dateAccessibleLabel = customDate
    ? t("root.searchModifiedSince", { date: customDate })
    : t("root.searchDate");
  const modifiedAfter = modifiedAfterForFilter(modifiedDate);

  const applyPreset = (value: "all" | "7" | "30") => {
    setModifiedDate(
      value === "all"
        ? { kind: "any" }
        : { kind: "preset", days: Number(value) as 7 | 30 },
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
          label={dateAccessibleLabel}
          triggerLabel={dateTriggerLabel}
          presetValue={presetForModifiedDate(modifiedDate)}
          selectedDay={
            modifiedDate.kind === "custom"
              ? new Date(`${modifiedDate.day}T00:00:00`)
              : undefined
          }
          onSelectPreset={applyPreset}
          focusInput={focusPickerInput}
          onPickDay={(day) => {
            const selected = new Date(
              day.getFullYear(),
              day.getMonth(),
              day.getDate(),
            );
            setModifiedDate({
              kind: "custom",
              day: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
              modifiedAfter: selected.toISOString(),
            });
          }}
        />
      </div>
      {!searchingAll && (spaces.error || (!spaces.isLoading && !scopeId)) ? (
        <>
          {renderList(staticItems)}
          <div role="alert" className="p-3 text-sm">
            {t("root.searchScopeUnavailable")}
          </div>
        </>
      ) : (!searchingAll && !scopeId) || query.trim() !== debouncedQuery ? (
        <>
          {renderList(staticItems)}
          <SearchLoading />
        </>
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
          renderList={renderList}
          staticItems={staticItems}
        />
      ) : (
        renderList(staticItems)
      )}
    </>
  );
}
