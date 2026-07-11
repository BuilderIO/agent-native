/**
 * Per-turn tool-call journal — derived (not separately recorded) from the
 * existing run-event ledger. Borrowed from Flue's durable-execution journal:
 * when an agent run resumes after an interruption (gateway/transport drop, cold
 * start, soft-timeout auto-continue), we classify the tool calls already in the
 * ledger so the resumed model does NOT re-execute side effects it already
 * completed (re-sending an email, re-creating a ticket) and so it is explicitly
 * told about any tool call that started but whose outcome was never recorded.
 *
 * IMPORTANT — this is a pure read-over-the-ledger view. There is no new
 * recording hook anywhere in the hot path. Classification uses input-aware
 * `tool_start` → `tool_done` matching when a `tool_done` event carries its
 * input, while preserving the legacy positional fallback that older ledger
 * events and `thread-data-builder.ts` rely on:
 *
 *   - `tool_start` events carry `{ tool, input }` (no tool-call id at this
 *     layer; the ledger event stream omits it).
 *   - `tool_done` events carry `{ tool, input?, result }`.
 *   - A `tool_done` with input is matched to the open start with the same tool
 *     name and deep-canonicalized input.
 *   - A legacy `tool_done` without input is matched to the OLDEST still-open
 *     `tool_start` for the same tool name (FIFO per tool).
 *
 * A `tool_start` with no matching `tool_done` is the dangerous case: the call
 * began, its side effect may or may not have landed, and the interruption ate
 * the result. We surface those as "interrupted / unknown outcome" so the model
 * decides rather than blindly re-running.
 *
 * Two layers of protection are built on this: (1) a prompt-level note on resume
 * (see `run-loop-with-resume.ts`) telling the model what already completed, and
 * (2) tool-layer enforcement in `production-agent.ts`/`runToolCall`, which uses
 * `findCompletedJournalEntry(...)` to refuse re-executing a journaled-complete
 * write tool — returning the journaled result instead of running the side
 * effect again. Layer 2 is the stronger guarantee.
 */

import type { AgentChatEvent, AgentToolInput } from "./types.js";

/** A single recorded tool-call ledger entry, classified by outcome. */
export interface ToolCallJournalEntry {
  /**
   * Stable-ish identity for this tool call within the turn. The ledger event
   * stream has no tool-call id, so we key by tool name + a short input
   * signature + positional order, exactly enough to disambiguate repeats of the
   * same tool within one turn for human/model-readable reporting.
   */
  key: string;
  /** Tool / action name (from the `tool_start` event). */
  tool: string;
  /** Tool input captured at `tool_start`, if any. */
  input?: AgentToolInput;
  /** 0-based position of the `tool_start` among all tool calls in the turn. */
  order: number;
  /** Result text from the matched `tool_done`, when the call completed. */
  result?: string;
}

/** Result of classifying one turn's ledger events. */
export interface ToolCallJournal {
  /** Tool calls with a matching `tool_done` — already ran, do NOT re-run. */
  completed: ToolCallJournalEntry[];
  /**
   * Tool calls with a `tool_start` but no matching `tool_done` — interrupted,
   * outcome unknown. The model must decide whether re-running is safe.
   */
  interrupted: ToolCallJournalEntry[];
}

/** Max length of an input signature included in a journal key (debug-readable). */
const INPUT_SIGNATURE_MAX_CHARS = 120;

/** Max length of a per-tool-call result summary surfaced in the resume note. */
const RESULT_SUMMARY_MAX_CHARS = 400;

/** Max length of explicit next-step guidance surfaced outside result summaries. */
const NEXT_REQUIRED_ACTION_MAX_CHARS = 900;

function inputSignature(input: unknown): string {
  if (input == null) return "";
  try {
    return JSON.stringify(canonicalizeForSignature(input));
  } catch {
    return String(input);
  }
}

function canonicalizeForSignature(
  input: unknown,
  seen = new WeakSet(),
): unknown {
  if (input == null) return input;
  if (typeof input === "bigint") return input.toString();
  if (typeof input === "function" || typeof input === "symbol") {
    return String(input);
  }
  if (typeof input !== "object") return input;

  if (seen.has(input)) return "[Circular]";
  seen.add(input);
  if (Array.isArray(input)) {
    const output = input.map((value) =>
      value === undefined
        ? "[Undefined]"
        : canonicalizeForSignature(value, seen),
    );
    seen.delete(input);
    return output;
  }

  const object = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    const value = object[key];
    output[key] =
      value === undefined
        ? "[Undefined]"
        : canonicalizeForSignature(value, seen);
  }
  seen.delete(input);
  return output;
}

