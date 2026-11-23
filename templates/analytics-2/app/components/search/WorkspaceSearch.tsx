import { notifyChatThreadsUpdated } from "@agent-native/core/client/agent-chat";
import { appBasePath } from "@agent-native/core/client/api-path";
import { actionErrorCode } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import {
  IconActivity,
  IconAdjustments,
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconCornerDownLeft,
  IconExternalLink,
  IconFileText,
  IconLoader2,
  IconMessageCircle,
  IconMessagePlus,
  IconRotate,
  IconSearch,
  IconTag,
  IconUser,
} from "@tabler/icons-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { startAskThread } from "@/components/agent/useAskThreadAdmission";
import { appMountedHref } from "@/components/projects/projectList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceData } from "@/components/workspace/WorkspaceDataContext";

import {
  clampSearchText,
  WORKSPACE_SEARCH_TEXT_MAX_LENGTH,
} from "../../../shared/search-limits";
import {
  CUSTOM_DATE_FIELDS,
  CUSTOM_DATE_MODES,
  customDateFieldLabel,
  customDateLabel,
  DEFAULT_DATE_FIELD,
  rangeIsComplete,
  type CustomDateField,
  type CustomDateMode,
} from "./custom-date-range";
import {
  formatResultDate,
  highlightQuery,
  isInternalHref,
  SEARCH_FIELD_LABELS,
} from "./format";
import { SearchDatePicker } from "./SearchDatePicker";
import type {
  SearchCellMatch,
  SearchField,
  SearchFilterOption,
  SearchProjectResult,
  SearchQuery,
  SearchResult,
  WorkspaceSearchProps,
} from "./types";

import "./search.css";

const DEFAULT_FIELDS: SearchField[] = ["title", "description", "cellContents"];
const DEBOUNCE_MS = 250;

const FIELD_OPTIONS: Array<{ id: SearchField; label: string }> = [
  { id: "title", label: SEARCH_FIELD_LABELS.title },
  { id: "description", label: SEARCH_FIELD_LABELS.description },
  { id: "cellContents", label: "Cell contents (text + code)" },
];

type FilterKey = "fields" | "creator" | "date" | "category" | "status";

type FlatRow = { kind: "start" } | SearchResult;

