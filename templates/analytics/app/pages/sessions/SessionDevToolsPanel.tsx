import { useT } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconChevronRight,
  IconCloudDataConnection,
  IconPlayerPlay,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { useErrorsT } from "../monitoring/errors/i18n";
import {
  type ConsoleLevelFilter,
  consoleLevelBucket,
  filterConsoleEntries,
  filterNetworkEntries,
  formatOffsetClock,
  latestEntryIndexAt,
  middleTruncate,
  type NetworkKindFilter,
  networkDisplayUrl,
  type ReplayConsoleEntry,
  type ReplayDevToolsDiagnostics,
  type ReplayNetworkEntry,
} from "./session-replay-devtools";

/**
 * A session console error line resolved to its captured, Sentry-style issue.
 * Keyed by `ReplayConsoleEntry.id`, computed server-side by `match-error-issues`
 * so the resolution shares one fingerprint implementation with ingest.
 */
export type SessionIssueMatch = { issueId: string; status: string };

/** Deep-link from a session error to the Monitoring → Errors issue detail. */
export function issueDetailPath(issueId: string): string {
  return `/monitoring?view=errors&issue=${encodeURIComponent(issueId)}`;
}

/** Search Monitoring for all captured issues resembling an unmatched line. */
export function issueSearchPath(message: string): string {
  const params = new URLSearchParams({
    view: "errors",
    status: "all",
    q: message,
  });
  return `/monitoring?${params.toString()}`;
}

/** Pause row auto-follow for a while after the user scrolls the list. */
const MANUAL_SCROLL_FOLLOW_PAUSE_MS = 4000;
const DEVTOOLS_ROW_HEIGHT = 34;
const DEVTOOLS_EXPANDED_ESTIMATE = 220;
const DEVTOOLS_OVERSCAN_ROWS = 10;
const DEVTOOLS_MIN_HEIGHT = 180;
const DEVTOOLS_MAX_HEIGHT = 620;

/**
 * Layout offsets for the virtualized Dev Tools list. Expanded rows reserve
 * extra height so details render inline under the selected line without
 * disabling virtualization for the rest of the list.
 */
export function buildDevToolsRowOffsets(
  entryCount: number,
  expandedIndex: number,
  expandedHeight = DEVTOOLS_EXPANDED_ESTIMATE,
): number[] {
  const offsets = new Array<number>(entryCount + 1);
  offsets[0] = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const height =
      index === expandedIndex ? expandedHeight : DEVTOOLS_ROW_HEIGHT;
    offsets[index + 1] = offsets[index] + height;
  }
  return offsets;
}

