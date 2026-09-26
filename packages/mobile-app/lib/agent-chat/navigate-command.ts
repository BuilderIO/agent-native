
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

export function extractThreadId(command: NavigateCommand): string | null {
  if (command.threadId) return command.threadId;
  if (!command.path) return null;
  const queryMatch = command.path.match(/[?&]threadId=([^&#]+)/);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);
  const pathMatch = command.path.match(/\/chat\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  return null;
}
