import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../../artifacts/detect.js";
import { getCurrentTurnEventsForThread } from "../run-store.js";
import {
  classifyToolCallJournal,
  type ToolCallJournal,
} from "../tool-call-journal.js";
import type { AgentChatEvent } from "../types.js";

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
      toolCallJournal: ToolCallJournal | null;
      priorToolCalls: PriorTurnToolCallSummary[];
      priorToolResults: PriorTurnToolResultSummary[];
      priorToolCallSequence: PriorTurnToolCallSequenceEntry[];
    }
  | { status: "unreadable"; error: string };

const LEDGER_READ_RETRY_MS = 250;

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
): Promise<PriorTurnToolCallJournalRead> {
  if (!threadId) {
    return {
      status: "read",
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
const LOADED_SKILL_CONTEXT_MAX_CHARS = 24_000;

export function loadedSkillPagesContext(
  results: readonly PriorTurnToolResultSummary[],
  allowedSlugs: ReadonlySet<string>,
): string {
  const pages = new Map<string, string>();
  for (const result of results) {
    if (result.name !== "docs-search" || result.isError) continue;
    const input =
      result.input && typeof result.input === "object"
        ? (result.input as Record<string, unknown>)
        : null;
    const slug = input?.slug;
    if (
      typeof slug !== "string" ||
      !slug.startsWith("skill-") ||
      !allowedSlugs.has(slug) ||
      !result.content.startsWith("# Skill:") ||
      result.content.includes("Doc not found:")
    ) {
      continue;
    }
    pages.delete(slug);
    pages.set(slug, result.content);
  }
  if (pages.size === 0) return "";

  const opening =
    "<already-loaded-skills>These skill pages were already read earlier in this turn. Reuse them instead of calling docs-search again. If a page is marked truncated, read only when missing detail matters.\n";
  const closing = "\n</already-loaded-skills>";
  let remaining =
    LOADED_SKILL_CONTEXT_MAX_CHARS - opening.length - closing.length;
  const blocks: string[] = [];
  for (const [slug, page] of pages) {
    const heading = `\n## ${slug}\n`;
    if (remaining <= heading.length) break;
    const truncated = page.length > remaining - heading.length;
    const marker = truncated
      ? "\n[Skill page truncated to fit continuation context.]"
      : "";
    const body = page.slice(
      0,
      Math.max(0, remaining - heading.length - marker.length),
    );
    blocks.push(`${heading}${body}${marker}`);
    remaining -= heading.length + body.length + marker.length;
    if (truncated) break;
  }
  return blocks.length > 0 ? `${opening}${blocks.join("\n")}${closing}` : "";
}

export function seedRepeatedToolCallCountsFromJournal(
  calls: readonly PriorTurnToolCallSequenceEntry[],
  keyForCall: (name: string, input: unknown) => string,
  isResurfacedReadOnlyDuplicate: (name: string, result: string) => boolean,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const key = keyForCall(call.name, call.input);
    if (call.event === "start") {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      continue;
    }

    const replayed = call.replayed === true;
    if (replayed || isResurfacedReadOnlyDuplicate(call.name, call.result)) {
      if (call.matchedStart) {
        const count = counts.get(key) ?? 0;
        if (count > 1) counts.set(key, count - 1);
        else counts.delete(key);
      }
      if (replayed && !call.isError && call.completedSideEffect === true) {
        for (const otherKey of counts.keys()) {
          if (otherKey !== key) counts.delete(otherKey);
        }
      }
      continue;
    }

    if (call.isError || call.completedSideEffect !== true) continue;
    if (!call.matchedStart) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const otherKey of counts.keys()) {
      if (otherKey !== key) counts.delete(otherKey);
    }
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
      if (!call.isError && call.completedSideEffect === true) {
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
      continue;
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
