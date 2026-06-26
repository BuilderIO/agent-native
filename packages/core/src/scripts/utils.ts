import fs from "fs";
import path from "path";

import dotenv from "dotenv";

// Re-export pure arg-parsing utilities (no Node.js deps, browser-safe)
export { parseArgs, camelCaseArgs } from "./parse-args.js";

/**
 * Load .env files. In an enterprise workspace (detected via
 * `agent-native.workspaceCore` in a parent package.json) this also loads the
 * workspace root's .env as a fallback, so shared keys like ANTHROPIC_API_KEY
 * flow to every app without duplication. Shell values win, then app
 * .env.local, app .env, workspace .env.local, and workspace .env.
 */
export function loadEnv(envPath?: string): void {
  const appEnv = envPath ?? path.join(process.cwd(), ".env");
  const shellKeys = new Set(Object.keys(process.env));
  // App-level .env first. Dotenv won't clobber already-set process.env, so
  // values that are already present (e.g. set by the shell) still win.
  // `quiet: true` suppresses the dotenv tip line on every load (v17+).
  loadEnvFile(appEnv);
  loadEnvLocalOverrides(localEnvPathFor(appEnv), shellKeys);

  // Then workspace root, if any — but only fill in keys the app didn't
  // define. Setting `override: false` is dotenv's default.
  const workspaceRoot = findWorkspaceRoot(path.dirname(appEnv));
  if (workspaceRoot) {
    const beforeWorkspaceKeys = new Set(Object.keys(process.env));
    const wsEnv = path.join(workspaceRoot, ".env");
    if (fs.existsSync(wsEnv) && wsEnv !== appEnv) {
      loadEnvFile(wsEnv);
      loadEnvLocalOverrides(localEnvPathFor(wsEnv), beforeWorkspaceKeys);
    }
  }
}

function loadEnvFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, quiet: true });
  }
}

function localEnvPathFor(envPath: string): string {
  return path.basename(envPath) === ".env"
    ? path.join(path.dirname(envPath), ".env.local")
    : `${envPath}.local`;
}

function loadEnvLocalOverrides(
  filePath: string,
  protectedKeys: Set<string>,
): void {
  if (!fs.existsSync(filePath)) return;
  const values = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(values)) {
    if (protectedKeys.has(key)) continue;
    process.env[key] = value;
  }
}

/**
 * Locate the nearest enterprise workspace root above `startDir`, identified
 * by the `agent-native.workspaceCore` field in its package.json.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const wsCore = pkg?.["agent-native"]?.workspaceCore;
        if (typeof wsCore === "string" && wsCore.length > 0) {
          return dir;
        }
      } catch {
        // Keep walking on malformed package.json
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
