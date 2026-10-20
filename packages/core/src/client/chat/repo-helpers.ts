import { ASSISTANT_RUN_DURATION_METADATA_KEY } from "../../agent/thread-data-builder.js";

export interface RepoMessageStatus {
  type?: string;
  reason?: string;
}

export interface RepoMessageContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface RepoMessage {
  id?: string;
  role?: string;
  status?: RepoMessageStatus;
  content?: string | RepoMessageContent[];
  metadata?: Record<string, unknown>;
  createdAt?: Date | string | number;
  [key: string]: unknown;
}

export interface RepoEntry {
  parentId?: string | null;
  message?: RepoMessage;
  id?: string;
  role?: string;
  status?: RepoMessageStatus;
  content?: string | RepoMessageContent[];
  [key: string]: unknown;
}

export interface NormalizedRepo {
  messages?: RepoEntry[];
  headId?: string;
  queuedMessages?: unknown[];
  [key: string]: unknown;
}

export function getRepoMessages(
  repo: NormalizedRepo | null | undefined,
): RepoEntry[] {
  return Array.isArray(repo?.messages) ? repo.messages : [];
}

export function getRepoMessage(entry: RepoEntry): RepoMessage | null {
  return (entry?.message ?? entry) as RepoMessage | null;
}

export function getAssistantRunDurationMs(
  message:
    | {
        metadata?: unknown;
      }
    | null
    | undefined,
): number | null {
  const metadata =
    message?.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : null;
  const custom =
    metadata?.custom && typeof metadata.custom === "object"
      ? (metadata.custom as Record<string, unknown>)
      : null;
  const durationMs = custom?.[ASSISTANT_RUN_DURATION_METADATA_KEY];
  return typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
    ? durationMs
    : null;
}

export function withLastAssistantRunDuration<T extends NormalizedRepo>(
  repo: T,
  durationMs: number | null | undefined,
): T {
  if (
    !Array.isArray(repo.messages) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return repo;
  }

  let messageIndex = -1;
  for (let index = repo.messages.length - 1; index >= 0; index -= 1) {
    if (getRepoMessage(repo.messages[index]!)?.role === "assistant") {
      messageIndex = index;
      break;
    }
  }
  if (messageIndex < 0) return repo;

  const entry = repo.messages[messageIndex]!;
  const message = getRepoMessage(entry);
  if (!message || getAssistantRunDurationMs(message) === durationMs) {
    return repo;
  }

  const metadata = message.metadata ?? {};
  const custom =
    metadata.custom && typeof metadata.custom === "object"
      ? (metadata.custom as Record<string, unknown>)
      : {};
  const nextMessage: RepoMessage = {
    ...message,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        [ASSISTANT_RUN_DURATION_METADATA_KEY]: durationMs,
      },
    },
  };
  const messages = repo.messages.slice();
  messages[messageIndex] =
    entry.message === undefined
      ? (nextMessage as RepoEntry)
      : { ...entry, message: nextMessage };
  return { ...repo, messages };
}

export function dedupeRepoMessagesById<T extends NormalizedRepo>(
  repo: T | null | undefined,
): T | null | undefined {
  if (!repo || !Array.isArray(repo.messages)) return repo;
  const entries = repo.messages;
  const lastIndexById = new Map<string, number>();
  let hasDuplicate = false;
  entries.forEach((entry, index) => {
    const id = getRepoMessage(entry)?.id;
    if (typeof id !== "string" || !id) return;
    if (lastIndexById.has(id)) hasDuplicate = true;
    lastIndexById.set(id, index);
  });
  if (!hasDuplicate) return repo;
  const deduped = entries.filter((entry, index) => {
    const id = getRepoMessage(entry)?.id;
    if (typeof id !== "string" || !id) return true;
    return lastIndexById.get(id) === index;
  });
  return { ...repo, messages: deduped };
}

function repoMessageContentIsEmpty(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return true;
  return !content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const type = (part as { type?: unknown }).type;
    if (type === "text") {
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" && text.trim().length > 0;
    }
    return true;
  });
}

function entryWithParentId(
  entry: RepoEntry,
  parentId: string | null,
): RepoEntry {
  return { ...entry, parentId };
}

function repairRepoLinks<T extends NormalizedRepo>(
  repo: T,
  entries: RepoEntry[],
): T {
  const seenIds = new Set<string>();
  let previousId: string | null = null;
  const repaired: RepoEntry[] = [];

  for (const entry of entries) {
    const id = getRepoMessage(entry)?.id;
    if (typeof id !== "string" || !id) continue;
    const requestedParentId = entry.parentId;
    const parentId =
      requestedParentId === null
        ? null
        : typeof requestedParentId === "string" &&
            seenIds.has(requestedParentId)
          ? requestedParentId
          : previousId;
    repaired.push(entryWithParentId(entry, parentId));
    seenIds.add(id);
    previousId = id;
  }

  const headId =
    typeof repo.headId === "string" && seenIds.has(repo.headId)
      ? repo.headId
      : previousId;
  return { ...repo, messages: repaired, headId: headId ?? undefined };
}

