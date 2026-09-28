import fs from "fs";
import path from "path";

import dotenv from "dotenv";

export { fail, type FailOptions } from "../action.js";

export { parseArgs, camelCaseArgs } from "./parse-args.js";

export function loadEnv(envPath?: string): void {
  const appEnv = envPath ?? path.join(process.cwd(), ".env");
  const shellKeys = new Set(Object.keys(process.env));
  loadEnvFile(appEnv);
  loadEnvLocalOverrides(localEnvPathFor(appEnv), shellKeys);

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

export function isValidPath(p: string): boolean {
  const normalized = path.normalize(p);
  return (
    !normalized.startsWith("..") &&
    !path.isAbsolute(normalized) &&
    !p.includes("\0")
  );
}

export function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
