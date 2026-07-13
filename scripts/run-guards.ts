import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";

const guards = [
  "guard:no-drizzle-push",
  "guard:no-unscoped-queries",
  "guard:no-env-credentials",
  "guard:no-unscoped-credentials",
  "guard:no-env-mutation",
  "guard:no-localhost-fallback",
  "guard:google-auth-redirects",
  "guard:db-tool-scoping",
  "guard:template-list",
  "guard:netlify-private-env",
  "guard:workspace-skills",
  "guard:public-packages",
  "guard:no-generated-artifacts",
  "guard:extension-no-public",
  "guard:no-one-off-mcp-app-html",
  "guard:i18n-catalogs",
  "guard:plan-skills",
  "guard:plan-marketplace",
  "guard:no-error-string-returns",
  "guard:no-action-twin-routes",
  "guard:agent-chat-context",
  "guard:request-storms",
] as const;

type GuardName = (typeof guards)[number];

type GuardResult = {
  name: GuardName;
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  output: string;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.list) {
  console.log(guards.join("\n"));
  process.exit(0);
}

if (args.unknown.length > 0) {
  console.error(`[guards] Unknown option(s): ${args.unknown.join(", ")}`);
  printHelp();
  process.exit(1);
}

const concurrency = resolveConcurrency(args.concurrency);

if (args.dryRun) {
  console.log(
    `[guards] ${guards.length} checks, concurrency=${formatConcurrency(
      concurrency,
    )}`,
  );
  for (const guard of guards) {
    console.log(`${pnpmCommand()} run ${guard}`);
  }
  process.exit(0);
}

const running = new Set<ChildProcess>();

process.on("SIGINT", () => {
  console.error("\n[guards] Interrupted; stopping running guards...");
  for (const child of running) child.kill("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  console.error("\n[guards] Terminated; stopping running guards...");
  for (const child of running) child.kill("SIGTERM");
  process.exit(143);
});

const numericConcurrency =
  concurrency === Infinity
    ? guards.length
    : Math.min(concurrency, guards.length);

console.error(
  `[guards] Running ${guards.length} checks with concurrency ${numericConcurrency}`,
);

const results = await runAll(numericConcurrency);
const failures = results.filter((result) => result.code !== 0 || result.signal);

if (failures.length > 0) {
  console.error(
    `[guards] ${failures.length} check(s) failed: ${failures
      .map((failure) => failure.name)
      .join(", ")}`,
  );
  process.exit(1);
}

console.error("[guards] All checks passed");

async function runAll(concurrency: number): Promise<GuardResult[]> {
  const queue = [...guards];
  const results: GuardResult[] = [];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const guard = queue.shift();
        if (!guard) return;
        const result = await runGuard(guard);
        results.push(result);
        printResult(result);
      }
    }),
  );

  return results;
}

function runGuard(name: GuardName): Promise<GuardResult> {
  const startedAt = Date.now();
  const child = spawn(pnpmCommand(), ["run", name], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  running.add(child);
  const chunks: string[] = [];

  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  return new Promise((resolve) => {
    child.on("error", (error) => {
      chunks.push(`[guards] Failed to start ${name}: ${error.message}\n`);
    });

    child.on("close", (code, signal) => {
      running.delete(child);
      resolve({
        name,
        code,
        signal,
        elapsedMs: Date.now() - startedAt,
        output: chunks.join(""),
      });
    });
  });
}

function printResult(result: GuardResult) {
  const status = result.code === 0 && !result.signal ? "PASS" : "FAIL";
  const elapsed = formatElapsed(result.elapsedMs);

  if (result.output.trim().length > 0) {
    process.stdout.write(`\n[${result.name}] output\n${result.output}`);
    if (!result.output.endsWith("\n")) process.stdout.write("\n");
  }

  console.error(`[guards] ${status} ${result.name} (${elapsed})`);
}

function printHelp() {
  console.log(`Usage: tsx scripts/run-guards.ts [options]

Runs root guard:* scripts in a bounded parallel pool.

Options:
  --concurrency <n|Infinity>  Override computed guard concurrency
  --dry-run                   Print the guard commands without running them
  --list                      List guard scripts and exit

Environment overrides:
  GUARD_CONCURRENCY / AGENT_NATIVE_GUARD_CONCURRENCY
`);
}

function parseArgs(rawArgs: string[]): {
  concurrency?: string;
  dryRun: boolean;
  help: boolean;
  list: boolean;
  unknown: string[];
} {
  let concurrency: string | undefined;
  let dryRun = false;
  let help = false;
  let list = false;
  const unknown: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--") continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--concurrency") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        unknown.push(arg);
      } else {
        concurrency = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      concurrency = arg.slice("--concurrency=".length);
      continue;
    }

    unknown.push(arg);
  }

  return { concurrency, dryRun, help, list, unknown };
}

function resolveConcurrency(explicitValue?: string): number | typeof Infinity {
  const envValue =
    explicitValue ??
    firstEnvValue(["GUARD_CONCURRENCY", "AGENT_NATIVE_GUARD_CONCURRENCY"]);

  if (envValue) return parseConcurrency(envValue);

  return clamp(Math.floor(availableParallelism() / 2), 2, 6);
}

function availableParallelism(): number {
  return Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
}

function parseConcurrency(value: string): number | typeof Infinity {
  if (value === "Infinity") return Infinity;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`[guards] Invalid concurrency: ${value}`);
    process.exit(1);
  }
  return parsed;
}

function formatConcurrency(value: number | typeof Infinity): string {
  return value === Infinity ? "Infinity" : String(value);
}

function firstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}