function displayInputSignature(input: unknown): string {
  const sig = inputSignature(input);
  return sig.length > INPUT_SIGNATURE_MAX_CHARS
    ? sig.slice(0, INPUT_SIGNATURE_MAX_CHARS)
    : sig;
}

/**
 * Classify a single turn's recorded events into completed vs interrupted tool
 * calls. Pure and side-effect free — given the same events it always returns
 * the same journal. A `clear` event resets the per-turn tally exactly as the
 * thread rebuild does, so partial streamed output that was discarded on resume
 * doesn't leave phantom open tool calls.
 */
export function classifyToolCallJournal(
  events: readonly AgentChatEvent[],
): ToolCallJournal {
  // Open tool_start entries awaiting a matching tool_done. We index by tool
  // name first, then prefer matching input signatures when the done event
  // carries input. Older ledger entries without done input fall back to FIFO.
  const openByTool = new Map<string, ToolCallJournalEntry[]>();
  const completed: ToolCallJournalEntry[] = [];
  let order = 0;

  for (const event of events) {
    if (event.type === "clear") {
      // Discarded partial output: drop any not-yet-completed starts so they
      // aren't reported as interrupted. Already-completed entries stay.
      openByTool.clear();
      continue;
    }

    if (event.type === "tool_start") {
      const tool = event.tool ?? "unknown";
      const input = event.input ?? undefined;
      const entry: ToolCallJournalEntry = {
        key: `${tool}#${order}:${displayInputSignature(input)}`,
        tool,
        ...(input ? { input } : {}),
        order,
      };
      order += 1;
      const queue = openByTool.get(tool);
      if (queue) queue.push(entry);
      else openByTool.set(tool, [entry]);
      continue;
    }

    if (event.type === "tool_done") {
      const tool = event.tool ?? "unknown";
      const queue = openByTool.get(tool);
      const entry = takeMatchingOpenEntry(queue, event);
      if (entry) {
        if (isNonCompletedToolDone(event)) {
          // Failed/blocked calls reached a terminal tool_done, but their side
          // effect did not complete. Drop the matching start instead of
          // classifying it as completed or interrupted.
          continue;
        }
        entry.result = event.result ?? "";
        completed.push(entry);
      }
      // A tool_done with no open start is ignored — it can't be re-associated
      // and re-reporting a duplicate done would be noise.
      continue;
    }
  }

  // Anything still open never received a tool_done → interrupted / unknown.
  const interrupted: ToolCallJournalEntry[] = [];
  for (const queue of openByTool.values()) {
    for (const entry of queue) interrupted.push(entry);
  }
  interrupted.sort((a, b) => a.order - b.order);

  return { completed, interrupted };
}

function takeMatchingOpenEntry(
  queue: ToolCallJournalEntry[] | undefined,
  event: Extract<AgentChatEvent, { type: "tool_done" }>,
): ToolCallJournalEntry | undefined {
  if (!queue || queue.length === 0) return undefined;
  if (event.input !== undefined) {
    const doneSig = inputSignature(event.input);
    const index = queue.findIndex(
      (entry) => inputSignature(entry.input) === doneSig,
    );
    if (index >= 0) return queue.splice(index, 1)[0];
  }
  return queue.shift();
}

function isNonCompletedToolDone(
  event: Extract<AgentChatEvent, { type: "tool_done" }>,
): boolean {
  if (event.completedSideEffect === false) return true;
  if (event.isError === true) return true;

  const result = (event.result ?? "").trim();
  if (!result) return false;

  // Legacy run events did not persist isError. Keep known non-execution results
  // from becoming durable "completed" write calls after deploy.
  return (
    result.startsWith("Error: Unknown tool") ||
    result.startsWith("Error running ") ||
    result.startsWith("Invalid action parameters for ") ||
    result.startsWith("Plan mode blocked ") ||
    result.startsWith("Skipped ") ||
    result.startsWith("Stopped after ") ||
    result.startsWith("The tool was not executed") ||
    result.startsWith("Awaiting human approval") ||
    result.includes(" did NOT execute")
  );
}

