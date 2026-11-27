import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resultStatus, summarizeGuardRun } from "./lib/guard-run-summary";

const FAST_GUARDS_SUPPORTED = new Set<GuardName>([
  "guard:agent-native-brand",
  "guard:no-secret-literals",
  "guard:no-core-client-barrel-imports",
  "guard:no-env-mutation",
  "guard:extension-no-public",
  "guard:help-icon-scale",
  "guard:no-localhost-fallback",
]);

type FastGuardReport = {
  name: GuardName;
  passed: boolean;
  elapsed_ms: number;
  summary: string;
  violations: string[];
};

function resolveFastGuardsBinary(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidate = path.resolve(
    process.cwd(),
    "tools/fast-guards/target/release",
    `fast-guards${ext}`,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

const SHELL_META_RE = /[|&;<>()$`'"]/;

const rootScripts: Record<string, string> = (() => {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
})();

const guards = [
  "guard:hooks-registered",
  "guard:agent-native-brand",
  "guard:readme-link-tags",
  "guard:no-drizzle-push",
  "guard:mcp-registry",
  "guard:no-pnpm-patches",
  "guard:template-layers",
  "guard:chat-first-shared-ui",
  "guard:chat-send-gate",
  "guard:no-empty-migrations",
  "guard:release-schema-complete",
  "guard:no-unscoped-queries",
  "guard:identity-columns-registered",
  "guard:no-raw-app-identity-env",
  "guard:no-raw-sql-interpolation",
  "guard:no-env-credentials",
  "guard:env-documentation",
  "guard:no-unscoped-credentials",
  "guard:no-env-mutation",
  "guard:no-localhost-fallback",
  "guard:google-auth-redirects",
  "guard:db-tool-scoping",
  "guard:template-list",
  "guard:netlify-private-env",
  "guard:netlify-release-migrations",
  "guard:netlify-prebuilt-workflow",
  "guard:beta-e2e-suite",
  "guard:automated-findings",
  "guard:trusted-acceptance",
  "guard:design-e2e-workflow",
  "guard:test-title-production",
  "guard:mobile-build-paths",
  "guard:content-product-docs",
  "guard:workspace-skills",
  "guard:template-standard",
  "guard:public-packages",
  "guard:shared-ui-singletons",
  "guard:modal-layer-integrity",
  "guard:no-core-client-barrel-imports",
  "guard:core-package-dependency-budget",
  "guard:toolkit-must-not-import-core",
  "guard:template-ui-imports",
  "guard:controller-boundaries",
  "guard:agentkit-stream-ownership",
  "guard:migration-manifest",
  "guard:eject-manifests",
  "guard:no-generated-artifacts",
  "guard:extension-no-public",
  "guard:no-one-off-mcp-app-html",
  "guard:i18n-catalogs",
  "guard:i18n-changed-copy",
  "guard:plan-skills",
  "guard:plan-marketplace",
  "guard:no-error-string-returns",
  "guard:no-action-twin-routes",
  "guard:agent-access-endpoints-public",
  "guard:external-result-contract",
  "guard:provider-action-factories",
  "guard:agent-chat-context",
  "guard:request-storms",
  "guard:ssr-cache-shell",
  "guard:ssr-cache-artifact",
  "guard:route-chunk-recovery",
  "guard:blocker-safe-module-names",
  "guard:one-sign-in",
  "guard:no-secret-literals",
  "guard:additive-migrations",
  "guard:config-docs",
  "guard:no-legacy-config",
  "guard:no-silent-coercion",
  "guard:no-source-reading-tests",
  "guard:no-duplicate-vi-mock",
  "guard:no-major-changeset",
  "guard:no-part-class-redefinition",
  "guard:no-part-geometry-classes",
  "guard:no-raw-colors",
  "guard:persistent-compositing",
  "guard:help-icon-scale",
  "guard:no-default-chrome",
  "guard:single-search-clear",
  "guard:single-s3-signer",
  "guard:no-boot-data-work",
  "guard:realtime-opt-in",
  "guard:tracking-event-names",
  "guard:no-untracked-imports",
  "guard:no-heavy-dashboard-list-reads",
  "guard:no-blob-column-predicate",
  "guard:no-unbounded-table-reads",
  "guard:no-bare-error-in-actions",
  "guard:no-unsealed-secret-columns",
  "guard:no-vault-secrets-table",
  "guard:no-unobserved-writes",
  "guard:no-bare-pnpm-spawn",
  "guard:recursive-copy-links",
  "guard:no-deferred-server-counts",
  "guard:no-oracle-loosening",
  "guard:no-wall-clock-assertions",
  "guard:no-new-legacy-mcp-hints",
  "guard:no-new-mcp-parity-gaps",
  "guard:action-output-schema",
  "guard:no-new-escape-hatches",
  "guard:compiler-strictness",
  "guard:strict-lint",
  "guard:new-prose-comments",
  "guard:mcp-unredacted-call-boundary",
  "guard:dead-settings-keys",
  "guard:serverless-function-payload",
  "guard:doc-budgets",
  "guard:e2e-quarantine",
  "guard:design-e2e-regression-pins",
  "guard:e2e-harness",
  "guard:workflow-engine-layering",
] as const;

type GuardName = (typeof guards)[number];

type GuardResult = {
  name: GuardName;
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  output: string;
};

const diffScopedGuards = new Set<GuardName>([
  "guard:no-silent-coercion",
  "guard:new-prose-comments",
  "guard:no-legacy-config",
  "guard:e2e-harness",
  "guard:no-raw-colors",
  "guard:no-boot-data-work",
  "guard:no-heavy-dashboard-list-reads",
  "guard:no-blob-column-predicate",
  "guard:no-unbounded-table-reads",
  "guard:no-bare-error-in-actions",
  "guard:no-unobserved-writes",
  "guard:external-result-contract",
  "guard:no-source-reading-tests",
  "guard:no-oracle-loosening",
  "guard:no-wall-clock-assertions",
  "guard:no-raw-sql-interpolation",
  "guard:action-output-schema",
  "guard:strict-lint",
  "guard:compiler-strictness",
  "guard:no-new-escape-hatches",
  "guard:no-new-legacy-mcp-hints",
  "guard:no-new-mcp-parity-gaps",
  "guard:no-bare-pnpm-spawn",
  "guard:no-unsealed-secret-columns",
  "guard:no-raw-app-identity-env",
  "guard:no-default-chrome",
  "guard:realtime-opt-in",
  "guard:tracking-event-names",
  "guard:chat-send-gate",
  "guard:i18n-changed-copy",
  "guard:request-storms",
  "guard:dead-settings-keys",
]);

const args = parseArgs(process.argv.slice(2));
const selectedGuards = args.diff
  ? guards.filter((name) => diffScopedGuards.has(name))
  : guards;
if (args.diff)
  console.error(
    `[guards] Diff scope: ${selectedGuards.length} ratchets; the whole-tree audit remains available without --diff.`,
  );

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.list) {
  console.log(selectedGuards.join("\n"));
  process.exit(0);
}

if (args.unknown.length > 0) {
  console.error(`[guards] Unknown option(s): ${args.unknown.join(", ")}`);
  printHelp();
  process.exit(1);
}

const concurrency = resolveConcurrency(args.concurrency);

const strictSkips =
  args.diff || (Boolean(process.env.CI) && !process.env.GUARD_ALLOW_SKIPS);

if (args.dryRun) {
  console.log(
    `[guards] ${selectedGuards.length} checks, concurrency=${formatConcurrency(
      concurrency,
    )}`,
  );
  for (const guard of selectedGuards) {
    console.log(formatCommand(guardCommand(guard)));
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
    ? selectedGuards.length
    : Math.min(concurrency, selectedGuards.length);

console.error(
  `[guards] Running ${selectedGuards.length} checks with concurrency ${numericConcurrency}`,
);

const PRIORITY_HEAVY_GUARDS = new Map<GuardName, number>([
  ["guard:i18n-catalogs", 0],
  ["guard:migration-manifest", 1],
  ["guard:no-deferred-server-counts", 2],
  ["guard:e2e-quarantine", 3],
  ["guard:design-e2e-regression-pins", 4],
  ["guard:mcp-unredacted-call-boundary", 5],
]);

const results = await runAll(numericConcurrency);
const summary = summarizeGuardRun(results, { strictSkips });
console.error(summary.message);
process.exit(summary.exitCode);

async function runAll(concurrency: number): Promise<GuardResult[]> {
  const fastBin = resolveFastGuardsBinary();
  const fastBatch = fastBin
    ? selectedGuards.filter((g) => FAST_GUARDS_SUPPORTED.has(g))
    : [];
  const fastSet = new Set<GuardName>(fastBatch);
  const queue = selectedGuards
    .filter((g) => !fastSet.has(g))
    .sort((a, b) => {
      const pa = PRIORITY_HEAVY_GUARDS.get(a) ?? Number.MAX_SAFE_INTEGER;
      const pb = PRIORITY_HEAVY_GUARDS.get(b) ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
  const results: GuardResult[] = [];

  const fastPromise =
    fastBin && fastBatch.length > 0
      ? runFastGuardsBatch(fastBin, fastBatch).then((batchResults) => {
          for (const result of batchResults) {
            results.push(result);
            printResult(result);
          }
        })
      : Promise.resolve();

  await Promise.all([
    fastPromise,
    ...Array.from({ length: concurrency }, async () => {
      for (;;) {
        const guard = queue.shift();
        if (!guard) return;
        const result = await runGuard(guard);
        results.push(result);
        printResult(result);
      }
    }),
  ]);

  return results;
}

function runFastGuardsBatch(
  binPath: string,
  batch: GuardName[],
): Promise<GuardResult[]> {
  const startedAt = Date.now();
  const child = spawn(
    binPath,
    ["--root", process.cwd(), "--guards", batch.join(","), "--json"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  running.add(child);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) =>
    stdoutChunks.push(chunk.toString()),
  );
  child.stderr.on("data", (chunk: Buffer) =>
    stderrChunks.push(chunk.toString()),
  );

  return new Promise((resolve) => {
    child.on("error", (error) => {
      stderrChunks.push(`[fast-guards] Failed to start: ${error.message}\n`);
    });
    child.on("close", (code, signal) => {
      running.delete(child);
      const elapsedMs = Date.now() - startedAt;
      const rawOut = stdoutChunks.join("").trim();
      const rawErr = stderrChunks.join("");
      if (rawOut.length > 0 && (code === 0 || code === 1)) {
        try {
          const parsed = JSON.parse(rawOut) as FastGuardReport[];
          const byName = new Map(parsed.map((item) => [item.name, item]));
          const mapped = batch.map((name): GuardResult => {
            const report = byName.get(name);
            if (!report) {
              return {
                name,
                code: 2,
                signal: null,
                elapsedMs,
                output: `[fast-guards] Missing report for ${name}\n${rawErr}`,
              };
            }
            const lines = [report.summary];
            for (const violation of report.violations) {
              lines.push(`  - ${violation}`);
            }
            return {
              name,
              code: report.passed ? 0 : 1,
              signal: null,
              elapsedMs: report.elapsed_ms,
              output: `${lines.join("\n")}\n`,
            };
          });
          resolve(mapped);
          return;
        } catch (parseError) {
          resolve(
            batch.map((name) => ({
              name,
              code: 2,
              signal,
              elapsedMs,
              output: `[fast-guards] Invalid JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}\n${rawErr}`,
            })),
          );
          return;
        }
      }
      resolve(
        batch.map((name) => ({
          name,
          code: code ?? 2,
          signal,
          elapsedMs,
          output:
            rawErr || rawOut || `[fast-guards] exited with code ${code}\n`,
        })),
      );
    });
  });
}

function runGuard(name: GuardName): Promise<GuardResult> {
  const startedAt = Date.now();
  const [command, args] = guardCommand(name);
  const useShell = process.platform === "win32" && command === "pnpm";
  const child = spawn(
    useShell ? formatCommand([command, args]) : command,
    useShell ? [] : args,
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
    },
  );

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
  const status = resultStatus(result);
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
  --diff                 Run the added-line ratchets; missing bases fail closed.
  --list                      List guard scripts and exit

Environment overrides:
  GUARD_CONCURRENCY / AGENT_NATIVE_GUARD_CONCURRENCY
`);
}

