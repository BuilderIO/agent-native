import type { ActionChatUIConfig } from "../../action-ui.js";
import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../../artifacts/detect.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import {
  getCompletedAgentExecutionSteps,
  getCurrentTurnEventsForThread,
} from "../run-store.js";
import {
  classifyToolCallJournal,
  isConsistentToolCallInputFingerprint,
  toolCallInputFingerprint,
  type ToolCallJournal,
} from "../tool-call-journal.js";
import type { AgentChatEvent, AgentFileMutationProof } from "../types.js";

export interface PriorTurnToolCallSummary {
  name: string;
  input: unknown;
}

export type PriorTurnToolCallSequenceEntry =
  | ({ event: "start" } & PriorTurnToolCallSummary)
  | {
      event: "done";
      name: string;
      input: unknown;
      result: string;
      isError: boolean;
      completedSideEffect?: boolean;
      replayed?: true;
      matchedStart: boolean;
    };

export interface PriorTurnToolResultSummary {
  name: string;
  input?: unknown;
  content: string;
  isError: boolean;
  artifacts?: ArtifactReceipt[];
}

export type PriorTurnToolCallJournalRead =
  | {
      status: "read";
      events: AgentChatEvent[];
      toolCallJournal: ToolCallJournal | null;
      priorToolCalls: PriorTurnToolCallSummary[];
      priorToolResults: PriorTurnToolResultSummary[];
      priorToolCallSequence: PriorTurnToolCallSequenceEntry[];
    }
  | { status: "unreadable"; error: string };

export interface PriorTurnToolCallJournalOptions {
  /** Recover outcomes committed before a reaper successor could persist tool_done. */
  recoverCompletedExecutionSteps?: boolean;
}

const LEDGER_READ_RETRY_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function durableStepChatUI(value: unknown): ActionChatUIConfig | undefined {
  if (!isRecord(value) || typeof value.renderer !== "string") return undefined;
  return {
    renderer: value.renderer,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
  };
}

function durableStepMcpApp(value: unknown): AgentMcpAppPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.serverId !== "string" ||
    typeof value.toolName !== "string" ||
    typeof value.originalToolName !== "string" ||
    typeof value.resourceUri !== "string" ||
    !isRecord(value.toolInput) ||
    !isRecord(value.toolResult)
  ) {
    return undefined;
  }
  return value as unknown as AgentMcpAppPayload;
}

function durableStepFileMutation(
  value: unknown,
): AgentFileMutationProof | undefined {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.contentSha256 !== "string"
  ) {
    return undefined;
  }
  return { path: value.path, contentSha256: value.contentSha256 };
}

function durableStepToolDone(
  event: Extract<AgentChatEvent, { type: "tool_start" }>,
  row: {
    stepId: string;
    operationId: string;
    toolName: string;
    inputJson: string;
    resultJson: string;
  },
): Extract<AgentChatEvent, { type: "tool_done" }> {
  if (!event.id || event.id !== row.stepId || row.operationId !== row.stepId) {
    throw new Error(
      `Completed execution step ${row.stepId} does not match its ledger call id`,
    );
  }
  if (event.tool !== row.toolName) {
    throw new Error(
      `Completed execution step ${row.stepId} does not match ledger tool ${event.tool}`,
    );
  }

  let input: unknown;
  let outcome: unknown;
  try {
    input = JSON.parse(row.inputJson);
    outcome = JSON.parse(row.resultJson);
  } catch (error) {
    throw new Error(
      `Completed execution step ${row.stepId} has unreadable stored intent or result`,
      { cause: error },
    );
  }
  if (
    !isRecord(input) ||
    typeof input.argumentsHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.argumentsHash) ||
    !isRecord(input.input) ||
    !isRecord(outcome) ||
    typeof outcome.result !== "string" ||
    typeof outcome.isError !== "boolean" ||
    typeof outcome.completedSideEffect !== "boolean"
  ) {
    throw new Error(
      `Completed execution step ${row.stepId} is missing replay identity or outcome fields`,
    );
  }
  if (
    outcome.errorCode !== undefined &&
    typeof outcome.errorCode !== "string"
  ) {
    throw new Error(
      `Completed execution step ${row.stepId} has an invalid error code`,
    );
  }

  const artifacts = Array.isArray(outcome.artifacts)
    ? outcome.artifacts.filter(isArtifactReceipt)
    : [];
  const mcpApp = durableStepMcpApp(outcome.mcpApp);
  const chatUI = durableStepChatUI(outcome.chatUI);
  const fileMutation = durableStepFileMutation(outcome.fileMutation);
  return {
    type: "tool_done",
    tool: event.tool,
    id: event.id,
    input: event.input,
    ...(event.inputFingerprint
      ? { inputFingerprint: event.inputFingerprint }
      : {}),
    ...(event.inputStoredFingerprint
      ? { inputStoredFingerprint: event.inputStoredFingerprint }
      : {}),
    result: outcome.result,
    ...(outcome.isError ? { isError: true } : {}),
    ...(typeof outcome.errorCode === "string"
      ? { errorCode: outcome.errorCode }
      : {}),
    completedSideEffect: outcome.completedSideEffect,
    argumentsHash: input.argumentsHash,
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(mcpApp ? { mcpApp } : {}),
    ...(chatUI && outcome.chatUIResult !== undefined
      ? { chatUI, chatUIResult: outcome.chatUIResult }
      : {}),
    ...(fileMutation ? { fileMutation } : {}),
  };
}