/** True when the journal has nothing worth telling a resuming model about. */
export function isJournalEmpty(journal: ToolCallJournal): boolean {
  return journal.completed.length === 0 && journal.interrupted.length === 0;
}

/**
 * Find a COMPLETED journal entry that matches a tool call about to be
 * dispatched, by tool name + input signature (position-independent — a resumed
 * call may sit at a different order than the original). Used by the tool-layer
 * hard-block in production-agent.ts/runToolCall to skip re-executing a side
 * effect that already completed in a prior interrupted chunk: when this returns
 * an entry, the loop returns `entry.result` instead of running the action.
 *
 * Returns the FIRST unmatched completed entry for that (name + input); the
 * caller is expected to claim it (mark it consumed) so two identical fresh
 * calls in the same turn don't both short-circuit on one journaled completion.
 * Returns undefined when there is no completed entry for this exact call —
 * including every fresh call, which must execute normally.
 */
export function findCompletedJournalEntry(
  journal: ToolCallJournal,
  toolName: string,
  input: unknown,
  consumedKeys?: Set<string>,
): ToolCallJournalEntry | undefined {
  const wantSig = inputSignature(input);
  for (const entry of journal.completed) {
    if (entry.tool !== toolName) continue;
    if (inputSignature(entry.input) !== wantSig) continue;
    if (consumedKeys?.has(entry.key)) continue;
    consumedKeys?.add(entry.key);
    return entry;
  }
  return undefined;
}

function summarizeResult(result: string | undefined): string {
  if (!result) return "(no result recorded)";
  const oneLine = result.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return "(empty result)";
  return oneLine.length > RESULT_SUMMARY_MAX_CHARS
    ? oneLine.slice(0, RESULT_SUMMARY_MAX_CHARS) + "…"
    : oneLine;
}

function parseResultObject(
  result: string | undefined,
): Record<string, unknown> {
  if (!result) return {};
  const trimmed = result.trim();
  if (!trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function summarizeNextRequiredAction(
  result: string | undefined,
): string | null {
  const action = parseResultObject(result).nextRequiredAction;
  if (typeof action !== "string") return null;
  const oneLine = action.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > NEXT_REQUIRED_ACTION_MAX_CHARS
    ? oneLine.slice(0, NEXT_REQUIRED_ACTION_MAX_CHARS) + "..."
    : oneLine;
}

function describeInput(input: unknown): string {
  if (!input) return "";
  const sig = displayInputSignature(input);
  return sig && sig !== "{}" ? ` input: ${sig}` : "";
}

/**
 * Build the structured resume note injected on auto-continue. Returns `null`
 * when there are no completed or interrupted tool calls to report, so the
 * caller can preserve the exact pre-existing "continue from where you left off"
 * behavior on normal resumes (no regression for turns with no tool activity).
 *
 * The note is intentionally a flat, model-readable block: a list of already-run
 * tool calls (with short results) the model must NOT re-run, and a separate list
 * of interrupted calls whose outcome is unknown for the model to decide on.
 */
export function buildResumeJournalNote(
  journal: ToolCallJournal,
): string | null {
  if (isJournalEmpty(journal)) return null;

  const lines: string[] = [];
  lines.push(
    "Tool-call journal from the interrupted attempt (derived from the durable run ledger):",
  );

  if (journal.completed.length > 0) {
    lines.push("");
    lines.push(
      "Already completed (do NOT re-run these — their side effects already happened; reuse the results below):",
    );
    for (const entry of journal.completed) {
      const nextRequiredAction = summarizeNextRequiredAction(entry.result);
      lines.push(
        `- ${entry.tool}${describeInput(entry.input)} → ${summarizeResult(entry.result)}`,
      );
      if (nextRequiredAction) {
        lines.push(`  Next required action from result: ${nextRequiredAction}`);
      }
    }
  }

  if (journal.interrupted.length > 0) {
    lines.push("");
    lines.push(
      "Interrupted / unknown outcome (these started but no result was recorded before the cut-off — do not assume they succeeded OR failed; if re-running could duplicate a side effect, verify state first):",
    );
    for (const entry of journal.interrupted) {
      lines.push(
        `- ${entry.tool}${describeInput(entry.input)} → (no result recorded)`,
      );
    }
  }

  return lines.join("\n");
}
