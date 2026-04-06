import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Re-export pure arg-parsing utilities (no Node.js deps, browser-safe)
export { parseArgs, camelCaseArgs } from "./parse-args.js";

/**
 * Load .env from project root (cwd).
 */
export function loadEnv(envPath?: string): void {
  dotenv.config({ path: envPath ?? path.join(process.cwd(), ".env") });
}

/**
 * Validate a relative file path (no traversal, no absolute).
 */
export function isValidPath(p: string): boolean {
  const normalized = path.normalize(p);
  return (
    !normalized.startsWith("..") &&
    !path.isAbsolute(normalized) &&
    !p.includes("\0")
  );
}

/**
 * Validate a project slug (e.g. "my-project" or "group/my-project").
 */
export function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
}

/**
 * mkdir -p helper.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Throw an error to abort a script. When running as a CLI (`pnpm script`),
 * the runner catches this and exits with code 1. When running in-server
 * (agent tools, A2A handlers), the error is caught by the wrapper and
 * returned as a tool result — no process.exit needed.
 */
export function fail(message: string): never {
  throw new Error(message);
}
