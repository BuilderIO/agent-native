import { createHash } from "node:crypto";

import type { ActionChatUIConfig } from "../action-ui.js";
import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../artifacts/detect.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { stripInlineBytes } from "../shared/inline-bytes.js";
import type { EngineMessage } from "./engine/types.js";
import type {
  AgentChatEvent,
  AgentFileMutationProof,
  AgentToolInput,
} from "./types.js";

export interface ToolCallJournalEntry {
  key: string;
  tool: string;
  id?: string;
  executionStepId?: string;
  input?: AgentToolInput;
  inputFingerprint?: string;
  inputStoredFingerprint?: string;
  order: number;
  result?: string;
  /** The call failed after its side effect completed. */
  isError?: true;
  errorCode?: string;
  /** The call recorded a completed side effect, its own or a nested call's. */
  committed?: true;
  /** Exact identity of the arguments the call ran with, defaults applied. */
  argumentsHash?: string;
  /** The call settled with an outcome it could not confirm. */
  outcomeUnknown?: true;
  artifacts?: ArtifactReceipt[];
  fileMutation?: AgentFileMutationProof;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: Omit<ActionChatUIConfig, "when" | "projectResult">;
  chatUIResult?: unknown;
}

export interface ToolCallJournal {
  completed: ToolCallJournalEntry[];
  interrupted: ToolCallJournalEntry[];
}

export function journalEntriesRepresentedInHistory(
  journal: ToolCallJournal,
  history: readonly EngineMessage[],
): Set<string> {
  const callsByStep = new Map<string, number>();
  const resultsByStep = new Map<string, number>();
  const callsByLegacyIdentity = new Map<string, number>();
  const resultsByLegacyIdentity = new Map<string, number>();
  const resultCountsByLegacyIdentity = new Map<string, number>();
  const count = (entries: Map<string, number>, key: string) => {
    entries.set(key, (entries.get(key) ?? 0) + 1);
  };
  const legacyIdentity = (toolName: string, id: string, fingerprint: string) =>
    JSON.stringify([toolName, id, fingerprint]);
  const legacyResultIdentity = (
    toolName: string,
    id: string,
    fingerprint: string,
    result: string,
  ) => JSON.stringify([toolName, id, fingerprint, result]);

  for (const message of history) {
    for (const part of message.content) {
      if (message.role === "assistant" && part.type === "tool-call") {
        if (part.executionStepId) {
          count(callsByStep, JSON.stringify([part.name, part.executionStepId]));
        } else {
          count(
            callsByLegacyIdentity,
            legacyIdentity(
              part.name,
              part.id,
              part.inputFingerprint ?? toolCallInputFingerprint(part.input),
            ),
          );
        }
      } else if (message.role !== "assistant" && part.type === "tool-result") {
        if (part.executionStepId) {
          count(
            resultsByStep,
            JSON.stringify([part.toolName, part.executionStepId]),
          );
        } else {
          let input: unknown;
          try {
            input = JSON.parse(part.toolInput);
          } catch {
            continue;
          }
          const fingerprint =
            part.inputFingerprint ?? toolCallInputFingerprint(input);
          const baseIdentity = legacyIdentity(
            part.toolName,
            part.toolCallId,
            fingerprint,
          );
          const resultIdentity = legacyResultIdentity(
            part.toolName,
            part.toolCallId,
            fingerprint,
            part.content,
          );
          count(resultsByLegacyIdentity, resultIdentity);
          count(resultCountsByLegacyIdentity, baseIdentity);
        }
      }
    }
  }

  const represented = new Set<string>();
  const entriesByLegacyIdentity = new Map<string, ToolCallJournalEntry[]>();
  for (const entry of journal.completed) {
    if (entry.executionStepId) {
      const identity = JSON.stringify([entry.tool, entry.executionStepId]);
      if (
        callsByStep.get(identity) === 1 &&
        resultsByStep.get(identity) === 1
      ) {
        represented.add(entry.key);
      }
      continue;
    }
    if (entry.id === undefined || entry.input === undefined) continue;
    const fingerprint =
      entry.inputFingerprint ?? toolCallInputFingerprint(entry.input);
    const identity = legacyResultIdentity(
      entry.tool,
      entry.id,
      fingerprint,
      entry.result ?? "",
    );
    const entries = entriesByLegacyIdentity.get(identity);
    if (entries) entries.push(entry);
    else entriesByLegacyIdentity.set(identity, [entry]);
  }
  for (const [identity, entries] of entriesByLegacyIdentity) {
    const [toolName, id, fingerprint] = JSON.parse(identity) as [
      string,
      string,
      string,
      string,
    ];
    const baseIdentity = legacyIdentity(toolName, id, fingerprint);
    const callCount = callsByLegacyIdentity.get(baseIdentity) ?? 0;
    const resultCount = resultCountsByLegacyIdentity.get(baseIdentity) ?? 0;
    const matchingResultCount = resultsByLegacyIdentity.get(identity) ?? 0;
    if (resultCount > callCount) continue;
    if (matchingResultCount !== entries.length) continue;
    for (const entry of entries) represented.add(entry.key);
  }
  return represented;
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

export function toolCallInputFingerprint(input: unknown): string {
  return createHash("sha256").update(inputSignature(input)).digest("hex");
}

export function isUnavailableToolCallInput(input: unknown): boolean {
  if (typeof input === "string")
    return /\[inline [^\]]+ data omitted\]/.test(input);
  if (!input || typeof input !== "object") return false;
  if (
    "omitted" in input &&
    (input.omitted === "inline-bytes" || input.omitted === "tool-input")
  ) {
    return true;
  }
  return Object.values(input).some(isUnavailableToolCallInput);
}

