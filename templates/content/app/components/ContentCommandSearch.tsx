import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuNestedDialog,
} from "@agent-native/toolkit/app/shared";
import { parseSearchQuery, searchQueryNeedles } from "@shared/search-query";
import {
  buildTitleSearchIndex,
  rankTitlesByQuery,
  type NormalizedTitleCandidate,
} from "@shared/search-title-ranking";
import {
  IconDatabase,
  IconFileText,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { contentDocumentIdFromPathname } from "@/hooks/content-action-refresh";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useDocuments, useDocumentTitles } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  buildDocumentSpaceRootIndex,
  contentCommandDocumentPath,
  documentPassesInstantSearchFilters,
  documentSpaceRootIds,
  documentToInstantSearchResult,
  excludeAlreadyShownDocuments,
  isLocalFileSearchResult,
  mergeInstantAndServerResults,
  pagesInsidePage,
  pageScopeEntry,
  searchHighlightParts,
  titleEntryPassesFilters,
  titleEntryToInstantSearchResult,
  type CommandSearchDocumentResult,
  type CommandSearchDocumentsResponse,
  type InstantSearchFilters,
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
import { Spinner } from "./ui/spinner";

const INSTANT_RESULT_LIMIT = 20;

const ALL_SPACES = "all";
/** The scope that searches the open page and the pages inside it. */
export const THIS_PAGE_SCOPE = "this-page";
const THIS_PAGE = THIS_PAGE_SCOPE;

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

/** Unobtrusive: a background server refresh while instant results already fill the list. */
function SearchUpdating() {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t("root.commandSearchLoading")}
      className="flex items-center justify-center p-2"
    >
      <Spinner className="text-muted-foreground" />
    </div>
  );
}

