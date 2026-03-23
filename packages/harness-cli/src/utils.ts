import fs from "fs";
import path from "path";

// Simple mutex for serializing CLI invocations
let chatLock: Promise<void> = Promise.resolve();
export function withChatLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = chatLock;
  let resolve: () => void;
  chatLock = new Promise<void>((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(() => resolve!());
}

export interface DataSnapshot {
  [filePath: string]: number; // mtime ms
}

export function snapshotDataDir(dataDir: string): DataSnapshot {
  const snap: DataSnapshot = {};
  if (!fs.existsSync(dataDir)) return snap;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        snap[full] = fs.statSync(full).mtimeMs;
      }
    }
  };
  walk(dataDir);
  return snap;
}

export function diffSnapshots(
  before: DataSnapshot,
  after: DataSnapshot,
  dataDir: string,
): string[] {
  const changed: string[] = [];
  // New or modified files
  for (const [filePath, mtime] of Object.entries(after)) {
    if (!(filePath in before) || before[filePath] !== mtime) {
      changed.push(path.relative(dataDir, filePath));
    }
  }
  // Deleted files
  for (const filePath of Object.keys(before)) {
    if (!(filePath in after)) {
      changed.push(path.relative(dataDir, filePath));
    }
  }
  return changed;
}

export const ASYNC_SYSTEM_PROMPT = `You are running in async API mode. You MUST follow these constraints:
- Only modify files in data/ that match the app's sync patterns
- Only run existing scripts via \`pnpm script <name>\` — do not create new scripts
- Do not edit source code files (components, routes, styles, server code)
- Do not modify package.json, tsconfig, or config files
- Return a clear, concise text response summarizing what you did`;

export function buildCliArgs(
  command: string,
  message: string,
  context?: string,
): string[] {
  const systemPrompt = context
    ? `${ASYNC_SYSTEM_PROMPT}\n\nAdditional context:\n${context}`
    : ASYNC_SYSTEM_PROMPT;

  switch (command) {
    case "claude":
      return ["--print", "--append-system-prompt", systemPrompt, message];
    case "codex":
      return ["--quiet", "--full-stdout", message];
    case "gemini":
      return ["--prompt", message];
    case "fusion":
      return [message];
    default:
      return [message];
  }
}
