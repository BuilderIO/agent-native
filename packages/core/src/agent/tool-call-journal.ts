import { createHash } from "node:crypto";

import type { ActionChatUIConfig } from "../action-ui.js";
import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../artifacts/detect.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { stripInlineBytes } from "../shared/inline-bytes.js";
import type {
  EngineMessage,
  EngineToolCallPart,
  EngineToolResultPart,
} from "./engine/types.js";
import { toolCallInputSignature as inputSignature } from "./tool-call-input-signature.js";
import { isUnknownWriteCause } from "./types.js";
import type {
  AgentChatEvent,
  AgentFileMutationProof,
  AgentToolInput,
  UnknownWriteCause,
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
  /** Why such a call's outcome is unknown, when its event recorded it. */
  unknownCause?: UnknownWriteCause;
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

export function toolCallIdentityKey(
  id?: string,
  executionStepId?: string,
): string | undefined {
  if (executionStepId !== undefined)
    return JSON.stringify(["step", executionStepId]);
  return id === undefined ? undefined : JSON.stringify(["id", id]);
}

export function matchToolCallResultsInHistory(
  history: readonly EngineMessage[],
): Array<{ call: EngineToolCallPart; result: EngineToolResultPart }> {
  const calls: Array<{ part: EngineToolCallPart; order: number }> = [];
  const results: Array<{ part: EngineToolResultPart; order: number }> = [];
  const callsByStep = new Map<string, typeof calls>();
  const resultsByStep = new Map<string, typeof results>();
  const callsById = new Map<string, typeof calls>();
  const resultsById = new Map<string, typeof results>();
  let order = 0;

  for (const message of history) {
    for (const part of message.content) {
      if (message.role === "assistant" && part.type === "tool-call") {
        const call = { part, order };
        calls.push(call);
        if (part.executionStepId !== undefined) {
          const matches = callsByStep.get(part.executionStepId) ?? [];
          matches.push(call);
          callsByStep.set(part.executionStepId, matches);
        }
        const matches = callsById.get(part.id) ?? [];
        matches.push(call);
        callsById.set(part.id, matches);
      } else if (message.role !== "assistant" && part.type === "tool-result") {
        const result = { part, order };
        results.push(result);
        if (part.executionStepId !== undefined) {
          const matches = resultsByStep.get(part.executionStepId) ?? [];
          matches.push(result);
          resultsByStep.set(part.executionStepId, matches);
        }
        const matches = resultsById.get(part.toolCallId) ?? [];
        matches.push(result);
        resultsById.set(part.toolCallId, matches);
      }
      order++;
    }
  }

  const matched: Array<{
    call: EngineToolCallPart;
    result: EngineToolResultPart;
  }> = [];
  for (const { part: result, order: resultOrder } of results) {
    let call: (typeof calls)[number] | undefined;
    if (result.executionStepId !== undefined) {
      const candidates = callsByStep.get(result.executionStepId) ?? [];
      if (
        candidates.length !== 1 ||
        (resultsByStep.get(result.executionStepId)?.length ?? 0) !== 1
      ) {
        continue;
      }
      call = candidates[0];
    } else {
      const candidates = callsById.get(result.toolCallId) ?? [];
      if (
        candidates.length !== 1 ||
        candidates[0]?.part.executionStepId !== undefined ||
        (resultsById.get(result.toolCallId)?.length ?? 0) !== 1
      ) {
        continue;
      }
      call = candidates[0];
    }

    if (
      !call ||
      call.order >= resultOrder ||
      call.part.name !== result.toolName
    ) {
      continue;
    }
    matched.push({ call: call.part, result });
  }
  return matched;
}

export function unmatchedAmbiguousLegacyToolCallResultsInHistory(
  history: readonly EngineMessage[],
): Array<{
  result: EngineToolResultPart;
  candidateCalls: EngineToolCallPart[];
}> {
  const matchedResults = new Set(
    matchToolCallResultsInHistory(history).map(({ result }) => result),
  );
  const callsByIdentity = new Map<
    string,
    Array<{ part: EngineToolCallPart; order: number }>
  >();
  const results: Array<{ part: EngineToolResultPart; order: number }> = [];
  let order = 0;

  for (const message of history) {
    for (const part of message.content) {
      if (
        message.role === "assistant" &&
        part.type === "tool-call" &&
        part.executionStepId === undefined
      ) {
        const key = JSON.stringify([part.id, part.name]);
        const calls = callsByIdentity.get(key) ?? [];
        calls.push({ part, order });
        callsByIdentity.set(key, calls);
      } else if (
        message.role !== "assistant" &&
        part.type === "tool-result" &&
        part.executionStepId === undefined
      ) {
        results.push({ part, order });
      }
      order++;
    }
  }

  const ambiguous: Array<{
    result: EngineToolResultPart;
    candidateCalls: EngineToolCallPart[];
  }> = [];
  for (const { part: result, order: resultOrder } of results) {
    if (matchedResults.has(result)) continue;
    const candidates = callsByIdentity.get(
      JSON.stringify([result.toolCallId, result.toolName]),
    );
    const candidateCalls =
      candidates
        ?.filter((candidate) => candidate.order < resultOrder)
        .map(({ part }) => part) ?? [];
    if (candidateCalls.length > 0) ambiguous.push({ result, candidateCalls });
  }
  return ambiguous;
}

export function journalEntriesRepresentedInHistory(
  journal: ToolCallJournal,
  history: readonly EngineMessage[],
): Set<string> {
  return journalHistoryAttribution(journal, history).represented;
}

export function journalEntriesAmbiguousInHistory(
  journal: ToolCallJournal,
  history: readonly EngineMessage[],
): Set<string> {
  return journalHistoryAttribution(journal, history).ambiguous;
}

function journalHistoryAttribution(
  journal: ToolCallJournal,
  history: readonly EngineMessage[],
): { represented: Set<string>; ambiguous: Set<string> } {
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
  const ambiguous = new Set<string>();
  const entriesByLegacyIdentity = new Map<string, ToolCallJournalEntry[]>();
  const entriesByLegacyBaseIdentity = new Map<string, ToolCallJournalEntry[]>();
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
    const baseIdentity = legacyIdentity(entry.tool, entry.id, fingerprint);
    const baseEntries = entriesByLegacyBaseIdentity.get(baseIdentity);
    if (baseEntries) baseEntries.push(entry);
    else entriesByLegacyBaseIdentity.set(baseIdentity, [entry]);
  }
  for (const [baseIdentity, entries] of entriesByLegacyBaseIdentity) {
    const callCount = callsByLegacyIdentity.get(baseIdentity) ?? 0;
    const resultCount = resultCountsByLegacyIdentity.get(baseIdentity) ?? 0;
    if (
      resultCount > callCount ||
      (callCount > 1 && resultCount !== callCount)
    ) {
      for (const entry of entries) ambiguous.add(entry.key);
      continue;
    }
    if (callCount > 1) {
      const exactAttribution =
        entries.length === resultCount &&
        [...entriesByLegacyIdentity].every(([identity, identityEntries]) => {
          const [toolName, id, fingerprint] = JSON.parse(identity) as [
            string,
            string,
            string,
            string,
          ];
          if (legacyIdentity(toolName, id, fingerprint) !== baseIdentity) {
            return true;
          }
          return (
            (resultsByLegacyIdentity.get(identity) ?? 0) ===
            identityEntries.length
          );
        });
      for (const entry of entries) {
        (exactAttribution ? represented : ambiguous).add(entry.key);
      }
      continue;
    }
    for (const [identity, identityEntries] of entriesByLegacyIdentity) {
      const [toolName, id, fingerprint] = JSON.parse(identity) as [
        string,
        string,
        string,
        string,
      ];
      if (legacyIdentity(toolName, id, fingerprint) !== baseIdentity) continue;
      const matchingResultCount = resultsByLegacyIdentity.get(identity) ?? 0;
      if (matchingResultCount === 0) continue;
      for (const entry of identityEntries) {
        (matchingResultCount >= identityEntries.length
          ? represented
          : ambiguous
        ).add(entry.key);
      }
    }
  }
  return { represented, ambiguous };
}

