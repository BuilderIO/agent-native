/**
 * Map a completed production run into a `defineEval` case.
 *
 * This module has no database imports — callers load the run, events, and
 * spans, then persist the returned dataset. Hosted actions must not write
 * `*.eval.ts`; only the eval CLI `--write` path emits a fixture file.
 */

import type { EvalDataset } from "../observability/types.js";
import { defineEval } from "./define-eval.js";
import { contains, usesTool } from "./scorer.js";
import type { Eval, EvalInput } from "./types.js";

const MAX_TOOLS = 8;
const DEFAULT_THRESHOLD = 0.5;
const RUN_ID_NAME_PREFIX = 8;

export type PromoteTraceError =
  | "not_found"
  | "run_not_completed"
  | "no_user_prompt"
  | "no_signal";

export interface PromoteTraceOptions {
  mustContain?: string;
  datasetName?: string;
  /** Owner of the dataset row. Scoped the same way trace reads filter user_id. */
  userId?: string | null;
}

export interface PromoteTraceSpan {
  spanType: string;
  name: string;
  status: string;
}

export interface PromoteTraceRun {
  status: string;
}

export interface PromoteTraceEvent {
  seq: number;
  eventData: string;
}

export type PromotedEvalScorerSpec =
  | { type: "usesTool"; toolName: string }
  | { type: "contains"; needle: string };

/** JSON-safe `defineEval` payload. Scorer functions cannot survive HTTP. */
export interface PromotedEvalSpec {
  name: string;
  input: EvalInput;
  threshold: number;
  source: { kind: "trace"; runId: string };
  scorers: PromotedEvalScorerSpec[];
}

export interface PromotedEval {
  eval: Eval;
  spec: PromotedEvalSpec;
  dataset: EvalDataset;
  sourceRunId: string;
}

export type PromoteTraceResult =
  | { ok: true; value: PromotedEval }
  | { ok: false; error: PromoteTraceError };

export interface PromoteTraceInput {
  runId: string;
  run: PromoteTraceRun | null;
  events: readonly PromoteTraceEvent[];
  spans?: readonly PromoteTraceSpan[];
  options?: PromoteTraceOptions;
}

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

function parseEvent(eventData: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(eventData) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function eventText(event: Record<string, unknown>): string {
  if (typeof event.text === "string" && event.text.length > 0) {
    return event.text;
  }
  if (typeof event.content === "string" && event.content.length > 0) {
    return event.content;
  }
  if (event.content != null) {
    try {
      return JSON.stringify(event.content);
    } catch {
      return "";
    }
  }
  return "";
}

function toolNameFromEvent(event: Record<string, unknown>): string | null {
  if (typeof event.tool === "string" && event.tool.length > 0) {
    return event.tool;
  }
  if (typeof event.name === "string" && event.name.length > 0) {
    return event.name;
  }
  return null;
}

function isToolError(event: Record<string, unknown>): boolean {
  return event.isError === true || event.status === "error";
}

/**
 * Rebuild user/assistant turns the same way `buildConversationTranscript`
 * walks `eventData`, but concatenate consecutive assistant text events so
 * history is one turn per reply rather than one turn per delta.
 */
export function conversationTurnsFromEvents(
  events: readonly PromoteTraceEvent[],
): ConversationTurn[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const turns: ConversationTurn[] = [];
  let assistant = "";

  const flushAssistant = () => {
    const text = assistant.trim();
    assistant = "";
    if (text.length > 0) {
      turns.push({ role: "assistant", text });
    }
  };

  for (const { eventData } of ordered) {
    const event = parseEvent(eventData);
    if (!event || typeof event.type !== "string") continue;

    if (event.type === "user-message") {
      flushAssistant();
      const text = eventText(event).trim();
      if (text.length > 0) {
        turns.push({ role: "user", text });
      }
      continue;
    }

    if (event.type === "text-delta" || event.type === "text") {
      assistant +=
        typeof event.text === "string" ? event.text : eventText(event);
      continue;
    }

    if (event.type === "tool_start" || event.type === "tool_done") {
      flushAssistant();
    }
  }
  flushAssistant();
  return turns;
}

function successfulToolNames(
  events: readonly PromoteTraceEvent[],
  spans: readonly PromoteTraceSpan[] | undefined,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (name: string | null | undefined) => {
    if (!name || seen.has(name) || names.length >= MAX_TOOLS) return;
    seen.add(name);
    names.push(name);
  };

  if (spans) {
    for (const span of spans) {
      if (span.spanType === "tool_call" && span.status === "success") {
        add(span.name);
      }
    }
  }

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const { eventData } of ordered) {
    const event = parseEvent(eventData);
    if (!event || event.type !== "tool_done") continue;
    if (isToolError(event)) continue;
    add(toolNameFromEvent(event));
  }

  return names;
}