function isDefaultFields(fields: SearchField[]): boolean {
  return (
    fields.length === DEFAULT_FIELDS.length &&
    DEFAULT_FIELDS.every((field) => fields.includes(field))
  );
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function toggleFilterOption(
  selected: SearchFilterOption[],
  option: SearchFilterOption,
): SearchFilterOption[] {
  return selected.some(({ id }) => id === option.id)
    ? selected.filter(({ id }) => id !== option.id)
    : [...selected, option];
}

function accessLabelFor(result: SearchProjectResult): string {
  return result.accessLabel ?? "";
}

/** The search dialog only mounts while open, so a fresh open starts clean. */
const RECENTS_LIMIT = 5;

export function WorkspaceSearch(props: WorkspaceSearchProps) {
  return props.open ? <WorkspaceSearchPanel {...props} /> : null;
}

function WorkspaceSearchPanel({
  onClose,
  queryText,
  onQueryTextChange,
  onSearch,
  onNavigate,
  onCreateThread,
  filterOptions,
}: WorkspaceSearchProps) {
  const t = useT();
  const locale = useReaderLocale();
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const creatorInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  const [text, setText] = useState(queryText ?? "");
  const [debouncedText, setDebouncedText] = useState(queryText ?? "");
  const prevQueryTextRef = useRef(queryText);
  const pendingUrlQueriesRef = useRef<string[]>([]);
  useEffect(() => {
    if (queryText === undefined || queryText === prevQueryTextRef.current)
      return;
    prevQueryTextRef.current = queryText;
    const echoedIndex = pendingUrlQueriesRef.current.indexOf(queryText);
    if (echoedIndex !== -1) {
      pendingUrlQueriesRef.current.splice(0, echoedIndex + 1);
      return;
    }
    pendingUrlQueriesRef.current = [];
    setText(queryText);
    setDebouncedText(queryText);
  }, [queryText]);
  const [fields, setFields] = useState<SearchField[]>(DEFAULT_FIELDS);
  // The reference's date filter is not a preset list: it is a field (Last edited /
  // Created), a mode (After / Before / Between) and a calendar to pick the day in
  // (the original).
  const [customRange, setCustomRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  // The reference defaults to "After" and "Last edited", and the three modes decide
  // whether one day or two are needed.
  const [customDateMode, setCustomDateMode] = useState<CustomDateMode>("after");
  const [customDateField, setCustomDateField] =
    useState<CustomDateField>(DEFAULT_DATE_FIELD);
  const dateFieldLabel = customDateFieldLabel(customDateField);
  const datePicked = rangeIsComplete(customRange, customDateMode);
  // The filter's own trigger text: "Date" until a day is picked, then the field, the mode
  // and the day (or both days) in the reference's wording.
  const dateLabel = customDateLabel(
    customRange,
    customDateMode,
    dateFieldLabel,
    locale,
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creators, setCreators] = useState<SearchFilterOption[]>([]);
  const [categories, setCategories] = useState<SearchFilterOption[]>([]);
  const [statuses, setStatuses] = useState<SearchFilterOption[]>([]);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsKey, setResultsKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [retryToken, setRetryToken] = useState(0);
  // A keyboard list keeps an active row: a changed query re-seats it on the
  // first match so typing then Enter runs that row without an arrow key.
  const [activeSeat, setActiveSeat] = useState(0);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [threadPending, setThreadPending] = useState(false);
  const threadPendingRef = useRef(false);
  const [threadError, setThreadError] = useState("");
  const [aiSetupNeeded, setAiSetupNeeded] = useState(false);
  const workspace = useWorkspaceData()?.shell;
  const startIntent = useRef<{
    id: string;
    query: string;
    orgId: string;
  } | null>(null);

  const trimmedText = text.trim();
  const sentText = clampSearchText(text, WORKSPACE_SEARCH_TEXT_MAX_LENGTH);
  const threadPreview =
    trimmedText.length > 100 ? `${trimmedText.slice(0, 97)}...` : trimmedText;
  const isSearching =
    trimmedText !== "" ||
    !isDefaultFields(fields) ||
    datePicked ||
    creators.length > 0 ||
    categories.length > 0 ||
    statuses.length > 0;
  const hasActiveFilters =
    !isDefaultFields(fields) ||
    datePicked ||
    creators.length > 0 ||
    categories.length > 0 ||
    statuses.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const target =
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected
          ? opener
          : document.querySelector<HTMLElement>("[data-search-trigger]");
      target?.focus();
    };
  }, []);

  const query = useMemo<SearchQuery>(
    () => ({
      text: clampSearchText(debouncedText, WORKSPACE_SEARCH_TEXT_MAX_LENGTH),
      fields,
      customRange: datePicked ? customRange : null,
      customDateMode,
      customDateField,
      includeArchived,
      creatorIds: creators.map(({ id }) => id),
      categoryIds: categories.map(({ id }) => id),
      statusIds: statuses.map(({ id }) => id),
    }),
    [
      debouncedText,
      fields,
      datePicked,
      customRange,
      customDateMode,
      customDateField,
      includeArchived,
      creators,
      categories,
      statuses,
    ],
  );
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    // queryKey covers every field of query; the ref keeps the latest callback.
    let settled = false;
    onSearchRef
      .current(query, (partial) => {
        if (cancelled || settled) return;
        setResults(partial);
        setResultsKey(queryKey);
      })
      .then(
        (next) => {
          settled = true;
          if (cancelled) return;
          setResults(next);
          setResultsKey(queryKey);
          setStatus("success");
        },
        () => {
          if (cancelled) return;
          // A transient failed refresh must not replace results the person is
          // already reading with a full-panel error, so the results stay and the
          // failure is reported inline instead. Marking the state "error" is what
          // surfaces that notice; rendering decides between the inline notice and
          // the full panel by whether any results are left to read.
          setStatus("error");
        },
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, retryToken]);

  useEffect(() => {
    setActiveSeat(0);
  }, [text, queryKey]);

  useEffect(() => {
    if (openFilter === "creator") {
      creatorInputRef.current?.focus();
    }
  }, [openFilter]);

  useEffect(() => {
    if (!openFilter) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && filtersRef.current?.contains(target)) return;
      setOpenFilter(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openFilter]);

  const resultsMatchQuery = resultsKey === queryKey && sentText === query.text;
  const visibleResults = !resultsMatchQuery
    ? []
    : isSearching
      ? results.filter((result) => isInternalHref(result.href))
      : results
          .filter(
            (result) => result.kind !== "thread" && isInternalHref(result.href),
          )
          .slice(0, RECENTS_LIMIT);
  const displayStatus =
    sentText !== query.text || (!resultsMatchQuery && status === "success")
      ? "loading"
      : status;

  const showStartThread = Boolean(onCreateThread) && trimmedText !== "";
  const flatRows: FlatRow[] = showStartThread
    ? [{ kind: "start" }, ...visibleResults]
    : visibleResults;
  const activeIndex =
    flatRows.length === 0 ? -1 : Math.min(activeSeat, flatRows.length - 1);

  const startThread = useCallback(
    async (newTab: boolean) => {
      if (!onCreateThread || trimmedText === "" || threadPendingRef.current)
        return;
      threadPendingRef.current = true;
      setThreadPending(true);
      setThreadError("");
      setAiSetupNeeded(false);
      let target: Window | null = null;
      try {
        if (!workspace) {
          await onCreateThread(trimmedText, { newTab });
        } else {
          if (newTab) {
            target = window.open("", "_blank");
            if (!target) throw new Error(t("analytics.ask.admissionFailed"));
          }
          const orgId = workspace.workspace.id;
          if (
            startIntent.current?.orgId !== orgId ||
            startIntent.current.query !== trimmedText
          ) {
            startIntent.current = {
              id: crypto.randomUUID(),
              query: trimmedText,
              orgId,
            };
          }
          const receipt = await startAskThread({
            intentId: startIntent.current.id,
            mode: "ask",
            trigger: {
              kind: "submit",
              prompt: {
                text: trimmedText,
                attachmentIds: [],
                mentions: [],
                sourceIds: [],
                approval: "ask",
              },
            },
          });
          startIntent.current = null;
          notifyChatThreadsUpdated();
          if (target)
            target.location.replace(
              appMountedHref(receipt.href, appBasePath()),
            );
          else onNavigate(receipt.href);
        }
        onClose();
      } catch (error: unknown) {
        target?.close();
        const missing = actionErrorCode(error) === "ai_provider_unavailable";
        setAiSetupNeeded(missing);
        setThreadError(
          missing
            ? t("analytics.ask.connectAiMessage")
            : t("analytics.ask.admissionFailed"),
        );
      } finally {
        threadPendingRef.current = false;
        setThreadPending(false);
      }
    },
    [onClose, onCreateThread, onNavigate, t, trimmedText, workspace],
  );

  const activateRow = useCallback(
    (index: number, newTab: boolean) => {
      const row = flatRows[index];
      if (!row) return;
      if (row.kind === "start") {
        void startThread(newTab);
        return;
      }
      if (newTab) {
        // The result href is app-relative; a new tab needs the mount path or it
        // opens the host root (census CEN-analytics-2-002).
        window.open(
          appMountedHref(row.href, appBasePath()),
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        onNavigate(row.href);
      }
      onClose();
    },
    [flatRows, onClose, onNavigate, startThread],
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (flatRows.length === 0) return;
        const direction = event.key === "ArrowUp" ? -1 : 1;
        let next = activeIndex + direction;
        if (next < 0) next = 0;
        if (next >= flatRows.length) next = flatRows.length - 1;
        setActiveSeat(next);
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        activateRow(activeIndex, event.metaKey || event.ctrlKey);
      }
    },
    [activateRow, activeIndex, flatRows.length],
  );

  useEffect(() => {
    if (activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (openFilter) {
        setOpenFilter(null);
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, openFilter]);

  const handleDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"]):not(:disabled)',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  const toggleField = (field: SearchField) => {
    const next = toggleValue(fields, field);
    if (next.length === 0) return;
    setFields(next);
  };

  const filterLabel = (
    key: FilterKey,
    optionList: SearchFilterOption[] | undefined,
    selected: SearchFilterOption[],
    emptyLabel: string,
  ) => {
    if (selected.length === 0) return emptyLabel;
    const names = selected.map(
      ({ id, label }) =>
        optionList?.find((option) => option.id === id)?.label ?? label,
    );
    return `${key === "status" ? "Statuses" : key === "category" ? "Categories" : "Creator"}: ${names.join(", ")}`;
  };

  const activeItemId =
    activeIndex >= 0 ? `${baseId}-row-${activeIndex}` : undefined;

  return (
    <div
      className="ws-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ws-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search your workspace"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="ws-search-input-group">
          <IconSearch
            className="ws-search-input-icon"
            size={16}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            className="ws-search-input"
            type="text"
            value={text}
            placeholder={t("analytics.shell.searchPlaceholder")}
            aria-label="Search your workspace"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={activeItemId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value;
              if (onQueryTextChange) {
                pendingUrlQueriesRef.current.push(next);
                onQueryTextChange(next);
              }
              setText(next);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div className="ws-search-divider" />

        <div
          ref={filtersRef}
          className="ws-search-filters"
          role="group"
          aria-label="Search filters"
        >
          <FilterButton
            active={!isDefaultFields(fields)}
            label={
              !isDefaultFields(fields)
                ? `Searching: ${fields.map((field) => SEARCH_FIELD_LABELS[field]).join(", ")}`
                : "Search by"
            }
            icon={<IconAdjustments size={16} aria-hidden="true" />}
            expanded={openFilter === "fields"}
            onClick={() =>
              setOpenFilter(openFilter === "fields" ? null : "fields")
            }
          >
            {openFilter === "fields" ? (
              <FilterMenu>
                {FIELD_OPTIONS.map((option) => (
                  <FilterCheckbox
                    key={option.id}
                    checked={fields.includes(option.id)}
                    disabled={fields.length === 1 && fields.includes(option.id)}
                    label={option.label}
                    onToggle={() => toggleField(option.id)}
                  />
                ))}
                {!isDefaultFields(fields) ? (
                  <>
                    <div className="ws-search-menu-divider" />
                    <FilterReset onClick={() => setFields(DEFAULT_FIELDS)} />
                  </>
                ) : null}
              </FilterMenu>
            ) : null}
          </FilterButton>

          <FilterButton
            active={creators.length > 0}
            label={filterLabel(
              "creator",
              filterOptions?.creators,
              creators,
              "Creator",
            )}
            icon={<IconUser size={16} aria-hidden="true" />}
            expanded={openFilter === "creator"}
            onClick={() =>
              setOpenFilter(openFilter === "creator" ? null : "creator")
            }
          >
            {openFilter === "creator" ? (
              <FilterMenu>
                {filterOptions?.creatorSearch ? (
                  <Input
                    ref={creatorInputRef}
                    type="search"
                    className="h-8 w-full px-2 text-sm"
                    aria-label={t(
                      "analytics.shell.searchFilters.creatorSearchPlaceholder",
                    )}
                    placeholder={t(
                      "analytics.shell.searchFilters.creatorSearchPlaceholder",
                    )}
                    value={filterOptions.creatorSearch.text}
                    maxLength={200}
                    onChange={(event) =>
                      filterOptions.creatorSearch?.onSearch(event.target.value)
                    }
                  />
                ) : null}
                {filterOptions?.creatorSearch?.status === "loading" ? (
                  <p className="ws-search-menu-empty" role="status">
                    {t("analytics.shell.searchFilters.creatorSearching")}
                  </p>
                ) : filterOptions?.creatorSearch?.status === "error" ? (
                  <p className="ws-search-menu-empty" role="alert">
                    {t("analytics.shell.searchFilters.creatorSearchFailed")}
                  </p>
                ) : (
                  <FilterOptionList
                    emptyLabel={t("analytics.shell.searchFilters.creatorEmpty")}
                    options={filterOptions?.creators}
                    selected={creators}
                    onToggle={(option) =>
                      setCreators((selected) =>
                        toggleFilterOption(selected, option),
                      )
                    }
                  />
                )}
                {filterOptions?.creatorSearch?.hasMore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ws-search-menu-item"
                    disabled={filterOptions.creatorSearch.status !== "ready"}
                    onClick={filterOptions.creatorSearch.onMore}
                  >
                    {t("analytics.shell.more")}
                  </Button>
                ) : null}
                {creators.length > 0 ? (
                  <>
                    <div className="ws-search-menu-divider" />
                    <FilterReset onClick={() => setCreators([])} />
                  </>
                ) : null}
              </FilterMenu>
            ) : null}
          </FilterButton>

          <FilterButton
            active={datePicked}
            label={dateLabel}
            icon={<IconCalendar size={16} aria-hidden="true" />}
            expanded={openFilter === "date"}
            onClick={() => setOpenFilter(openFilter === "date" ? null : "date")}
          >
            {openFilter === "date" ? (
              <FilterMenu className="ws-search-date-menu">
                <div className="ws-search-date-head">
                  <div className="ws-search-date-selects">
                    <FilterSelect
                      label={dateFieldLabel}
                      onSelect={(next) =>
                        setCustomDateField(next as CustomDateField)
                      }
                      options={CUSTOM_DATE_FIELDS.map((entry) => ({
                        id: entry.field,
                        label: entry.label,
                      }))}
                      rid="search.date.field"
                      selected={customDateField}
                    />
                    <FilterSelect
                      label={
                        CUSTOM_DATE_MODES.find(
                          (entry) => entry.mode === customDateMode,
                        )?.label ?? ""
                      }
                      onSelect={(next) => {
                        setCustomDateMode(next as CustomDateMode);
                        setCustomRange((current) =>
                          current
                            ? {
                                from: current.from,
                                to: next === "between" ? current.to : "",
                              }
                            : current,
                        );
                      }}
                      options={CUSTOM_DATE_MODES.map((entry) => ({
                        id: entry.mode,
                        label: entry.label,
                      }))}
                      rid="search.date.mode"
                      selected={customDateMode}
                    />
                  </div>
                  {datePicked ? (
                    <button
                      className="ws-search-date-reset"
                      data-rid="search.date.reset"
                      onClick={() => setCustomRange(null)}
                      type="button"
                    >
                      <IconRotate size={14} aria-hidden="true" />
                      <span>Reset</span>
                    </button>
                  ) : null}
                </div>
                <div className="ws-search-menu-divider" />
                <SearchDatePicker
                  mode={customDateMode}
                  onChange={setCustomRange}
                  value={customRange}
                />
              </FilterMenu>
            ) : null}
          </FilterButton>

          <FilterButton
            active={categories.length > 0}
            label={filterLabel(
              "category",
              filterOptions?.categories,
              categories,
              "Category",
            )}
            icon={<IconTag size={16} aria-hidden="true" />}
            expanded={openFilter === "category"}
            onClick={() =>
              setOpenFilter(openFilter === "category" ? null : "category")
            }
          >
            {openFilter === "category" ? (
              <FilterMenu>
                <FilterOptionList
                  emptyLabel="No categories available"
                  options={filterOptions?.categories}
                  selected={categories}
                  onToggle={(option) =>
                    setCategories((selected) =>
                      toggleFilterOption(selected, option),
                    )
                  }
                />
                {categories.length > 0 ? (
                  <>
                    <div className="ws-search-menu-divider" />
                    <FilterReset onClick={() => setCategories([])} />
                  </>
                ) : null}
              </FilterMenu>
            ) : null}
          </FilterButton>

          <FilterButton
            active={statuses.length > 0}
            label={filterLabel(
              "status",
              filterOptions?.statuses,
              statuses,
              "Status",
            )}
            icon={<IconActivity size={16} aria-hidden="true" />}
            expanded={openFilter === "status"}
            onClick={() =>
              setOpenFilter(openFilter === "status" ? null : "status")
            }
          >
            {openFilter === "status" ? (
              <FilterMenu>
                <FilterOptionList
                  emptyLabel="No statuses available"
                  options={filterOptions?.statuses}
                  selected={statuses}
                  onToggle={(option) =>
                    setStatuses((selected) =>
                      toggleFilterOption(selected, option),
                    )
                  }
                />
                {statuses.length > 0 ? (
                  <>
                    <div className="ws-search-menu-divider" />
                    <FilterReset onClick={() => setStatuses([])} />
                  </>
                ) : null}
              </FilterMenu>
            ) : null}
          </FilterButton>

          <button
            type="button"
            role="switch"
            aria-checked={includeArchived}
            className="ws-search-archive-toggle"
            onClick={() => setIncludeArchived((value) => !value)}
          >
            <span
              className="ws-search-switch"
              data-checked={includeArchived}
              aria-hidden="true"
            >
              <span className="ws-search-switch-thumb" />
            </span>
            <span>Include archived</span>
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              className="ws-search-menu-reset"
              onClick={() => {
                setFields(DEFAULT_FIELDS);
                setCreators([]);
                setCategories([]);
                setStatuses([]);
                setCustomRange(null);
                setCustomDateMode("after");
                setCustomDateField(DEFAULT_DATE_FIELD);
                setIncludeArchived(false);
                setOpenFilter(null);
              }}
            >
              <IconRotate size={14} aria-hidden="true" />
              {t("analytics.shell.searchFilters.resetAll")}
            </button>
          ) : null}
        </div>

        <div className="ws-search-divider" />

        <div
          ref={listRef}
          id={`${baseId}-list`}
          className="ws-search-list"
          role="menu"
          aria-label="Workspace search results"
        >
          {displayStatus === "loading" &&
          visibleResults.length === 0 &&
          !showStartThread ? (
            <div className="ws-search-loading" role="status">
              <IconLoader2
                className="ws-search-spinner"
                size={24}
                aria-hidden="true"
              />
              <span className="ws-search-sr-only">Searching</span>
            </div>
          ) : isSearching &&
            displayStatus === "error" &&
            visibleResults.length === 0 ? (
            <div className="ws-search-state" role="alert">
              <IconAlertTriangle size={24} aria-hidden="true" />
              <p className="ws-search-state-title">Something went wrong</p>
              <p className="ws-search-state-body">
                Please contact support@builder.io if this persists
              </p>
            </div>
          ) : (
            <>
              {displayStatus === "error" ? (
                <p className="ws-search-refresh-error" role="status">
                  Could not refresh results.
                  <button
                    type="button"
                    className="ws-search-retry"
                    onClick={() => setRetryToken((value) => value + 1)}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              {showStartThread ? (
                <SearchRow
                  active={activeIndex === 0}
                  index={0}
                  id={`${baseId}-row-0`}
                  icon={<IconMessagePlus size={16} aria-hidden="true" />}
                  onClick={(event) => {
                    event.preventDefault();
                    activateRow(0, event.metaKey || event.ctrlKey);
                  }}
                  title={
                    threadPending
                      ? "Starting a new thread..."
                      : "Start a new thread"
                  }
                  description={
                    threadError
                      ? threadError
                      : `Ask \u201c${threadPreview}\u201d`
                  }
                  descriptionError={threadError !== ""}
                  disabled={threadPending}
                />
              ) : null}
              {aiSetupNeeded && workspace?.features.isAdmin ? (
                <div className="px-3 py-1">
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={appMountedHref(
                        buildSettingsRoute("model"),
                        appBasePath(),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("analytics.ask.connectAi")}
                    </a>
                  </Button>
                </div>
              ) : null}

              {displayStatus === "success" &&
              isSearching &&
              visibleResults.length === 0 ? (
                <div className="ws-search-state">
                  <IconSearch size={24} aria-hidden="true" />
                  <p className="ws-search-state-title">No results found</p>
                </div>
              ) : null}

              {flatRows.map((result, index) => {
                if (result.kind === "start") return null;
                const id = `${baseId}-row-${index}`;
                const active = activeIndex === index;
                const activate = (event: ReactMouseEvent) => {
                  event.preventDefault();
                  activateRow(index, event.metaKey || event.ctrlKey);
                };
                return (
                  <Fragment key={`${result.kind}-${result.id}`}>
                    {flatRows[index - 1]?.kind !== result.kind ? (
                      <SectionHeader
                        title={
                          result.kind === "thread"
                            ? t("analytics.shell.search.myThreads")
                            : isSearching
                              ? "Projects"
                              : "Recents"
                        }
                      />
                    ) : null}
                    {result.kind === "thread" ? (
                      <SearchRow
                        active={active}
                        index={index}
                        id={id}
                        icon={
                          <IconMessageCircle size={16} aria-hidden="true" />
                        }
                        title={highlightQuery(
                          result.title ||
                            t("analytics.shell.searchUntitledThread"),
                          debouncedText,
                        )}
                        description={formatResultDate(
                          result.latestMessageAt ?? result.updatedAt,
                        )}
                        onClick={activate}
                      />
                    ) : (
                      <ProjectRow
                        result={result}
                        index={index}
                        active={active}
                        rowId={id}
                        query={debouncedText}
                        fields={fields}
                        onActivate={activate}
                        onNavigateApp={(href) => {
                          onNavigate(href);
                          onClose();
                        }}
                      />
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>

        <div className="ws-search-footer">
          {isSearching ? (
            <>
              <FooterHint
                icon={<IconArrowUp size={14} aria-hidden="true" />}
                label="Up"
              />
              <FooterHint
                icon={<IconArrowDown size={14} aria-hidden="true" />}
                label="Down"
              />
              <FooterHint
                icon={<IconCornerDownLeft size={14} aria-hidden="true" />}
                label="Open"
              />
              <FooterHint
                icon={<IconCornerDownLeft size={14} aria-hidden="true" />}
                label="Open in new tab"
                prefix={"\u2318"}
              />
            </>
          ) : (
            <span className="ws-search-footer-note">
              Open the workspace search from anywhere with
              <kbd className="ws-search-key">{"\u2318 K"}</kbd>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  children,
  expanded,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  children?: ReactNode;
  expanded: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="ws-search-filter">
      <button
        type="button"
        className="ws-search-filter-button"
        data-active={active}
        aria-expanded={expanded}
        aria-haspopup="true"
        onClick={onClick}
      >
        <span className="ws-search-filter-icon">{icon}</span>
        <span className="ws-search-filter-label">{label}</span>
        <IconChevronDown
          className="ws-search-chevron"
          size={16}
          aria-hidden="true"
        />
      </button>
      {children}
    </div>
  );
}

function FilterMenu({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className ? `ws-search-menu ${className}` : "ws-search-menu"}
      role="menu"
    >
      {children}
    </div>
  );
}

/**
 * One of the date filter's two small dropdowns (the field and the mode). The
 * reference draws each as a minimal button with the current value and a caret, and
 * lists its options in a nested menu that closes on a pick.
 */
function FilterSelect({
  label,
  onSelect,
  options,
  rid,
  selected,
}: {
  label: string;
  onSelect: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  rid: string;
  selected: string;
}) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && selectRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    document.addEventListener("click", handleOutside, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutside, true);
      document.removeEventListener("click", handleOutside, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={selectRef} className="ws-search-select">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="ws-search-select-button"
        data-rid={rid}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span>{label}</span>
        <IconChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ws-search-submenu" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.id === selected}
              className="ws-search-menu-item"
              data-rid={`${rid}.${option.id}`}
              key={option.id}
              onClick={() => {
                onSelect(option.id);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterCheckbox({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="ws-search-menu-item"
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="ws-search-check" data-checked={checked}>
        {checked ? <IconCheck size={12} aria-hidden="true" /> : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

function FilterOptionList({
  emptyLabel,
  options,
  selected,
  onToggle,
}: {
  emptyLabel: string;
  options: SearchFilterOption[] | undefined;
  selected: SearchFilterOption[];
  onToggle: (option: SearchFilterOption) => void;
}) {
  if (!options || options.length === 0) {
    return <p className="ws-search-menu-empty">{emptyLabel}</p>;
  }
  return (
    <>
      {options.map((option) => (
        <FilterCheckbox
          key={option.id}
          checked={selected.some(({ id }) => id === option.id)}
          label={option.label}
          onToggle={() => onToggle(option)}
        />
      ))}
    </>
  );
}

function FilterReset({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ws-search-menu-reset" onClick={onClick}>
      Reset
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="ws-search-section" role="presentation">
      <h3>{title}</h3>
    </div>
  );
}

function SearchRow({
  active,
  description,
  descriptionError,
  disabled,
  icon,
  id,
  index,
  onClick,
  title,
}: {
  active: boolean;
  description?: ReactNode;
  descriptionError?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  id: string;
  index: number;
  onClick: (event: ReactMouseEvent) => void;
  title: ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="menuitem"
      data-row-index={index}
      className="ws-search-row"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ws-search-row-icon">{icon}</span>
      <span className="ws-search-row-text">
        <span className="ws-search-row-title">{title}</span>
        {description ? (
          <span
            className="ws-search-row-description"
            data-error={descriptionError}
          >
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ProjectRow({
  active,
  fields,
  index,
  onActivate,
  onNavigateApp,
  query,
  result,
  rowId,
}: {
  active: boolean;
  index: number;
  onActivate: (event: ReactMouseEvent) => void;
  onNavigateApp: (href: string) => void;
  query: string;
  fields: SearchField[];
  result: SearchProjectResult;
  rowId: string;
}) {
  const meta = [
    result.ownerName,
    formatResultDate(result.updatedAt),
    accessLabelFor(result),
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      id={rowId}
      role="menuitem"
      data-row-index={index}
      className="ws-search-row"
      data-active={active}
      tabIndex={-1}
      onClick={onActivate}
    >
      <span className="ws-search-row-icon">
        <IconFileText size={16} aria-hidden="true" />
      </span>
      <span className="ws-search-row-text">
        <span className="ws-search-row-title">
          {highlightQuery(result.title, fields.includes("title") ? query : "")}
          {result.archived ? (
            <span className="ws-search-archived">Archived</span>
          ) : null}
        </span>
        {result.cellMatches && result.cellMatches.length > 0 ? (
          <span className="ws-search-cell-matches">
            {result.cellMatches.map((match) => (
              <CellMatch
                key={`${match.cellId}-${match.snippet}`}
                match={match}
                query={fields.includes("cellContents") ? query : ""}
              />
            ))}
          </span>
        ) : result.description ? (
          <span className="ws-search-row-description">
            {highlightQuery(
              result.description,
              fields.includes("description") ? query : "",
            )}
          </span>
        ) : null}
        {meta.length > 0 ? (
          <span className="ws-search-row-meta" suppressHydrationWarning>
            {meta.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </span>
        ) : null}
      </span>
      {result.publishedAppHref && isInternalHref(result.publishedAppHref) ? (
        <a
          href={appMountedHref(result.publishedAppHref, appBasePath())}
          className="ws-search-view-app"
          onClick={(event) => {
            event.stopPropagation();
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onNavigateApp(result.publishedAppHref as string);
          }}
        >
          <IconExternalLink size={14} aria-hidden="true" />
          View app
        </a>
      ) : null}
    </div>
  );
}

function CellMatch({
  match,
  query,
}: {
  match: SearchCellMatch;
  query: string;
}) {
  return (
    <span className="ws-search-cell-match">
      <span className="ws-search-cell-tag">
        {cellKindLabel(match.cellKind)}
      </span>
      <span className="ws-search-cell-snippet">
        {highlightQuery(match.snippet, query)}
      </span>
    </span>
  );
}

function cellKindLabel(kind: SearchCellMatch["cellKind"]): string {
  switch (kind) {
    case "sql":
      return "SQL";
    case "python":
      return "Python";
    case "r":
      return "R";
    case "markdown":
      return "Markdown";
    case "chart":
      return "Chart";
    case "text":
    default:
      return "Text";
  }
}

function FooterHint({
  icon,
  label,
  prefix,
}: {
  icon: ReactNode;
  label: string;
  prefix?: string;
}) {
  return (
    <span className="ws-search-footer-hint">
      <kbd className="ws-search-key">
        {prefix ? <span>{prefix}</span> : null}
        {icon}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