export function dropEmptyAssistantMessages<T extends NormalizedRepo>(
  repo: T | null | undefined,
): T | null | undefined {
  if (!repo || !Array.isArray(repo.messages)) return repo;

  let changed = false;
  const messages = repo.messages.filter((entry) => {
    const message = getRepoMessage(entry);
    const drop =
      message?.role === "assistant" &&
      repoMessageContentIsEmpty(message.content);
    if (drop) changed = true;
    return !drop;
  });

  if (!changed) return repo;
  return repairRepoLinks(repo, messages);
}

export function isAssistantMessageTerminal(
  message: RepoMessage | null,
): boolean {
  const statusType = message?.status?.type;
  return statusType === "complete" || statusType === "incomplete";
}

export function repoHasAssistantMessage(
  repo: NormalizedRepo | null | undefined,
): boolean {
  return getRepoMessages(repo).some(
    (m) => getRepoMessage(m)?.role === "assistant",
  );
}

function repoTextLength(repo: NormalizedRepo | null | undefined): number {
  let length = 0;
  for (const entry of getRepoMessages(repo)) {
    const message = getRepoMessage(entry);
    const content = message?.content;
    if (typeof content === "string") {
      length += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          length += part.text.length;
        }
      }
    }
  }
  return length;
}

function repoTerminalAssistantCount(
  repo: NormalizedRepo | null | undefined,
): number {
  return getRepoMessages(repo).filter((entry) => {
    const message = getRepoMessage(entry);
    return message?.role === "assistant" && isAssistantMessageTerminal(message);
  }).length;
}

function toolCallProgressScore(part: RepoMessageContent): number {
  if (part.type !== "tool-call") return 0;
  let score = 1;
  if (part.activity !== true) score += 1;
  if ("result" in part) score += 4;
  return score;
}

function repoToolCallProgress(repo: NormalizedRepo | null | undefined): {
  total: number;
  materialized: number;
  completed: number;
  score: number;
} {
  const progress = {
    total: 0,
    materialized: 0,
    completed: 0,
    score: 0,
  };
  for (const entry of getRepoMessages(repo)) {
    const message = getRepoMessage(entry);
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== "tool-call") continue;
      progress.total += 1;
      if (part.activity !== true) progress.materialized += 1;
      if ("result" in part) progress.completed += 1;
      progress.score += toolCallProgressScore(part);
    }
  }
  return progress;
}

function repoAttachmentCount(repo: NormalizedRepo | null | undefined): number {
  let count = 0;
  for (const entry of getRepoMessages(repo)) {
    const message = getRepoMessage(entry);
    const attachments = message?.attachments;
    if (Array.isArray(attachments)) count += attachments.length;
  }
  return count;
}

function repoAttachmentIdentities(
  repo: NormalizedRepo | null | undefined,
): string[] {
  const identities: string[] = [];
  getRepoMessages(repo).forEach((entry, messageIndex) => {
    const message = getRepoMessage(entry);
    const attachments = message?.attachments;
    if (!Array.isArray(attachments)) return;
    attachments.forEach((attachment, index) => {
      const value =
        attachment && typeof attachment === "object"
          ? (attachment as Record<string, unknown>)
          : {};
      const metadata =
        value.metadata && typeof value.metadata === "object"
          ? (value.metadata as Record<string, unknown>)
          : {};
      identities.push(
        JSON.stringify([
          messageIndex,
          index,
          typeof value.type === "string" ? value.type : "",
          typeof value.name === "string" ? value.name : "",
          typeof value.contentType === "string" ? value.contentType : "",
          value.displayOnly === true || metadata.displayOnly === true,
        ]),
      );
    });
  });
  return identities;
}

export function shouldImportServerThreadData(
  currentRepo: NormalizedRepo | null | undefined,
  incomingRepo: NormalizedRepo | null | undefined,
): boolean {
  const incomingCount = getRepoMessages(incomingRepo).length;
  if (incomingCount === 0) return false;

  const currentCount = getRepoMessages(currentRepo).length;
  if (currentCount === 0) return true;
  if (incomingCount < currentCount) return false;

  const currentAttachments = repoAttachmentCount(currentRepo);
  const incomingAttachments = repoAttachmentCount(incomingRepo);
  if (incomingAttachments < currentAttachments) {
    return false;
  }
  const currentAttachmentIdentities = repoAttachmentIdentities(currentRepo);
  const incomingAttachmentIdentities = repoAttachmentIdentities(incomingRepo);
  if (
    currentAttachments > 0 &&
    currentAttachmentIdentities.some(
      (identity, index) => incomingAttachmentIdentities[index] !== identity,
    )
  ) {
    return false;
  }

  if (incomingCount === currentCount) {
    const currentTerminalAssistants = repoTerminalAssistantCount(currentRepo);
    const incomingTerminalAssistants = repoTerminalAssistantCount(incomingRepo);
    if (incomingTerminalAssistants < currentTerminalAssistants) {
      return false;
    }
    if (
      incomingTerminalAssistants <= currentTerminalAssistants &&
      repoTextLength(incomingRepo) < repoTextLength(currentRepo)
    ) {
      return false;
    }
    const currentTools = repoToolCallProgress(currentRepo);
    const incomingTools = repoToolCallProgress(incomingRepo);
    if (
      incomingTools.total < currentTools.total ||
      incomingTools.materialized < currentTools.materialized ||
      incomingTools.completed < currentTools.completed ||
      incomingTools.score < currentTools.score
    ) {
      return false;
    }
  }

  return true;
}