export function SessionDevToolsPanel({
  diagnostics,
  currentTime,
  height,
  maxHeight = DEVTOOLS_MAX_HEIGHT,
  onHeightChange,
  onSeek,
  issueMatches,
  issueMatching = false,
}: {
  diagnostics: ReplayDevToolsDiagnostics;
  currentTime: number;
  height: number;
  maxHeight?: number;
  onHeightChange: (height: number) => void;
  onSeek: (ms: number) => void;
  /** Resolved error issues by console entry id, for cross-linking to Errors. */
  issueMatches?: ReadonlyMap<string, SessionIssueMatch>;
  /** Prevent an unmatched fallback from flashing while issue lookup is active. */
  issueMatching?: boolean;
}) {
  const t = useT();
  const [tab, setTab] = useState<"console" | "network">("console");
  const [consoleLevel, setConsoleLevel] = useState<ConsoleLevelFilter>("all");
  const [consoleQuery, setConsoleQuery] = useState("");
  const [networkKind, setNetworkKind] = useState<NetworkKindFilter>("all");
  const [networkQuery, setNetworkQuery] = useState("");
  const [selectedConsoleId, setSelectedConsoleId] = useState<string | null>(
    null,
  );
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(
    null,
  );

  const filteredConsole = useMemo(
    () => filterConsoleEntries(diagnostics.console, consoleLevel, consoleQuery),
    [diagnostics.console, consoleLevel, consoleQuery],
  );
  const filteredNetwork = useMemo(
    () => filterNetworkEntries(diagnostics.network, networkKind, networkQuery),
    [diagnostics.network, networkKind, networkQuery],
  );

  const activeConsoleId =
    tab === "console"
      ? (filteredConsole[latestEntryIndexAt(filteredConsole, currentTime)]
          ?.id ?? null)
      : null;
  const activeNetworkId =
    tab === "network"
      ? (filteredNetwork[latestEntryIndexAt(filteredNetwork, currentTime)]
          ?.id ?? null)
      : null;

  useEffect(() => {
    if (
      selectedConsoleId &&
      !filteredConsole.some((entry) => entry.id === selectedConsoleId)
    ) {
      setSelectedConsoleId(null);
    }
  }, [filteredConsole, selectedConsoleId]);

  useEffect(() => {
    if (
      selectedNetworkId &&
      !filteredNetwork.some((entry) => entry.id === selectedNetworkId)
    ) {
      setSelectedNetworkId(null);
    }
  }, [filteredNetwork, selectedNetworkId]);

  const consoleLevelCounts = useMemo(() => {
    const counts = { log: 0, info: 0, warn: 0, error: 0 };
    for (const entry of diagnostics.console) {
      counts[consoleLevelBucket(entry.level)] += 1;
    }
    return counts;
  }, [diagnostics.console]);

  const networkKindCounts = useMemo(() => {
    const counts = { fetch: 0, xhr: 0, failed: 0 };
    for (const entry of diagnostics.network) {
      counts[entry.api] += 1;
      if (entry.failed) counts.failed += 1;
    }
    return counts;
  }, [diagnostics.network]);

  return (
    <div
      className="analytics-session-devtools relative flex min-h-0 shrink-0 flex-col border-t bg-background"
      style={{ height: Math.min(height, maxHeight) }}
    >
      <DevToolsResizeHandle
        height={Math.min(height, maxHeight)}
        maxHeight={maxHeight}
        onHeightChange={onHeightChange}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "console" | "network")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
          <TabsList className="h-8 p-0.5">
            <TabsTrigger value="console" className="h-7 gap-1.5 px-2.5 text-xs">
              <IconTerminal2 className="h-3.5 w-3.5" />
              {t("sessions.devtoolsConsoleTab", {
                count: String(diagnostics.console.length),
              })}
              {diagnostics.consoleErrorCount > 0 ? (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="network" className="h-7 gap-1.5 px-2.5 text-xs">
              <IconCloudDataConnection className="h-3.5 w-3.5" />
              {t("sessions.devtoolsNetworkTab", {
                count: String(diagnostics.network.length),
              })}
              {diagnostics.networkFailedCount > 0 ? (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="console"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
            <FilterChip
              label={t("sessions.devtoolsFilterAll", {
                count: String(diagnostics.console.length),
              })}
              active={consoleLevel === "all"}
              onClick={() => setConsoleLevel("all")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterLog", {
                count: String(consoleLevelCounts.log),
              })}
              active={consoleLevel === "log"}
              onClick={() => setConsoleLevel("log")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterInfo", {
                count: String(consoleLevelCounts.info),
              })}
              active={consoleLevel === "info"}
              onClick={() => setConsoleLevel("info")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterWarning", {
                count: String(consoleLevelCounts.warn),
              })}
              active={consoleLevel === "warn"}
              onClick={() => setConsoleLevel("warn")}
              tone="warn"
            />
            <FilterChip
              label={t("sessions.devtoolsFilterError", {
                count: String(consoleLevelCounts.error),
              })}
              active={consoleLevel === "error"}
              onClick={() => setConsoleLevel("error")}
              tone="error"
            />
            <DevToolsSearchInput
              value={consoleQuery}
              onChange={setConsoleQuery}
              placeholder={t("sessions.devtoolsConsoleSearch")}
            />
          </div>
          <VirtualizedDevToolsList
            entries={filteredConsole}
            activeEntryId={activeConsoleId}
            expandedEntryId={selectedConsoleId}
            emptyMessage={
              diagnostics.console.length
                ? t("sessions.devtoolsNoConsoleMatches")
                : t("sessions.devtoolsNoConsole")
            }
            renderRow={(entry, expanded) => (
              <ConsoleRow
                entry={entry}
                active={entry.id === activeConsoleId}
                selected={expanded}
                issueMatch={issueMatches?.get(entry.id) ?? null}
                issueMatching={issueMatching}
                onSelect={() =>
                  setSelectedConsoleId((current) =>
                    current === entry.id ? null : entry.id,
                  )
                }
                onSeek={onSeek}
              />
            )}
          />
        </TabsContent>

        <TabsContent
          value="network"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
            <FilterChip
              label={t("sessions.devtoolsFilterAll", {
                count: String(diagnostics.network.length),
              })}
              active={networkKind === "all"}
              onClick={() => setNetworkKind("all")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterFetch", {
                count: String(networkKindCounts.fetch),
              })}
              active={networkKind === "fetch"}
              onClick={() => setNetworkKind("fetch")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterXhr", {
                count: String(networkKindCounts.xhr),
              })}
              active={networkKind === "xhr"}
              onClick={() => setNetworkKind("xhr")}
            />
            <FilterChip
              label={t("sessions.devtoolsFilterFailed", {
                count: String(networkKindCounts.failed),
              })}
              active={networkKind === "failed"}
              onClick={() => setNetworkKind("failed")}
              tone="error"
            />
            <DevToolsSearchInput
              value={networkQuery}
              onChange={setNetworkQuery}
              placeholder={t("sessions.devtoolsNetworkSearch")}
            />
          </div>
          <VirtualizedDevToolsList
            entries={filteredNetwork}
            activeEntryId={activeNetworkId}
            expandedEntryId={selectedNetworkId}
            emptyMessage={
              diagnostics.network.length
                ? t("sessions.devtoolsNoNetworkMatches")
                : t("sessions.devtoolsNoNetwork")
            }
            renderRow={(entry, expanded) => (
              <NetworkRow
                entry={entry}
                active={entry.id === activeNetworkId}
                selected={expanded}
                onSelect={() =>
                  setSelectedNetworkId((current) =>
                    current === entry.id ? null : entry.id,
                  )
                }
                onSeek={onSeek}
              />
            )}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DevToolsResizeHandle({
  height,
  maxHeight,
  onHeightChange,
}: {
  height: number;
  maxHeight: number;
  onHeightChange: (height: number) => void;
}) {
  const t = useT();
  const cappedMax = Math.max(DEVTOOLS_MIN_HEIGHT, maxHeight);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;

    function handlePointerMove(moveEvent: PointerEvent) {
      onHeightChange(
        clamp(
          startHeight - (moveEvent.clientY - startY),
          Math.min(DEVTOOLS_MIN_HEIGHT, cappedMax),
          cappedMax,
        ),
      );
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  return (
    <div
      role="separator"
      aria-label={t("sessions.devtoolsResize")}
      aria-orientation="horizontal"
      aria-valuemin={Math.min(DEVTOOLS_MIN_HEIGHT, cappedMax)}
      aria-valuemax={cappedMax}
      aria-valuenow={Math.round(height)}
      className="absolute inset-x-0 -top-1 z-10 flex h-2 cursor-row-resize items-center justify-center"
      onPointerDown={handlePointerDown}
    >
      <span className="h-0.5 w-9 rounded-full bg-border opacity-0 transition-opacity hover:opacity-100" />
    </div>
  );
}

function VirtualizedDevToolsList<T extends { id: string }>({
  entries,
  activeEntryId,
  expandedEntryId,
  emptyMessage,
  renderRow,
}: {
  entries: T[];
  activeEntryId: string | null;
  expandedEntryId: string | null;
  emptyMessage: string;
  renderRow: (entry: T, expanded: boolean) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastManualScrollAtRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [expandedRowHeight, setExpandedRowHeight] = useState(
    DEVTOOLS_EXPANDED_ESTIMATE,
  );
  const [expandedElement, setExpandedElement] = useState<HTMLDivElement | null>(
    null,
  );

  const activeIndex = activeEntryId
    ? entries.findIndex((entry) => entry.id === activeEntryId)
    : -1;
  const expandedIndex = expandedEntryId
    ? entries.findIndex((entry) => entry.id === expandedEntryId)
    : -1;

  const rowOffsets = useMemo(
    () =>
      buildDevToolsRowOffsets(entries.length, expandedIndex, expandedRowHeight),
    [entries.length, expandedIndex, expandedRowHeight],
  );

  const totalHeight = rowOffsets[entries.length] ?? 0;

  useEffect(() => {
    setExpandedRowHeight(DEVTOOLS_EXPANDED_ESTIMATE);
  }, [expandedEntryId]);

  useEffect(() => {
    if (!expandedElement) return;
    const update = () => {
      const measured = Math.ceil(
        expandedElement.getBoundingClientRect().height,
      );
      if (measured > 0) setExpandedRowHeight(measured);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(expandedElement);
    return () => observer.disconnect();
  }, [expandedElement]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    if (
      Date.now() - lastManualScrollAtRef.current <
      MANUAL_SCROLL_FOLLOW_PAUSE_MS
    ) {
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rowTop = rowOffsets[activeIndex] ?? 0;
    const rowBottom =
      rowOffsets[activeIndex + 1] ?? rowTop + DEVTOOLS_ROW_HEIGHT;
    if (rowTop >= el.scrollTop && rowBottom <= el.scrollTop + el.clientHeight) {
      return;
    }
    el.scrollTo({
      top: Math.max(0, rowTop - el.clientHeight / 2 + DEVTOOLS_ROW_HEIGHT),
    });
  }, [activeIndex, entries.length, rowOffsets]);

  const markManualScroll = () => {
    lastManualScrollAtRef.current = Date.now();
  };

  if (!entries.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        <DevToolsEmptyState message={emptyMessage} />
      </div>
    );
  }

  const measuredHeight = viewportHeight || 240;
  let startIndex = 0;
  while (
    startIndex < entries.length &&
    (rowOffsets[startIndex + 1] ?? 0) < scrollTop
  ) {
    startIndex += 1;
  }
  startIndex = clamp(startIndex - DEVTOOLS_OVERSCAN_ROWS, 0, entries.length);

  let endIndex = startIndex;
  while (
    endIndex < entries.length &&
    (rowOffsets[endIndex] ?? 0) < scrollTop + measuredHeight
  ) {
    endIndex += 1;
  }
  endIndex = clamp(
    endIndex + DEVTOOLS_OVERSCAN_ROWS,
    startIndex,
    entries.length,
  );
  const visibleEntries = entries.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto border-t"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onWheel={markManualScroll}
      onPointerDown={markManualScroll}
      onTouchMove={markManualScroll}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleEntries.map((entry, offset) => {
          const index = startIndex + offset;
          const expanded = entry.id === expandedEntryId;
          const top = rowOffsets[index] ?? 0;
          return (
            <div key={entry.id} className="absolute inset-x-0" style={{ top }}>
              <div ref={expanded ? setExpandedElement : undefined}>
                {renderRow(entry, expanded)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone = "default",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "default" | "warn" | "error";
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active &&
          tone === "default" &&
          "border-primary/40 bg-primary/10 text-primary",
        active &&
          tone === "warn" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        active &&
          tone === "error" &&
          "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function DevToolsSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative ms-auto w-full max-w-56">
      <IconSearch className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className="h-7 ps-7 text-xs"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function DevToolsEmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function JumpToButton({
  offsetMs,
  onSeek,
}: {
  offsetMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        onSeek(offsetMs);
      }}
    >
      <IconPlayerPlay className="h-3 w-3" />
      {t("sessions.devtoolsJumpTo")}
    </button>
  );
}

/**
 * Compact link from a captured session error to its Errors issue detail. Kept
 * outside the row's toggle `<button>` (an anchor nested in a button is invalid)
 * and stops click propagation so following the link never also toggles/seeks.
 */
function ViewIssueLink({
  issueId,
  className,
}: {
  issueId: string;
  className?: string;
}) {
  const et = useErrorsT();
  return (
    <Link
      to={issueDetailPath(issueId)}
      title={et.viewIssueTooltip}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <IconArrowUpRight className="h-3 w-3" />
      {et.viewIssue}
    </Link>
  );
}

function SearchIssuesLink({ message }: { message: string }) {
  const et = useErrorsT();
  return (
    <Link
      to={issueSearchPath(message)}
      title={et.searchIssuesTooltip}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <IconSearch className="h-3 w-3" />
      {et.searchIssues}
    </Link>
  );
}

function ConsoleRow({
  entry,
  active,
  selected,
  issueMatch,
  issueMatching,
  onSelect,
  onSeek,
}: {
  entry: ReplayConsoleEntry;
  active: boolean;
  selected: boolean;
  issueMatch: SessionIssueMatch | null;
  issueMatching: boolean;
  onSelect: () => void;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const bucket = consoleLevelBucket(entry.level);

  return (
    <div
      data-entry-id={entry.id}
      className={cn(
        "group border-b transition-colors hover:bg-muted/50",
        active && "bg-primary/[0.06] dark:bg-primary/[0.09]",
        selected && "bg-muted/40",
      )}
    >
      <div className="flex h-[34px] items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={selected}
          onClick={onSelect}
        >
          <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatOffsetClock(entry.offsetMs)}
          </span>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              bucket === "error" && "bg-red-500",
              bucket === "warn" && "bg-amber-500",
              bucket === "info" && "bg-sky-500",
              bucket === "log" && "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-xs",
              bucket === "error" && "text-red-600 dark:text-red-400",
              bucket === "warn" && "text-amber-600 dark:text-amber-400",
              bucket !== "error" && bucket !== "warn" && "text-foreground/80",
            )}
            title={entry.message}
          >
            {entry.message || entry.level}
          </span>
          {entry.repeat > 1 ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              x{entry.repeat}
            </span>
          ) : null}
          {entry.source !== "console" ? (
            <span className="hidden shrink-0 rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              {entry.source}
            </span>
          ) : null}
          <IconChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100",
              selected && "rotate-90 rtl:scale-x-100",
            )}
          />
        </button>
        {issueMatch ? <ViewIssueLink issueId={issueMatch.issueId} /> : null}
        {!issueMatch && !issueMatching && bucket === "error" ? (
          <SearchIssuesLink message={entry.message} />
        ) : null}
        <JumpToButton offsetMs={entry.offsetMs} onSeek={onSeek} />
      </div>
      {selected ? (
        <div className="space-y-2 border-t border-border/60 bg-muted/20 px-3 py-2 ps-[3.25rem]">
          <DetailField label={t("sessions.devtoolsMessage")}>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/85">
              {entry.message || entry.level}
            </pre>
          </DetailField>
          {entry.url ? (
            <DetailField label={t("sessions.url")}>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {entry.url}
              </p>
            </DetailField>
          ) : null}
          {entry.args.length ? (
            <DetailField label={t("sessions.devtoolsArgs")}>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                {entry.args.join("\n")}
              </pre>
            </DetailField>
          ) : null}
          {entry.stack ? (
            <DetailField label={t("sessions.devtoolsStack")}>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                {entry.stack}
              </pre>
            </DetailField>
          ) : null}
          {issueMatch ? (
            <div className="pt-1">
              <ViewIssueLink issueId={issueMatch.issueId} />
            </div>
          ) : !issueMatching && bucket === "error" ? (
            <div className="pt-1">
              <SearchIssuesLink message={entry.message} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NetworkRow({
  entry,
  active,
  selected,
  onSelect,
  onSeek,
}: {
  entry: ReplayNetworkEntry;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const displayUrl = middleTruncate(networkDisplayUrl(entry.url), 72);

  return (
    <div
      data-entry-id={entry.id}
      className={cn(
        "group border-b transition-colors hover:bg-muted/50",
        active && "bg-primary/[0.06] dark:bg-primary/[0.09]",
        selected && "bg-muted/40",
      )}
    >
      <div className="flex h-[34px] items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={selected}
          onClick={onSelect}
        >
          <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatOffsetClock(entry.offsetMs)}
          </span>
          <span
            className={cn(
              "w-12 shrink-0 font-mono text-[11px] font-semibold",
              entry.failed
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground",
            )}
          >
            {entry.status > 0
              ? entry.status
              : t("sessions.devtoolsFailedStatus")}
          </span>
          <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
            {entry.method}
          </span>
          <span className="hidden w-10 shrink-0 font-mono text-[10px] uppercase text-muted-foreground/70 sm:inline">
            {entry.api === "xhr" ? "XHR" : "fetch"}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
            title={entry.url}
          >
            {displayUrl}
          </span>
          {entry.error ? (
            <span
              className="hidden max-w-32 shrink-0 truncate font-mono text-[11px] text-red-600 dark:text-red-400 lg:inline"
              title={entry.error}
            >
              {entry.error}
            </span>
          ) : null}
          <span className="w-14 shrink-0 text-end font-mono text-[11px] text-muted-foreground">
            {t("sessions.devtoolsDurationMs", {
              ms: String(entry.durationMs),
            })}
          </span>
          <IconChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100",
              selected && "rotate-90 rtl:scale-x-100",
            )}
          />
        </button>
        <JumpToButton offsetMs={entry.offsetMs} onSeek={onSeek} />
      </div>
      {selected ? (
        <div className="space-y-2 border-t border-border/60 bg-muted/20 px-3 py-2 ps-[3.25rem]">
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailValue
              label={t("sessions.time")}
              value={formatOffsetClock(entry.offsetMs)}
            />
            <DetailValue
              label="API"
              value={entry.api === "xhr" ? "XHR" : "fetch"}
            />
            <DetailValue
              label="Status"
              value={
                entry.status > 0
                  ? String(entry.status)
                  : t("sessions.devtoolsFailedStatus")
              }
            />
            <DetailValue
              label="Duration"
              value={t("sessions.devtoolsDurationMs", {
                ms: String(entry.durationMs),
              })}
            />
          </div>
          <DetailField label={t("sessions.url")}>
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {entry.url}
            </p>
          </DetailField>
          {entry.error ? (
            <DetailField label="Error">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-red-600 dark:text-red-400">
                {entry.error}
              </pre>
            </DetailField>
          ) : null}
          {entry.responseBody ? (
            <DetailField label={t("sessions.devtoolsResponseBody")}>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                {entry.responseBody}
              </pre>
            </DetailField>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-foreground/80">
        {value}
      </p>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
