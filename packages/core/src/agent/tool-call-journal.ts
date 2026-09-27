import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../artifacts/detect.js";
import type { AgentChatEvent, AgentToolInput } from "./types.js";

export interface ToolCallJournalEntry {
  key: string;
  tool: string;
  input?: AgentToolInput;
  order: number;
  result?: string;
  artifacts?: ArtifactReceipt[];
}

export interface ToolCallJournal {
  completed: ToolCallJournalEntry[];
  interrupted: ToolCallJournalEntry[];
}

const INPUT_SIGNATURE_MAX_CHARS = 120;

const RESULT_SUMMARY_MAX_CHARS = 400;

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

export function classifyToolCallJournal(
  events: readonly AgentChatEvent[],
): ToolCallJournal {
  const openByTool = new Map<string, ToolCallJournalEntry[]>();
  const completed: ToolCallJournalEntry[] = [];
  let order = 0;

  for (const event of events) {
    if (event.type === "clear") {
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
          continue;
        }
        entry.result = event.result ?? "";
        const artifacts = event.artifacts?.filter(isArtifactReceipt);
        if (artifacts && artifacts.length > 0) entry.artifacts = artifacts;
        completed.push(entry);
      }
      continue;
    }
  }

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

export function isJournalEmpty(journal: ToolCallJournal): boolean {
  return journal.completed.length === 0 && journal.interrupted.length === 0;
}

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