const INPUT_SIGNATURE_MAX_CHARS = 120;

const RESULT_SUMMARY_MAX_CHARS = 400;

const NEXT_REQUIRED_ACTION_MAX_CHARS = 900;

function replayOutcomeIdentity(entry: ToolCallJournalEntry): string {
  try {
    return JSON.stringify([
      entry.id,
      entry.executionStepId,
      entry.argumentsHash,
      entry.inputFingerprint,
      entry.inputStoredFingerprint,
      entry.result,
      entry.isError,
      entry.errorCode,
      entry.committed,
      entry.outcomeUnknown,
      entry.artifacts,
      entry.fileMutation,
      entry.mcpApp,
      entry.chatUI,
      entry.chatUIResult,
    ]);
  } catch {
    return entry.key;
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
          if (isUnknownWriteCause(event.unknownCause)) {
            entry.unknownCause = event.unknownCause;
          }
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
 * A conservative legacy effect group for IDs reused across calls. This key is
 * only for invalidating cached reads and holding unknown writes; it does not
 * identify a call for replay or argument matching.
 */
export function ambiguousLegacyCallEffectKey(
  id: string,
  toolName: string,
): string {
  return JSON.stringify(["ambiguous-legacy-effect", toolName, id]);
}

/**
 * What each call recorded having done, keyed by execution step where present
 * and otherwise by an unambiguous legacy provider ID. Ambiguous legacy IDs
 * retain a conservative effect group, separate from call identity.
 */
export function journalCallEffects(
  journal: ToolCallJournal,
  events: readonly AgentChatEvent[],
  history: readonly EngineMessage[] = [],
): Map<string, JournalCallEffect> {
  const effects = new Map<string, JournalCallEffect>();
  const identityKey = (
    id: string | undefined,
    executionStepId: string | undefined,
    toolName: string,
  ) =>
    journalCallIdentityKeyIfUnambiguous(
      id,
      executionStepId,
      toolName,
      events,
      history,
    );
  const recordEffect = (
    id: string | undefined,
    executionStepId: string | undefined,
    toolName: string,
    effect: JournalCallEffect,
  ) => {
    const key = identityKey(id, executionStepId, toolName);
    if (key) {
      effects.set(key, effect);
      return;
    }
    if (executionStepId !== undefined || id === undefined) return;

    const fallbackKey = ambiguousLegacyCallEffectKey(id, toolName);
    const previous = effects.get(fallbackKey);
    if (
      previous === undefined ||
      (previous === "none" && effect !== "none") ||
      effect === "unknown"
    ) {
      effects.set(fallbackKey, effect);
    }
  };
  // The journal drops a call that changed nothing, so its own record says so.
  for (const event of events) {
    if (
      event.type === "tool_done" &&
      event.completedSideEffect === false &&
      event.outcomeUnknown !== true
    ) {
      recordEffect(event.id, event.executionStepId, event.tool, "none");
    }
  }
  for (const entry of journal.completed) {
    if (entry.committed) {
      recordEffect(entry.id, entry.executionStepId, entry.tool, "committed");
    }
  }
  for (const entry of journal.interrupted) {
    if (entry.outcomeUnknown) {
      recordEffect(entry.id, entry.executionStepId, entry.tool, "unknown");
    }
  }
  return effects;
}

/**
 * The prepared identity for each call, keyed by its execution step where
 * present and otherwise by an unambiguous legacy provider ID.
 */
export function journalCallIdentities(
  events: readonly AgentChatEvent[],
  history: readonly EngineMessage[],
): Map<string, string> {
  const identities = new Map<string, string>();
  for (const event of events) {
    if (event.type === "tool_done" && event.argumentsHash) {
      const key = journalCallIdentityKeyIfUnambiguous(
        event.id,
        event.executionStepId,
        event.tool,
        events,
        history,
      );
      if (key) identities.set(key, event.argumentsHash);
    }
  }
  return identities;
}

function journalCallIdentityKeyIfUnambiguous(
  id: string | undefined,
  executionStepId: string | undefined,
  toolName: string,
  events: readonly AgentChatEvent[],
  history: readonly EngineMessage[],
): string | undefined {
  if (executionStepId !== undefined) {
    const hasConflictingJournalCall = events.some(
      (event) =>
        event.type === "tool_start" &&
        event.executionStepId === executionStepId &&
        event.tool !== toolName,
    );
    const hasConflictingHistoryCall = history.some(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (part) =>
            part.type === "tool-call" &&
            part.executionStepId === executionStepId &&
            part.name !== toolName,
        ),
    );
    return !hasConflictingJournalCall && !hasConflictingHistoryCall
      ? toolCallIdentityKey(id, executionStepId)
      : undefined;
  }
  if (id === undefined) return undefined;

  let journalMatches = 0;
  let historyMatches = 0;
  for (const event of events) {
    if (event.type !== "tool_start" || event.id !== id) continue;
    if (event.executionStepId !== undefined) return undefined;
    journalMatches++;
  }
  for (const message of history) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call" || part.id !== id) continue;
      if (part.executionStepId !== undefined) return undefined;
      historyMatches++;
    }
  }
  return journalMatches <= 1 && historyMatches <= 1
    ? toolCallIdentityKey(id)
    : undefined;
}

