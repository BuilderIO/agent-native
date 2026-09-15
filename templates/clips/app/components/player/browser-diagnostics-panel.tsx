import { useT } from "@agent-native/core/client/i18n";
import type {
  BrowserDiagnosticConsoleLog,
  BrowserDiagnosticNetworkRequest,
  BrowserDiagnosticsData,
} from "@shared/browser-diagnostics";
import {
  IconAlertTriangle,
  IconBug,
  IconCircleCheck,
  IconInfoCircle,
  IconNetwork,
  IconTerminal2,
} from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export type BrowserDiagnosticsView = "issues" | "console" | "network";

export type BrowserDiagnosticGroup =
  | {
      id: string;
      kind: "console";
      elapsedMs: number;
      entries: BrowserDiagnosticConsoleLog[];
    }
  | {
      id: string;
      kind: "network";
      elapsedMs: number;
      entries: BrowserDiagnosticNetworkRequest[];
    };

export function isFullBrowserDiagnostics(
  value: unknown,
): value is BrowserDiagnosticsData {
  if (!value || typeof value !== "object") return false;
  const diagnostics = value as Partial<BrowserDiagnosticsData>;
  return (
    Array.isArray(diagnostics.consoleLogs) &&
    Array.isArray(diagnostics.networkRequests) &&
    Boolean(diagnostics.summary)
  );
}

function isFailedNetworkRequest(
  entry: BrowserDiagnosticNetworkRequest,
): boolean {
  return (
    Boolean(entry.error) ||
    (typeof entry.status === "number" && entry.status >= 400)
  );
}

function groupConsoleEntries(
  entries: BrowserDiagnosticConsoleLog[],
): BrowserDiagnosticGroup[] {
  const groups = new Map<string, BrowserDiagnosticConsoleLog[]>();
  for (const entry of entries) {
    const fingerprint = [entry.level, entry.message, entry.stack ?? ""].join(
      "\u0000",
    );
    const existing = groups.get(fingerprint);
    if (existing) existing.push(entry);
    else groups.set(fingerprint, [entry]);
  }
  return Array.from(groups, ([fingerprint, grouped]) => ({
    id: `console:${fingerprint}`,
    kind: "console" as const,
    elapsedMs: Math.min(...grouped.map((entry) => entry.elapsedMs)),
    entries: grouped.sort((a, b) => a.elapsedMs - b.elapsedMs),
  }));
}

function groupNetworkEntries(
  entries: BrowserDiagnosticNetworkRequest[],
): BrowserDiagnosticGroup[] {
  const groups = new Map<string, BrowserDiagnosticNetworkRequest[]>();
  for (const entry of entries) {
    const fingerprint = [
      entry.method,
      entry.url,
      entry.status ?? "",
      entry.error ?? "",
    ].join("\u0000");
    const existing = groups.get(fingerprint);
    if (existing) existing.push(entry);
    else groups.set(fingerprint, [entry]);
  }
  return Array.from(groups, ([fingerprint, grouped]) => ({
    id: `network:${fingerprint}`,
    kind: "network" as const,
    elapsedMs: Math.min(...grouped.map((entry) => entry.elapsedMs)),
    entries: grouped.sort((a, b) => a.elapsedMs - b.elapsedMs),
  }));
}

export function buildBrowserDiagnosticGroups(
  diagnostics: BrowserDiagnosticsData,
  view: BrowserDiagnosticsView,
): BrowserDiagnosticGroup[] {
  const consoleEntries =
    view === "network"
      ? []
      : view === "issues"
        ? diagnostics.consoleLogs.filter(
            (entry) => entry.level === "warn" || entry.level === "error",
          )
        : diagnostics.consoleLogs;
  const networkEntries =
    view === "console"
      ? []
      : view === "issues"
        ? diagnostics.networkRequests.filter(isFailedNetworkRequest)
        : diagnostics.networkRequests;

  return [
    ...groupConsoleEntries(consoleEntries),
    ...groupNetworkEntries(networkEntries),
  ].sort((a, b) => a.elapsedMs - b.elapsedMs);
}