function guardCommand(name: GuardName): [string, string[]] {
  const extraArgs =
    args.diff &&
    (name === "guard:request-storms" || name === "guard:dead-settings-keys")
      ? ["--diff"]
      : [];

  if (name === "guard:no-heavy-dashboard-list-reads") {
    return [
      process.execPath,
      ["scripts/guard-no-heavy-dashboard-list-reads.mjs"],
    ];
  }
  if (name === "guard:no-blob-column-predicate") {
    return [process.execPath, ["scripts/guard-no-blob-column-predicate.mjs"]];
  }

  const script = rootScripts[name]?.trim();
  if (script && !SHELL_META_RE.test(script)) {
    const tokens = script.split(/\s+/);
    if (tokens[0] === "node" && tokens.length >= 2) {
      return [process.execPath, [...tokens.slice(1), ...extraArgs]];
    }
    if (tokens[0] === "tsx" && tokens.length >= 2) {
      return [
        process.execPath,
        ["--import", "tsx", ...tokens.slice(1), ...extraArgs],
      ];
    }
  }

  return ["pnpm", ["run", name, ...extraArgs]];
}

function formatCommand([command, args]: [string, string[]]): string {
  return [command, ...args].join(" ");
}

function parseArgs(rawArgs: string[]): {
  concurrency?: string;
  diff: boolean;
  dryRun: boolean;
  help: boolean;
  list: boolean;
  unknown: string[];
} {
  let concurrency: string | undefined;
  let diff = false;
  let dryRun = false;
  let help = false;
  let list = false;
  const unknown: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--") continue;
    if (arg === "--diff") {
      diff = true;
      continue;
    }
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

  return { concurrency, diff, dryRun, help, list, unknown };
}

function resolveConcurrency(explicitValue?: string): number | typeof Infinity {
  const envValue =
    explicitValue ??
    firstEnvValue(["GUARD_CONCURRENCY", "AGENT_NATIVE_GUARD_CONCURRENCY"]);

  if (envValue) return parseConcurrency(envValue);

  return clamp(availableParallelism(), 4, 8);
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