/**
 * The completed call a continued turn replays instead of running a call
 * prepared to `argumentsHash`: one that recorded a committed effect for that
 * exact identity, whatever raw input either call was sent with. A call that
 * recorded no committed effect runs fresh. A call recorded before calls had
 * identities is matched as it was then, by its raw input, and only for a
 * call prepared as a write, given in `rawWrite`: running that fresh could
 * repeat its effect. A legacy result already represented in history cannot
 * identify a new step merely because its tool and arguments match. The result
 * and the identity it ran with come from one `tool_done`, never joined by call
 * id, so a repeated id cannot attach one call's result to another's arguments.
 */
export function findReplayableJournalEntry(
  journal: ToolCallJournal,
  toolName: string,
  argumentsHash: string,
  consumedKeys?: Set<string>,
  rawWrite?: { input: unknown },
  representedKeys?: ReadonlySet<string>,
  executionStepId?: string,
  ambiguousKeys?: ReadonlySet<string>,
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
    const ambiguous = ambiguousKeys?.has(candidate.key) === true;
    const identityMatches =
      executionStepId === undefined
        ? candidate.executionStepId === undefined && !ambiguous && !represented
        : candidate.executionStepId === executionStepId ||
          (candidate.executionStepId === undefined &&
            !ambiguous &&
            !represented);
    return identityMatches && matches(candidate);
  });
  const firstCandidate = candidates[0];
  const hasRepresentedLegacyCandidate = candidates.some(
    (candidate) =>
      candidate.executionStepId === undefined &&
      representedKeys?.has(candidate.key) === true,
  );
  const candidate =
    candidates.length === 1
      ? firstCandidate
      : hasRepresentedLegacyCandidate
        ? undefined
        : firstCandidate &&
            candidates.every(
              (entry) =>
                replayOutcomeIdentity(entry) ===
                replayOutcomeIdentity(firstCandidate),
            )
          ? candidates.at(-1)
          : undefined;
  const entry = candidate;
  if (entry) consumedKeys?.add(entry.key);
  return entry;
}

