// Command-line plumbing shared by the fragility skills: argument parsing,
// exit codes, subprocesses, JSON files, and the per-run data directory.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function skillDir(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function loadSkillConfig<T>(importMetaUrl: string): T {
  return JSON.parse(
    readFileSync(path.join(skillDir(importMetaUrl), "config.json"), "utf8"),
  ) as T;
}

export interface CommonConfig {
  repo: string;
  dataDir: string;
}

export function commonConfig(): CommonConfig {
  return loadSkillConfig<CommonConfig>(import.meta.url);
}

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
  }
}

export function main(fn: (args: Args) => Promise<void> | void): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const args = parseArgs(process.argv.slice(2));
  Promise.resolve()
    .then(() => fn(args))
    .catch((error: unknown) => {
      const code = error instanceof ScriptError ? error.exitCode : 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `${path.basename(process.argv[1] ?? "script")}: ${message}`,
      );
      process.exit(code);
    });
}

export type Args = { _: string[]; [flag: string]: string | true | string[] };

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (eq !== -1) out[key] = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

export function argString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === true) throw new ScriptError(`--${key} needs a value`);
  if (Array.isArray(value)) throw new ScriptError(`--${key} is reserved`);
  return value;
}

export function argNumber(args: Args, key: string, fallback: number): number {
  const raw = argString(args, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new ScriptError(`--${key} must be a number`);
  return value;
}

export function argList(args: Args, key: string): string[] {
  return (argString(args, key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let cachedRoot: string | undefined;
export function repoRoot(): string {
  cachedRoot ??= run("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
  }).trim();
  return cachedRoot;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): string {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot(),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    input: opts.input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
  });
  const label = `${cmd} ${args.slice(0, 4).join(" ")}`;
  if (result.error) {
    const timedOut =
      (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    throw new ScriptError(
      timedOut
        ? `${label} timed out after ${timeoutMs}ms`
        : `${label} failed to start: ${result.error.message}`,
      2,
    );
  }
  if (result.status !== 0) {
    throw new ScriptError(
      `${label} exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 800)}`,
    );
  }
  return result.stdout;
}

export function runId(args: Args): string {
  const id = argString(args, "run") ?? new Date().toISOString().slice(0, 10);
  // The id becomes a directory name.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || id.includes("..")) {
    throw new ScriptError(
      `--run must be a plain id like 2026-10-08, got "${id}"`,
    );
  }
  return id;
}

export function runDir(id: string): string {
  const dir = path.join(repoRoot(), commonConfig().dataDir, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string): T {
  if (!existsSync(file)) {
    throw new ScriptError(
      `${file} does not exist — run the earlier step first`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readJsonOr<T>(file: string, fallback: T): T {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as T)
    : fallback;
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function rel(file: string): string {
  return path.relative(repoRoot(), file);
}