function SearchPartialError({
  onRetry,
}: {
  onRetry: (event: { currentTarget: HTMLElement }) => void;
}) {
  const t = useT();
  return (
    <div role="alert" className="p-3 text-sm">
      {t("root.commandSearchPartialError")}
      <Button variant="ghost" size="sm" onClick={onRetry}>
        {t("root.searchRetry")}
      </Button>
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

/** Moves focus back to the command menu's search field. */
export function focusSearchInput(control: HTMLElement | null) {
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

function renderSearchResultItem({
  document,
  needles,
  onOpenChange,
  navigate,
  formatDate,
  t,
}: {
  document: CommandSearchDocumentResult;
  needles: string[];
  onOpenChange: (open: boolean) => void;
  navigate: ReturnType<typeof useNavigate>;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
  t: ReturnType<typeof useT>;
}) {
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
      value={`document:${document.id}`}
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
            t("root.searchModified", { date: formatDate(document.updatedAt) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {document.snippet ? (
          <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground group-data-[selected=true]:line-clamp-6 md:group-data-[selected=true]:line-clamp-2">
            <Highlight text={document.snippet} needles={needles} />
          </span>
        ) : null}
        {document.description ? (
          <span className="hidden mt-1 text-xs text-muted-foreground group-data-[selected=true]:block md:group-data-[selected=true]:hidden">
            {document.description}
          </span>
        ) : null}
        {sourceUpdated ? (
          <span className="hidden text-xs text-muted-foreground group-data-[selected=true]:block md:group-data-[selected=true]:hidden">
            {t("root.searchSourceUpdated", { date: formatDate(sourceUpdated) })}
          </span>
        ) : null}
      </span>
    </CommandMenu.Item>
  );
}

/**
 * Details of the highlighted row beside the results, on screens wide enough
 * for two columns. Narrow screens expand the highlighted row instead.
 */
function CommandPreviewPane({
  selectedValue,
  documents,
  needles,
  commandPreview,
}: {
  selectedValue: string | undefined;
  documents: CommandSearchDocumentResult[];
  needles: string[];
  commandPreview?: (value: string) => ReactNode;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const document = selectedValue?.startsWith("document:")
    ? documents.find(
        (candidate) => `document:${candidate.id}` === selectedValue,
      )
    : undefined;
  let body: ReactNode = null;
  if (document) {
    const Icon =
      document.documentType === "database"
        ? IconDatabase
        : isLocalFileSearchResult(document)
          ? IconFolderOpen
          : IconFileText;
    const sourceUpdated = document.sourceUpdatedAt
      ? normalizeTimestamp(document.sourceUpdatedAt)
      : null;
    body = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 break-words font-medium leading-snug">
            <Highlight
              text={document.title || t("sidebar.untitled")}
              needles={needles}
            />
          </p>
        </div>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {document.parentTitle || document.sourceKind ? (
            <p className="break-words">
              {[document.parentTitle, document.sourceKind]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <p>
            {t("root.searchModified", { date: formatDate(document.updatedAt) })}
          </p>
          {sourceUpdated ? (
            <p>
              {t("root.searchSourceUpdated", {
                date: formatDate(sourceUpdated),
              })}
            </p>
          ) : null}
        </div>
        {document.description ? (
          <p className="text-sm">{document.description}</p>
        ) : null}
        {document.snippet ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
            <Highlight text={document.snippet} needles={needles} />
          </p>
        ) : null}
      </div>
    );
  } else if (selectedValue && commandPreview) {
    body = commandPreview(selectedValue);
  }
  return (
    <aside
      aria-label={t("root.commandPreview")}
      data-testid="content-command-preview"
      className="hidden w-2/5 max-w-sm shrink-0 overflow-y-auto border-s border-border p-4 md:block"
    >
      {body}
    </aside>
  );
}

export function SearchPage({
  liveQuery,
  debouncedQuery,
  needles,
  spaceId,
  withinSubtreeOf,
  searchFields,
  documentType,
  modifiedAfter,
  onOpenChange,
  renderList,
  staticItems,
  titleIndex,
  selectedValue,
  commandPreview,
}: {
  liveQuery: string;
  debouncedQuery: string;
  needles: string[];
  spaceId?: string;
  withinSubtreeOf?: string;
  searchFields: "all" | "title";
  documentType?: "page" | "database";
  modifiedAfter?: string;
  onOpenChange: (open: boolean) => void;
  renderList: (results?: ReactNode) => ReactNode;
  staticItems: ReactNode;
  titleIndex: NormalizedTitleCandidate<CommandSearchDocumentResult>[];
  selectedValue?: string;
  commandPreview?: (value: string) => ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { formatDate } = useFormatters();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(0);
  }, [
    debouncedQuery,
    spaceId,
    withinSubtreeOf,
    searchFields,
    documentType,
    modifiedAfter,
  ]);

  // Instant lane: reranked on every keystroke straight from the precomputed
  // index, no debounce and no network wait (SO-01).
  const instantMatches = useMemo(
    () =>
      rankTitlesByQuery(titleIndex, liveQuery, {
        limit: INSTANT_RESULT_LIMIT,
      })
        .slice(0, INSTANT_RESULT_LIMIT)
        .map((result) => result.candidate),
    [titleIndex, liveQuery],
  );

  const baseArgs = {
    query: debouncedQuery,
    spaceId,
    withinSubtreeOf,
    searchFields,
    documentType,
    modifiedAfter,
    limit: 20,
  };
  // No `placeholderData`: a query-key change (a new debounced query, or a
  // different filter/scope) must never keep showing the previous key's
  // response as though it answered the current one
  // (docs/command-menu-architecture.md ~L111-112). The instant lane already
  // covers the resulting gap while the new request is in flight. Page one is
  // always kept mounted (even while viewing a later page) so its shown-id set
  // stays available to dedupe Next/Previous pages against.
  const pageOneResults = useActionQuery<CommandSearchDocumentsResponse>(
    "search-documents",
    { ...baseArgs, offset: 0 },
    { retry: false, enabled: Boolean(debouncedQuery) },
  );
  const pagedResults = useActionQuery<CommandSearchDocumentsResponse>(
    "search-documents",
    { ...baseArgs, offset },
    { retry: false, enabled: Boolean(debouncedQuery) },
  );
  // Server responses answer `debouncedQuery`. While the user is still typing,
  // they belong to an earlier query, so only the instant lane is shown until
  // the server catches up to the current text.
  const serverIsCurrent = liveQuery === debouncedQuery;
  const visibleOffset = serverIsCurrent ? offset : 0;
  const activeResults = visibleOffset === 0 ? pageOneResults : pagedResults;
  const pageOneServerDocuments = serverIsCurrent
    ? pageOneResults.data?.documents
    : undefined;

  const pageOneMerged = useMemo(
    () =>
      mergeInstantAndServerResults(
        instantMatches,
        pageOneServerDocuments ?? [],
      ),
    [instantMatches, pageOneServerDocuments],
  );
  const pageOneShownIds = useMemo(
    () => new Set(pageOneMerged.map((document) => document.id)),
    [pageOneMerged],
  );
  const displayedDocuments = useMemo(
    () =>
      visibleOffset === 0
        ? pageOneMerged
        : excludeAlreadyShownDocuments(
            pagedResults.data?.documents ?? [],
            pageOneShownIds,
          ),
    [visibleOffset, pageOneMerged, pagedResults.data, pageOneShownIds],
  );

  // When the server matched a mistyped word as other words, highlight those
  // too, so a result shows why it matched.
  const correctedNeedles = serverIsCurrent
    ? (activeResults.data?.spellingCorrections ?? []).flatMap(
        (correction) => correction.replacements,
      )
    : [];
  const resultNeedles = correctedNeedles.length
    ? [...needles, ...correctedNeedles]
    : needles;

  const hasResults = displayedDocuments.length > 0;
  const isFetchingActive = !serverIsCurrent || activeResults.isFetching;
  const serverError = serverIsCurrent ? activeResults.error : null;
  const retryActive = (event: { currentTarget: HTMLElement }) => {
    focusSearchInput(event.currentTarget);
    void activeResults.refetch();
  };

  const pagination = serverIsCurrent
    ? activeResults.data?.pagination
    : undefined;
  let results: ReactNode;
  if (hasResults) {
    results = (
      <>
        {renderList(
          <>
            <CommandMenu.Group heading={t("root.commandSearchHeading")}>
              {displayedDocuments.map((document) =>
                renderSearchResultItem({
                  document,
                  needles: resultNeedles,
                  onOpenChange,
                  navigate,
                  formatDate,
                  t,
                }),
              )}
            </CommandMenu.Group>
            {staticItems}
          </>,
        )}
        {isFetchingActive ? <SearchUpdating /> : null}
        {serverError && !isFetchingActive ? (
          <SearchPartialError onRetry={retryActive} />
        ) : null}
        {visibleOffset > 0 || pagination?.hasMore ? (
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
              disabled={visibleOffset === 0}
              onClick={() => setOffset(Math.max(0, visibleOffset - 20))}
            >
              {t("root.searchPrevious")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!pagination?.hasMore}
              onClick={() => {
                const next = pagination?.nextOffset;
                if (next != null) setOffset(next);
              }}
            >
              {t("root.searchNext")}
            </Button>
          </div>
        ) : null}
      </>
    );
  } else if (isFetchingActive || (!serverError && !activeResults.data)) {
    results = (
      <>
        {renderList(staticItems)}
        <SearchLoading />
      </>
    );
  } else if (serverError) {
    results = (
      <>
        {renderList(staticItems)}
        <div role="alert" className="p-3 text-sm">
          {t("root.commandSearchError")}
          <Button variant="ghost" size="sm" onClick={retryActive}>
            {t("root.searchRetry")}
          </Button>
        </div>
      </>
    );
  } else {
    results = renderList(
      <>
        <SearchEmptyOption />
        {staticItems}
      </>,
    );
  }

  // The preview stays beside the list while results load or when none
  // match, since the menu's own commands can still be highlighted.
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{results}</div>
      <CommandPreviewPane
        selectedValue={selectedValue}
        documents={displayedDocuments}
        needles={resultNeedles}
        commandPreview={commandPreview}
      />
    </div>
  );
}

export function ContentCommandSearchResults({
  query,
  onOpenChange,
  renderList,
  staticItems,
  scope,
  onScopeChange,
  selectedValue,
  commandPreview,
}: {
  query: string;
  onOpenChange: (open: boolean) => void;
  renderList: (results?: ReactNode) => ReactNode;
  staticItems: ReactNode;
  /** The chosen scope, when the menu owns it; otherwise kept here. */
  scope?: string | null;
  onScopeChange?: (scope: string | null) => void;
  /** The highlighted row, for the preview pane. */
  selectedValue?: string;
  /** Preview for a highlighted row that isn't a page result. */
  commandPreview?: (value: string) => ReactNode;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const spaces = useContentSpaces();
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const [ownScope, setOwnScope] = useState<string | null>(null);
  const chosenScope = scope !== undefined ? scope : ownScope;
  const setChosenScope = (next: string | null) => {
    if (scope === undefined) setOwnScope(next);
    onScopeChange?.(next);
  };
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: spaces.data?.spaces ?? [],
    storedSpaceId,
  });
  const currentPageId = contentDocumentIdFromPathname(useLocation().pathname);
  const pageScopeId =
    chosenScope === THIS_PAGE && currentPageId ? currentPageId : undefined;
  // Searching inside a page crosses workspaces if the page's contents do.
  const searchingAll = chosenScope === ALL_SPACES || Boolean(pageScopeId);
  const scopeId =
    chosenScope && chosenScope !== ALL_SPACES && chosenScope !== THIS_PAGE
      ? chosenScope
      : selectedSpace?.id;
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
  const liveQuery = query.trim();
  const highlightNeedles = useMemo(() => {
    const parsed = parseSearchQuery(liveQuery);
    return parsed.empty ? [] : searchQueryNeedles(parsed);
  }, [liveQuery]);
  const resolvedDocumentType =
    documentType === "all" ? undefined : (documentType as "page" | "database");

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

  // Instant title lane: the titles of everything the caller can search, or,
  // in local-file mode, the complete list the sidebar loads for
  // `useDocuments()` (`enabled: false` returns its cached data, if any).
  // Elsewhere that cache can hold just a page created a moment ago, so only
  // local-file mode reads it. Filtering and indexing are memoized separately
  // from ranking, which reruns on every keystroke.
  const localFileMode = spaces.data?.sourceMode === "local-files";
  const documentsQuery = useDocuments({ enabled: false });
  const documents = localFileMode ? documentsQuery.data : undefined;
  const titleEntries = useDocumentTitles({
    enabled: Boolean(spaces.data) && !localFileMode,
  }).data?.documents;
  const rootIndex = useMemo(
    () => buildDocumentSpaceRootIndex(documents ?? []),
    [documents],
  );
  const scopeSpace = useMemo(
    () =>
      searchingAll
        ? null
        : ((spaces.data?.spaces ?? []).find((space) => space.id === scopeId) ??
          null),
    [searchingAll, spaces.data, scopeId],
  );
  const spaceRootIds = useMemo(
    () => (scopeSpace ? documentSpaceRootIds(scopeSpace) : null),
    [scopeSpace],
  );
  const instantFilters: InstantSearchFilters = useMemo(
    () => ({
      searchingAll,
      spaceRootIds,
      rootIndex,
      documentType: resolvedDocumentType,
      modifiedAfter,
    }),
    [
      searchingAll,
      spaceRootIds,
      rootIndex,
      resolvedDocumentType,
      modifiedAfter,
    ],
  );
  const insidePage = useMemo(
    () =>
      pageScopeId
        ? pagesInsidePage(
            documents?.map(pageScopeEntry) ?? titleEntries ?? [],
            pageScopeId,
          )
        : null,
    [documents, titleEntries, pageScopeId],
  );
  const candidateDocuments = useMemo(() => {
    if (documents) {
      return documents
        .filter(
          (document) =>
            documentPassesInstantSearchFilters(document, instantFilters) &&
            (!insidePage || insidePage.has(document.id)),
        )
        .map(documentToInstantSearchResult);
    }
    const titleById = new Map(
      (titleEntries ?? []).map((entry) => [entry.id, entry.title]),
    );
    return (titleEntries ?? [])
      .filter((entry) =>
        titleEntryPassesFilters(entry, {
          spaceId: searchingAll ? undefined : scopeId,
          insidePage,
          documentType: resolvedDocumentType,
          modifiedAfter,
        }),
      )
      .map((entry) => titleEntryToInstantSearchResult(entry, titleById));
  }, [
    documents,
    instantFilters,
    insidePage,
    titleEntries,
    searchingAll,
    scopeId,
    resolvedDocumentType,
    modifiedAfter,
  ]);
  const titleIndex = useMemo(
    () => buildTitleSearchIndex(candidateDocuments),
    [candidateDocuments],
  );

  const applyPreset = (value: "all" | "7" | "30") => {
    setModifiedDate(
      value === "all"
        ? { kind: "any" }
        : { kind: "preset", days: Number(value) as 7 | 30 },
    );
  };

  return (
    <>
      {liveQuery ? (
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
            value={
              pageScopeId
                ? THIS_PAGE
                : searchingAll
                  ? ALL_SPACES
                  : (scopeId ?? "")
            }
            choices={[
              ...(currentPageId
                ? [{ value: THIS_PAGE, label: t("root.searchThisPage") }]
                : []),
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
      ) : null}
      {!searchingAll && (spaces.error || (!spaces.isLoading && !scopeId)) ? (
        <>
          {renderList(staticItems)}
          <div role="alert" className="p-3 text-sm">
            {t("root.searchScopeUnavailable")}
          </div>
        </>
      ) : !searchingAll && !scopeId ? (
        <>
          {renderList(staticItems)}
          <SearchLoading />
        </>
      ) : liveQuery ? (
        <SearchPage
          liveQuery={liveQuery}
          debouncedQuery={debouncedQuery}
          needles={highlightNeedles}
          spaceId={searchingAll ? undefined : scopeId}
          withinSubtreeOf={pageScopeId}
          searchFields={searchFields as "all" | "title"}
          documentType={resolvedDocumentType}
          modifiedAfter={modifiedAfter}
          onOpenChange={onOpenChange}
          renderList={renderList}
          staticItems={staticItems}
          titleIndex={titleIndex}
          selectedValue={selectedValue}
          commandPreview={commandPreview}
        />
      ) : (
        renderList(staticItems)
      )}
    </>
  );
}
