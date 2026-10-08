import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export interface Config {
  repo: string;
  baseBranch: string;
  windowHours: number;
  lookbackDays: number;
  reFixDays: number;
  minWindowCommits: number;
  maxHotSystems: number;
  systemDepth: Record<string, number>;
  ignoreSubjects: string[];
  ignorePaths: string[];
  mechanicalPaths: string[];
  plansDir: string;
  dataDir: string;
  jira: {
    baseUrl: string;
    projectKey: string;
    issueType: string;
    label: string;
    podField: string;
    podValue: string;
    propertyKey: string;
    sightingCooldownDays: number;
    maxNewTicketsPerRun: number;
    email: string;
    emailEnv: string;
    tokenEnv: string;
  };
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
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) out[key] = inline;
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

export function loadConfig(): Config {
  return JSON.parse(readFileSync(path.join(SKILL_DIR, "config.json"), "utf8"));
}

let cachedRoot: string | undefined;
export function repoRoot(): string {
  cachedRoot ??= run("git", ["rev-parse", "--show-toplevel"], {
    cwd: SKILL_DIR,
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
  return argString(args, "run") ?? new Date().toISOString().slice(0, 10);
}

export function runDir(config: Config, id: string): string {
  const dir = path.join(repoRoot(), config.dataDir, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function plansDir(config: Config, id: string): string {
  const dir = path.join(repoRoot(), config.plansDir, id);
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

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function rel(file: string): string {
  return path.relative(repoRoot(), file);
}

export type CommitKind =
  | "fix"
  | "revert"
  | "feat"
  | "refactor"
  | "perf"
  | "test"
  | "docs"
  | "ci"
  | "chore"
  | "other";

const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:/;
const FIX_WORDS =
  /\b(fix(es|ed)?|bug|regression|hotfix|repair|restore|prevent|harden|unbreak|broken|crash|flak(y|e))\b/i;
// This repo writes most subjects as plain imperative sentences ("Keep X on Y"),
// so the leading verb carries the intent that a conventional prefix would.
const FIX_VERBS =
  /^(fix|keep|preserve|stop|stabili[sz]e|honou?r|prevent|restore|recover|handle|avoid|guard|retry|unblock|correct|repair|ensure|survive|tolerate|resume|unstick|dedupe)\b/i;
const FEAT_VERBS =
  /^(add|offer|introduce|support|bundle|enable|expose|build|create|launch|ship|let|allow)\b/i;
const REFACTOR_VERBS =
  /^(split|extract|consolidate|rename|unify|replace|simplify|migrate|move|share|centrali[sz]e|collapse|delete|remove)\b/i;

export function classifySubject(subject: string): CommitKind {
  if (/^revert\b/i.test(subject)) return "revert";
  const type = CONVENTIONAL.exec(subject)?.[1]?.toLowerCase();
  if (type === "fix" || type === "hotfix") return "fix";
  if (type === "feat") return FIX_WORDS.test(subject) ? "fix" : "feat";
  if (
    type &&
    ["refactor", "perf", "test", "docs", "ci", "chore"].includes(type)
  ) {
    return type as CommitKind;
  }
  const sentence = subject.replace(/^[A-Za-z][\w /-]{0,24}:\s+/, "");
  if (FIX_VERBS.test(sentence)) return "fix";
  if (
    /^make\b/i.test(sentence) &&
    /\b(reliabl[ey]|work|stable|safe|consistent|correct)/i.test(sentence)
  ) {
    return "fix";
  }
  if (FIX_WORDS.test(sentence)) return "fix";
  if (FEAT_VERBS.test(sentence)) return "feat";
  if (REFACTOR_VERBS.test(sentence)) return "refactor";
  return "other";
}

export function prNumber(subject: string): number | null {
  const match = /\(#(\d+)\)\s*$/.exec(subject) ?? /#(\d+)/.exec(subject);
  return match ? Number(match[1]) : null;
}

export function systemOf(file: string, config: Config): string {
  const parts = file.split("/");
  const dirs = parts.slice(0, -1);
  const depth = config.systemDepth[parts[0]] ?? config.systemDepth.default;
  if (dirs.length >= depth) return dirs.slice(0, depth).join("/");
  const stem = parts[parts.length - 1]
    .replace(/\.(test|spec)(?=\.)/, "")
    .replace(/\.[^.]+$/, "");
  return [...dirs, stem].join("/");
}

export function compile(patterns: string[]): (value: string) => boolean {
  const regexes = patterns.map((p) => new RegExp(p));
  return (value) => regexes.some((r) => r.test(value));
}

export function fingerprintFor(systems: string[], slug: string): string {
  const anchor = [...systems].sort()[0] ?? "unscoped";
  return `fsys:${anchor}:${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, "-");
}

export function deriveRunUrl(): string | null {
  const explicit = process.env.FRAGILITY_RUN_URL;
  if (explicit) return explicit;
  const origin = process.env.FUSION_ENV_ORIGIN;
  const match =
    origin &&
    /^https:\/\/([0-9a-f]{20,32})-([a-z0-9-]+)\.builderio\.xyz/.exec(origin);
  return match
    ? `https://builder.io/app/projects/${match[1]}/${match[2]}`
    : null;
}
