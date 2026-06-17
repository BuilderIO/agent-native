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
 * recording hook anywhere in the hot path. The classification reuses the exact
 * positional `tool_start` → `tool_done` matching that `thread-data-builder.ts`
 * already relies on to rebuild durable turns:
 *
 *   - `tool_start` events carry `{ tool, input }` (no tool-call id at this
 *     layer; the ledger event stream omits it).
 *   - `tool_done` events carry `{ tool, result }`.
 *   - A `tool_done` is matched to the OLDEST still-open `tool_start` for the
 *     same tool name (FIFO per tool), mirroring how the dispatch loop emits a
 *     start immediately before its matching done.
 *
 * A `tool_start` with no matching `tool_done` is the dangerous case: the call
 * began, its side effect may or may not have landed, and the interruption ate
 * the result. We surface those as "interrupted / unknown outcome" so the model
 * decides rather than blindly re-running.
 *
 * TODO(charlie-merge): optional hard-block — refuse re-execution of
 * journaled-complete tool calls at the tool layer in
 * production-agent.ts/runToolCall (CHARLIE owns that file). The prompt-level
 * journal here is the shippable first cut; the tool-layer enforcement is the
 * stronger guarantee and must wait until CHARLIE's loop edits land. When wiring
 * it, key off `classifyToolCallJournal(...).completed` and short-circuit a
 * re-dispatched write tool whose (tool name + input + order) matches a
 * completed entry, returning the journaled result instead of executing.
 */

import type { AgentChatEvent } from "./types.js";

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
  input?: Record<string, string>;
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

function inputSignature(input: Record<string, string> | undefined): string {
  if (!input) return "";
  let sig: string;
  try {
    // Stable key order so the same logical input produces the same signature
    // regardless of how the engine serialized the object.
    const sorted = Object.keys(input)
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        acc[k] = input[k];
        return acc;
      }, {});
    sig = JSON.stringify(sorted);
  } catch {
    sig = String(input);
  }
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
  // Open tool_start entries awaiting a matching tool_done, in FIFO order. We
  // index by tool name so a tool_done matches the OLDEST open start for that
  // same tool — the dispatch loop always emits start-then-done per call, so the
  // first unmatched start of a given name is the one this done belongs to.
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
      const input = (event.input ?? undefined) as
        | Record<string, string>
        | undefined;
      const entry: ToolCallJournalEntry = {
        key: `${tool}#${order}:${inputSignature(input)}`,
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
      const entry = queue?.shift();
      if (entry) {
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
  const wantSig = inputSignature(normalizeInputForSignature(input));
  for (const entry of journal.completed) {
    if (entry.tool !== toolName) continue;
    if (inputSignature(entry.input) !== wantSig) continue;
    if (consumedKeys?.has(entry.key)) continue;
    consumedKeys?.add(entry.key);
    return entry;
  }
  return undefined;
}

/**
 * Coerce an arbitrary tool input into the `Record<string, string>` shape the
 * journal recorded at `tool_start` so signatures compare apples-to-apples. The
 * ledger stores `tool_start.input` as a string map; the live call's `input` is
 * the parsed object — both pass through `inputSignature`, which sorts keys and
 * JSON-stringifies, so a plain object compares correctly.
 */
function normalizeInputForSignature(
  input: unknown,
): Record<string, string> | undefined {
  if (input == null || typeof input !== "object") return undefined;
  return input as Record<string, string>;
}

function summarizeResult(result: string | undefined): string {
  if (!result) return "(no result recorded)";
  const oneLine = result.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return "(empty result)";
  return oneLine.length > RESULT_SUMMARY_MAX_CHARS
    ? oneLine.slice(0, RESULT_SUMMARY_MAX_CHARS) + "…"
    : oneLine;
}

function describeInput(input: Record<string, string> | undefined): string {
  if (!input) return "";
  const sig = inputSignature(input);
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
      lines.push(
        `- ${entry.tool}${describeInput(entry.input)} → ${summarizeResult(entry.result)}`,
      );
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
