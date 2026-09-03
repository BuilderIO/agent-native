/**
 * Pure helpers for agent-issued navigation commands read from
 * `/_agent-native/application-state/navigate`. Mirrors the web runtime's
 * command dedup (`_writeId` or JSON content) so both clients acknowledge the
 * same command exactly once.
 */

export interface NavigateCommand {
  view?: string;
  path?: string;
  threadId?: string;
  _writeId?: string;
}

export function navigateCommandDedupKey(command: NavigateCommand): string {
  if (typeof command._writeId === "string" && command._writeId) {
    return command._writeId;
  }
  try {
    return JSON.stringify(command);
  } catch {
    return "";
  }
}

/**
 * Thread id from a navigate command: explicit `threadId`, a `?threadId=`
 * query param, or a `/chat/:id` path segment (any app prefix, e.g.
 * `/dispatch/chat/thread-123`).
 */
export function extractThreadId(command: NavigateCommand): string | null {
  if (command.threadId) return command.threadId;
  if (!command.path) return null;
  const queryMatch = command.path.match(/[?&]threadId=([^&#]+)/);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);
  const pathMatch = command.path.match(/\/chat\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  return null;
}
