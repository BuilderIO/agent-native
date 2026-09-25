/**
 * Map a completed production run into a `defineEval` case.
 *
 * This module has no database imports — callers load the run, events, spans,
 * and durable thread input, then persist the returned dataset. Hosted actions
 * must not write `*.eval.ts`; only the eval CLI `--write` path emits a fixture
 * file.
 */

import { isToolDoneFailure } from "../agent/tool-done-error.js";
import type { EvalDataset } from "../observability/types.js";
import { defineEval } from "./define-eval.js";
import { contains, usesTool } from "./scorer.js";
import type { Eval, EvalInput } from "./types.js";

const MAX_TOOLS = 8;
const DEFAULT_THRESHOLD = 0.5;
const RUN_ID_NAME_PREFIX = 8;

/** Stable per-owner identity for one promoted run. Encoded so the parts cannot collide. */
export function promotedDatasetIdempotencyKey(
  runId: string,
  userId?: string | null,
): string {
  return `from-trace:${encodeURIComponent(userId ?? "")}:${encodeURIComponent(runId)}`;
}

export function promotedDatasetDescription(runId: string): string {
  return `Promoted from production run ${runId}`;
}

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
  /**
   * Durable chat thread repository (`chat_threads.thread_data`), as an object
   * or the raw JSON string. User prompts are persisted on the thread, not as
   * run events.
   */
  threadInput?: unknown;
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
    // coercion-ok: malformed event JSON is skipped and callers treat null as no event
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
      // coercion-ok: circular content cannot be stringified, so the turn contributes no text
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
  return event.status === "error" || isToolDoneFailure(event);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseThreadRepository(
  threadInput: unknown,
): Record<string, unknown> | null {
  if (typeof threadInput === "string") {
    const trimmed = threadInput.trim();
    if (!trimmed) return null;
    try {
      return asRecord(JSON.parse(trimmed) as unknown);
    } catch {
      // coercion-ok: malformed thread JSON yields no repository for prompt extraction
      return null;
    }
  }
  return asRecord(threadInput);
}

/** Wrapped `{ message, parentId }` rows and flat `{ role, content }` rows. */
function threadMessages(threadInput: unknown): Record<string, unknown>[] {
  const repo = parseThreadRepository(threadInput);
  const raw = Array.isArray(repo?.messages)
    ? repo.messages
    : Array.isArray(threadInput)
      ? threadInput
      : null;
  if (!raw) return [];
  const messages: Record<string, unknown>[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const message = asRecord(record.message) ?? record;
    if (typeof message.role !== "string") continue;
    messages.push(message);
  }
  return messages;
}

function customMeta(message: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(message.metadata)?.custom) ?? {};
}

function storedMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (
        !record ||
        record.type !== "text" ||
        typeof record.text !== "string"
      ) {
        return "";
      }
      return record.text;
    })
    .join("")
    .trim();
}

function submittedRunId(message: Record<string, unknown>): string | null {
  const id = customMeta(message).submittedRunId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function messageRunIds(message: Record<string, unknown>): string[] {
  const metadata = asRecord(message.metadata);
  const folded = customMeta(message).foldedRunIds;
  const ids = [
    metadata?.runId,
    customMeta(message).runId,
    ...(Array.isArray(folded) ? folded : []),
  ];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/**
 * Index of the user message that started this run. `submittedRunId` is stamped
 * on the foreground chunk; a later completed continuation only appears on the
 * assistant message (`runId` / `foldedRunIds`), so walk back to the user turn
 * that message belongs to.
 */
function promptIndexForRun(
  messages: readonly Record<string, unknown>[],
  runId: string,
): number {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === "user" && submittedRunId(message) === runId) return i;
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === "user" || !messageRunIds(message).includes(runId)) {
      continue;
    }
    for (let j = i; j >= 0; j--) {
      const earlier = messages[j]!;
      if (earlier.role === "user" && storedMessageText(earlier).length > 0) {
        return j;
      }
    }
  }
  return -1;
}

