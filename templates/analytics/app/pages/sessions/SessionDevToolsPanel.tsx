import { useT } from "@agent-native/core/client";
import {
  IconChevronRight,
  IconCloudDataConnection,
  IconPlayerPlay,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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

/** Pause row auto-follow for a while after the user scrolls the list. */
const MANUAL_SCROLL_FOLLOW_PAUSE_MS = 4000;

export function SessionDevToolsPanel({
  diagnostics,
  currentTime,
  onSeek,
}: {
  diagnostics: ReplayDevToolsDiagnostics;
  currentTime: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"console" | "network">("console");
  const [consoleLevel, setConsoleLevel] = useState<ConsoleLevelFilter>("all");
  const [consoleQuery, setConsoleQuery] = useState("");
  const [networkKind, setNetworkKind] = useState<NetworkKindFilter>("all");
  const [networkQuery, setNetworkQuery] = useState("");

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
    <div className="analytics-session-devtools shrink-0 border-t">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "console" | "network")}
      >
        <div className="flex items-center gap-2 px-3 pt-2">
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

        <TabsContent value="console" className="mt-0">
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
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
          <DevToolsScrollArea activeEntryId={activeConsoleId}>
            {filteredConsole.length ? (
              filteredConsole.map((entry) => (
                <ConsoleRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === activeConsoleId}
                  onSeek={onSeek}
                />
              ))
            ) : (
              <DevToolsEmptyState
                message={
                  diagnostics.console.length
                    ? t("sessions.devtoolsNoConsoleMatches")
                    : t("sessions.devtoolsNoConsole")
                }
              />
            )}
          </DevToolsScrollArea>
        </TabsContent>

        <TabsContent value="network" className="mt-0">
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
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
          <DevToolsScrollArea activeEntryId={activeNetworkId}>
            {filteredNetwork.length ? (
              filteredNetwork.map((entry) => (
                <NetworkRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === activeNetworkId}
                  onSeek={onSeek}
                />
              ))
            ) : (
              <DevToolsEmptyState
                message={
                  diagnostics.network.length
                    ? t("sessions.devtoolsNoNetworkMatches")
                    : t("sessions.devtoolsNoNetwork")
                }
              />
            )}
          </DevToolsScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DevToolsScrollArea({
  activeEntryId,
  children,
}: {
  activeEntryId: string | null;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastManualScrollAtRef = useRef(0);

  useEffect(() => {
    if (!activeEntryId) return;
    if (
      Date.now() - lastManualScrollAtRef.current <
      MANUAL_SCROLL_FOLLOW_PAUSE_MS
    ) {
      return;
    }
    const row = containerRef.current?.querySelector(
      `[data-entry-id="${activeEntryId}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeEntryId]);

  const markManualScroll = () => {
    lastManualScrollAtRef.current = Date.now();
  };

  return (
    <div
      ref={containerRef}
      className="max-h-56 overflow-y-auto border-t"
      onWheel={markManualScroll}
      onPointerDown={markManualScroll}
      onTouchMove={markManualScroll}
    >
      {children}
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

function ConsoleRow({
  entry,
  active,
  onSeek,
}: {
  entry: ReplayConsoleEntry;
  active: boolean;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(entry.stack || entry.args.length > 1 || entry.url);
  const bucket = consoleLevelBucket(entry.level);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        data-entry-id={entry.id}
        className={cn(
          "group flex items-start gap-2 border-b px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/50",
          active && "bg-muted",
        )}
      >
        <span className="mt-0.5 w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatOffsetClock(entry.offsetMs)}
        </span>
        <span
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            bucket === "error" && "bg-red-500",
            bucket === "warn" && "bg-amber-500",
            bucket === "info" && "bg-sky-500",
            bucket === "log" && "bg-muted-foreground/50",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-mono text-xs",
              bucket === "error" && "text-red-600 dark:text-red-400",
              bucket === "warn" && "text-amber-600 dark:text-amber-400",
              bucket !== "error" && bucket !== "warn" && "text-foreground/80",
            )}
            title={entry.message}
          >
            {entry.message}
          </span>
        </span>
        {entry.repeat > 1 ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            {t("sessions.devtoolsRepeatCount", {
              count: String(entry.repeat),
            })}
          </span>
        ) : null}
        {entry.source !== "console" ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded border px-1 font-mono text-[10px] text-muted-foreground">
            {entry.source}
          </span>
        ) : null}
        <JumpToButton offsetMs={entry.offsetMs} onSeek={onSeek} />
        {hasDetail ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("sessions.devtoolsToggleDetails")}
            >
              <IconChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform rtl:-scale-x-100",
                  open && "rotate-90 rtl:scale-x-100",
                )}
              />
            </button>
          </CollapsibleTrigger>
        ) : null}
      </div>
      {hasDetail ? (
        <CollapsibleContent>
          <div className="space-y-2 border-b bg-muted/30 px-3 py-2 ps-[3.75rem]">
            {entry.url ? (
              <p
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={entry.url}
              >
                {entry.url}
              </p>
            ) : null}
            {entry.args.length > 1 ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sessions.devtoolsArgs")}
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80">
                  {entry.args.join("\n")}
                </pre>
              </div>
            ) : null}
            {entry.stack ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sessions.devtoolsStack")}
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {entry.stack}
                </pre>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function NetworkRow({
  entry,
  active,
  onSeek,
}: {
  entry: ReplayNetworkEntry;
  active: boolean;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(entry.responseBody);
  const displayUrl = middleTruncate(networkDisplayUrl(entry.url), 72);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        data-entry-id={entry.id}
        className={cn(
          "group flex items-center gap-2 border-b px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/50",
          active && "bg-muted",
        )}
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
          {entry.status > 0 ? entry.status : t("sessions.devtoolsFailedStatus")}
        </span>
        <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
          {entry.method}
        </span>
        <span className="w-10 shrink-0 font-mono text-[10px] uppercase text-muted-foreground/70">
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
            className="max-w-32 shrink-0 truncate font-mono text-[11px] text-red-600 dark:text-red-400"
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
        <JumpToButton offsetMs={entry.offsetMs} onSeek={onSeek} />
        {hasDetail ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("sessions.devtoolsToggleDetails")}
            >
              <IconChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform rtl:-scale-x-100",
                  open && "rotate-90 rtl:scale-x-100",
                )}
              />
            </button>
          </CollapsibleTrigger>
        ) : null}
      </div>
      {hasDetail ? (
        <CollapsibleContent>
          <div className="space-y-2 border-b bg-muted/30 px-3 py-2 ps-[3.75rem]">
            {entry.responseBody ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sessions.devtoolsResponseBody")}
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {entry.responseBody}
                </pre>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
