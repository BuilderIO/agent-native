import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@agent-native/toolkit/ui/sheet";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleX,
  IconInfoCircle,
  IconPigMoney,
  IconThumbDown,
  IconThumbUp,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useT } from "../i18n.js";
import { useActionQuery } from "../use-action.js";

type T = ReturnType<typeof useT>;
type UsageScope = "me" | "workspace";

interface CostBreakdown {
  cacheReadCents: number;
  cacheWriteCents: number;
  uncachedInputCents: number;
  outputCents: number;
  totalCents: number;
  estimatedCents: number;
  noCacheCents: number;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

type RestartCause = "tool-lookup" | "prefix-changed";

interface RunTool {
  name: string;
  calls: number;
  failed: number;
  error: string | null;
}

interface RunListItem {
  runId: string;
  createdAt: number;
  model: string;
  prompt: string | null;
  status: "success" | "error" | "unknown";
  tokens: TokenTotals;
  cost: CostBreakdown;
  modelCalls: number;
  tools: RunTool[];
  restarts: {
    count: number;
    cents: number;
    byCause: Record<RestartCause, { count: number; cents: number }>;
  };
  parallel: { calls: number; savedMs: number };
  recoveredErrors: number;
  durationMs: number | null;
  feedback: "up" | "down" | null;
}

interface PeriodTotals {
  runs: number;
  tokens: TokenTotals;
  cost: CostBreakdown;
}

interface UsageInsightsData {
  sinceDays: number;
  current: PeriodTotals;
  previous: PeriodTotals;
  runs: RunListItem[];
}

interface RunTurn {
  index: number;
  model: string;
  durationMs: number;
  tokens: TokenTotals;
  cost: CostBreakdown;
  status: string;
  restart: { cause: RestartCause; cents: number } | null;
  cacheExpired: boolean;
  toolCalls: Array<{
    name: string;
    startedAt: number;
    durationMs: number;
    status: string;
    errorMessage: string | null;
  }>;
}

interface RunDetail extends RunListItem {
  reply: string | null;
  turns: RunTurn[];
  scores: Array<{
    source: "heuristic" | "judge" | "human";
    criteria: string;
    score: number;
  }>;
}

// Apps don't share chart tokens, and this set is checked for colour-blind separation in both themes.
const LIGHT_PALETTE =
  // guard:allow-raw-color — validated categorical palette, light surface
  "--usage-cache-read: #2a78d6; --usage-cache-write: #eb6834; --usage-fresh-input: #1baf7a; --usage-output: #eda100;";
const DARK_PALETTE =
  // guard:allow-raw-color — same palette stepped for the dark surface
  "--usage-cache-read: #3987e5; --usage-cache-write: #d95926; --usage-fresh-input: #199e70; --usage-output: #c98500;";
const PALETTE_CSS = `.usage-insights, .usage-insights-panel { ${LIGHT_PALETTE} } .dark .usage-insights, .dark .usage-insights-panel { ${DARK_PALETTE} }`;

const WRITE_VERBS = new Set([
  "add",
  "apply",
  "create",
  "delete",
  "duplicate",
  "edit",
  "export",
  "generate",
  "insert",
  "move",
  "remove",
  "rename",
  "save",
  "send",
  "set",
  "update",
  "upload",
  "write",
]);

function verbLabel(t: T, verb: string, object: string): string | null {
  const labels: Record<string, () => string> = {
    add: () => t("agentChat.usage.insights.toolVerb.add", { object }),
    analyze: () => t("agentChat.usage.insights.toolVerb.analyze", { object }),
    apply: () => t("agentChat.usage.insights.toolVerb.apply", { object }),
    capture: () => t("agentChat.usage.insights.toolVerb.capture", { object }),
    check: () => t("agentChat.usage.insights.toolVerb.check", { object }),
    connect: () => t("agentChat.usage.insights.toolVerb.connect", { object }),
    consume: () => t("agentChat.usage.insights.toolVerb.read", { object }),
    create: () => t("agentChat.usage.insights.toolVerb.create", { object }),
    delete: () => t("agentChat.usage.insights.toolVerb.delete", { object }),
    duplicate: () =>
      t("agentChat.usage.insights.toolVerb.duplicate", { object }),
    edit: () => t("agentChat.usage.insights.toolVerb.edit", { object }),
    export: () => t("agentChat.usage.insights.toolVerb.export", { object }),
    fetch: () => t("agentChat.usage.insights.toolVerb.fetch", { object }),
    find: () => t("agentChat.usage.insights.toolVerb.find", { object }),
    generate: () => t("agentChat.usage.insights.toolVerb.generate", { object }),
    get: () => t("agentChat.usage.insights.toolVerb.read", { object }),
    index: () => t("agentChat.usage.insights.toolVerb.index", { object }),
    insert: () => t("agentChat.usage.insights.toolVerb.insert", { object }),
    list: () => t("agentChat.usage.insights.toolVerb.list", { object }),
    move: () => t("agentChat.usage.insights.toolVerb.move", { object }),
    navigate: () => t("agentChat.usage.insights.toolVerb.navigate", { object }),
    open: () => t("agentChat.usage.insights.toolVerb.open", { object }),
    present: () => t("agentChat.usage.insights.toolVerb.present", { object }),
    propose: () => t("agentChat.usage.insights.toolVerb.propose", { object }),
    query: () => t("agentChat.usage.insights.toolVerb.query", { object }),
    read: () => t("agentChat.usage.insights.toolVerb.read", { object }),
    remove: () => t("agentChat.usage.insights.toolVerb.remove", { object }),
    rename: () => t("agentChat.usage.insights.toolVerb.rename", { object }),
    reply: () => t("agentChat.usage.insights.toolVerb.reply", { object }),
    resolve: () => t("agentChat.usage.insights.toolVerb.resolve", { object }),
    run: () => t("agentChat.usage.insights.toolVerb.run", { object }),
    save: () => t("agentChat.usage.insights.toolVerb.save", { object }),
    search: () => t("agentChat.usage.insights.toolVerb.search", { object }),
    send: () => t("agentChat.usage.insights.toolVerb.send", { object }),
    set: () => t("agentChat.usage.insights.toolVerb.set", { object }),
    take: () => t("agentChat.usage.insights.toolVerb.take", { object }),
    update: () => t("agentChat.usage.insights.toolVerb.update", { object }),
    upload: () => t("agentChat.usage.insights.toolVerb.upload", { object }),
    view: () => t("agentChat.usage.insights.toolVerb.view", { object }),
    write: () => t("agentChat.usage.insights.toolVerb.write", { object }),
  };
  return labels[verb]?.() ?? null;
}

function toolWords(name: string): string[] {
  return name
    .replace(/^mcp__[^_]+__/, "")
    .split(/[-_]/)
    .filter(Boolean);
}

function toolVerb(name: string): string | null {
  const words = toolWords(name);
  if (WRITE_VERBS.has(words[0]!) || READ_VERBS.has(words[0]!)) return words[0]!;
  const last = words.at(-1)!;
  if (WRITE_VERBS.has(last) || READ_VERBS.has(last)) return last;
  return null;
}

const READ_VERBS = new Set([
  "analyze",
  "capture",
  "check",
  "connect",
  "consume",
  "fetch",
  "find",
  "get",
  "index",
  "list",
  "navigate",
  "open",
  "present",
  "propose",
  "query",
  "read",
  "reply",
  "resolve",
  "run",
  "search",
  "take",
  "view",
]);

/** "edit-design" → "Edited design", "docs-search" → "Searched docs". */
function humanizeTool(t: T, name: string): string {
  if (name === "tool-search") {
    return t("agentChat.usage.insights.lookedForTools");
  }
  const words = toolWords(name);
  const verb = toolVerb(name);
  if (!verb) return words.join(" ");
  const object = (words[0] === verb ? words.slice(1) : words.slice(0, -1)).join(
    " ",
  );
  return verbLabel(t, verb, object) ?? words.join(" ");
}

function toolNoun(name: string): string {
  return toolWords(name).join(" ");
}

function listTools(
  t: T,
  tools: Array<{ name: string; calls: number }>,
): string {
  return tools
    .map((tool) =>
      tool.calls > 1
        ? t("agentChat.usage.insights.timesCount", {
            label: humanizeTool(t, tool.name),
            count: tool.calls,
          })
        : humanizeTool(t, tool.name),
    )
    .join(", ");
}

function outcomeLine(t: T, tools: RunTool[]): string | null {
  const writes = tools.filter(
    (tool) =>
      WRITE_VERBS.has(toolVerb(tool.name) ?? "") && tool.calls > tool.failed,
  );
  if (writes.length === 0) return null;
  return listTools(t, writes.slice(0, 4));
}

function turnLabel(t: T, turn: RunTurn, isLast: boolean): string {
  if (turn.toolCalls.length === 0) {
    return isLast
      ? t("agentChat.usage.insights.turnReply")
      : t("agentChat.usage.insights.turnThought");
  }
  const counts = new Map<string, number>();
  for (const call of turn.toolCalls) {
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  return listTools(
    t,
    [...counts].map(([name, calls]) => ({ name, calls })),
  );
}

function formatUsd(cents: number): string {
  if (cents <= 0) return "$0";
  if (cents < 1) return "<1¢";
  if (cents < 100) return `${Math.round(cents)}¢`;
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Restarts worth mentioning: at least 10% of what the prompt cost. */
function notableRestart(run: RunListItem): boolean {
  return (
    run.restarts.cents > 0 &&
    run.restarts.cents >= run.cost.estimatedCents * 0.1
  );
}

function failedTools(run: RunListItem): RunTool[] {
  return run.tools.filter((tool) => tool.failed > 0);
}

function mainRestartCause(run: RunListItem): RestartCause {
  const { byCause } = run.restarts;
  return byCause["tool-lookup"].cents >= byCause["prefix-changed"].cents
    ? "tool-lookup"
    : "prefix-changed";
}

function restartReason(t: T, cause: RestartCause): string {
  return cause === "tool-lookup"
    ? t("agentChat.usage.insights.reasonToolLookup")
    : t("agentChat.usage.insights.reasonPrefixChanged");
}

function restartFix(t: T, cause: RestartCause): string {
  return cause === "tool-lookup"
    ? t("agentChat.usage.insights.fixToolLookup")
    : t("agentChat.usage.insights.fixPrefixChanged");
}

type InsightKind = "problem" | "saving" | "info";

interface Insight {
  key: string;
  kind: InsightKind;
  title: string;
  body: string;
  fix?: string;
  runIds: string[];
}

function buildInsights(t: T, runs: RunListItem[]): Insight[] {
  const total = runs.reduce((sum, run) => sum + run.cost.estimatedCents, 0);
  const insights: Insight[] = [];

  const errored = runs.filter((run) => run.status === "error");
  if (errored.length > 0) {
    insights.push({
      key: "errored",
      kind: "problem",
      title: t("agentChat.usage.insights.erroredTitle", {
        count: errored.length,
      }),
      body: t("agentChat.usage.insights.erroredBody"),
      fix: t("agentChat.usage.insights.erroredFix"),
      runIds: errored.map((run) => run.runId),
    });
  }

  const toolFailures = new Map<
    string,
    { error: string | null; runIds: string[] }
  >();
  for (const run of runs) {
    for (const tool of failedTools(run)) {
      const entry = toolFailures.get(tool.name) ?? {
        error: tool.error,
        runIds: [],
      };
      entry.runIds.push(run.runId);
      toolFailures.set(tool.name, entry);
    }
  }
  const [worstTool] = [...toolFailures].sort(
    (a, b) => b[1].runIds.length - a[1].runIds.length,
  );
  if (worstTool) {
    const [name, { error, runIds }] = worstTool;
    const recovered = runs.filter(
      (run) => runIds.includes(run.runId) && run.status === "success",
    ).length;
    const said = error
      ? t("agentChat.usage.insights.toolFailedSaid", {
          error: error.length > 180 ? `${error.slice(0, 179)}…` : error,
        })
      : t("agentChat.usage.insights.toolFailedGeneric");
    const recovery =
      recovered === 0
        ? ""
        : recovered === runIds.length
          ? t("agentChat.usage.insights.toolRecoveredAll")
          : t("agentChat.usage.insights.toolRecoveredSome", {
              count: recovered,
            });
    insights.push({
      key: `tool-${name}`,
      kind: "problem",
      title: t("agentChat.usage.insights.toolFailedTitle", {
        tool: toolNoun(name),
        count: runIds.length,
      }),
      body: recovery ? `${said} ${recovery}` : said,
      runIds,
    });
  }

  for (const cause of ["tool-lookup", "prefix-changed"] as const) {
    const affected = runs.filter(
      (run) => run.restarts.byCause[cause].cents > 0,
    );
    const cents = affected.reduce(
      (sum, run) => sum + run.restarts.byCause[cause].cents,
      0,
    );
    if (cents >= Math.max(5, total * 0.1)) {
      insights.push({
        key: `restart-${cause}`,
        kind: "saving",
        title: t("agentChat.usage.insights.restartTitle", {
          amount: formatUsd(cents),
          percent: percent(cents, total),
        }),
        body: t("agentChat.usage.insights.restartBody", {
          count: affected.length,
          total: runs.length,
          reason: restartReason(t, cause),
        }),
        fix: restartFix(t, cause),
        runIds: affected.map((run) => run.runId),
      });
    }
  }

  const spend = runs.reduce((sum, run) => sum + run.cost.totalCents, 0);
  const priciest = [...runs].sort(
    (a, b) => b.cost.totalCents - a.cost.totalCents,
  )[0];
  if (
    runs.length >= 3 &&
    priciest &&
    spend >= 50 &&
    priciest.cost.totalCents > spend * 0.4
  ) {
    insights.push({
      key: "priciest",
      kind: "info",
      title: t("agentChat.usage.insights.priciestTitle", {
        percent: percent(priciest.cost.totalCents, spend),
      }),
      body: t("agentChat.usage.insights.priciestBody", {
        prompt: priciest.prompt ?? t("agentChat.usage.insights.untitledPrompt"),
        amount: formatUsd(priciest.cost.totalCents),
        count: priciest.modelCalls,
      }),
      runIds: [priciest.runId],
    });
  }

  return insights.slice(0, 3);
}

function InsightCard({
  insight,
  onShow,
}: {
  insight: Insight;
  onShow: () => void;
}) {
  const t = useT();
  const style: Record<
    InsightKind,
    { icon: ReactNode; label: string; className: string }
  > = {
    problem: {
      icon: (
        <IconAlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      ),
      label: t("agentChat.usage.insights.kindProblem"),
      className: "border-amber-500/30",
    },
    saving: {
      icon: (
        <IconPigMoney className="size-4 text-emerald-600 dark:text-emerald-400" />
      ),
      label: t("agentChat.usage.insights.kindSaving"),
      className: "border-emerald-500/30",
    },
    info: {
      icon: <IconInfoCircle className="size-4 text-muted-foreground" />,
      label: t("agentChat.usage.insights.kindInfo"),
      className: "border-border/70",
    },
  };
  const kind = style[insight.kind];
  return (
    <div className={`rounded-lg border bg-card p-4 ${kind.className}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {kind.icon}
        {kind.label}
      </div>
      <h4 className="mt-1.5 text-sm font-semibold leading-5 text-foreground">
        {insight.title}
      </h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {insight.body}
      </p>
      {insight.fix ? (
        <p className="mt-1.5 text-xs leading-5 text-foreground/90">
          <span className="font-medium">
            {t("agentChat.usage.insights.fixLabel")}{" "}
          </span>
          {insight.fix}
        </p>
      ) : null}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mt-1 h-auto p-0 text-xs"
        onClick={onShow}
      >
        {insight.runIds.length === 1
          ? t("agentChat.usage.insights.openPrompt")
          : t("agentChat.usage.insights.seePrompts", {
              count: insight.runIds.length,
            })}
      </Button>
    </div>
  );
}

function RunRow({ run, onOpen }: { run: RunListItem; onOpen: () => void }) {
  const t = useT();
  const outcome = outcomeLine(t, run.tools);
  const failures = failedTools(run);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-foreground">
            {run.prompt ?? t("agentChat.usage.insights.promptNotSaved")}
          </span>
          {run.feedback === "up" ? (
            <IconThumbUp
              aria-label={t("agentChat.usage.insights.ratedHelpful")}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : run.feedback === "down" ? (
            <IconThumbDown
              aria-label={t("agentChat.usage.insights.ratedUnhelpful")}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {run.status === "error" ? (
            <span className="flex min-w-0 items-center gap-1 text-destructive">
              <IconCircleX aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("agentChat.usage.insights.stoppedWithError")}
              </span>
            </span>
          ) : run.status === "unknown" ? (
            <span className="truncate">
              {t("agentChat.usage.insights.detailsUnavailable")}
            </span>
          ) : (
            <span className="truncate">
              → {outcome ?? t("agentChat.usage.insights.answered")}
            </span>
          )}
          {notableRestart(run) ? (
            <span className="shrink-0 text-amber-700 dark:text-amber-400">
              ·{" "}
              {t("agentChat.usage.insights.startedOverShort", {
                count: run.restarts.count,
              })}
            </span>
          ) : run.recoveredErrors > 0 ? (
            <span className="shrink-0">
              ·{" "}
              {t("agentChat.usage.insights.recoveredShort", {
                count: run.recoveredErrors,
              })}
            </span>
          ) : failures.length > 0 ? (
            <span className="shrink-0 text-amber-700 dark:text-amber-400">
              ·{" "}
              {t("agentChat.usage.insights.toolsFailedShort", {
                count: failures.length,
              })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium tabular-nums text-foreground">
          {formatUsd(run.cost.totalCents)}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {run.durationMs
            ? formatDuration(run.durationMs)
            : formatTime(run.createdAt)}
        </div>
      </div>
    </button>
  );
}

function CostDetails({ run }: { run: RunDetail }) {
  const t = useT();
  const parts = [
    {
      label: t("agentChat.usage.insights.partReused"),
      cents: run.cost.cacheReadCents,
      tokens: run.tokens.cacheReadTokens,
      color: "var(--usage-cache-read)",
    },
    {
      label: t("agentChat.usage.insights.partSaved"),
      cents: run.cost.cacheWriteCents,
      tokens: run.tokens.cacheWriteTokens,
      color: "var(--usage-cache-write)",
    },
    {
      label: t("agentChat.usage.insights.partNew"),
      cents: run.cost.uncachedInputCents,
      tokens: Math.max(
        0,
        run.tokens.inputTokens -
          run.tokens.cacheReadTokens -
          run.tokens.cacheWriteTokens,
      ),
      color: "var(--usage-fresh-input)",
    },
    {
      label: t("agentChat.usage.insights.partOutput"),
      cents: run.cost.outputCents,
      tokens: run.tokens.outputTokens,
      color: "var(--usage-output)",
    },
  ];
  const checks = run.scores.filter((score) => score.source === "heuristic");
  const judged = run.scores.filter((score) => score.source === "judge");
  const estimated = run.cost.estimatedCents;
  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className="text-muted-foreground">
          {t("agentChat.usage.insights.noCacheCompare", {
            noCache: formatUsd(run.cost.noCacheCents),
            estimated: formatUsd(estimated),
          })}
        </p>
        <div className="mt-2 flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
          {parts.map((part) =>
            part.cents > 0 && estimated > 0 ? (
              <div
                key={part.label}
                style={{
                  width: `${(part.cents / estimated) * 100}%`,
                  minWidth: 3,
                  background: part.color,
                }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {parts.map((part) => (
            <div key={part.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: part.color }}
              />
              <span className="text-muted-foreground">{part.label}</span>
              <span className="ml-auto tabular-nums text-foreground">
                {formatUsd(part.cents)}
              </span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">
                {compactTokens(part.tokens)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="font-medium text-foreground">
          {t("agentChat.usage.insights.checksHeading")}
        </div>
        {judged.length === 0 && checks.length === 0 ? (
          <p className="mt-1 text-muted-foreground">
            {t("agentChat.usage.insights.checksNone")}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {[...judged, ...checks].map((score) => (
              <li key={score.criteria} className="flex justify-between gap-4">
                <span>
                  {score.criteria.replaceAll("_", " ")}
                  {score.source === "judge"
                    ? ` ${t("agentChat.usage.insights.checksGraded")}`
                    : ""}
                </span>
                <span className="tabular-nums">
                  {Math.round(score.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("agentChat.usage.insights.checksNote")}
        </p>
      </div>
    </div>
  );
}

function StepList({ turns }: { turns: RunTurn[] }) {
  const t = useT();
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  return (
    <ol className="mt-2 divide-y divide-border/50 rounded-lg border border-border/70">
      {turns.map((turn, index) => {
        const open = openTurn === turn.index;
        const failed = turn.toolCalls.some((call) => call.status === "error");
        return (
          <li key={turn.index}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent/40"
              onClick={() => setOpenTurn(open ? null : turn.index)}
              aria-expanded={open}
            >
              <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                {turn.index}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {turnLabel(t, turn, index === turns.length - 1)}
              </span>
              {turn.restart ? (
                <span className="shrink-0 text-amber-700 dark:text-amber-400">
                  {t("agentChat.usage.insights.startedOverTag")}
                </span>
              ) : null}
              {failed ? (
                <span className="shrink-0 text-destructive">
                  {t("agentChat.usage.insights.toolFailedTag")}
                </span>
              ) : null}
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatDuration(turn.durationMs)}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-foreground">
                {formatUsd(turn.cost.estimatedCents)}
              </span>
            </button>
            {open ? (
              <div className="space-y-1.5 bg-muted/30 px-3 py-2.5 pl-11 text-xs text-muted-foreground">
                <p>
                  {t("agentChat.usage.insights.turnContext", {
                    tokens: compactTokens(turn.tokens.inputTokens),
                    percent: percent(
                      turn.tokens.cacheReadTokens,
                      turn.tokens.inputTokens,
                    ),
                  })}{" "}
                  {turn.cacheExpired
                    ? `${t("agentChat.usage.insights.turnExpired")} `
                    : ""}
                  {t("agentChat.usage.insights.turnOutput", {
                    tokens: compactTokens(turn.tokens.outputTokens),
                  })}
                </p>
                {turn.restart ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    {t("agentChat.usage.insights.turnRestart", {
                      reason: restartReason(t, turn.restart.cause),
                      amount: formatUsd(turn.restart.cents),
                    })}
                  </p>
                ) : null}
                {turn.toolCalls.map((call, callIndex) => (
                  <p
                    key={callIndex}
                    className={
                      call.status === "error" ? "text-destructive" : ""
                    }
                  >
                    {humanizeTool(t, call.name)} ·{" "}
                    {formatDuration(call.durationMs)}
                    {call.status === "error" && call.errorMessage
                      ? ` · ${call.errorMessage}`
                      : ""}
                  </p>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Expandable({
  text,
  lines,
  limit,
}: {
  text: string;
  lines: "line-clamp-4" | "line-clamp-6";
  limit: number;
}) {
  const t = useT();
  const [full, setFull] = useState(false);
  return (
    <>
      <p className={`whitespace-pre-wrap ${full ? "" : lines}`}>{text}</p>
      {text.length > limit ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setFull((value) => !value)}
        >
          {full
            ? t("agentChat.usage.insights.showLess")
            : t("agentChat.usage.insights.showAll")}
        </button>
      ) : null}
    </>
  );
}

function handledText(
  t: T,
  parallel: { calls: number; savedMs: number },
  recovered: number,
): string[] {
  const lines: string[] = [];
  if (parallel.savedMs >= 1000) {
    lines.push(
      t("agentChat.usage.insights.handledParallel", {
        count: parallel.calls,
        duration: formatDuration(parallel.savedMs),
      }),
    );
  }
  if (recovered > 0) {
    lines.push(
      t("agentChat.usage.insights.handledRecovered", { count: recovered }),
    );
  }
  return lines;
}

function HandledNote({ run }: { run: RunListItem }) {
  const t = useT();
  const lines = handledText(t, run.parallel, run.recoveredErrors);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-xs leading-5">
      <p className="font-medium text-foreground">
        {t("agentChat.usage.insights.handledHeading")}
      </p>
      <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function RunPanel({
  run,
  scope,
  userEmail,
  appId,
}: {
  run: RunListItem;
  scope: UsageScope;
  userEmail?: string;
  appId?: string;
}) {
  const t = useT();
  const query = useActionQuery<RunDetail | null>("get-usage-run", {
    runId: run.runId,
    scope,
    userEmail,
    appId,
  });
  const [showSteps, setShowSteps] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const detail = query.data;
  const failures = failedTools(run);
  const outcome = outcomeLine(t, run.tools);
  const cause = mainRestartCause(run);
  const headline =
    run.status === "error"
      ? t("agentChat.usage.insights.stoppedWithError")
      : run.status === "unknown"
        ? t("agentChat.usage.insights.detailsUnavailable")
        : t("agentChat.usage.insights.finished");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 px-5 pb-4 pt-5">
        <div className="flex items-center gap-2 pr-20">
          {run.status === "error" ? (
            <IconCircleX className="size-4 shrink-0 text-destructive" />
          ) : run.status === "unknown" ? (
            <IconInfoCircle className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconCircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <SheetTitle className="text-sm font-medium">
            {headline}
            {run.durationMs
              ? ` ${t("agentChat.usage.insights.headerDuration", {
                  duration: formatDuration(run.durationMs),
                })}`
              : ""}{" "}
            ·{" "}
            {t("agentChat.usage.insights.stepsCount", {
              count: run.modelCalls,
            })}{" "}
            · {formatUsd(run.cost.totalCents)}
          </SheetTitle>
        </div>
        <SheetDescription className="mt-1 text-xs">
          {formatTime(run.createdAt)} · {run.model} ·{" "}
          {run.feedback === "up"
            ? t("agentChat.usage.insights.ratedHelpful")
            : run.feedback === "down"
              ? t("agentChat.usage.insights.ratedUnhelpful")
              : t("agentChat.usage.insights.notRated")}
        </SheetDescription>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-sm leading-6">
            <Expandable
              text={run.prompt ?? t("agentChat.usage.insights.promptNotSaved")}
              lines="line-clamp-4"
              limit={240}
            />
          </div>
          <div className="max-w-[92%] space-y-2">
            {outcome ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("agentChat.usage.insights.whatItDid")}{" "}
                </span>
                {outcome}
              </p>
            ) : null}
            {query.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : detail?.reply ? (
              <div className="rounded-2xl rounded-bl-md border border-border/70 px-3.5 py-2.5 text-sm leading-6">
                <Expandable
                  text={detail.reply}
                  lines="line-clamp-6"
                  limit={400}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("agentChat.usage.insights.replyNotSaved")}
              </p>
            )}
            {run.tools.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {run.tools.slice(0, 8).map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => setShowSteps(true)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${tool.failed ? "border-destructive/40 text-destructive" : "border-border/70 text-muted-foreground hover:text-foreground"}`}
                  >
                    {tool.calls > 1
                      ? t("agentChat.usage.insights.timesCount", {
                          label: humanizeTool(t, tool.name),
                          count: tool.calls,
                        })
                      : humanizeTool(t, tool.name)}
                    {tool.failed
                      ? ` · ${t("agentChat.usage.insights.failedSuffix")}`
                      : ""}
                  </button>
                ))}
                {run.tools.length > 8 ? (
                  <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                    {t("agentChat.usage.insights.moreTools", {
                      count: run.tools.length - 8,
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <HandledNote run={run} />

        {notableRestart(run) || failures.length > 0 ? (
          <div className="space-y-2">
            {notableRestart(run) ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-xs leading-5">
                <p className="text-foreground">
                  {t("agentChat.usage.insights.startedOverNote", {
                    count: run.restarts.count,
                    reason: restartReason(t, cause),
                    amount: formatUsd(run.restarts.cents),
                    total: formatUsd(run.cost.estimatedCents),
                  })}
                </p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium text-foreground/90">
                    {t("agentChat.usage.insights.fixLabel")}{" "}
                  </span>
                  {restartFix(t, cause)}
                </p>
              </div>
            ) : null}
            {failures.slice(0, 1).map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-xs leading-5"
              >
                <p className="text-foreground">
                  {run.status === "success"
                    ? t("agentChat.usage.insights.toolFailedRecoveredNote", {
                        tool: toolNoun(tool.name),
                        count: tool.failed,
                      })
                    : t("agentChat.usage.insights.toolFailedNote", {
                        tool: toolNoun(tool.name),
                        count: tool.failed,
                      })}
                </p>
                {tool.error ? (
                  <p className="mt-1 text-muted-foreground">{tool.error}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {run.status !== "unknown" ? (
          <section>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium text-foreground"
              onClick={() => setShowSteps((value) => !value)}
              aria-expanded={showSteps}
            >
              <IconChevronDown
                className={`size-3.5 transition-transform ${showSteps ? "rotate-180" : ""}`}
              />
              {showSteps
                ? t("agentChat.usage.insights.hideSteps")
                : t("agentChat.usage.insights.showSteps", {
                    count: run.modelCalls,
                  })}
            </button>
            {showSteps ? (
              detail ? (
                <StepList turns={detail.turns} />
              ) : (
                <Skeleton className="mt-2 h-24 w-full" />
              )
            ) : null}
          </section>
        ) : null}

        <section>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-foreground"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
          >
            <IconChevronDown
              className={`size-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
            />
            {t("agentChat.usage.insights.costDetails")}
          </button>
          {showDetails && detail ? (
            <div className="mt-3">
              <CostDetails run={detail} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {detail ? (
        <div className="text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function changeText(
  t: T,
  current: number,
  previous: number,
): string | undefined {
  if (previous <= 0) return undefined;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return t("agentChat.usage.insights.changeSame");
  return change > 0
    ? t("agentChat.usage.insights.changeUp", { percent: change })
    : t("agentChat.usage.insights.changeDown", { percent: -change });
}

export function UsageInsightsSection({
  sinceDays,
  scope,
  userEmail,
  appId,
}: {
  sinceDays: number;
  scope: UsageScope;
  userEmail?: string;
  appId?: string;
}) {
  const t = useT();
  const query = useActionQuery<UsageInsightsData>("get-usage-insights", {
    sinceDays,
    scope,
    userEmail,
    appId,
  });
  const data = query.data;
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const insights = useMemo(() => buildInsights(t, runs), [t, runs]);
  const [sort, setSort] = useState<"newest" | "cost">("newest");
  const [onlyRunIds, setOnlyRunIds] = useState<string[] | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const filtered = onlyRunIds
      ? runs.filter((run) => onlyRunIds.includes(run.runId))
      : runs;
    return sort === "cost"
      ? [...filtered].sort((a, b) => b.cost.totalCents - a.cost.totalCents)
      : filtered;
  }, [runs, onlyRunIds, sort]);
  const openIndex = visible.findIndex((run) => run.runId === openRunId);
  const openRun = openIndex >= 0 ? visible[openIndex]! : null;
  const openAt = (index: number) => {
    const run = visible[index];
    if (run) setOpenRunId(run.runId);
  };

  useEffect(() => {
    if (!openRun) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable=true]")
      ) {
        return;
      }
      if (event.key === "j") openAt(openIndex + 1);
      else if (event.key === "k") openAt(openIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) {
    return (
      <div className="space-y-3 pt-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const { current, previous } = data;
  const avgCents = current.runs ? current.cost.totalCents / current.runs : 0;
  const previousAvg = previous.runs
    ? previous.cost.totalCents / previous.runs
    : 0;
  const known = runs.filter((run) => run.status !== "unknown");
  const completed = known.filter((run) => run.status === "success").length;
  const recovered = runs.reduce((sum, run) => sum + run.recoveredErrors, 0);
  const handled = handledText(
    t,
    {
      calls: runs.reduce((sum, run) => sum + run.parallel.calls, 0),
      savedMs: runs.reduce((sum, run) => sum + run.parallel.savedMs, 0),
    },
    recovered,
  );
  const typical = median(
    runs.map((run) => run.durationMs ?? 0).filter(Boolean),
  );
  const problems = insights.filter(
    (insight) => insight.kind === "problem",
  ).length;

  return (
    <div className="usage-insights space-y-4 pt-2">
      <style>{PALETTE_CSS}</style>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {insights.length === 0 ? (
            <>
              <IconCircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
              {t("agentChat.usage.insights.verdictSmooth")}
            </>
          ) : (
            <>
              <IconAlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              {t("agentChat.usage.insights.verdictLook", {
                count: insights.length,
              })}
              {problems
                ? ` · ${t("agentChat.usage.insights.verdictProblems", {
                    count: problems,
                  })}`
                : ""}
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("agentChat.usage.insights.spentSummary", {
            amount: formatUsd(current.cost.totalCents),
            count: current.runs,
            days: sinceDays,
          })}
        </p>
        {handled.length > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-medium text-foreground">
                {t("agentChat.usage.insights.handledLabel")}{" "}
              </span>
              {handled.join(" ")}
            </span>
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
          <Stat
            label={t("agentChat.usage.insights.avgPerPrompt")}
            value={formatUsd(avgCents)}
            detail={changeText(t, avgCents, previousAvg)}
          />
          <Stat
            label={t("agentChat.usage.insights.completed")}
            value={known.length ? `${percent(completed, known.length)}%` : "—"}
            detail={
              known.length
                ? recovered
                  ? t("agentChat.usage.insights.completedRecovered", {
                      done: completed,
                      total: known.length,
                      count: recovered,
                    })
                  : t("agentChat.usage.insights.completedDetail", {
                      done: completed,
                      total: known.length,
                    })
                : undefined
            }
          />
          <Stat
            label={t("agentChat.usage.insights.typicalTime")}
            value={typical ? formatDuration(typical) : "—"}
            detail={t("agentChat.usage.insights.median")}
          />
        </div>
      </section>

      {insights.length > 0 ? (
        <div
          className={`grid gap-3 ${insights.length > 1 ? "md:grid-cols-2" : ""} ${insights.length > 2 ? "xl:grid-cols-3" : ""}`}
        >
          {insights.map((insight) => (
            <InsightCard
              key={insight.key}
              insight={insight}
              onShow={() =>
                insight.runIds.length === 1
                  ? setOpenRunId(insight.runIds[0]!)
                  : setOnlyRunIds(insight.runIds)
              }
            />
          ))}
        </div>
      ) : null}

      <section className="rounded-lg border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("agentChat.usage.insights.promptsHeading")}
            </h3>
            {onlyRunIds ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setOnlyRunIds(null)}
              >
                {t("agentChat.usage.insights.showing", {
                  count: onlyRunIds.length,
                })}{" "}
                <IconX className="size-3" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center rounded-md border border-border/70 p-0.5">
            {(["newest", "cost"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={sort === value ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
              >
                {value === "newest"
                  ? t("agentChat.usage.insights.sortNewest")
                  : t("agentChat.usage.insights.sortCost")}
              </Button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="border-t border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("agentChat.usage.insights.emptyPrompts")}
          </p>
        ) : (
          <div className="divide-y divide-border/60 border-t border-border/70">
            {visible.map((run) => (
              <RunRow
                key={run.runId}
                run={run}
                onOpen={() => setOpenRunId(run.runId)}
              />
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(openRun)}
        onOpenChange={(open) => {
          if (!open) setOpenRunId(null);
        }}
      >
        <SheetContent className="usage-insights-panel w-full gap-0 p-0 sm:max-w-[640px]">
          {openRun ? (
            <>
              <div className="absolute end-12 top-4 flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={openIndex <= 0}
                  onClick={() => openAt(openIndex - 1)}
                  aria-label={t("agentChat.usage.insights.prevPrompt")}
                  title={t("agentChat.usage.insights.prevPrompt")}
                >
                  <IconChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={openIndex >= visible.length - 1}
                  onClick={() => openAt(openIndex + 1)}
                  aria-label={t("agentChat.usage.insights.nextPrompt")}
                  title={t("agentChat.usage.insights.nextPrompt")}
                >
                  <IconChevronDown className="size-4" />
                </Button>
              </div>
              <RunPanel
                key={openRun.runId}
                run={openRun}
                scope={scope}
                userEmail={userEmail}
                appId={appId}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
