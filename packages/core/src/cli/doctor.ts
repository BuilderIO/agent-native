/**
 * `agent-native doctor` — scan an app's source tree for the security-
 * critical code-safety invariants this monorepo already enforces on
 * itself via `scripts/guard-*.mjs` (see
 * `advisor-plans/reports/005-doctor-design.md` for the full design and
 * `advisor-plans/015-doctor-v1-implementation.md` for the implementation
 * plan). v1 ships 9 of those guards, ported to work against a single
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
  scanEmptyMigrations,
  scanEnvCredentials,
  scanEnvMutation,
  scanExplicitCollabAccess,
  scanLocalhostFallback,
  scanUnscopedCredentials,
  scanUnscopedQueries,
} from "../guards/index.js";
import type { GuardFinding, GuardResult } from "../guards/index.js";
import {
  AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND,
  scanDeprecatedImports,
  type MigrationManifest,
} from "../package-lifecycle/index.js";
import { formatBytes, scanCleanTargets } from "./clean.js";

export type GuardName =
  | "no-drizzle-push"
  | "no-empty-migrations"
  | "no-unscoped-credentials"
  | "no-unscoped-queries"
  | "no-env-credentials"
  | "db-tool-scoping"
  | "no-env-mutation"
  | "no-localhost-fallback"
  | "explicit-collab-access"
  | "migration-manifest";

export const ALL_GUARD_NAMES: GuardName[] = [
  "no-drizzle-push",
  "no-empty-migrations",
  "no-unscoped-credentials",
  "no-unscoped-queries",
  "no-env-credentials",
  "db-tool-scoping",
  "no-env-mutation",
  "no-localhost-fallback",
  "explicit-collab-access",
  "migration-manifest",
];

export interface DoctorConfig {
  disabledGuards: string[];
  dbToolScopingDenylist: Record<string, string>;
  failOnBuild: boolean;
}

const DEFAULT_DOCTOR_CONFIG: DoctorConfig = {
  disabledGuards: [],
  dbToolScopingDenylist: {},
  failOnBuild: true,
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
  warnings: DoctorFinding[];
  guardsRun: string[];
}

interface DoctorGuardResult extends GuardResult {
  warnings?: GuardFinding[];
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
    const failOnBuild =
      typeof doctor.failOnBuild === "boolean"
        ? doctor.failOnBuild
        : DEFAULT_DOCTOR_CONFIG.failOnBuild;
    return { disabledGuards, dbToolScopingDenylist, failOnBuild };
  } catch (error) {
    throw new Error(
      `Could not read Doctor configuration from ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function runGuard(
  name: GuardName,
  root: string,
  config: DoctorConfig,
  migrationManifests?: MigrationManifest[],
): DoctorGuardResult {
  switch (name) {
    case "no-drizzle-push":
      return scanDrizzlePush({ root });
    case "no-empty-migrations":
      return scanEmptyMigrations({ root });
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
    case "explicit-collab-access":
      return scanExplicitCollabAccess({ root });
    case "migration-manifest": {
      const imports = scanDeprecatedImports({
        root,
        manifests: migrationManifests,
      });
      return {
        name,
        findings: imports
          .filter((finding) => finding.status === "active")
          .map((finding) => ({
            file: path.relative(root, finding.file),
            line: finding.line,
            message: `${finding.from} moves to ${finding.to.join(", ")}. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
          })),
        warnings: imports
          .filter((finding) => finding.status === "planned")
          .map((finding) => ({
            file: path.relative(root, finding.file),
            line: finding.line,
            message: `${finding.from} is planned to move to ${finding.to.join(", ")} in a future release. No rewrite is available yet.`,
          })),
      };
    }
  }
}

export interface RunDoctorScanOptions {
  root: string;
  /** Restrict to these guard names. When omitted, runs every guard not
   * listed in `agent-native.json`'s `doctor.disabledGuards`. Unknown names
   * are silently ignored here — the CLI layer (`runDoctor`) validates
   * `--only` and reports a usage error before calling this. */
  only?: string[];
  migrationManifests?: MigrationManifest[];
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
  const warnings: DoctorFinding[] = [];
  for (const name of names) {
    const result = runGuard(name, root, config, options.migrationManifests);
    for (const f of result.findings) {
      findings.push({
        guard: name,
        file: f.file,
        line: f.line,
        message: f.message,
      });
    }
    for (const warning of result.warnings ?? []) {
      warnings.push({
        guard: name,
        file: warning.file,
        line: warning.line,
        message: warning.message,
      });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    warnings,
    guardsRun: names,
  };
}

