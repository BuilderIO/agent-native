const CHAT_HOME_THREAD_STORAGE_KEY = "agent-native.chat-home-thread";
const CHAT_HOME_THREAD_TTL_MS = 10 * 60 * 1000;

type PendingChatHomeThread = {
  id: string;
  issuedAt: number;
};

function createChatThreadId(): string {
  return `chat-${
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36)
  }`;
}

export function getChatHomeThreadId(): string {
  const create = () => {
    const id = createChatThreadId();
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(
          CHAT_HOME_THREAD_STORAGE_KEY,
          JSON.stringify({
            id,
            issuedAt: Date.now(),
          } satisfies PendingChatHomeThread),
        );
        // coercion-ok: sessionStorage is optional startup deduplication; a fresh id remains valid when unavailable.
      } catch {
        // Session storage can be unavailable in restricted browser contexts.
      }
    }
    return id;
  };

  if (typeof window === "undefined") return create();

  try {
    const raw = window.sessionStorage.getItem(CHAT_HOME_THREAD_STORAGE_KEY);
    if (raw) {
      const pending = JSON.parse(raw) as Partial<PendingChatHomeThread>;
      if (
        typeof pending.id === "string" &&
        pending.id.startsWith("chat-") &&
        typeof pending.issuedAt === "number" &&
        Date.now() - pending.issuedAt <= CHAT_HOME_THREAD_TTL_MS
      ) {
        return pending.id;
      }
    }
    // coercion-ok: sessionStorage is optional startup deduplication; a fresh id remains valid when unavailable.
  } catch {
    // Fall through to a fresh id when the stored handoff cannot be read.
  }

  return create();
}

export function clearChatHomeThreadId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHAT_HOME_THREAD_STORAGE_KEY);
    // coercion-ok: clearing optional sessionStorage cannot invalidate the durable chat route.
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}
