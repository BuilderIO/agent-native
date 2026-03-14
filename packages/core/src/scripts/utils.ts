import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Load .env from project root (cwd).
 */
export function loadEnv(envPath?: string): void {
  dotenv.config({ path: envPath ?? path.join(process.cwd(), ".env") });
}

/**
 * Parse CLI args in --key value format.
 * Supports: --key value, --key=value, --flag (boolean true)
 */
export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      const key = arg.slice(2, eqIndex);
      result[key] = arg.slice(eqIndex + 1);
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

/**
 * Convert kebab-case keys to camelCase.
 */
export function camelCaseArgs(
  args: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camel] = value;
  }
  return result;
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
 * Print error to stderr and exit with code 1.
 */
export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