/**
 * A workspace root is an orchestrator, not an app root. The portable guards
 * intentionally inspect `actions/` and `server/` relative to one project, so
 * a recursive scan from the workspace root would miss `apps/<name>/` queries.
 * Run the same versioned scanner once per workspace app and shared package,
 * prefixing findings with the project path so both humans and coding agents
 * can fix the right file.
 */
interface WorkspaceDoctorRoots {
  appRoots: string[];
  scanRoots: string[];
}

function workspaceDoctorRoots(root: string): WorkspaceDoctorRoots | null {
  const packagePath = path.join(root, "package.json");
  const appsDir = path.join(root, "apps");
  if (!fs.existsSync(packagePath) || !fs.existsSync(appsDir)) return null;

  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    if (typeof packageJson?.["agent-native"]?.workspaceCore !== "string") {
      return null;
    }
  } catch (error) {
    throw new Error(
      `Could not read workspace metadata from ${packagePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const appRoots = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name))
    .filter((appRoot) => fs.existsSync(path.join(appRoot, "package.json")))
    .sort();
  const scanRoots = [...appRoots];
  const sharedRoot = path.join(root, "packages", "shared");
  if (fs.existsSync(path.join(sharedRoot, "package.json"))) {
    scanRoots.push(sharedRoot);
  }
  return { appRoots, scanRoots };
}

function prefixWorkspaceFindings(
  findings: DoctorFinding[],
  root: string,
  appRoot: string,
): DoctorFinding[] {
  const prefix = path.relative(root, appRoot).replaceAll("\\", "/");
  return findings.map((finding) => ({
    ...finding,
    file: `${prefix}/${finding.file}`,
  }));
}

function runWorkspaceDoctorScan(
  root: string,
  scanRoots: string[],
  only?: string[],
): DoctorReport {
  const reports = scanRoots.map((scanRoot) => ({
    scanRoot,
    report: runDoctorScan({ root: scanRoot, only }),
  }));

  const guardsRun = Array.from(
    new Set(reports.flatMap(({ report }) => report.guardsRun)),
  );

  return {
    ok: reports.every(({ report }) => report.ok),
    findings: reports.flatMap(({ scanRoot, report }) =>
      prefixWorkspaceFindings(report.findings, root, scanRoot),
    ),
    warnings: reports.flatMap(({ scanRoot, report }) =>
      prefixWorkspaceFindings(report.warnings, root, scanRoot),
    ),
    guardsRun,
  };
}

/**
 * Hosted app volumes are ~4.84 GB total, so anything under this is close
 * enough to a stalled build or a failed write to be worth naming.
 */
export const LOW_DISK_FREE_BYTES = 500 * 1024 * 1024;

export interface DoctorDisk {
  freeBytes: number;
  totalBytes: number;
  /** Size of the caches `agent-native clean` removes by default. Undefined —
   * not 0 — unless `--disk` asked for the scan: "not measured" is not "empty". */
  reclaimableBytes?: number;
  /** Paths the cache scan could not read, so `reclaimableBytes` is a floor. */
  scanFailures?: number;
  low: boolean;
}

/** Set instead of the reading when free space could not be determined —
 * "unknown" must not read as "plenty". */
export interface DoctorDiskError {
  error: string;
}

export type DoctorDiskReport = DoctorDisk | DoctorDiskError;

/**
 * Free space on the volume holding `root`. Advisory only: it never changes
 * doctor's exit code.
 *
 * `measureReclaimable` adds what `agent-native clean` could give back, which
 * costs a recursive walk plus a full stat of every dep cache — multi-GB and
 * seconds in a workspace, on a run that only prints one advisory line. Free
 * space is the number that matters when the disk is full, so the scan is
 * opt-in (`doctor --disk`).
 */
export function checkDisk(
  root: string,
  { measureReclaimable = false } = {},
): DoctorDiskReport {
  let stats: fs.StatsFs;
  try {
    stats = fs.statfsSync(root);
  } catch (err) {
    return {
      error: `could not read free space for ${root}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const disk: DoctorDisk = {
    freeBytes,
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
    low: freeBytes < LOW_DISK_FREE_BYTES,
  };
  if (!measureReclaimable) return disk;

  const scan = scanCleanTargets({ root });
  return {
    ...disk,
    reclaimableBytes: scan.targets.reduce(
      (total, target) => total + target.bytes,
      0,
    ),
    scanFailures: scan.failures.length,
  };
}

function formatDiskLine(disk: DoctorDiskReport): string {
  if ("error" in disk) return `Disk: ${disk.error}`;
  const space = `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`;
  if (disk.reclaimableBytes === undefined) {
    return disk.low
      ? `Disk: ${space} — LOW. \`agent-native clean\` frees build caches (\`doctor --disk\` measures how much).`
      : `Disk: ${space}.`;
  }
  const partial =
    disk.scanFailures && disk.scanFailures > 0
      ? ` (at least — ${disk.scanFailures} path(s) unreadable)`
      : "";
  const reclaim = `\`agent-native clean\` can reclaim ${formatBytes(disk.reclaimableBytes)} of build caches${partial}.`;
  return disk.low
    ? `Disk: ${space} — LOW. ${reclaim}`
    : `Disk: ${space}. ${reclaim}`;
}

/** Pure escalation rule shared by the CLI (`--strict`) and the `build`
 * pre-step (`--strict` / `agent-native.json` `doctor.failOnBuild`). Doctor
 * findings fail builds by default; only an explicit `failOnBuild: false`
 * opt-out can keep a build moving, while `strict` always fails. */
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

function formatDoctorHuman(
  report: DoctorReport,
  root: string,
  disk: DoctorDiskReport,
  workspaceApps?: string[],
): string {
  const lines: string[] = [];
  lines.push(`agent-native doctor: ${root}`);
  if (workspaceApps) {
    lines.push(
      `Workspace apps scanned: ${workspaceApps.join(", ") || "(none)"}`,
    );
  }
  lines.push(`Guards run: ${report.guardsRun.join(", ") || "(none)"}`);
  lines.push(formatDiskLine(disk));
  if (report.findings.length === 0) {
    lines.push("Clean — no findings.");
  } else {
    lines.push(`${report.findings.length} finding(s):`);
    for (const f of report.findings) {
      lines.push(`  [${f.guard}] ${f.file}:${f.line} — ${f.message}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push(`${report.warnings.length} warning(s):`);
    for (const warning of report.warnings) {
      lines.push(
        `  [${warning.guard}] ${warning.file}:${warning.line} — ${warning.message}`,
      );
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
  /** Also measure what `agent-native clean` would reclaim (walks every cache). */
  disk?: boolean;
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
    } else if (arg === "--disk") {
      opts.disk = true;
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
      "  agent-native doctor --json                 Machine-readable report: { ok, findings, warnings, guardsRun, disk, strict }",
      "  agent-native doctor --only <guard,guard>   Run only the named guard(s)",
      "  agent-native doctor --strict                Keep the build gate explicit when invoked by `agent-native build`",
      "  agent-native doctor --cwd <dir>             Run against a project root other than the current directory",
      "  agent-native doctor --disk                  Also measure what `agent-native clean` would reclaim (scans every build cache)",
      "  agent-native doctor --fix                   Not implemented in this version",
      "  agent-native doctor --help                  Show this help",
      "",
      `Guards: ${ALL_GUARD_NAMES.join(", ")}`,
      "",
      "Exit codes: 0 clean, 1 findings present, 2 usage/execution error.",
      "",
      "Every run also reports free space on the volume holding the project;",
      "`--disk` adds how much of it `agent-native clean` could give back. Disk",
      "is advisory — it never changes the exit code.",
      "",
      "`agent-native build` runs doctor before the build and fails on findings",
      'by default. Set `agent-native.json` to `{ "doctor": {',
      '\"failOnBuild\": false } }` only with a reviewed reason; `--strict`',
      "always keeps the gate enabled.",
      "",
      "For dependency-pin health (framework overrides/patches, stale",
      "@agent-native/* pins), run `agent-native upgrade check` instead.",
      `For import migrations, run \`${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}\`.`,
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

  const workspaceRoots = workspaceDoctorRoots(root);
  const report =
    workspaceRoots === null
      ? runDoctorScan({ root, only: opts.only })
      : runWorkspaceDoctorScan(root, workspaceRoots.scanRoots, opts.only);
  const disk = checkDisk(root, { measureReclaimable: Boolean(opts.disk) });

  if (opts.json) {
    // The machine-readable report always goes to stdout (io.log), whether
    // or not findings are present, so `agent-native doctor --json >
    // report.json` in CI always captures the report. Only the usage/
    // execution error payloads above (bad --cwd, unknown --only) go to
    // stderr — those are diagnostics for exit code 2, not the report.
    io.log(
      JSON.stringify(
        {
          ...report,
          ...(workspaceRoots === null
            ? {}
            : {
                workspaceApps: workspaceRoots.appRoots.map((appRoot) =>
                  path.relative(root, appRoot).replaceAll("\\", "/"),
                ),
              }),
          disk,
          strict: Boolean(opts.strict),
        },
        null,
        2,
      ),
    );
  } else {
    io.log(
      formatDoctorHuman(
        report,
        root,
        disk,
        workspaceRoots?.appRoots.map((appRoot) =>
          path.relative(root, appRoot).replaceAll("\\", "/"),
        ),
      ),
    );
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
  /** False when findings are present and the project has not explicitly
   * opted out of the build gate. */
  ok: boolean;
  report: DoctorReport;
}

/**
 * `agent-native build`'s doctor pre-step. Always runs every enabled guard
 * and always prints findings to `io.err` — never silent. Findings fail the
 * build by default; only an explicit `doctor.failOnBuild: false` opt-out can
 * keep a build moving, while `--strict` overrides that opt-out.
 */
export async function runDoctorBuildHook(
  options: DoctorBuildHookOptions,
  io: DoctorIo = defaultIo,
): Promise<DoctorBuildHookResult> {
  const root = path.resolve(options.cwd);
  const config = readDoctorConfig(root);
  const workspaceRoots = workspaceDoctorRoots(root);
  const report =
    workspaceRoots === null
      ? runDoctorScan({ root })
      : runWorkspaceDoctorScan(root, workspaceRoots.scanRoots);

  if (report.findings.length > 0) {
    io.err(
      `\n[doctor] ${report.findings.length} finding(s) from \`agent-native doctor\` — fix them before the build can continue.`,
    );
    for (const f of report.findings) {
      io.err(`  [${f.guard}] ${f.file}:${f.line} — ${f.message}`);
    }
  }
  if (report.warnings.length > 0) {
    io.err(
      `\n[doctor] ${report.warnings.length} planned migration warning(s) — no rewrite is available yet.`,
    );
    for (const warning of report.warnings) {
      io.err(
        `  [${warning.guard}] ${warning.file}:${warning.line} — ${warning.message}`,
      );
    }
  }

  const fail = shouldFailBuild(report.findings.length > 0, {
    strict: options.strict,
    failOnBuild: config.failOnBuild,
  });
  if (fail) {
    io.err(
      `\n[doctor] Failing build: ${options.strict ? "--strict was passed" : "the doctor.failOnBuild gate is enabled (default: true)"}.`,
    );
  }

  return { ok: !fail, report };
}
