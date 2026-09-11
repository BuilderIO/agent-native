import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  listCodeAgentRunRecords,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
  type CodeAgentTranscriptEvent,
} from "./code-agent-runs.js";

export interface CodeAgentThreadSummary {
  id: string;
  goalId: string;
  title: string;
  status: CodeAgentRunRecord["status"];
  updatedAt: string;
  source?: string;
}

export interface CreateCodeAgentThreadInput {
  title?: string;
  prompt: string;
  cwd: string;
  permissionMode?: CodeAgentPermissionMode;
  sourceRunId: string;
  sourceRunTitle?: string;
}

export interface CreateCodeAgentThreadResult {
  run: CodeAgentRunRecord;
  event: CodeAgentTranscriptEvent;
}

export interface MessageCodeAgentThreadInput {
  targetRunId: string;
  prompt: string;
  sourceRunId: string;
  sourceRunTitle?: string;
}

export interface MessageCodeAgentThreadResult {
  run: CodeAgentRunRecord;
  event: CodeAgentTranscriptEvent;
}

export function listCodeAgentThreadSummaries(
  query?: string,
): CodeAgentThreadSummary[] {
  const normalizedQuery = query?.trim().toLowerCase();
  return listCodeAgentRunRecords()
    .filter((run) => {
      if (!normalizedQuery) return true;
      return `${run.title} ${run.id}`.toLowerCase().includes(normalizedQuery);
    })
    .map((run) => ({
      id: run.id,
      goalId: run.goalId,
      title: run.title,
      status: run.status,
      updatedAt: run.updatedAt,
      source:
        typeof run.metadata?.source === "string"
          ? run.metadata.source
          : undefined,
    }));
}

export function createCodeAgentThread(
  input: CreateCodeAgentThreadInput,
): CreateCodeAgentThreadResult {
  const prompt = requiredText(input.prompt, "Thread prompt");
  const title = requiredText(
    input.title ?? titleFromPrompt(prompt),
    "Thread title",
  );
  const now = new Date().toISOString();
  const run = createCodeAgentRunRecord({
    goalId: "task",
    title,
    subtitle: "Created by another agent",
    status: "queued",
    phase: "queued",
    permissionMode: input.permissionMode ?? "full-auto",
    cwd: input.cwd,
    metadata: {
      source: "agent",
      sourceRunId: input.sourceRunId,
      ...(input.sourceRunTitle ? { sourceRunTitle: input.sourceRunTitle } : {}),
      createdByAgent: true,
      startRequested: true,
      createdAtByAgent: now,
      initialPrompt: prompt,
    },
  });
  const event = appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "user",
    message: prompt,
    metadata: {
      source: "agent",
      sourceRunId: input.sourceRunId,
      ...(input.sourceRunTitle ? { sourceRunTitle: input.sourceRunTitle } : {}),
      threadCreated: true,
    },
  });
  return { run, event };
}

export function messageCodeAgentThread(
  input: MessageCodeAgentThreadInput,
): MessageCodeAgentThreadResult {
  const prompt = requiredText(input.prompt, "Thread message");
  if (!input.targetRunId || input.targetRunId === input.sourceRunId) {
    throw new Error("Choose a different target thread.");
  }
  const target = getCodeAgentRunRecord(input.targetRunId);
  if (!target) throw new Error(`Thread not found: ${input.targetRunId}`);
  const event = appendCodeAgentTranscriptEvent({
    runId: target.id,
    kind: "user",
    message: prompt,
    metadata: {
      source: "agent",
      sourceRunId: input.sourceRunId,
      ...(input.sourceRunTitle ? { sourceRunTitle: input.sourceRunTitle } : {}),
    },
  });
  const followUp = queueCodeAgentFollowUp({
    runId: target.id,
    prompt,
    mode: "queued",
    eventId: event.id,
    source: "agent",
  });
  if (!followUp) throw new Error(`Could not queue a message for ${target.id}`);
  const run =
    updateCodeAgentRunRecord(target.id, {
      metadata: {
        startRequested: true,
        lastMessageSource: "agent",
        lastMessageSourceRunId: input.sourceRunId,
      },
    }) ?? target;
  return { run, event };
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, 8_000);
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const normalized = firstLine.replace(/^\/+[a-z0-9-]+\s*/i, "").trim();
  if (!normalized) return "Agent-created thread";
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}
