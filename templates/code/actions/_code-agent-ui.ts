import {
  executeCodeAgentRun,
  executeExistingCodeAgentRun,
  getCodeAgentRunRecord,
  localCodeBackgroundAgentController,
  listBackgroundAgentTranscriptEvents,
  toBackgroundAgentRun,
  updateCodeAgentRunRecord,
  type BackgroundAgentTranscriptEvent,
  type BackgroundAgentRun,
  type CodeAgentFollowUpMode,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
  type CodeAgentTranscriptEvent as StoredTranscriptEvent,
} from "@agent-native/core/code-agents";
import type {
  CodeAgentPromptAttachment,
  CodeAgentReasoningEffort,
  CodeAgentRun,
  CodeAgentTranscriptEvent,
} from "@agent-native/code-agents-ui/types";

export function toUiRun(record: CodeAgentRunRecord): CodeAgentRun {
  return backgroundRunToUiRun(toBackgroundAgentRun(record));
}

export function backgroundRunToUiRun(record: BackgroundAgentRun): CodeAgentRun {
  return {
    id: record.id,
    goalId: record.goalId,
    title: record.title,
    subtitle: record.subtitle,
    kind: record.kind,
    source: record.source,
    sourceLabel: record.sourceLabel,
    status: record.status,
    phase: record.phase,
    needsApproval: record.needsApproval,
    progress: record.progress,
    details: record.details,
    surfaceUrl: record.surfaceUrl,
    metadata: {
      ...(record.metadata ?? {}),
      artifactRoot: record.artifactRoot,
      cwd: record.cwd,
      permissionMode: record.permissionMode,
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toUiTranscriptEvent(
  event: StoredTranscriptEvent | BackgroundAgentTranscriptEvent,
): CodeAgentTranscriptEvent {
  const type =
    event.kind === "note"
      ? "status"
      : event.kind === "system"
        ? "system"
        : event.kind === "artifact"
          ? "artifact"
          : event.kind === "user"
            ? "user"
            : "status";
  return {
    id: event.id,
    runId: event.runId,
    type,
    title: transcriptTitle(event),
    text: event.message,
    createdAt: event.createdAt,
    metadata: event.metadata,
  };
}

export function transcriptTitle(
  event: StoredTranscriptEvent | BackgroundAgentTranscriptEvent,
): string {
  if (event.kind === "user") return "User prompt";
  if (event.kind === "artifact") return "Artifact";
  if (event.metadata?.role === "assistant") return "Assistant";
  if (event.metadata?.type === "tool_start") return "Tool started";
  if (event.metadata?.type === "tool_done") return "Tool finished";
  return "Status";
}

export function listUiTranscript(runId: string): CodeAgentTranscriptEvent[] {
  return listBackgroundAgentTranscriptEvents(runId).map(toUiTranscriptEvent);
}

export function runCodeAgentInBackground(input: {
  runId: string;
  prompt?: string;
  appendUserEvent?: boolean;
  model?: string;
  reasoningEffort?: CodeAgentReasoningEffort;
  attachments?: CodeAgentPromptAttachment[];
}): void {
  setTimeout(() => {
    void executeCodeAgentRun({
      runId: input.runId,
      prompt: input.prompt,
      appendUserEvent: input.appendUserEvent,
      model: input.model,
      reasoningEffort:
        input.reasoningEffort === "auto" ? undefined : input.reasoningEffort,
      attachments: input.attachments,
    });
  }, 0);
}

export function resumeCodeAgentInBackground(runId: string): void {
  setTimeout(() => {
    void executeExistingCodeAgentRun(runId);
  }, 0);
}

export async function appendFollowUpAndRun(input: {
  runId: string;
  prompt: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort;
  followUpMode?: CodeAgentFollowUpMode;
  attachments?: CodeAgentPromptAttachment[];
}): Promise<CodeAgentTranscriptEvent> {
  const record = getCodeAgentRunRecord(input.runId);
  if (!record)
    throw new Error(`Agent-Native Code run not found: ${input.runId}`);
  if (input.permissionMode) {
    updateCodeAgentRunRecord(input.runId, {
      permissionMode: input.permissionMode,
      metadata: {
        permissionMode: input.permissionMode,
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: input.attachments }
          : {}),
      },
    });
  } else if (
    input.engine ||
    input.model ||
    input.effort ||
    (input.attachments && input.attachments.length > 0)
  ) {
    updateCodeAgentRunRecord(input.runId, {
      metadata: {
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: input.attachments }
          : {}),
      },
    });
  }
  const result = await localCodeBackgroundAgentController.sendFollowUp({
    runId: input.runId,
    prompt: input.prompt,
    mode: input.followUpMode ?? "immediate",
    permissionMode: input.permissionMode,
    model: input.model,
    reasoningEffort: input.effort === "auto" ? undefined : input.effort,
    source: "code-template-follow-up",
    metadata: {
      engine: input.engine,
      model: input.model,
      effort: input.effort,
      attachments: input.attachments,
    },
  });
  if (!result.ok) throw new Error(result.error ?? "Follow-up failed.");
  const events = await Promise.resolve(
    localCodeBackgroundAgentController.transcript(input.runId),
  );
  const event = events[events.length - 1];
  if (!event) throw new Error("Follow-up was recorded without a transcript.");
  return toUiTranscriptEvent(event);
}

export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "";
  return truncateForDisplay(firstLine || "Agent-Native Code session", 90);
}

export function truncateForDisplay(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
