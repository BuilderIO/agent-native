/**
 * `agent-native doctor` — scan an app's source tree for the security-
 * critical code-safety invariants this monorepo already enforces on
 * itself via `scripts/guard-*.mjs` (see
 * `advisor-plans/reports/005-doctor-design.md` for the full design and
 * `advisor-plans/015-doctor-v1-implementation.md` for the implementation
 * plan). v1 ships 7 of those guards, ported to work against a single
 * generated app root instead of this monorepo's multi-template layout —
 * see `../guards/index.ts`.
 *
 * This is a NEW top-level command, deliberately kept separate from the two
 * existing "doctor" precedents in this CLI:
 *   - `agent-native upgrade check` (`upgrade.ts`) — dependency-pin health.
 *   - `agent-native recap doctor` (`recap.ts`) — PR Visual Recap config health.
 * Each diagnoses a different domain; none are folded into a shared
 * mega-doctor (see report 005, "Relationship to upgrade doctor and recap
 * doctor").
 *
 * `--fix` is reserved, not implemented in v1 — it prints a message and
 * exits 2 rather than silently no-op, so a future implementation doesn't
 * collide with a script already passing the flag.
 */
import fs from "node:fs";
import path from "node:path";

import {
  scanDbToolScoping,
  scanDrizzlePush,
  scanEnvCredentials,
  scanEnvMutation,
  scanLocalhostFallback,
  scanUnscopedCredentials,
  scanUnscopedQueries,
} from "../guards/index.js";
import type { GuardResult } from "../guards/index.js";

export type GuardName =
  | "no-drizzle-push"
  | "no-unscoped-credentials"
  | "no-unscoped-queries"
  | "no-env-credentials"
  | "db-tool-scoping"
  | "no-env-mutation"
  | "no-localhost-fallback";

export const ALL_GUARD_NAMES: GuardName[] = [
  "no-drizzle-push",
  "no-unscoped-credentials",
  "no-unscoped-queries",
  "no-env-credentials",
  "db-tool-scoping",
  "no-env-mutation",
  "no-localhost-fallback",
];

export interface DoctorConfig {
  disabledGuards: string[];
  dbToolScopingDenylist: Record<string, string>;
  failOnBuild: boolean;
}

const DEFAULT_DOCTOR_CONFIG: DoctorConfig = {
  disabledGuards: [],
  dbToolScopingDenylist: {},
  failOnBuild: false,
};

export interface DoctorFinding {
  guard: string;
  file: string;
  line: number;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
  guardsRun: string[];
}

/**
 * Reads the optional `"doctor"` key from `<root>/agent-native.json`. All
 * fields are optional with sane empty defaults — an app needs zero config
 * to run `agent-native doctor` with every v1 guard enabled.
 */
export function readDoctorConfig(root: string): DoctorConfig {
  const manifestPath = path.join(root, "agent-native.json");
  if (!fs.existsSync(manifestPath)) {
    return { ...DEFAULT_DOCTOR_CONFIG, dbToolScopingDenylist: {} };
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { doctor?: Record<string, unknown> };
    const doctor = parsed.doctor ?? {};
    const disabledGuards = Array.isArray(doctor.disabledGuards)
      ? doctor.disabledGuards.filter((v): v is string => typeof v === "string")
      : [];
    const dbToolScopingDenylist =
      doctor.dbToolScopingDenylist &&
      typeof doctor.dbToolScopingDenylist === "object"
        ? (Object.fromEntries(
            Object.entries(
              doctor.dbToolScopingDenylist as Record<string, unknown>,
            ).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ) as Record<string, string>)
        : {};
    const failOnBuild = doctor.failOnBuild === true;
    return { disabledGuards, dbToolScopingDenylist, failOnBuild };
  } catch {
    return { ...DEFAULT_DOCTOR_CONFIG, dbToolScopingDenylist: {} };
  }
}

function runGuard(
  name: GuardName,
  root: string,
  config: DoctorConfig,
): GuardResult {
  switch (name) {
    case "no-drizzle-push":
      return scanDrizzlePush({ root });
    case "no-unscoped-credentials":
      return scanUnscopedCredentials({ root });
    case "no-unscoped-queries":
      return scanUnscopedQueries({ root, extraExemptPaths: [] });
    case "no-env-credentials":
      return scanEnvCredentials({ root });
    case "db-tool-scoping":
      return scanDbToolScoping({
        root,
        denylist: config.dbToolScopingDenylist,
      });
    case "no-env-mutation":
      return scanEnvMutation({ root });
    case "no-localhost-fallback":
      return scanLocalhostFallback({ root, extraExemptPaths: [] });
  }
}