export function findAmbiguousLegacyJournalEntryForCall(
  journal: ToolCallJournal,
  ambiguousKeys: ReadonlySet<string>,
  representedKeys: ReadonlySet<string>,
  toolName: string,
  argumentsHash: string,
  input: unknown,
  consumedKeys?: ReadonlySet<string>,
  includeRepresentedDuplicates = false,
): ToolCallJournalEntry | undefined {
  const inputFingerprint = toolCallInputFingerprint(input);
  const matchesInput = (entry: ToolCallJournalEntry) =>
    entry.argumentsHash === undefined
      ? entry.inputFingerprint !== undefined
        ? entry.inputFingerprint === inputFingerprint
        : entry.input !== undefined &&
          inputSignature(entry.input) === inputSignature(input)
      : entry.argumentsHash === argumentsHash;
  const matchingEntries = journal.completed.filter(
    (entry) =>
      !entry.executionStepId && entry.tool === toolName && matchesInput(entry),
  );
  const historyAmbiguity = matchingEntries.find((entry) =>
    ambiguousKeys.has(entry.key),
  );
  if (historyAmbiguity) return historyAmbiguity;
  const availableEntries = matchingEntries.filter(
    (entry) => !consumedKeys?.has(entry.key),
  );
  const representedMatches = availableEntries.filter((entry) =>
    representedKeys.has(entry.key),
  );
  if (
    includeRepresentedDuplicates &&
    representedMatches.length > 0 &&
    availableEntries.length > 1
  ) {
    return representedMatches[0];
  }
  const candidates = matchingEntries.filter(
    (entry) =>
      !ambiguousKeys.has(entry.key) &&
      !representedKeys.has(entry.key) &&
      !consumedKeys?.has(entry.key),
  );
  const firstCandidate = candidates[0];
  if (!firstCandidate || candidates.length < 2) return undefined;
  return candidates.every(
    (entry) =>
      replayOutcomeIdentity(entry) === replayOutcomeIdentity(firstCandidate),
  )
    ? undefined
    : firstCandidate;
}