export async function overlayCompletedExecutionStepOutcomes(
  threadId: string,
  turnId: string,
  events: AgentChatEvent[],
): Promise<AgentChatEvent[]> {
  const startsById = new Map<
    string,
    Array<{
      event: Extract<AgentChatEvent, { type: "tool_start" }>;
      index: number;
    }>
  >();
  const donesById = new Map<
    string,
    Array<{
      event: Extract<AgentChatEvent, { type: "tool_done" }>;
      index: number;
    }>
  >();
  events.forEach((event, index) => {
    if (event.type === "tool_start" && event.id) {
      const starts = startsById.get(event.id) ?? [];
      starts.push({ event, index });
      startsById.set(event.id, starts);
    } else if (event.type === "tool_done" && event.id) {
      const dones = donesById.get(event.id) ?? [];
      dones.push({ event, index });
      donesById.set(event.id, dones);
    }
  });
  const candidateIds = [...startsById.keys()];
  if (candidateIds.length === 0) return events;

  const rows = await getCompletedAgentExecutionSteps(
    threadId,
    turnId,
    candidateIds,
  );
  const rowsById = new Map<string, (typeof rows)[number]>();
  const replacedIndexes = new Set<number>();
  const replacementsAt = new Map<number, AgentChatEvent>();
  const replacementsAfter = new Map<number, AgentChatEvent>();
  for (const row of rows) {
    if (!candidateIds.includes(row.stepId)) {
      throw new Error(
        `Completed execution step ${row.stepId} was not requested by the ledger`,
      );
    }
    if (rowsById.has(row.stepId)) {
      throw new Error(
        `Completed execution step ${row.stepId} has ambiguous stored rows`,
      );
    }
    const starts = startsById.get(row.stepId);
    if (!starts || starts.length === 0) {
      throw new Error(
        `Completed execution step ${row.stepId} has no matching ledger call`,
      );
    }
    const canonicalStart = starts[0]!.event;
    const canonicalDone = durableStepToolDone(canonicalStart, row);
    if (
      !isConsistentToolCallInputFingerprint(
        canonicalStart.input,
        canonicalStart.inputFingerprint,
        canonicalStart.inputStoredFingerprint,
      )
    ) {
      throw new Error(
        `Completed execution step ${row.stepId} has unreadable ledger call identity`,
      );
    }
    const canonicalFingerprint = getToolCallEventFingerprint(canonicalStart);
    for (const { event } of starts.slice(1)) {
      if (
        event.tool !== canonicalStart.tool ||
        !isConsistentToolCallInputFingerprint(
          event.input,
          event.inputFingerprint,
          event.inputStoredFingerprint,
        ) ||
        getToolCallEventFingerprint(event) !== canonicalFingerprint
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} has conflicting ledger call identities`,
        );
      }
    }

    const dones = donesById.get(row.stepId) ?? [];
    for (const { event } of dones) {
      if (
        event.tool !== row.toolName ||
        !isConsistentToolCallInputFingerprint(
          event.input,
          event.inputFingerprint,
          event.inputStoredFingerprint,
        )
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done identity`,
        );
      }
      const doneFingerprint = getToolCallEventFingerprint(event);
      if (
        canonicalFingerprint !== undefined &&
        doneFingerprint !== undefined &&
        doneFingerprint !== canonicalFingerprint
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done input`,
        );
      }
      if (
        event.argumentsHash !== undefined &&
        event.argumentsHash !== canonicalDone.argumentsHash
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done arguments`,
        );
      }
      if (
        event.completedSideEffect !== undefined &&
        event.completedSideEffect !== canonicalDone.completedSideEffect
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done side-effect outcome`,
        );
      }
      if (event.isError === true && canonicalDone.isError !== true) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done error outcome`,
        );
      }
      if (
        event.errorCode !== undefined &&
        event.errorCode !== canonicalDone.errorCode
      ) {
        throw new Error(
          `Completed execution step ${row.stepId} conflicts with its tool_done error code`,
        );
      }
    }

    rowsById.set(row.stepId, row);

    for (const { index } of starts) replacedIndexes.add(index);
    for (const { index } of dones) replacedIndexes.add(index);
    const firstStartIndex = starts[0]!.index;
    const lastStartIndex = starts.at(-1)!.index;
    const lastDoneIndex = dones.at(-1)?.index ?? -1;
    const doneIndex = Math.max(lastStartIndex, lastDoneIndex);
    replacementsAfter.set(doneIndex, canonicalDone);
    replacementsAt.set(firstStartIndex, canonicalStart);
  }

  const overlaid: AgentChatEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (replacedIndexes.has(index)) {
      const replacement = replacementsAt.get(index);
      if (replacement) overlaid.push(replacement);
    } else {
      overlaid.push(event);
    }
    const replacementAfter = replacementsAfter.get(index);
    if (replacementAfter?.type === "tool_done") {
      overlaid.push(replacementAfter);
    }
  }
  return overlaid;
}