export function formatDiagnosticTime(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100));
  const hours = Math.floor(totalTenths / 36_000);
  const minutes = Math.floor((totalTenths % 36_000) / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  const secondsLabel = `${String(seconds).padStart(2, "0")}${tenths ? `.${tenths}` : ""}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secondsLabel}`
    : `${minutes}:${secondsLabel}`;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || url.hostname;
  } catch {
    return value;
  }
}

function captureSource(diagnostics: BrowserDiagnosticsData): string | null {
  if (!diagnostics.pageUrl) return null;
  try {
    return new URL(diagnostics.pageUrl).hostname;
  } catch {
    return diagnostics.pageUrl;
  }
}

function DiagnosticTimeButton({
  elapsedMs,
  durationMs,
  onSeek,
}: {
  elapsedMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  if (elapsedMs < 0 || elapsedMs > durationMs) {
    return (
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
        {t("browserDiagnostics.afterRecording")}
      </span>
    );
  }
  const label = formatDiagnosticTime(elapsedMs);
  return (
    <button
      type="button"
      className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onSeek(elapsedMs);
      }}
      aria-label={t("browserDiagnostics.seekToTime", { time: label })}
    >
      {label}
    </button>
  );
}

function RepeatBadge({ count }: { count: number }) {
  if (count < 2) return null;
  return (
    <span className="shrink-0 rounded-md border border-border px-1 py-px font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
      ×{count}
    </span>
  );
}

