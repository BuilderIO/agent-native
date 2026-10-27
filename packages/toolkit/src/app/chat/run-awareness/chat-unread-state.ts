import {
  compareAndSetClientAppState,
  readClientAppState,
  readClientAppStateMany,
} from "@agent-native/core/client/application-state";
import { useChangeVersions } from "@agent-native/core/client/use-change-version";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Per-user `application_state` key holding chats whose run finished while the
 * user was not viewing them, so the dot follows the user across tabs, reloads
 * and devices, and the agent can read it.
 */
export const CHAT_UNREAD_STATE_KEY = "chat-unread";

/** Oldest entries drop first so the row stays well under the hosted size cap. */
export const MAX_UNREAD_CHATS = 200;
const MAX_WRITE_ATTEMPTS = 5;

export interface ChatUnreadState {
  /** Thread id to the time its unread reply finished, in ms. */
  threads: Readonly<Record<string, number>>;
}

export const EMPTY_CHAT_UNREAD_STATE: ChatUnreadState = { threads: {} };

export class ChatUnreadStateUnreadableError extends Error {
  constructor(readonly value: unknown) {
    super(
      `Application state "${CHAT_UNREAD_STATE_KEY}" does not hold unread chats.`,
    );
    this.name = "ChatUnreadStateUnreadableError";
  }
}

/** `null` is a user with nothing unread; any other non-matching value throws. */
export function parseChatUnreadState(value: unknown): ChatUnreadState {
  if (value === null) return EMPTY_CHAT_UNREAD_STATE;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatUnreadStateUnreadableError(value);
  }
  const threads = (value as { threads?: unknown }).threads;
  if (!threads || typeof threads !== "object" || Array.isArray(threads)) {
    throw new ChatUnreadStateUnreadableError(value);
  }
  for (const finishedAt of Object.values(threads)) {
    if (typeof finishedAt !== "number" || !Number.isFinite(finishedAt)) {
      throw new ChatUnreadStateUnreadableError(value);
    }
  }
  return { threads: threads as Record<string, number> };
}

export function withChatUnread(
  state: ChatUnreadState,
  threadId: string,
  finishedAt: number,
): ChatUnreadState {
  if (state.threads[threadId] === finishedAt) return state;
  const entries = Object.entries(state.threads).filter(
    ([id]) => id !== threadId,
  );
  entries.push([threadId, finishedAt]);
  entries.sort((a, b) => a[1] - b[1]);
  return {
    threads: Object.fromEntries(entries.slice(-MAX_UNREAD_CHATS)),
  };
}

export function withChatRead(
  state: ChatUnreadState,
  threadId: string,
): ChatUnreadState {
  if (!(threadId in state.threads)) return state;
  const threads = { ...state.threads };
  delete threads[threadId];
  return { threads };
}

/**
 * What a chat list knows about unread chats. While loading or unreadable no
 * chat is reported unread, and `status` says which.
 */
export type ChatUnreadThreads =
  | { status: "loading"; unreadThreadIds: ReadonlySet<string> }
  | {
      status: "unreadable";
      error: unknown;
      unreadThreadIds: ReadonlySet<string>;
    }
  | { status: "ready"; unreadThreadIds: ReadonlySet<string> };

const NO_THREADS: ReadonlySet<string> = new Set();
const LOADING: ChatUnreadThreads = {
  status: "loading",
  unreadThreadIds: NO_THREADS,
};

let snapshot: ChatUnreadThreads = LOADING;
// Bumped by every read and write so a slower, older read never overwrites a
// newer value.
let generation = 0;
let requestedVersion: number | null = null;
const listeners = new Set<() => void>();

function publish(next: ChatUnreadThreads): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function publishState(state: ChatUnreadState): void {
  publish({
    status: "ready",
    unreadThreadIds: new Set(Object.keys(state.threads)),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ChatUnreadThreads {
  return snapshot;
}

function getServerSnapshot(): ChatUnreadThreads {
  return LOADING;
}

export async function refreshChatUnreadState(): Promise<void> {
  const token = ++generation;
  try {
    const state = parseChatUnreadState(
      await readClientAppState(CHAT_UNREAD_STATE_KEY),
    );
    if (token === generation) publishState(state);
  } catch (error) {
    if (token === generation) {
      publish({ status: "unreadable", error, unreadThreadIds: NO_THREADS });
    }
  }
}

async function updateChatUnreadState(
  update: (state: ChatUnreadState) => ChatUnreadState,
): Promise<ChatUnreadState> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const batch = await readClientAppStateMany([CHAT_UNREAD_STATE_KEY]);
    const stored =
      CHAT_UNREAD_STATE_KEY in batch.values
        ? batch.values[CHAT_UNREAD_STATE_KEY]
        : null;
    const current = parseChatUnreadState(stored);
    const next = update(current);
    if (next !== current) {
      // The compare is on the stored text, so it carries the row exactly as read.
      const expected =
        stored === null ? null : (stored as Record<string, unknown>);
      const value = Object.keys(next.threads).length
        ? { threads: next.threads }
        : null;
      if (expected !== null || value !== null) {
        const changed = await compareAndSetClientAppState(
          CHAT_UNREAD_STATE_KEY,
          expected,
          value,
          { requestSource: "chat-unread" },
        );
        if (!changed) continue;
      }
    }
    generation += 1;
    publishState(next);
    return next;
  }
  throw new Error(
    `Unread chats changed ${MAX_WRITE_ATTEMPTS} times during one update; the change was not saved.`,
  );
}

export function markChatThreadUnread(
  threadId: string,
  finishedAt: number = Date.now(),
): Promise<ChatUnreadState> {
  return updateChatUnreadState((state) =>
    withChatUnread(state, threadId, finishedAt),
  );
}

export function markChatThreadRead(threadId: string): Promise<ChatUnreadState> {
  return updateChatUnreadState((state) => withChatRead(state, threadId));
}

/**
 * The signed-in user's unread chats, shared by every list on the page. With
 * `enabled`, the first mount loads them and a change to the key from another
 * tab or device (delivered by `useDbSync`) reloads them; without it, the hook
 * only reports what is already loaded.
 */
export function useChatUnreadThreads({
  enabled = true,
}: { enabled?: boolean } = {}): ChatUnreadThreads {
  const version = useChangeVersions([
    `app-state:${CHAT_UNREAD_STATE_KEY}`,
    "app-state:*",
  ]);
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  useEffect(() => {
    if (!enabled || requestedVersion === version) return;
    requestedVersion = version;
    void refreshChatUnreadState();
  }, [enabled, version]);
  return current;
}

export function resetChatUnreadStateForTests(): void {
  snapshot = LOADING;
  generation = 0;
  requestedVersion = null;
  listeners.clear();
}