function getToolCallEventFingerprint(
  event: Extract<AgentChatEvent, { type: "tool_start" | "tool_done" }>,
): string | undefined {
  return (
    event.inputFingerprint ??
    (event.input === undefined
      ? undefined
      : toolCallInputFingerprint(event.input))
  );
}

async function readCurrentTurnEventsWithRetry(
  threadId: string,
  turnId?: string,
): Promise<AgentChatEvent[]> {
  try {
    return await getCurrentTurnEventsForThread(threadId, turnId);
  } catch (err) {
    console.warn(
      `[tool-call-journal] per-turn ledger read failed for thread ${threadId}, retrying once: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await new Promise((resolve) => setTimeout(resolve, LEDGER_READ_RETRY_MS));
    return await getCurrentTurnEventsForThread(threadId, turnId);
  }
}

export async function loadPriorTurnToolCallJournal(
  threadId: string | undefined,
  turnId?: string,
  options: PriorTurnToolCallJournalOptions = {},
): Promise<PriorTurnToolCallJournalRead> {
  if (options.recoverCompletedExecutionSteps && (!threadId || !turnId)) {
    return {
      status: "unreadable",
      error:
        "Reaper recovery requires a thread and turn id to read execution steps.",
    };
  }
  if (!threadId) {
    return {
      status: "read",
      events: [],
      toolCallJournal: null,
      priorToolCalls: [],
      priorToolResults: [],
      priorToolCallSequence: [],
    };
  }
  let priorEvents: AgentChatEvent[];
  try {
    priorEvents = await readCurrentTurnEventsWithRetry(threadId, turnId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      `[tool-call-journal] per-turn ledger read failed for thread ${threadId}: ${error}`,
    );
    return { status: "unreadable", error };
  }
  if (options.recoverCompletedExecutionSteps) {
    try {
      priorEvents = await overlayCompletedExecutionStepOutcomes(
        threadId,
        turnId!,
        priorEvents,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(
        `[tool-call-journal] execution-step recovery read failed for thread ${threadId}: ${error}`,
      );
      return { status: "unreadable", error };
    }
  }
  const priorToolCalls: PriorTurnToolCallSummary[] = [];
  const priorToolResults: PriorTurnToolResultSummary[] = [];
  const priorToolCallSequence: PriorTurnToolCallSequenceEntry[] = [];
  const openCallsById = new Map<string, PriorTurnToolCallSummary>();
  const openCallsByTool = new Map<string, PriorTurnToolCallSummary[]>();
  for (const event of priorEvents) {
    if (event.type === "tool_start") {
      priorToolCalls.push({ name: event.tool, input: event.input });
      const call = { name: event.tool, input: event.input };
      priorToolCallSequence.push({ event: "start", ...call });
      if (event.id) openCallsById.set(event.id, call);
      const queue = openCallsByTool.get(event.tool);
      if (queue) queue.push(call);
      else openCallsByTool.set(event.tool, [call]);
    } else if (event.type === "tool_done") {
      const queue = openCallsByTool.get(event.tool);
      const call = event.id ? openCallsById.get(event.id) : queue?.[0];
      if (call) {
        const index = queue?.indexOf(call) ?? -1;
        if (index >= 0) queue!.splice(index, 1);
        if (event.id) openCallsById.delete(event.id);
      }
      priorToolCallSequence.push({
        event: "done",
        name: event.tool,
        input: event.input ?? call?.input,
        result: event.result,
        isError: event.isError === true,
        ...(event.completedSideEffect === true
          ? { completedSideEffect: true }
          : {}),
        ...(event.replayed === true ? { replayed: true } : {}),
        matchedStart: call !== undefined,
      });
      const artifacts = event.artifacts?.filter(isArtifactReceipt);
      priorToolResults.push({
        name: event.tool,
        input: event.input ?? call?.input,
        content: event.result,
        isError: event.isError === true,
        ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
      });
    }
  }
  return {
    status: "read",
    events: priorEvents,
    toolCallJournal:
      priorEvents.length > 0 ? classifyToolCallJournal(priorEvents) : null,
    priorToolCalls,
    priorToolResults,
    priorToolCallSequence,
  };
}

export const JOURNALED_TOOL_REPLAY_PREFIX =
  "(Already completed in an earlier interrupted attempt - not re-run to avoid a duplicate side effect.)\n\n";
export const RECOVERED_TOOL_REPLAY_PREFIX =
  "(Recovered from prior interrupted chunk — action already completed.)\n\n";
const LOADED_SKILL_CONTEXT_MAX_CHARS = 40_000;
const OMITTED_NOTICE_RESERVE_CHARS = 1_000;

export function loadedSkillPagesContext(
  results: readonly PriorTurnToolResultSummary[],
  threadPages: ReadonlyMap<string, string>,
  currentSkillBodies: ReadonlyMap<string, string>,
  isInHistory: (slug: string, page: string) => boolean = () => false,
): string {
  const pages = new Map<string, string>();
  for (const result of results) {
    if (result.name !== "docs-search" || result.isError) continue;
    const input =
      result.input && typeof result.input === "object"
        ? (result.input as Record<string, unknown>)
        : null;
    const slug = input?.slug;
    const currentBody =
      typeof slug === "string" ? currentSkillBodies.get(slug) : undefined;
    // A journaled read may predate a skill edit or have been truncated; only
    // reuse it if it still holds the skill's current body.
    if (
      typeof slug !== "string" ||
      !slug.startsWith("skill-") ||
      currentBody === undefined ||
      !result.content.startsWith("# Skill:") ||
      result.content.includes("Doc not found:") ||
      !result.content.includes(currentBody.trim())
    ) {
      continue;
    }
    pages.delete(slug);
    pages.set(slug, result.content);
  }
  const merged = new Map(threadPages);
  for (const [slug, page] of pages) {
    merged.delete(slug);
    merged.set(slug, page);
  }
  for (const [slug, page] of merged) {
    if (isInHistory(slug, page)) merged.delete(slug);
  }
  return renderLoadedSkillPages(merged);
}

// Newest reads win the budget: they are likeliest to apply to the current task.
function renderLoadedSkillPages(pages: ReadonlyMap<string, string>): string {
  if (pages.size === 0) return "";

  const opening =
    "<already-loaded-skills>These skill pages were already read earlier in this conversation. Reuse them instead of calling docs-search again. If a page is marked truncated or listed as omitted, read it with docs-search when missing detail matters.\n";
  const closing = "\n</already-loaded-skills>";
  let remaining =
    LOADED_SKILL_CONTEXT_MAX_CHARS -
    opening.length -
    closing.length -
    OMITTED_NOTICE_RESERVE_CHARS;
  const blocks: string[] = [];
  const entries = [...pages].reverse();
  let omitted: string[] = [];
  for (const [index, [slug, page]] of entries.entries()) {
    const heading = `\n## ${slug}\n`;
    if (remaining <= heading.length) {
      omitted = entries.slice(index).map(([omittedSlug]) => omittedSlug);
      break;
    }
    const truncated = page.length > remaining - heading.length;
    const marker = truncated
      ? "\n[Skill page truncated to fit loaded-skill context.]"
      : "";
    const body = page.slice(
      0,
      Math.max(0, remaining - heading.length - marker.length),
    );
    blocks.push(`${heading}${body}${marker}`);
    remaining -= heading.length + body.length + marker.length;
    if (truncated) {
      omitted = entries.slice(index + 1).map(([omittedSlug]) => omittedSlug);
      break;
    }
  }
  if (blocks.length === 0) return "";
  if (omitted.length > 0) {
    const prefix =
      "\n[Omitted to fit loaded-skill context; read with docs-search if needed: ";
    const names = omitted
      .join(", ")
      .slice(0, OMITTED_NOTICE_RESERVE_CHARS - prefix.length - 4);
    blocks.push(`${prefix}${names}]`);
  }
  return `${opening}${blocks.join("\n")}${closing}`;
}

export function seedRepeatedToolCallCountsFromJournal(
  calls: readonly PriorTurnToolCallSequenceEntry[],
  keyForCall: (name: string, input: unknown) => string,
  isResurfacedReadOnlyDuplicate: (name: string, result: string) => boolean,
): Map<string, number> {
  const counts = new Map<string, number>();
  const pendingStarts = new Map<string, number>();
  const resetOtherCountsAfterWrite = (successfulWriteKey: string) => {
    for (const otherKey of counts.keys()) {
      if (
        otherKey !== successfulWriteKey &&
        (pendingStarts.get(otherKey) ?? 0) === 0
      ) {
        counts.delete(otherKey);
      }
    }
  };
  for (const call of calls) {
    const key = keyForCall(call.name, call.input);
    if (call.event === "start") {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      pendingStarts.set(key, (pendingStarts.get(key) ?? 0) + 1);
      continue;
    }

    if (call.matchedStart) {
      const pending = pendingStarts.get(key) ?? 0;
      if (pending > 1) pendingStarts.set(key, pending - 1);
      else pendingStarts.delete(key);
    }

    const replayed = call.replayed === true;
    if (replayed || isResurfacedReadOnlyDuplicate(call.name, call.result)) {
      if (call.matchedStart) {
        const count = counts.get(key) ?? 0;
        if (count > 1) counts.set(key, count - 1);
        else counts.delete(key);
      }
      if (replayed && call.completedSideEffect === true) {
        resetOtherCountsAfterWrite(key);
      }
      continue;
    }

    // A call that failed after its write completed still made progress.
    if (call.completedSideEffect !== true) continue;
    if (!call.matchedStart) counts.set(key, (counts.get(key) ?? 0) + 1);
    resetOtherCountsAfterWrite(key);
  }
  return counts;
}

export function seedRepeatedToolErrorCountsFromJournal(
  calls: readonly PriorTurnToolCallSequenceEntry[],
  keyForCall: (name: string, input: unknown) => string,
  normalizeError: (error: string) => string,
): {
  sameArguments: Map<string, number>;
  sameTool: Map<string, number>;
} {
  const sameArguments = new Map<string, number>();
  const sameTool = new Map<string, number>();
  for (const call of calls) {
    if (call.event === "start") continue;

    if (call.replayed) {
      if (call.completedSideEffect === true) {
        const successfulWriteKey = keyForCall(call.name, call.input);
        for (const key of sameArguments.keys()) {
          if (!key.startsWith(`${successfulWriteKey}:`)) {
            sameArguments.delete(key);
          }
        }
        for (const key of sameTool.keys()) {
          if (!key.startsWith(`${call.name}:`)) sameTool.delete(key);
        }
      }
      continue;
    }

    if (call.isError) {
      const error = normalizeError(call.result);
      const toolKey = `${call.name}:${error}`;
      sameTool.set(toolKey, (sameTool.get(toolKey) ?? 0) + 1);
      const callKey = `${keyForCall(call.name, call.input)}:${error}`;
      sameArguments.set(callKey, (sameArguments.get(callKey) ?? 0) + 1);
    }

    if (call.completedSideEffect !== true) continue;
    const successfulWriteKey = keyForCall(call.name, call.input);
    for (const key of sameArguments.keys()) {
      if (!key.startsWith(`${successfulWriteKey}:`)) sameArguments.delete(key);
    }
    for (const key of sameTool.keys()) {
      if (!key.startsWith(`${call.name}:`)) sameTool.delete(key);
    }
  }
  return { sameArguments, sameTool };
}