function OccurrenceTimes({
  elapsedTimes,
  durationMs,
  onSeek,
}: {
  elapsedTimes: number[];
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  if (elapsedTimes.length < 2) return null;
  return (
    <div className="grid gap-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("browserDiagnostics.occurrences")}
      </dt>
      <dd className="m-0 flex flex-wrap gap-2">
        {elapsedTimes.map((elapsedMs, index) => (
          <DiagnosticTimeButton
            key={`${elapsedMs}-${index}`}
            elapsedMs={elapsedMs}
            durationMs={durationMs}
            onSeek={onSeek}
          />
        ))}
      </dd>
    </div>
  );
}

function DiagnosticGroupTrigger({
  icon,
  summary,
  elapsedMs,
  durationMs,
  onSeek,
}: {
  icon: ReactNode;
  summary: ReactNode;
  elapsedMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const afterRecording = elapsedMs < 0 || elapsedMs > durationMs;
  return (
    <>
      <AccordionTrigger
        data-browser-diagnostic-row
        className={cn(
          "relative min-h-9 gap-2 py-1.5 text-start hover:no-underline [&>svg]:absolute [&>svg]:end-0 [&>svg]:top-1/2 [&>svg]:size-3.5 [&>svg]:-translate-y-1/2",
          afterRecording ? "pe-32" : "pe-20",
        )}
      >
        {icon}
        <span className="flex w-0 min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {summary}
        </span>
      </AccordionTrigger>
      <span className="absolute end-9 top-[18px] z-10 -translate-y-1/2">
        <DiagnosticTimeButton
          elapsedMs={elapsedMs}
          durationMs={durationMs}
          onSeek={onSeek}
        />
      </span>
    </>
  );
}

function ConsoleGroupRow({
  group,
  durationMs,
  onSeek,
}: {
  group: Extract<BrowserDiagnosticGroup, { kind: "console" }>;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const first = group.entries[0];
  const firstLine = first.message.split("\n", 1)[0];
  const isError = first.level === "error";
  const isWarning = first.level === "warn";
  return (
    <AccordionItem value={group.id} className="relative border-border/70 px-3">
      <DiagnosticGroupTrigger
        icon={
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-md border",
              isError && "border-destructive/30 text-destructive",
              isWarning && "border-border text-foreground",
              !isError && !isWarning && "border-border text-muted-foreground",
            )}
          >
            {isError || isWarning ? (
              <IconAlertTriangle className="size-3" aria-hidden="true" />
            ) : (
              <IconTerminal2 className="size-3" aria-hidden="true" />
            )}
          </span>
        }
        summary={
          <>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {firstLine}
            </span>
            <RepeatBadge count={group.entries.length} />
          </>
        }
        elapsedMs={group.elapsedMs}
        durationMs={durationMs}
        onSeek={onSeek}
      />
      <AccordionContent className="pb-4 ps-7">
        <dl className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-4">
          <div className="grid gap-1">
            <dt className="font-semibold text-muted-foreground">
              {t("browserDiagnostics.consoleSource")}
            </dt>
            <dd className="m-0 font-mono">{first.level}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold text-muted-foreground">
              {t("browserDiagnostics.message")}
            </dt>
            <dd className="m-0 whitespace-pre-wrap break-words font-mono">
              {first.message}
            </dd>
          </div>
          {first.stack ? (
            <div className="grid gap-1">
              <dt className="font-semibold text-muted-foreground">
                {t("browserDiagnostics.stackTrace")}
              </dt>
              <dd className="m-0 whitespace-pre-wrap break-words font-mono text-muted-foreground">
                {first.stack}
              </dd>
            </div>
          ) : null}
          <OccurrenceTimes
            elapsedTimes={group.entries.map((entry) => entry.elapsedMs)}
            durationMs={durationMs}
            onSeek={onSeek}
          />
        </dl>
      </AccordionContent>
    </AccordionItem>
  );
}

function NetworkGroupRow({
  group,
  durationMs,
  onSeek,
}: {
  group: Extract<BrowserDiagnosticGroup, { kind: "network" }>;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const first = group.entries[0];
  const failed = isFailedNetworkRequest(first);
  const status = first.status ?? (first.error ? "ERR" : "—");
  return (
    <AccordionItem value={group.id} className="relative border-border/70 px-3">
      <DiagnosticGroupTrigger
        icon={
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-md border",
              failed
                ? "border-destructive/30 text-destructive"
                : "border-border text-muted-foreground",
            )}
          >
            <IconNetwork className="size-3" aria-hidden="true" />
          </span>
        }
        summary={
          <>
            <span className="shrink-0 font-mono text-xs font-medium">
              {first.method}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
              {shortUrl(first.url)}
            </span>
            <RepeatBadge count={group.entries.length} />
          </>
        }
        elapsedMs={group.elapsedMs}
        durationMs={durationMs}
        onSeek={onSeek}
      />
      <AccordionContent className="pb-4 ps-7">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-4">
          <dt className="font-semibold text-muted-foreground">
            {t("browserDiagnostics.request")}
          </dt>
          <dd className="m-0 break-all font-mono">
            {first.type.toUpperCase()} · {first.method} {first.url}
          </dd>
          <dt className="font-semibold text-muted-foreground">
            {t("browserDiagnostics.status")}
          </dt>
          <dd className="m-0 font-mono">
            {status}
            {first.statusText ? ` ${first.statusText}` : ""}
          </dd>
          <dt className="font-semibold text-muted-foreground">
            {t("browserDiagnostics.duration")}
          </dt>
          <dd className="m-0 font-mono tabular-nums">
            {Math.round(first.durationMs)} ms
          </dd>
          {first.error ? (
            <>
              <dt className="font-semibold text-muted-foreground">
                {t("browserDiagnostics.error")}
              </dt>
              <dd className="m-0 whitespace-pre-wrap break-words font-mono">
                {first.error}
              </dd>
            </>
          ) : null}
          <div className="col-span-2">
            <OccurrenceTimes
              elapsedTimes={group.entries.map((entry) => entry.elapsedMs)}
              durationMs={durationMs}
              onSeek={onSeek}
            />
          </div>
        </dl>
      </AccordionContent>
    </AccordionItem>
  );
}