export function findInterruptedJournalEntryForCall(
  journal: ToolCallJournal,
  toolName: string,
  argumentsHash: string | undefined,
  input: unknown,
  consumedKeys?: Set<string>,
): ToolCallJournalEntry | undefined {
  const matches = journalStepEntriesForCall(
    journal.interrupted,
    toolName,
    argumentsHash,
    input,
    consumedKeys,
  );
  const match = matches.length === 1 ? matches[0] : undefined;
  if (match) consumedKeys?.add(match.key);
  return match;
}

/**
 * The earliest unclaimed finished entry with a durable step that this call's
 * identity matches. Each finished entry carries its own result, so identical
 * calls pair with identical entries in ledger order.
 */
export function findFinishedJournalStepForCall(
  entries: readonly ToolCallJournalEntry[],
  toolName: string,
  argumentsHash: string | undefined,
  input: unknown,
  consumedKeys?: Set<string>,
): ToolCallJournalEntry | undefined {
  const [match] = journalStepEntriesForCall(
    entries,
    toolName,
    argumentsHash,
    input,
    consumedKeys,
  );
  if (match) consumedKeys?.add(match.key);
  return match;
}

function journalStepEntriesForCall(
  entries: readonly ToolCallJournalEntry[],
  toolName: string,
  argumentsHash: string | undefined,
  input: unknown,
  consumedKeys: ReadonlySet<string> | undefined,
): ToolCallJournalEntry[] {
  const inputFingerprint = toolCallInputFingerprint(input);
  return entries.filter((entry) => {
    if (
      entry.tool !== toolName ||
      !entry.executionStepId ||
      consumedKeys?.has(entry.key)
    ) {
      return false;
    }
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
}

export function findInterruptedLegacyJournalEntryForCall(
  journal: ToolCallJournal,
  toolName: string,
  argumentsHash: string | undefined,
  input: unknown,
  history: readonly EngineMessage[],
  consumedKeys?: Set<string>,
):
  | { status: "none" }
  | { status: "ambiguous" }
  | { status: "matched"; entry: ToolCallJournalEntry; stepId: string } {
  const inputFingerprint = toolCallInputFingerprint(input);
  const matchesInput = (entry: ToolCallJournalEntry) =>
    entry.argumentsHash !== undefined && argumentsHash !== undefined
      ? entry.argumentsHash === argumentsHash
      : entry.inputFingerprint !== undefined
        ? entry.inputFingerprint === inputFingerprint
        : entry.input !== undefined &&
          inputSignature(entry.input) === inputSignature(input);
  const candidates = journal.interrupted.filter(
    (entry) =>
      entry.executionStepId === undefined &&
      entry.id !== undefined &&
      entry.id.length > 0 &&
      entry.tool === toolName &&
      !consumedKeys?.has(entry.key) &&
      matchesInput(entry),
  );
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length !== 1) return { status: "ambiguous" };

  const entry = candidates[0]!;
  const stepId = entry.id!;
  const sameIdJournalEntries = [
    ...journal.completed,
    ...journal.interrupted,
  ].filter((candidate) => candidate.id === stepId);
  const sameIdHistoryCalls = history.flatMap((message) =>
    message.role === "assistant"
      ? message.content.filter(
          (part) => part.type === "tool-call" && part.id === stepId,
        )
      : [],
  );
  if (
    sameIdJournalEntries.length !== 1 ||
    sameIdHistoryCalls.length > 1 ||
    (sameIdHistoryCalls.length === 1 &&
      (sameIdHistoryCalls[0]?.type !== "tool-call" ||
        sameIdHistoryCalls[0].name !== toolName ||
        toolCallInputFingerprint(sameIdHistoryCalls[0].input) !==
          inputFingerprint))
  ) {
    return { status: "ambiguous" };
  }

  consumedKeys?.add(entry.key);
  return { status: "matched", entry, stepId };
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