function evalInputFromTurns(turns: ConversationTurn[]): EvalInput | null {
  const promptIndex = turns.findIndex((turn) => turn.role === "user");
  if (promptIndex < 0) return null;
  const prompt = turns[promptIndex]!.text;
  const history = turns.slice(0, promptIndex).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
  return history.length > 0 ? { prompt, history } : { prompt };
}

export function serializePromotedEval(value: PromotedEval): PromotedEvalSpec {
  return value.spec;
}

export function generateEvalModuleSource(spec: PromotedEvalSpec): string {
  const usesToolNames = spec.scorers
    .filter(
      (scorer): scorer is { type: "usesTool"; toolName: string } =>
        scorer.type === "usesTool",
    )
    .map((scorer) => scorer.toolName);
  const containsNeedles = spec.scorers
    .filter(
      (scorer): scorer is { type: "contains"; needle: string } =>
        scorer.type === "contains",
    )
    .map((scorer) => scorer.needle);

  const imports = ["defineEval"];
  if (usesToolNames.length > 0) imports.push("usesTool");
  if (containsNeedles.length > 0) imports.push("contains");

  const scorerLines: string[] = [];
  for (const scorer of spec.scorers) {
    if (scorer.type === "usesTool") {
      scorerLines.push(`    usesTool(${JSON.stringify(scorer.toolName)}),`);
    } else {
      scorerLines.push(`    contains(${JSON.stringify(scorer.needle)}),`);
    }
  }

  const history = spec.input.history ?? [];
  const historyBlock =
    history.length === 0
      ? ""
      : `\n    history: [\n${history
          .map(
            (turn) =>
              `      { role: ${JSON.stringify(turn.role)}, text: ${JSON.stringify(turn.text)} },`,
          )
          .join("\n")}\n    ],`;

  return `import { ${imports.join(", ")} } from "@agent-native/core/eval";

export default defineEval({
  name: ${JSON.stringify(spec.name)},
  input: {
    prompt: ${JSON.stringify(spec.input.prompt)},${historyBlock}
  },
  threshold: ${spec.threshold},
  source: { kind: "trace", runId: ${JSON.stringify(spec.source.runId)} },
  scorers: [
${scorerLines.join("\n")}
  ],
});
`;
}

/**
 * Turn a completed production run into a `defineEval` case plus an in-memory
 * `EvalDataset`. Callers persist the dataset; this function never writes SQL
 * or files.
 */
export function promoteTraceToEval(
  input: PromoteTraceInput,
): PromoteTraceResult {
  const runId = input.runId.trim();
  if (!runId || !input.run) {
    return { ok: false, error: "not_found" };
  }
  if (input.run.status !== "completed") {
    return { ok: false, error: "run_not_completed" };
  }

  const turns = conversationTurnsFromEvents(input.events);
  const evalInput = evalInputFromTurns(turns);
  if (!evalInput) {
    return { ok: false, error: "no_user_prompt" };
  }

  const toolNames = successfulToolNames(input.events, input.spans);
  const mustContain = input.options?.mustContain?.trim() || undefined;
  if (toolNames.length === 0 && !mustContain) {
    return { ok: false, error: "no_signal" };
  }

  const scorerSpecs: PromotedEvalScorerSpec[] = [
    ...toolNames.map((toolName) => ({ type: "usesTool" as const, toolName })),
    ...(mustContain
      ? [{ type: "contains" as const, needle: mustContain }]
      : []),
  ];
  const scorers = scorerSpecs.map((spec) =>
    spec.type === "usesTool" ? usesTool(spec.toolName) : contains(spec.needle),
  );

  const name = `from-trace:${runId.slice(0, RUN_ID_NAME_PREFIX)}`;
  const spec: PromotedEvalSpec = {
    name,
    input: evalInput,
    threshold: DEFAULT_THRESHOLD,
    source: { kind: "trace", runId },
    scorers: scorerSpecs,
  };
  const evalCase = defineEval({
    name,
    input: evalInput,
    threshold: DEFAULT_THRESHOLD,
    source: { kind: "trace", runId },
    scorers,
  });

  const now = Date.now();
  const datasetName =
    input.options?.datasetName?.trim() || `from-trace:${runId}`;
  const dataset: EvalDataset = {
    id: crypto.randomUUID(),
    name: datasetName,
    description: `Promoted from production run ${runId}`,
    entries: [
      {
        input: evalInput.prompt,
        ...(mustContain ? { expectedOutput: mustContain } : {}),
        context: {
          runId,
          history: evalInput.history ?? [],
          tools: toolNames,
        },
        tags: ["from-trace", runId],
      },
    ],
    createdAt: now,
    updatedAt: now,
    userId: input.options?.userId ?? null,
  };

  return {
    ok: true,
    value: {
      eval: evalCase,
      spec,
      dataset,
      sourceRunId: runId,
    },
  };
}