function BrowserDiagnosticsSection({
  view,
  label,
  count,
  groups,
  durationMs,
  onSeek,
}: {
  view: BrowserDiagnosticsView;
  label: string;
  count: number;
  groups: BrowserDiagnosticGroup[];
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  return (
    <AccordionItem
      value={view}
      className="border-border/70"
      data-browser-diagnostics-section={view}
    >
      <AccordionTrigger className="min-h-10 px-4 py-2 text-xs hover:no-underline [&>svg]:size-3.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{label}</span>
          <span className="rounded-md border border-border px-1.5 py-px font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        {groups.length ? (
          <Accordion
            type="multiple"
            className="ps-4"
            data-browser-diagnostics-items
          >
            {groups.map((group) =>
              group.kind === "console" ? (
                <ConsoleGroupRow
                  key={group.id}
                  group={group}
                  durationMs={durationMs}
                  onSeek={onSeek}
                />
              ) : (
                <NetworkGroupRow
                  key={group.id}
                  group={group}
                  durationMs={durationMs}
                  onSeek={onSeek}
                />
              ),
            )}
          </Accordion>
        ) : (
          <DiagnosticsEmptyState view={view} captured />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function DiagnosticsEmptyState({
  view,
  captured,
}: {
  view: BrowserDiagnosticsView;
  captured: boolean;
}) {
  const t = useT();
  const title =
    view === "issues"
      ? t("browserDiagnostics.noIssuesTitle")
      : view === "console"
        ? t("browserDiagnostics.noConsoleTitle")
        : t("browserDiagnostics.noNetworkTitle");
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-8 text-center">
      <span className="mb-3 grid size-9 place-items-center rounded-full border border-border text-muted-foreground">
        {view === "issues" ? (
          <IconCircleCheck className="size-4" aria-hidden="true" />
        ) : (
          <IconInfoCircle className="size-4" aria-hidden="true" />
        )}
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {captured ? (
        <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
          {t("browserDiagnostics.capturedDescription")}
        </p>
      ) : null}
    </div>
  );
}

export function BrowserDiagnosticsPanel({
  diagnostics,
  durationMs,
  onSeek,
}: {
  diagnostics: BrowserDiagnosticsData;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const groupsByView = useMemo(
    () => ({
      issues: buildBrowserDiagnosticGroups(diagnostics, "issues"),
      console: buildBrowserDiagnosticGroups(diagnostics, "console"),
      network: buildBrowserDiagnosticGroups(diagnostics, "network"),
    }),
    [diagnostics],
  );
  const source = captureSource(diagnostics);
  const hasFailures =
    diagnostics.summary.consoleErrorCount > 0 ||
    diagnostics.summary.consoleWarnCount > 0 ||
    diagnostics.summary.networkFailureCount > 0;

  const sections: Array<{
    id: BrowserDiagnosticsView;
    label: string;
    count: number;
  }> = [
    {
      id: "issues",
      label: t("browserDiagnostics.issues"),
      count:
        diagnostics.summary.consoleErrorCount +
        diagnostics.summary.consoleWarnCount +
        diagnostics.summary.networkFailureCount,
    },
    {
      id: "console",
      label: t("browserDiagnostics.consoleSource"),
      count: diagnostics.summary.consoleCount,
    },
    {
      id: "network",
      label: t("browserDiagnostics.networkSource"),
      count: diagnostics.summary.networkCount,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-browser-diagnostics>
      <div className="shrink-0 border-b border-border/70 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <IconBug className="size-4" aria-hidden="true" />
              {t("browserDiagnostics.title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasFailures
                ? t("browserDiagnostics.failureSummary", {
                    consoleCount:
                      diagnostics.summary.consoleErrorCount +
                      diagnostics.summary.consoleWarnCount,
                    networkCount: diagnostics.summary.networkFailureCount,
                  })
                : t("browserDiagnostics.noFailures")}
            </p>
          </div>
          <span
            className={cn(
              "mt-1 size-2 shrink-0 rounded-full",
              hasFailures ? "bg-destructive" : "bg-success",
            )}
            role="img"
            aria-label={
              hasFailures
                ? t("browserDiagnostics.failuresPresent")
                : t("browserDiagnostics.captureSuccessful")
            }
          />
        </div>
        <p className="mt-3 truncate text-[11px] text-muted-foreground">
          {source
            ? t("browserDiagnostics.capturedFrom", { source })
            : t("browserDiagnostics.browserCapture")}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Accordion type="single" defaultValue="issues" collapsible>
          {sections.map((section) => (
            <BrowserDiagnosticsSection
              key={section.id}
              view={section.id}
              label={section.label}
              count={section.count}
              groups={groupsByView[section.id]}
              durationMs={durationMs}
              onSeek={onSeek}
            />
          ))}
        </Accordion>
      </div>
    </div>
  );
}
