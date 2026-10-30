import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
export const VERIFY_ROOT = path.join(REPO_ROOT, ".tmp", "verify");
export const CDP_URL = process.env.VERIFY_CDP_URL ?? "http://127.0.0.1:9222";
export const GATEWAY_URL =
  process.env.VERIFY_GATEWAY_URL ?? "http://127.0.0.1:8080";

export interface Instance {
  runId: string;
  app: string;
  port: number;
  pgid: number;
  url: string;
  dbUrl: string;
  scratchDir: string;
  evidenceDir: string;
  log: string;
  startedAt: string;
}

export function parseFlags(argv: string[]): {
  flags: Record<string, string | true>;
  params: Record<string, string>;
} {
  const flags: Record<string, string | true> = {};
  const params: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) i++;
    if (key === "param") {
      if (value === true || !value.includes("=")) {
        throw new Error("--param expects key=value");
      }
      const eq = value.indexOf("=");
      params[value.slice(0, eq)] = value.slice(eq + 1);
    } else {
      flags[key] = value;
    }
  }
  return { flags, params };
}

export function requireString(
  flags: Record<string, string | true>,
  key: string,
): string {
  const value = flags[key];
  if (typeof value !== "string") throw new Error(`--${key} is required`);
  return value;
}

export function runDir(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return path.join(VERIFY_ROOT, runId);
}

export function readInstance(runId: string): Instance {
  const file = path.join(runDir(runId), "instance.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `No instance for run "${runId}" (${file} missing). Launch one first.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Instance;
}

export function listenerPid(port: number): number | null {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    ).trim();
    return out ? Number(out.split("\n")[0]) : null;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return null;
    throw error;
  }
}

export function processGroup(pid: number): number {
  return Number(
    execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim(),
  );
}

export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export type DbKind =
  | { kind: "pglite"; location: string }
  | { kind: "remote"; host: string }
  | { kind: "unset" }
  | { kind: "unreadable"; reason: string };

export function listenerDb(pid: number, app: string): DbKind {
  const key = `${app.toUpperCase().replace(/-/g, "_")}_DATABASE_URL=`;
  let environ: string;
  try {
    environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
  } catch (error) {
    return { kind: "unreadable", reason: (error as Error).message };
  }
  const entry = environ.split("\0").find((line) => line.startsWith(key));
  if (!entry) return { kind: "unset" };
  const value = entry.slice(key.length);
  if (value.startsWith("pglite:")) {
    return { kind: "pglite", location: value.slice("pglite:".length) };
  }
  try {
    return { kind: "remote", host: new URL(value).host };
  } catch {
    return { kind: "remote", host: "(unparseable url)" };
  }
}