function evalInputFromThread(
  threadInput: unknown,
  runId: string,
): EvalInput | null {
  const messages = threadMessages(threadInput);
  const promptIndex = promptIndexForRun(messages, runId);
  if (promptIndex < 0) return null;
  const prompt = storedMessageText(messages[promptIndex]!);
  if (!prompt) return null;
  const history: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const message of messages.slice(0, promptIndex)) {
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = storedMessageText(message);
    if (!text) continue;
    history.push({ role, text });
  }
  return history.length > 0 ? { prompt, history } : { prompt };
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
  // Names whose spans are only failures. A later success span clears this.
  const failedOnly = new Set<string>();

  const add = (name: string | null | undefined) => {
    if (!name || seen.has(name) || names.length >= MAX_TOOLS) return;
    seen.add(name);
    failedOnly.delete(name);
    names.push(name);
  };

  // A span already classified by trace instrumentation wins over the event
  // fallback. An error span must not be re-added because `tool_done` omitted
  // `isError`.
  if (spans) {
    for (const span of spans) {
      if (span.spanType !== "tool_call" || !span.name) continue;
      if (span.status === "success") add(span.name);
      else if (!seen.has(span.name)) failedOnly.add(span.name);
    }
  }

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const { eventData } of ordered) {
    const event = parseEvent(eventData);
    if (!event || event.type !== "tool_done") continue;
    if (isToolError(event)) continue;
    const name = toolNameFromEvent(event);
    if (name && failedOnly.has(name)) continue;
    add(name);
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

function historyFromDatasetContext(
  history: unknown,
): Array<{ role: "user" | "assistant"; text: string }> | null {
  if (history == null) return [];
  if (!Array.isArray(history)) return null;
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const turn of history) {
    const record = asRecord(turn);
    if (!record) return null;
    const role = record.role;
    const text = record.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") {
      return null;
    }
    turns.push({ role, text });
  }
  return turns;
}

function toolNamesFromDatasetContext(tools: unknown): string[] | null {
  if (tools == null) return [];
  if (!Array.isArray(tools)) return null;
  const names: string[] = [];
  for (const name of tools) {
    if (typeof name !== "string" || name.length === 0) return null;
    if (names.includes(name) || names.length >= MAX_TOOLS) continue;
    names.push(name);
  }
  return names;
}

/**
 * Rebuild the JSON eval spec from a dataset row so a repeat promotion can
 * return the stored case without replaying the run.
 */
export function promotedEvalSpecFromDataset(
  dataset: EvalDataset,
  runId: string,
): PromotedEvalSpec | null {
  const entry = dataset.entries[0];
  if (!entry || typeof entry.input !== "string" || entry.input.length === 0) {
    return null;
  }
  const context = entry.context ?? {};
  if (
    typeof context.runId === "string" &&
    context.runId.length > 0 &&
    context.runId !== runId
  ) {
    return null;
  }
  const history = historyFromDatasetContext(context.history);
  const toolNames = toolNamesFromDatasetContext(context.tools);
  if (!history || !toolNames) return null;
  const needle =
    typeof entry.expectedOutput === "string" ? entry.expectedOutput.trim() : "";
  if (toolNames.length === 0 && needle.length === 0) return null;

  const scorers: PromotedEvalScorerSpec[] = [
    ...toolNames.map((toolName) => ({ type: "usesTool" as const, toolName })),
    ...(needle.length > 0 ? [{ type: "contains" as const, needle }] : []),
  ];
  const name = `from-trace:${runId.slice(0, RUN_ID_NAME_PREFIX)}`;
  return {
    name,
    input:
      history.length > 0
        ? { prompt: entry.input, history }
        : { prompt: entry.input },
    threshold: DEFAULT_THRESHOLD,
    source: { kind: "trace", runId },
    scorers,
  };
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

  const evalInput =
    evalInputFromThread(input.threadInput, runId) ??
    evalInputFromTurns(conversationTurnsFromEvents(input.events));
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
    // Node 22.22+ exposes Web Crypto on globalThis. Do not import node:crypto.
    id: globalThis.crypto.randomUUID(),
    name: datasetName,
    description: promotedDatasetDescription(runId),
    idempotencyKey: promotedDatasetIdempotencyKey(
      runId,
      input.options?.userId ?? null,
    ),
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