export interface RunDoctorScanOptions {
  root: string;
  /** Restrict to these guard names. When omitted, runs every guard not
   * listed in `agent-native.json`'s `doctor.disabledGuards`. Unknown names
   * are silently ignored here — the CLI layer (`runDoctor`) validates
   * `--only` and reports a usage error before calling this. */
  only?: string[];
}

/** Pure scan orchestrator: runs the selected guards against `root` and
 * returns a flat report. No I/O beyond reading `agent-native.json` and the
 * app source tree — no printing, no process.exit. */
export function runDoctorScan(options: RunDoctorScanOptions): DoctorReport {
  const root = options.root;
  const config = readDoctorConfig(root);

  let names: GuardName[];
  if (options.only && options.only.length > 0) {
    const knownOnly = options.only.filter((n): n is GuardName =>
      (ALL_GUARD_NAMES as string[]).includes(n),
    );
    names = knownOnly;
  } else {
    names = ALL_GUARD_NAMES.filter((n) => !config.disabledGuards.includes(n));
  }

  const findings: DoctorFinding[] = [];
  for (const name of names) {
    const result = runGuard(name, root, config);
    for (const f of result.findings) {
      findings.push({
        guard: name,
        file: f.file,
        line: f.line,
        message: f.message,
      });
    }
  }

  return { ok: findings.length === 0, findings, guardsRun: names };
}

/** Pure escalation rule shared by the CLI (`--strict`) and the `build`
 * pre-step (`--strict` / `agent-native.json` `doctor.failOnBuild`). Doctor
 * findings never fail anything on their own — only `strict` or
 * `failOnBuild` turn findings into a hard failure. */
export function shouldFailBuild(
  hasFindings: boolean,
  opts: { strict?: boolean; failOnBuild?: boolean },
): boolean {
  return hasFindings && Boolean(opts.strict || opts.failOnBuild);
}

export interface DoctorIo {
  log: (message: string) => void;
  err: (message: string) => void;
}

const defaultIo: DoctorIo = {
  log: (message) => console.log(message),
  err: (message) => console.error(message),
};

function formatDoctorHuman(report: DoctorReport, root: string): string {
  const lines: string[] = [];
  lines.push(`agent-native doctor: ${root}`);
  lines.push(`Guards run: ${report.guardsRun.join(", ") || "(none)"}`);
  if (report.findings.length === 0) {
    lines.push("Clean — no findings.");
  } else {
    lines.push(`${report.findings.length} finding(s):`);
    for (const f of report.findings) {
      lines.push(`  [${f.guard}] ${f.file}:${f.line} — ${f.message}`);
    }
  }
  return lines.join("\n");
}

export interface DoctorCliOptions {
  json?: boolean;
  cwd?: string;
  only?: string[];
  strict?: boolean;
  help?: boolean;
  fix?: boolean;
}

export function parseDoctorArgs(argv: string[]): DoctorCliOptions {
  const opts: DoctorCliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--strict") {
      opts.strict = true;
    } else if (arg === "--fix") {
      opts.fix = true;
    } else if (arg === "--cwd" && argv[i + 1] !== undefined) {
      opts.cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      opts.cwd = arg.slice("--cwd=".length);
    } else if (arg === "--only" && argv[i + 1] !== undefined) {
      opts.only = splitGuardList(argv[++i]);
    } else if (arg.startsWith("--only=")) {
      opts.only = splitGuardList(arg.slice("--only=".length));
    }
  }
  return opts;
}

function splitGuardList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function printDoctorHelp(io: Pick<DoctorIo, "log"> = defaultIo): void {
  io.log(
    [
      "Usage:",
      "  agent-native doctor                        Scan app source for security-critical guard violations",
      "  agent-native doctor --json                 Machine-readable report: { ok, findings, guardsRun, strict }",
      "  agent-native doctor --only <guard,guard>   Run only the named guard(s)",
      "  agent-native doctor --strict                Escalate findings to a hard failure when used by `agent-native build --strict`",
      "  agent-native doctor --cwd <dir>             Run against a project root other than the current directory",
      "  agent-native doctor --fix                   Not implemented in this version",
      "  agent-native doctor --help                  Show this help",
      "",
      `Guards: ${ALL_GUARD_NAMES.join(", ")}`,
      "",
      "Exit codes: 0 clean, 1 findings present, 2 usage/execution error.",
      "",
      "`agent-native build` runs doctor as a warn-only pre-step by default — it",
      "never fails the build unless `agent-native build --strict` is passed or",
      'agent-native.json sets { "doctor": { "failOnBuild": true } }.',
      "",
      "For dependency-pin health (framework overrides/patches, stale",
      "@agent-native/* pins), run `agent-native upgrade check` instead.",
    ].join("\n"),
  );
}

