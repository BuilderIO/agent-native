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

import { useActionQuery } from "../use-action.js";

type UsageScope = "me" | "workspace";

interface CostBreakdown {
  cacheReadCents: number;
  cacheWriteCents: number;
  uncachedInputCents: number;
  outputCents: number;
  totalCents: number;
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
  status: "success" | "error";
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

const VERB_PAST: Record<string, string> = {
  add: "added",
  analyze: "analyzed",
  apply: "applied",
  capture: "captured",
  check: "checked",
  connect: "connected",
  consume: "read",
  create: "created",
  delete: "deleted",
  duplicate: "duplicated",
  edit: "edited",
  export: "exported",
  fetch: "fetched",
  find: "found",
  generate: "generated",
  get: "read",
  index: "indexed",
  insert: "inserted",
  list: "listed",
  move: "moved",
  navigate: "navigated",
  open: "opened",
  present: "presented",
  propose: "proposed",
  query: "queried",
  read: "read",
  remove: "removed",
  rename: "renamed",
  reply: "replied to",
  resolve: "resolved",
  run: "ran",
  save: "saved",
  search: "searched",
  send: "sent",
  set: "set",
  take: "took",
  update: "updated",
  upload: "uploaded",
  view: "viewed",
  write: "wrote",
};

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

const RESTART_REASON: Record<RestartCause, string> = {
  "tool-lookup": "picking up new tools",
  "prefix-changed": "something at the start of its instructions changed",
};

const RESTART_FIX: Record<RestartCause, string> = {
  "tool-lookup":
    "Preload the tools this app uses with initialToolNames so the tool list stays the same for the whole prompt.",
  "prefix-changed":
    "Keep changing content, like timestamps or per-step state, out of the system prompt.",
};

function toolWords(name: string): string[] {
  return name
    .replace(/^mcp__[^_]+__/, "")
    .split(/[-_]/)
    .filter(Boolean);
}

function toolVerb(name: string): string | null {
  const words = toolWords(name);
  if (VERB_PAST[words[0]!]) return words[0]!;
  if (VERB_PAST[words.at(-1)!]) return words.at(-1)!;
  return null;
}

/** "edit-design" → "edited design", "docs-search" → "searched docs". */
function humanizeTool(name: string): string {
  if (name === "tool-search") return "looked for more tools";
  const words = toolWords(name);
  const verb = toolVerb(name);
  if (!verb) return words.join(" ");
  const rest = words[0] === verb ? words.slice(1) : words.slice(0, -1);
  return [VERB_PAST[verb], ...rest].join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function listTools(tools: Array<{ name: string; calls: number }>): string {
  return tools
    .map((tool) =>
      tool.calls > 1
        ? `${humanizeTool(tool.name)} ×${tool.calls}`
        : humanizeTool(tool.name),
    )
    .join(", ");
}

function outcomeLine(tools: RunTool[]): string | null {
  const writes = tools.filter(
    (tool) =>
      WRITE_VERBS.has(toolVerb(tool.name) ?? "") && tool.calls > tool.failed,
  );
  if (writes.length === 0) return null;
  return capitalize(listTools(writes.slice(0, 4)));
}

function turnLabel(turn: RunTurn, isLast: boolean): string {
  if (turn.toolCalls.length === 0) {
    return isLast ? "Wrote the reply" : "Thought it through";
  }
  const counts = new Map<string, number>();
  for (const call of turn.toolCalls) {
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  return capitalize(
    listTools([...counts].map(([name, calls]) => ({ name, calls }))),
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
    run.restarts.cents > 0 && run.restarts.cents >= run.cost.totalCents * 0.1
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

type InsightKind = "problem" | "saving" | "info";

interface Insight {
  key: string;
  kind: InsightKind;
  title: string;
  body: string;
  fix?: string;
  runIds: string[];
}

function buildInsights(runs: RunListItem[]): Insight[] {
  const total = runs.reduce((sum, run) => sum + run.cost.totalCents, 0);
  const insights: Insight[] = [];

  const errored = runs.filter((run) => run.status === "error");
  if (errored.length > 0) {
    insights.push({
      key: "errored",
      kind: "problem",
      title: `${errored.length} ${errored.length === 1 ? "prompt" : "prompts"} ended with an error`,
      body: "The agent stopped before finishing.",
      fix: "Open a prompt to see the last thing it did before it stopped.",
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
    insights.push({
      key: `tool-${name}`,
      kind: "problem",
      title: `The ${toolWords(name).join(" ")} tool failed in ${runIds.length} ${runIds.length === 1 ? "prompt" : "prompts"}`,
      body: `${
        error
          ? `It said: “${error.length > 180 ? `${error.slice(0, 179)}…` : error}”`
          : "The tool reported an error."
      }${recovered ? ` The agent recovered and finished ${recovered === runIds.length ? "every time" : `in ${recovered} of them`}.` : ""}`,
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
        title: `Starting over cost about ${formatUsd(cents)} (${percent(cents, total)}% of spend)`,
        body: `In ${affected.length} of ${runs.length} recent prompts the agent re-sent its whole conversation after ${RESTART_REASON[cause]}, instead of re-using what it had already sent.`,
        fix: RESTART_FIX[cause],
        runIds: affected.map((run) => run.runId),
      });
    }
  }

  const priciest = [...runs].sort(
    (a, b) => b.cost.totalCents - a.cost.totalCents,
  )[0];
  if (
    runs.length >= 3 &&
    priciest &&
    total >= 50 &&
    priciest.cost.totalCents > total * 0.4
  ) {
    insights.push({
      key: "priciest",
      kind: "info",
      title: `One prompt used ${percent(priciest.cost.totalCents, total)}% of recent spend`,
      body: `“${priciest.prompt ?? "Untitled prompt"}” cost ${formatUsd(priciest.cost.totalCents)} over ${priciest.modelCalls} steps.`,
      runIds: [priciest.runId],
    });
  }

  return insights.slice(0, 3);
}

const INSIGHT_STYLE: Record<
  InsightKind,
  { icon: ReactNode; label: string; className: string }
> = {
  problem: {
    icon: (
      <IconAlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
    ),
    label: "Problem",
    className: "border-amber-500/30",
  },
  saving: {
    icon: (
      <IconPigMoney className="size-4 text-emerald-600 dark:text-emerald-400" />
    ),
    label: "Could save",
    className: "border-emerald-500/30",
  },
  info: {
    icon: <IconInfoCircle className="size-4 text-muted-foreground" />,
    label: "Good to know",
    className: "border-border/70",
  },
};

function InsightCard({
  insight,
  onShow,
}: {
  insight: Insight;
  onShow: () => void;
}) {
  const style = INSIGHT_STYLE[insight.kind];
  return (
    <div className={`rounded-lg border bg-card p-4 ${style.className}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {style.icon}
        {style.label}
      </div>
      <h4 className="mt-1.5 text-sm font-semibold leading-5 text-foreground">
        {insight.title}
      </h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {insight.body}
      </p>
      {insight.fix ? (
        <p className="mt-1.5 text-xs leading-5 text-foreground/90">
          <span className="font-medium">Fix: </span>
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
          ? "Open the prompt"
          : `See the ${insight.runIds.length} prompts`}
      </Button>
    </div>
  );
}

function RunRow({ run, onOpen }: { run: RunListItem; onOpen: () => void }) {
  const outcome = outcomeLine(run.tools);
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
            {run.prompt ?? "Prompt text wasn't saved"}
          </span>
          {run.feedback === "up" ? (
            <IconThumbUp
              aria-label="Rated helpful"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : run.feedback === "down" ? (
            <IconThumbDown
              aria-label="Rated unhelpful"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {run.status === "error" ? (
            <span className="flex min-w-0 items-center gap-1 text-red-700 dark:text-red-400">
              <IconCircleX aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">Stopped with an error</span>
            </span>
          ) : (
            <span className="truncate">
              {outcome ? `→ ${outcome}` : "→ Answered"}
            </span>
          )}
          {notableRestart(run) ? (
            <span className="shrink-0 text-amber-700 dark:text-amber-400">
              · started over {run.restarts.count}×
            </span>
          ) : run.recoveredErrors > 0 ? (
            <span className="shrink-0">
              · recovered from {run.recoveredErrors} tool{" "}
              {run.recoveredErrors === 1 ? "error" : "errors"}
            </span>
          ) : failures.length > 0 ? (
            <span className="shrink-0 text-amber-700 dark:text-amber-400">
              · {failures.length} {failures.length === 1 ? "tool" : "tools"}{" "}
              failed
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
  const parts = [
    {
      label: "Re-used context",
      cents: run.cost.cacheReadCents,
      tokens: run.tokens.cacheReadTokens,
      color: "var(--usage-cache-read)",
    },
    {
      label: "Saved to cache",
      cents: run.cost.cacheWriteCents,
      tokens: run.tokens.cacheWriteTokens,
      color: "var(--usage-cache-write)",
    },
    {
      label: "New context",
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
      label: "Written by the model",
      cents: run.cost.outputCents,
      tokens: run.tokens.outputTokens,
      color: "var(--usage-output)",
    },
  ];
  const checks = run.scores.filter((score) => score.source === "heuristic");
  const judged = run.scores.filter((score) => score.source === "judge");
  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className="text-muted-foreground">
          Without re-using earlier context this prompt would have cost{" "}
          <span className="text-foreground">
            {formatUsd(run.cost.noCacheCents)}
          </span>{" "}
          instead of{" "}
          <span className="text-foreground">
            {formatUsd(run.cost.totalCents)}
          </span>
          .
        </p>
        <div className="mt-2 flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
          {parts.map((part) =>
            part.cents > 0 && run.cost.totalCents > 0 ? (
              <div
                key={part.label}
                style={{
                  width: `${(part.cents / run.cost.totalCents) * 100}%`,
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
        <div className="font-medium text-foreground">Automatic checks</div>
        {judged.length === 0 && checks.length === 0 ? (
          <p className="mt-1 text-muted-foreground">None were recorded.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {[...judged, ...checks].map((score) => (
              <li key={score.criteria} className="flex justify-between gap-4">
                <span>
                  {capitalize(score.criteria.replaceAll("_", " "))}
                  {score.source === "judge" ? " (graded by a model)" : ""}
                </span>
                <span className="tabular-nums">
                  {Math.round(score.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Framework checks look at how the run went (errors, steps, speed), not
          at whether the result was good.
        </p>
      </div>
    </div>
  );
}

function StepList({ turns }: { turns: RunTurn[] }) {
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
                {turnLabel(turn, index === turns.length - 1)}
              </span>
              {turn.restart ? (
                <span className="shrink-0 text-amber-700 dark:text-amber-400">
                  started over
                </span>
              ) : null}
              {failed ? (
                <span className="shrink-0 text-red-700 dark:text-red-400">
                  tool failed
                </span>
              ) : null}
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatDuration(turn.durationMs)}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-foreground">
                {formatUsd(turn.cost.totalCents)}
              </span>
            </button>
            {open ? (
              <div className="space-y-1.5 bg-muted/30 px-3 py-2.5 pl-11 text-xs text-muted-foreground">
                <p>
                  Sent {compactTokens(turn.tokens.inputTokens)} tokens of
                  context,{" "}
                  {percent(
                    turn.tokens.cacheReadTokens,
                    turn.tokens.inputTokens,
                  )}
                  % re-used from earlier
                  {turn.cacheExpired
                    ? " (the saved context had expired after a pause, which is expected)"
                    : ""}
                  . Wrote {compactTokens(turn.tokens.outputTokens)} tokens.
                </p>
                {turn.restart ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    Started over after {RESTART_REASON[turn.restart.cause]},
                    about {formatUsd(turn.restart.cents)} more than re-using it.
                  </p>
                ) : null}
                {turn.toolCalls.map((call, callIndex) => (
                  <p
                    key={callIndex}
                    className={
                      call.status === "error"
                        ? "text-red-700 dark:text-red-400"
                        : ""
                    }
                  >
                    {capitalize(humanizeTool(call.name))} ·{" "}
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
          {full ? "Show less" : "Show all"}
        </button>
      ) : null}
    </>
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
  const outcome = outcomeLine(run.tools);
  const cause = mainRestartCause(run);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 px-5 pb-4 pt-5">
        <div className="flex items-center gap-2 pr-20">
          {run.status === "error" ? (
            <IconCircleX className="size-4 shrink-0 text-red-600 dark:text-red-400" />
          ) : (
            <IconCircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <SheetTitle className="text-sm font-medium">
            {run.status === "error" ? "Stopped with an error" : "Finished"}
            {run.durationMs
              ? ` in ${formatDuration(run.durationMs)}`
              : ""} · {run.modelCalls} steps · {formatUsd(run.cost.totalCents)}
          </SheetTitle>
        </div>
        <SheetDescription className="mt-1 text-xs">
          {formatTime(run.createdAt)} · {run.model} ·{" "}
          {run.feedback
            ? `Rated ${run.feedback === "up" ? "helpful" : "unhelpful"}`
            : "Not rated"}
        </SheetDescription>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-sm leading-6">
            <Expandable
              text={run.prompt ?? "Prompt text wasn't saved"}
              lines="line-clamp-4"
              limit={240}
            />
          </div>
          <div className="max-w-[92%] space-y-2">
            {outcome ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  What it did:{" "}
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
                The reply text wasn't saved for this prompt.
              </p>
            )}
            {run.tools.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {run.tools.slice(0, 8).map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => setShowSteps(true)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${tool.failed ? "border-red-500/40 text-red-700 dark:text-red-400" : "border-border/70 text-muted-foreground hover:text-foreground"}`}
                  >
                    {capitalize(humanizeTool(tool.name))}
                    {tool.calls > 1 ? ` ×${tool.calls}` : ""}
                    {tool.failed ? " · failed" : ""}
                  </button>
                ))}
                {run.tools.length > 8 ? (
                  <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                    +{run.tools.length - 8} more
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
                  <span className="font-medium">
                    Started over {run.restarts.count}{" "}
                    {run.restarts.count === 1 ? "time" : "times"}
                  </span>{" "}
                  after {RESTART_REASON[cause]}. That cost about{" "}
                  {formatUsd(run.restarts.cents)} of the{" "}
                  {formatUsd(run.cost.totalCents)}.
                </p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium text-foreground/90">Fix: </span>
                  {RESTART_FIX[cause]}
                </p>
              </div>
            ) : null}
            {failures.slice(0, 1).map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-3 text-xs leading-5"
              >
                <p className="text-foreground">
                  <span className="font-medium">
                    The {toolWords(tool.name).join(" ")} tool failed
                  </span>
                  {tool.failed > 1 ? ` ${tool.failed} times` : ""}
                  {run.status === "success"
                    ? ", but the agent kept going and finished."
                    : "."}
                </p>
                {tool.error ? (
                  <p className="mt-1 text-muted-foreground">{tool.error}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

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
            {showSteps ? "Hide steps" : `Show the ${run.modelCalls} steps`}
          </button>
          {showSteps ? (
            detail ? (
              <StepList turns={detail.turns} />
            ) : (
              <Skeleton className="mt-2 h-24 w-full" />
            )
          ) : null}
        </section>

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
            Cost details and checks
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

function handledText(
  parallel: { calls: number; savedMs: number },
  recovered: number,
): string[] {
  const lines: string[] = [];
  if (parallel.savedMs >= 1000) {
    lines.push(
      `Ran ${parallel.calls} tool calls at the same time, about ${formatDuration(parallel.savedMs)} faster than one by one.`,
    );
  }
  if (recovered > 0) {
    lines.push(
      `Recovered from ${recovered} tool ${recovered === 1 ? "error" : "errors"} without stopping.`,
    );
  }
  return lines;
}

function HandledNote({ run }: { run: RunListItem }) {
  const lines = handledText(run.parallel, run.recoveredErrors);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-xs leading-5">
      <p className="font-medium text-foreground">Handled by Agent Native</p>
      <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
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

function changeText(current: number, previous: number): string | undefined {
  if (previous <= 0) return undefined;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "same as the period before";
  return `${change > 0 ? "↑" : "↓"} ${Math.abs(change)}% vs the period before`;
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
  const query = useActionQuery<UsageInsightsData>("get-usage-insights", {
    sinceDays,
    scope,
    userEmail,
    appId,
  });
  const data = query.data;
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const insights = useMemo(() => buildInsights(runs), [runs]);
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
  const completed = runs.filter((run) => run.status === "success").length;
  const recovered = runs.reduce((sum, run) => sum + run.recoveredErrors, 0);
  const handled = handledText(
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
      <style>
        {".usage-insights, .usage-insights-panel { --usage-cache-read: #2a78d6; --usage-cache-write: #eb6834; --usage-fresh-input: #1baf7a; --usage-output: #eda100; }" +
          ".dark .usage-insights, .dark .usage-insights-panel { --usage-cache-read: #3987e5; --usage-cache-write: #d95926; --usage-fresh-input: #199e70; --usage-output: #c98500; }"}
      </style>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {insights.length === 0 ? (
            <>
              <IconCircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
              Running smoothly
            </>
          ) : (
            <>
              <IconAlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              {insights.length} {insights.length === 1 ? "thing" : "things"}{" "}
              worth a look
              {problems
                ? ` · ${problems} ${problems === 1 ? "problem" : "problems"}`
                : ""}
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatUsd(current.cost.totalCents)} spent on {current.runs}{" "}
          {current.runs === 1 ? "prompt" : "prompts"} in the last {sinceDays}{" "}
          days.
        </p>
        {handled.length > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-medium text-foreground">
                Handled by Agent Native:{" "}
              </span>
              {handled.join(" ")}
            </span>
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
          <Stat
            label="Average per prompt"
            value={formatUsd(avgCents)}
            detail={changeText(avgCents, previousAvg)}
          />
          <Stat
            label="Completed"
            value={runs.length ? `${percent(completed, runs.length)}%` : "—"}
            detail={
              runs.length
                ? `${completed} of the last ${runs.length}${recovered ? `, after recovering from ${recovered} tool ${recovered === 1 ? "error" : "errors"}` : ""}`
                : undefined
            }
          />
          <Stat
            label="Typical time"
            value={typical ? formatDuration(typical) : "—"}
            detail="median"
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
            <h3 className="text-sm font-semibold text-foreground">Prompts</h3>
            {onlyRunIds ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setOnlyRunIds(null)}
              >
                Showing {onlyRunIds.length} <IconX className="size-3" />
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
                {value === "newest" ? "Newest" : "Most expensive"}
              </Button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="border-t border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            No prompts in this period yet. They show up here a few seconds after
            they finish.
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
                  aria-label="Previous prompt (K)"
                  title="Previous prompt (K)"
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
                  aria-label="Next prompt (J)"
                  title="Next prompt (J)"
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
