// Owns: typed helpers for reading/comparing the assistant-ui message repository shape.

// The assistant-ui ExportedMessageRepository type is structurally complex and
// the normalised internal form diverges slightly. We define a structural
// interface covering the shapes both `threadRuntime.export()` and
// `normalizeThreadRepository()` produce, and use it everywhere instead of `any`.

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

/** Entry in `repo.messages` — may be flat or wrapped `{ message: RepoMessage }`. */
export interface RepoEntry {
  parentId?: string | null;
  message?: RepoMessage;
  // Flat (unwrapped) fields are also legal:
  id?: string;
  role?: string;
  status?: RepoMessageStatus;
  content?: string | RepoMessageContent[];
  [key: string]: unknown;
}

/** Minimal structure of the normalised thread repository used by AssistantChat. */
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

/**
 * Collapse duplicate message ids before a repository is handed to
 * `threadRuntime.import()`. assistant-ui's `MessageRepository` throws
 * "MessageRepository(performOp/link): A message with the same id already exists
 * in the parent tree" when the imported messages contain the same id more than
 * once (Sentry AGENT-NATIVE-BROWSER-2Q). Duplicate ids are never valid thread
 * data — they come from optimistic+echo races, streaming reconnect replays, or
 * multi-tab merges — so keep only the LAST occurrence of each id (the most
 * recent, most complete copy). parentId references stay valid because the
 * surviving entry keeps the same id.
 *
 * Returns the input unchanged (same reference) when there are no duplicates, so
 * the overwhelmingly common no-dupe case is a cheap no-op with zero behavioural
 * change for normal threads.
 */
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
    // Keep id-less entries untouched; for duplicated ids keep only the last.
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

export function shouldImportServerThreadData(
  currentRepo: NormalizedRepo | null | undefined,
  incomingRepo: NormalizedRepo | null | undefined,
): boolean {
  const incomingCount = getRepoMessages(incomingRepo).length;
  if (incomingCount === 0) return false;

  const currentCount = getRepoMessages(currentRepo).length;
  if (currentCount === 0) return true;
  if (incomingCount < currentCount) return false;

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