export function isConsistentToolCallInputFingerprint(
  input: unknown,
  fingerprint: string | undefined,
  storedFingerprint?: string,
): boolean {
  if (storedFingerprint !== undefined)
    return (
      fingerprint !== undefined &&
      input !== undefined &&
      toolCallInputFingerprint(input) === storedFingerprint
    );
  return (
    fingerprint === undefined ||
    input === undefined ||
    toolCallInputFingerprint(input) === fingerprint
  );
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
  const output: Record<string, unknown> = Object.create(null);
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

  // Clearing a draft does not establish the outcome of a started action.
  for (const event of events) {
    if (event.type === "tool_start") {
      const tool = event.tool ?? "unknown";
      const input = event.input ?? undefined;
      const entry: ToolCallJournalEntry = {
        key: `${tool}#${order}:${displayInputSignature(input)}`,
        tool,
        ...(event.id !== undefined ? { id: event.id } : {}),
        ...(event.executionStepId !== undefined
          ? { executionStepId: event.executionStepId }
          : {}),
        ...(input ? { input } : {}),
        ...(event.inputFingerprint
          ? { inputFingerprint: event.inputFingerprint }
          : {}),
        ...(event.inputStoredFingerprint
          ? { inputStoredFingerprint: event.inputStoredFingerprint }
          : {}),
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
        if (event.outcomeUnknown === true) {
          entry.outcomeUnknown = true;
          if (event.argumentsHash) entry.argumentsHash = event.argumentsHash;
          queue!.push(entry);
          continue;
        }
        if (isNonCompletedToolDone(event)) {
          continue;
        }
        entry.result = event.result ?? "";
        if (event.isError === true) entry.isError = true;
        if (event.errorCode) entry.errorCode = event.errorCode;
        if (event.completedSideEffect === true) entry.committed = true;
        if (event.argumentsHash) entry.argumentsHash = event.argumentsHash;
        const artifacts = event.artifacts?.filter(isArtifactReceipt);
        if (artifacts && artifacts.length > 0) entry.artifacts = artifacts;
        if (event.fileMutation) entry.fileMutation = event.fileMutation;
        if (event.mcpApp) entry.mcpApp = event.mcpApp;
        if (event.chatUI && event.chatUIResult !== undefined) {
          entry.chatUI = {
            renderer: event.chatUI.renderer,
            ...(event.chatUI.title ? { title: event.chatUI.title } : {}),
            ...(event.chatUI.description
              ? { description: event.chatUI.description }
              : {}),
          };
          entry.chatUIResult = event.chatUIResult;
        }
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
  if (
    !isConsistentToolCallInputFingerprint(
      event.input,
      event.inputFingerprint,
      event.inputStoredFingerprint,
    )
  )
    return undefined;
  const hasIdentity =
    event.id !== undefined ||
    event.inputFingerprint !== undefined ||
    event.input !== undefined;
  if (!hasIdentity && queue.length !== 1) return undefined;

  const doneFingerprint =
    event.inputFingerprint ??
    (event.input === undefined
      ? undefined
      : toolCallInputFingerprint(event.input));
  const matches = queue.filter((entry) => {
    if (
      event.executionStepId !== undefined &&
      entry.executionStepId !== event.executionStepId
    ) {
      return false;
    }
    if (
      !isConsistentToolCallInputFingerprint(
        entry.input,
        entry.inputFingerprint,
        entry.inputStoredFingerprint,
      )
    )
      return false;
    if (
      event.executionStepId === undefined &&
      event.id !== undefined &&
      entry.id !== event.id
    ) {
      return false;
    }
    if (
      doneFingerprint !== undefined &&
      (entry.inputFingerprint ?? toolCallInputFingerprint(entry.input)) !==
        doneFingerprint
    )
      return false;
    return (
      event.input === undefined ||
      inputSignature(
        event.inputFingerprint === undefined &&
          entry.inputFingerprint === undefined
          ? entry.input
          : stripInlineBytes(entry.input, "placeholder"),
      ) ===
        inputSignature(
          event.inputFingerprint === undefined &&
            entry.inputFingerprint === undefined
            ? event.input
            : stripInlineBytes(event.input, "placeholder"),
        )
    );
  });
  if (matches.length === 0) return undefined;
  if (event.executionStepId !== undefined) {
    const matched = new Set(matches);
    const latest = matches[matches.length - 1];
    if (!latest) return undefined;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (matched.has(queue[i]!)) queue.splice(i, 1);
    }
    return latest;
  }
  if (matches.length !== 1) return undefined;
  return queue.splice(queue.indexOf(matches[0]!), 1)[0];
}

function isNonCompletedToolDone(
  event: Extract<AgentChatEvent, { type: "tool_done" }>,
): boolean {
  if (event.replayed === true) return true;
  // The effect, not the response: a call can fail after its changes saved.
  if (event.completedSideEffect !== undefined) {
    return !event.completedSideEffect;
  }
  if (event.isError !== undefined) return event.isError;

  const result = (event.result ?? "").trim();
  if (!result) return false;

  return (
    result.startsWith("Error: Unknown tool") ||
    result.startsWith("Error: Tool no longer available") ||
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

export type JournalCallEffect = "none" | "committed" | "unknown";

/**
 * What each call of the journal recorded having done, by call id: no side
 * effect, a completed one, or an outcome it could not confirm. A call that
 * recorded none of these, as calls before effects were recorded did, or that
 * never finished, is absent.
 */
export function journalCallEffects(
  journal: ToolCallJournal,
  events: readonly AgentChatEvent[],
): Map<string, JournalCallEffect> {
  const effects = new Map<string, JournalCallEffect>();
  // The journal drops a call that changed nothing, so its own record says so.
  for (const event of events) {
    if (
      event.type === "tool_done" &&
      event.id &&
      event.completedSideEffect === false &&
      event.outcomeUnknown !== true
    ) {
      effects.set(event.id, "none");
    }
  }
  for (const entry of journal.completed) {
    if (entry.id !== undefined && entry.committed) {
      effects.set(entry.id, "committed");
    }
  }
  for (const entry of journal.interrupted) {
    if (entry.id !== undefined && entry.outcomeUnknown) {
      effects.set(entry.id, "unknown");
    }
  }
  return effects;
}

/**
 * The identity each call of a turn recorded running with, by call id, for a
 * result found by that id in the turn's `history`. A call that recorded none,
 * as calls before identities did, is absent, and so is every id that more
 * than one call of the turn used, in the journal or in the history: which of
 * them a result belongs to cannot be told by its id.
 */
export function journalCallIdentities(
  events: readonly AgentChatEvent[],
  history: readonly EngineMessage[],
): Map<string, string> {
  const journalCalls = new Map<string, number>();
  const historyCalls = new Map<string, number>();
  const count = (calls: Map<string, number>, id: string) =>
    calls.set(id, (calls.get(id) ?? 0) + 1);
  for (const event of events) {
    if (event.type === "tool_start" && event.id) count(journalCalls, event.id);
  }
  for (const message of history) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "tool-call") count(historyCalls, part.id);
    }
  }
  const identities = new Map<string, string>();
  for (const event of events) {
    if (
      event.type === "tool_done" &&
      event.id &&
      event.argumentsHash &&
      (journalCalls.get(event.id) ?? 0) <= 1 &&
      (historyCalls.get(event.id) ?? 0) <= 1
    ) {
      identities.set(event.id, event.argumentsHash);
    }
  }
  return identities;
}

/**
 * The completed call a continued turn replays instead of running a call
 * prepared to `argumentsHash`: one that recorded a committed effect for that
 * exact identity, whatever raw input either call was sent with. A call that
 * recorded no committed effect runs fresh. A call recorded before calls had
 * identities is matched as it was then, by its raw input, and only for a
 * call prepared as a write, given in `rawWrite`: running that fresh could
 * repeat its effect. The result and the identity it ran with come from one
 * `tool_done`, never joined by call id, so a repeated id cannot attach one
 * call's result to another's arguments here.
 */
export function findReplayableJournalEntry(
  journal: ToolCallJournal,
  toolName: string,
  argumentsHash: string,
  consumedKeys?: Set<string>,
  rawWrite?: { input: unknown },
  representedKeys?: ReadonlySet<string>,
  executionStepId?: string,
  allowRepresentedLegacyEntry = false,
): ToolCallJournalEntry | undefined {
  const matches = (candidate: ToolCallJournalEntry) =>
    candidate.tool === toolName &&
    !consumedKeys?.has(candidate.key) &&
    (candidate.argumentsHash === undefined
      ? rawWrite !== undefined &&
        (candidate.inputFingerprint
          ? candidate.inputFingerprint ===
            toolCallInputFingerprint(rawWrite.input)
          : inputSignature(candidate.input) === inputSignature(rawWrite.input))
      : candidate.committed === true &&
        candidate.argumentsHash === argumentsHash);
  const candidates = journal.completed.filter((candidate) => {
    const represented = representedKeys?.has(candidate.key) === true;
    const identityMatches =
      executionStepId === undefined
        ? candidate.executionStepId === undefined &&
          (allowRepresentedLegacyEntry || !represented)
        : candidate.executionStepId === executionStepId ||
          (allowRepresentedLegacyEntry &&
            candidate.executionStepId === undefined);
    return identityMatches && matches(candidate);
  });
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  const entry = candidate;
  if (entry) consumedKeys?.add(entry.key);
  return entry;
}

export function findInterruptedJournalEntryForCall(
  journal: ToolCallJournal,
  toolName: string,
  argumentsHash: string | undefined,
  input: unknown,
): ToolCallJournalEntry | undefined {
  const inputFingerprint = toolCallInputFingerprint(input);
  const matches = journal.interrupted.filter((entry) => {
    if (entry.tool !== toolName || !entry.executionStepId) return false;
    if (entry.argumentsHash !== undefined && argumentsHash !== undefined) {
      return entry.argumentsHash === argumentsHash;
    }
    if (entry.inputFingerprint !== undefined) {
      return entry.inputFingerprint === inputFingerprint;
    }
    return (
      entry.input !== undefined &&
      inputSignature(entry.input) === inputSignature(input)
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
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
        `- ${entry.tool}${describeInput(entry.input)} → ${entry.isError ? "failed after its changes were saved: " : ""}${summarizeResult(entry.result)}`,
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