/** `agent-native doctor` CLI entrypoint. Returns the process exit code —
 * callers are responsible for calling `process.exit(code)`. */
export async function runDoctor(
  argv: string[],
  io: DoctorIo = defaultIo,
): Promise<number> {
  const opts = parseDoctorArgs(argv);

  if (opts.help) {
    printDoctorHelp(io);
    return 0;
  }

  if (opts.fix) {
    io.err(
      "agent-native doctor --fix is not implemented in this version. Fix findings manually and re-run `agent-native doctor`.",
    );
    return 2;
  }

  const root = path.resolve(opts.cwd ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    const message = `--cwd path does not exist or is not a directory: ${root}`;
    if (opts.json) io.err(JSON.stringify({ ok: false, message }, null, 2));
    else io.err(message);
    return 2;
  }

  if (opts.only) {
    const unknown = opts.only.filter(
      (n) => !(ALL_GUARD_NAMES as string[]).includes(n),
    );
    if (unknown.length > 0) {
      const message = `Unknown guard name(s) in --only: ${unknown.join(", ")}. Known guards: ${ALL_GUARD_NAMES.join(", ")}`;
      if (opts.json) io.err(JSON.stringify({ ok: false, message }, null, 2));
      else io.err(message);
      return 2;
    }
  }

  const report = runDoctorScan({ root, only: opts.only });

  if (opts.json) {
    // The machine-readable report always goes to stdout (io.log), whether
    // or not findings are present, so `agent-native doctor --json >
    // report.json` in CI always captures the report. Only the usage/
    // execution error payloads above (bad --cwd, unknown --only) go to
    // stderr — those are diagnostics for exit code 2, not the report.
    io.log(
      JSON.stringify({ ...report, strict: Boolean(opts.strict) }, null, 2),
    );
  } else {
    io.log(formatDoctorHuman(report, root));
    if (!report.ok) {
      io.err("");
      io.err(
        "agent-native doctor found issues above. Fix them, or add a `// guard:allow-<check> — reason` opt-out with reviewer approval.",
      );
    }
  }

  return report.ok ? 0 : 1;
}

export interface DoctorBuildHookOptions {
  cwd: string;
  /** Set when the caller passed `agent-native build --strict`. */
  strict?: boolean;
}

export interface DoctorBuildHookResult {
  /** False only when findings are present AND (`strict` was requested OR
   * `agent-native.json`'s `doctor.failOnBuild` is true). */
  ok: boolean;
  report: DoctorReport;
}

/**
 * `agent-native build`'s doctor pre-step. Always runs every enabled guard
 * and always prints findings (as warnings) to `io.err` — never silent.
 * Never causes the build to fail unless `strict` was passed or
 * `agent-native.json` sets `doctor.failOnBuild: true` (see report 005,
 * "Where it runs" — the v1 doctor has zero field mileage against arbitrary
 * app layouts, so shipping fail-by-default would risk breaking a first
 * deploy on a false positive).
 */
export async function runDoctorBuildHook(
  options: DoctorBuildHookOptions,
  io: DoctorIo = defaultIo,
): Promise<DoctorBuildHookResult> {
  const root = path.resolve(options.cwd);
  const config = readDoctorConfig(root);
  const report = runDoctorScan({ root });

  if (report.findings.length > 0) {
    io.err(
      `\n[doctor] ${report.findings.length} finding(s) from \`agent-native doctor\` — run it directly for details. This does not fail the build unless --strict was passed or agent-native.json's doctor.failOnBuild is true.`,
    );
    for (const f of report.findings) {
      io.err(`  [${f.guard}] ${f.file}:${f.line} — ${f.message}`);
    }
  }

  const fail = shouldFailBuild(report.findings.length > 0, {
    strict: options.strict,
    failOnBuild: config.failOnBuild,
  });
  if (fail) {
    io.err(
      `\n[doctor] Failing build: ${options.strict ? "--strict was passed" : "agent-native.json's doctor.failOnBuild is true"}.`,
    );
  }

  return { ok: !fail, report };
}
