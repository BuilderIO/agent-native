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
  }

  return true;
}
