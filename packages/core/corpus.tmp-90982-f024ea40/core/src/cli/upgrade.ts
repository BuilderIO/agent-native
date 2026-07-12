/**
 * `agent-native upgrade` — bring an existing Agent Native app/workspace current.
 *
 * Older branches often break after a core bump. Agents then invent
 * `pnpm.overrides` / patches against `@agent-native/*` (especially dispatch),
 * which makes things worse. This command is the supported path:
 *
 *   1. Doctor: refuse or warn on framework overrides/patches
 *   2. Bump `@agent-native/*` deps to `latest` (unless file:/link:/workspace:)
 *   3. Install
 *   4. Refresh scaffold skills (`skills update scaffold --project`)
 *   5. Verify with typecheck when available
 *
 * On failure: print the error and stop. Do not patch framework packages.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_NATIVE_SCOPE = "@agent-native/";
const PINNABLE_VERSION = "latest";

export type UpgradeCommand = "run" | "check" | "help";

export interface UpgradeCliOptions {
  command: UpgradeCommand;
  cwd?: string;
  dryRun?: boolean;
  skipInstall?: boolean;
  skipVerify?: boolean;
  skipSkills?: boolean;
  json?: boolean;
  help?: boolean;
  /** Force past doctor findings that would otherwise block (not recommended). */
  force?: boolean;
}

export interface PackageJsonLike {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
    patchedDependencies?: Record<string, string>;
  };
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  scripts?: Record<string, string>;
}

export interface FrameworkOverrideFinding {
  file: string;
  field: string;
  key: string;
  value: string;
}

export interface AgentNativeDepBump {
  file: string;
  section: "dependencies" | "devDependencies" | "optionalDependencies";
  name: string;
  from: string;
  to: string;
}

export interface UpgradeProject {
  root: string;
  kind: "standalone" | "workspace";
  packageFiles: string[];
}

export interface UpgradeDoctorReport {
  project: UpgradeProject;
  findings: FrameworkOverrideFinding[];
  bumps: AgentNativeDepBump[];
  installedCoreVersion: string | null;
  cliCoreVersion: string | null;
  scaffoldStaleHint: boolean;
}

export interface UpgradeRunResult {
  ok: boolean;
  dryRun: boolean;
  doctor: UpgradeDoctorReport;
  steps: Array<{
    id: string;
    status: "ok" | "skipped" | "failed" | "planned";
    detail?: string;
  }>;
  message: string;
  exitCode: number;
}

export interface UpgradeIo {
  log: (message: string) => void;
  err: (message: string) => void;
  spawn: (
    command: string,
    args: string[],
    options: { cwd: string; stdio?: "inherit" | "pipe" },
  ) => SpawnSyncReturns<string | Buffer>;
  runSkillsUpdate: (cwd: string) => Promise<void>;
}

const defaultIo: UpgradeIo = {
  log: (message) => console.log(message),
  err: (message) => console.error(message),
  spawn: (command, args, options) =>
    spawnSync(command, args, {
      cwd: options.cwd,
      stdio: options.stdio ?? "inherit",
      encoding: "utf-8",
      shell: process.platform === "win32",
    }),
  runSkillsUpdate: async (cwd) => {
    const { runSkills } = await import("./skills.js");
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      await runSkills(["update", "scaffold", "--project"]);
    } finally {
      process.chdir(previous);
    }
  },
};

export function parseUpgradeArgs(argv: string[]): UpgradeCliOptions {
  const opts: UpgradeCliOptions = { command: "run" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "check" || arg === "doctor") {
      opts.command = "check";
    } else if (arg === "help" || arg === "--help" || arg === "-h") {
      opts.command = "help";
      opts.help = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--skip-install") {
      opts.skipInstall = true;
    } else if (arg === "--skip-verify") {
      opts.skipVerify = true;
    } else if (arg === "--skip-skills") {
      opts.skipSkills = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--cwd" && argv[i + 1]) {
      opts.cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      opts.cwd = arg.slice("--cwd=".length);
    } else if (!arg.startsWith("-")) {
      // Ignore unknown positional for forward-compat; help covers usage.
    }
  }
  return opts;
}

export function printUpgradeHelp(io: Pick<UpgradeIo, "log"> = defaultIo): void {
  io.log(
    [
      "Usage:",
      "  agent-native upgrade              Bring this app/workspace to current @agent-native/*",
      "  agent-native upgrade check        Doctor only: overrides, patches, pending bumps",
      "  agent-native upgrade --dry-run    Show the plan without writing or installing",
      "",
      "Options:",
      "  --skip-install   Bump package.json only; do not run the package manager",
      "  --skip-skills    Skip `skills update scaffold --project`",
      "  --skip-verify    Skip typecheck after upgrade",
      "  --force          Continue even when framework overrides/patches are present",
      "  --json           Machine-readable report",
      "  --cwd <dir>      Run against a project root other than the current directory",
      "",
      "On failure: report the error and stop. Do NOT add pnpm.overrides,",
      "patchedDependencies, or local patches against @agent-native/* packages.",
      "Do NOT edit node_modules/@agent-native/* or invent dispatch/core behavior",
      "overrides. Revert those changes and re-run `agent-native upgrade`.",
    ].join("\n"),
  );
}

function readJsonFile(filePath: string): PackageJsonLike | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PackageJsonLike;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: PackageJsonLike): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function isAgentNativePackageName(name: string): boolean {
  return name === "@agent-native" || name.startsWith(AGENT_NATIVE_SCOPE);
}

export function isPinnedOrLocalVersion(version: string): boolean {
  const v = version.trim();
  return (
    v.startsWith("file:") ||
    v.startsWith("link:") ||
    v.startsWith("workspace:") ||
    v.startsWith("portal:") ||
    v.startsWith("git+") ||
    v.startsWith("github:") ||
    v.startsWith("http:") ||
    v.startsWith("https:")
  );
}

export function shouldBumpAgentNativeVersion(version: string): boolean {
  if (isPinnedOrLocalVersion(version)) return false;
  return version.trim() !== PINNABLE_VERSION;
}

function collectOverrideFindings(
  file: string,
  pkg: PackageJsonLike,
): FrameworkOverrideFinding[] {
  const findings: FrameworkOverrideFinding[] = [];
  const tables: Array<{
    field: string;
    map: Record<string, string> | undefined;
  }> = [
    { field: "pnpm.overrides", map: pkg.pnpm?.overrides },
    { field: "pnpm.patchedDependencies", map: pkg.pnpm?.patchedDependencies },
    { field: "overrides", map: pkg.overrides },
    { field: "resolutions", map: pkg.resolutions },
  ];
  for (const table of tables) {
    if (!table.map) continue;
    for (const [key, value] of Object.entries(table.map)) {
      // Keys may be bare (`@agent-native/core`) or versioned
      // (`@agent-native/core@1.2.3` for patchedDependencies).
      if (key.includes(AGENT_NATIVE_SCOPE) || isAgentNativePackageName(key)) {
        findings.push({ file, field: table.field, key, value: String(value) });
      }
    }
  }
  return findings;
}

function collectBumps(
  file: string,
  pkg: PackageJsonLike,
): AgentNativeDepBump[] {
  const bumps: AgentNativeDepBump[] = [];
  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const;
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (!isAgentNativePackageName(name)) continue;
      if (!shouldBumpAgentNativeVersion(version)) continue;
      bumps.push({
        file,
        section,
        name,
        from: version,
        to: PINNABLE_VERSION,
      });
    }
  }
  return bumps;
}

function applyBumps(pkg: PackageJsonLike, bumps: AgentNativeDepBump[]): void {
  for (const bump of bumps) {
    const section = pkg[bump.section];
    if (!section) continue;
    if (section[bump.name] === bump.from) {
      section[bump.name] = bump.to;
    }
  }
}

export function detectUpgradeProject(cwd: string): UpgradeProject | null {
  const start = path.resolve(cwd);
  let dir = start;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = readJsonFile(pkgPath);
      const hasCore =
        Boolean(pkg?.dependencies?.["@agent-native/core"]) ||
        Boolean(pkg?.devDependencies?.["@agent-native/core"]);
      const workspaceYaml = path.join(dir, "pnpm-workspace.yaml");
      const isWorkspace = fs.existsSync(workspaceYaml);
      if (hasCore || isWorkspace) {
        const packageFiles = [pkgPath];
        if (isWorkspace) {
          packageFiles.push(...workspacePackageFiles(dir, workspaceYaml));
        }
        return {
          root: dir,
          kind: isWorkspace ? "workspace" : "standalone",
          packageFiles: Array.from(new Set(packageFiles)),
        };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function workspacePackageFiles(root: string, workspaceYaml: string): string[] {
  const patterns = parseWorkspacePackagePatterns(workspaceYaml);
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const rawPattern of patterns) {
    const exclude = rawPattern.startsWith("!");
    const pattern = exclude ? rawPattern.slice(1) : rawPattern;
    const files = packageFilesForWorkspacePattern(root, pattern);
    for (const file of files) {
      if (exclude) excluded.add(file);
      else included.add(file);
    }
  }
  return Array.from(included)
    .filter((file) => !excluded.has(file))
    .sort();
}

function parseWorkspacePackagePatterns(workspaceYaml: string): string[] {
  let text = "";
  try {
    text = fs.readFileSync(workspaceYaml, "utf-8");
  } catch {
    return ["apps/*", "packages/*"];
  }
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^[A-Za-z0-9_-]+:/.test(trimmed)) {
      inPackages = trimmed === "packages:";
      continue;
    }
    if (!inPackages || !trimmed.startsWith("-")) continue;
    const pattern = trimmed
      .slice(1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (pattern) patterns.push(pattern);
  }
  return patterns.length ? patterns : ["apps/*", "packages/*"];
}

function packageFilesForWorkspacePattern(
  root: string,
  pattern: string,
): string[] {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized.includes("node_modules")) return [];
  if (normalized.endsWith("/**")) {
    return collectPackageFilesRecursive(
      path.join(root, normalized.slice(0, -3)),
    );
  }
  if (normalized.endsWith("/*")) {
    const base = path.join(root, normalized.slice(0, -2));
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(base, entry.name, "package.json"))
      .filter((file) => fs.existsSync(file));
  }
  if (normalized.includes("*")) {
    return collectPackageFilesRecursive(
      path.join(root, normalized.split("*")[0]),
    );
  }
  const file = path.join(root, normalized, "package.json");
  return fs.existsSync(file) ? [file] : [];
}

function collectPackageFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(dir, entry.name);
    const pkg = path.join(child, "package.json");
    if (fs.existsSync(pkg)) files.push(pkg);
    files.push(...collectPackageFilesRecursive(child));
  }
  return files;
}

function resolveInstalledPackageVersion(
  projectRoot: string,
  packageName: string,
): string | null {
  let dir = projectRoot;
  while (true) {
    const candidate = path.join(
      dir,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (fs.existsSync(candidate)) {
      const pkg = readJsonFile(candidate);
      return typeof pkg?.version === "string" ? pkg.version : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readCliCoreVersion(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../../package.json");
    const pkg = readJsonFile(pkgPath);
    return typeof pkg?.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function detectPackageManager(projectRoot: string): "pnpm" | "npm" | "yarn" {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "npm";
  // Prefer pnpm for Agent Native scaffolds.
  return "pnpm";
}

function installArgs(pm: "pnpm" | "npm" | "yarn"): string[] {
  if (pm === "npm") return ["install"];
  if (pm === "yarn") return ["install"];
  return ["install"];
}

export function buildUpgradeDoctorReport(
  project: UpgradeProject,
): UpgradeDoctorReport {
  const findings: FrameworkOverrideFinding[] = [];
  const bumps: AgentNativeDepBump[] = [];
  for (const file of project.packageFiles) {
    const pkg = readJsonFile(file);
    if (!pkg) continue;
    findings.push(...collectOverrideFindings(file, pkg));
    bumps.push(...collectBumps(file, pkg));
  }
  const installedCoreVersion = resolveInstalledPackageVersion(
    project.root,
    "@agent-native/core",
  );
  const cliCoreVersion = readCliCoreVersion();
  const skillsUpdateScript = project.packageFiles.some((file) => {
    const pkg = readJsonFile(file);
    return Boolean(pkg?.scripts?.["skills:update"]);
  });
  return {
    project,
    findings,
    bumps,
    installedCoreVersion,
    cliCoreVersion,
    scaffoldStaleHint: skillsUpdateScript || bumps.length > 0,
  };
}

function relativeTo(root: string, file: string): string {
  const rel = path.relative(root, file);
  return rel || ".";
}

function formatDoctorHuman(report: UpgradeDoctorReport): string {
  const lines: string[] = [];
  lines.push(`Project: ${report.project.root} (${report.project.kind})`);
  if (report.installedCoreVersion) {
    lines.push(`Installed @agent-native/core: ${report.installedCoreVersion}`);
  } else {
    lines.push("Installed @agent-native/core: (not found in node_modules)");
  }
  if (report.cliCoreVersion) {
    lines.push(`CLI package version: ${report.cliCoreVersion}`);
  }
  if (report.findings.length === 0) {
    lines.push("Framework overrides/patches: none");
  } else {
    lines.push("Framework overrides/patches:");
    for (const finding of report.findings) {
      lines.push(
        `  - ${relativeTo(report.project.root, finding.file)} ${finding.field}["${finding.key}"] = ${finding.value}`,
      );
    }
  }
  if (report.bumps.length === 0) {
    lines.push("Pending @agent-native/* bumps: none");
  } else {
    lines.push("Pending @agent-native/* bumps:");
    for (const bump of report.bumps) {
      lines.push(
        `  - ${relativeTo(report.project.root, bump.file)} ${bump.name}: ${bump.from} → ${bump.to}`,
      );
    }
  }
  return lines.join("\n");
}

const FAILURE_GUIDANCE = [
  "Upgrade failed. Do not paper over this with framework patches.",
  "Never add pnpm.overrides / patchedDependencies / resolutions for @agent-native/*.",
  "Never edit node_modules/@agent-native/* or invent local dispatch/core behavior overrides.",
  "Revert those changes if present, fix the app-level compile/runtime error, then re-run:",
  "  npx @agent-native/core@latest upgrade",
].join("\n");

export async function runUpgrade(
  argv: string[],
  io: UpgradeIo = defaultIo,
): Promise<number> {
  const opts = parseUpgradeArgs(argv);
  if (opts.help || opts.command === "help") {
    printUpgradeHelp(io);
    return 0;
  }

  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const project = detectUpgradeProject(cwd);
  if (!project) {
    const message =
      "No Agent Native app/workspace found. Run from an app or workspace root that depends on @agent-native/core.";
    if (opts.json) {
      io.err(JSON.stringify({ ok: false, message }, null, 2));
    } else {
      io.err(message);
    }
    return 1;
  }

  const doctor = buildUpgradeDoctorReport(project);
  if (opts.command === "check") {
    if (opts.json) {
      io.log(
        JSON.stringify({ ok: doctor.findings.length === 0, doctor }, null, 2),
      );
    } else {
      io.log(formatDoctorHuman(doctor));
      if (doctor.findings.length > 0) {
        io.err("");
        io.err(FAILURE_GUIDANCE);
      }
    }
    return doctor.findings.length > 0 ? 1 : 0;
  }

  const result: UpgradeRunResult = {
    ok: true,
    dryRun: Boolean(opts.dryRun),
    doctor,
    steps: [],
    message: "",
    exitCode: 0,
  };

  if (doctor.findings.length > 0 && !opts.force) {
    result.ok = false;
    result.exitCode = 1;
    result.message =
      "Blocked: framework overrides/patches for @agent-native/* are present. Remove them, then re-run upgrade (or pass --force to continue unsafely).";
    result.steps.push({
      id: "doctor",
      status: "failed",
      detail: result.message,
    });
    if (opts.json) {
      io.err(JSON.stringify(result, null, 2));
    } else {
      io.log(formatDoctorHuman(doctor));
      io.err("");
      io.err(result.message);
      io.err("");
      io.err(FAILURE_GUIDANCE);
    }
    return 1;
  }

  result.steps.push({
    id: "doctor",
    status: doctor.findings.length > 0 ? "ok" : "ok",
    detail:
      doctor.findings.length > 0
        ? "Continuing with --force despite framework overrides/patches"
        : "No framework overrides/patches",
  });

  // Apply package.json bumps.
  if (doctor.bumps.length === 0) {
    result.steps.push({
      id: "bump",
      status: "skipped",
      detail: "All @agent-native/* deps already use latest or local pins",
    });
  } else if (opts.dryRun) {
    result.steps.push({
      id: "bump",
      status: "planned",
      detail: doctor.bumps
        .map(
          (b) =>
            `${relativeTo(project.root, b.file)} ${b.name}: ${b.from} → ${b.to}`,
        )
        .join("; "),
    });
  } else {
    const byFile = new Map<string, AgentNativeDepBump[]>();
    for (const bump of doctor.bumps) {
      const list = byFile.get(bump.file) ?? [];
      list.push(bump);
      byFile.set(bump.file, list);
    }
    for (const [file, bumps] of byFile) {
      const pkg = readJsonFile(file);
      if (!pkg) continue;
      applyBumps(pkg, bumps);
      writeJsonFile(file, pkg);
    }
    result.steps.push({
      id: "bump",
      status: "ok",
      detail: `Updated ${doctor.bumps.length} @agent-native/* dependency pin(s)`,
    });
  }

  // Install.
  if (opts.skipInstall) {
    result.steps.push({
      id: "install",
      status: "skipped",
      detail: "--skip-install",
    });
  } else if (opts.dryRun) {
    result.steps.push({
      id: "install",
      status: "planned",
      detail: `${detectPackageManager(project.root)} install`,
    });
  } else {
    const pm = detectPackageManager(project.root);
    const spawned = io.spawn(pm, installArgs(pm), {
      cwd: project.root,
      stdio: opts.json ? "pipe" : "inherit",
    });
    if (spawned.status !== 0) {
      result.ok = false;
      result.exitCode = spawned.status ?? 1;
      result.message = `${pm} install failed`;
      result.steps.push({
        id: "install",
        status: "failed",
        detail: result.message,
      });
      emitResult(io, opts, result);
      return result.exitCode;
    }
    result.steps.push({ id: "install", status: "ok", detail: `${pm} install` });
  }

  // Skills refresh.
  if (opts.skipSkills) {
    result.steps.push({
      id: "skills",
      status: "skipped",
      detail: "--skip-skills",
    });
  } else if (opts.dryRun) {
    result.steps.push({
      id: "skills",
      status: "planned",
      detail: "skills update scaffold --project",
    });
  } else {
    try {
      await io.runSkillsUpdate(project.root);
      result.steps.push({
        id: "skills",
        status: "ok",
        detail: "skills update scaffold --project",
      });
    } catch (err) {
      result.ok = false;
      result.exitCode = 1;
      result.message = `skills update failed: ${err instanceof Error ? err.message : String(err)}`;
      result.steps.push({
        id: "skills",
        status: "failed",
        detail: result.message,
      });
      emitResult(io, opts, result);
      return result.exitCode;
    }
  }

  // Verify.
  if (opts.skipVerify) {
    result.steps.push({
      id: "verify",
      status: "skipped",
      detail: "--skip-verify",
    });
  } else if (opts.dryRun) {
    result.steps.push({
      id: "verify",
      status: "planned",
      detail: "typecheck (when available)",
    });
  } else {
    const rootPkg = readJsonFile(path.join(project.root, "package.json"));
    const hasTypecheck = Boolean(rootPkg?.scripts?.typecheck);
    if (!hasTypecheck) {
      result.steps.push({
        id: "verify",
        status: "skipped",
        detail: "no typecheck script",
      });
    } else {
      const pm = detectPackageManager(project.root);
      const args =
        pm === "npm"
          ? ["run", "typecheck"]
          : pm === "yarn"
            ? ["typecheck"]
            : ["typecheck"];
      const spawned = io.spawn(pm, args, {
        cwd: project.root,
        stdio: opts.json ? "pipe" : "inherit",
      });
      if (spawned.status !== 0) {
        result.ok = false;
        result.exitCode = spawned.status ?? 1;
        result.message = "typecheck failed";
        result.steps.push({
          id: "verify",
          status: "failed",
          detail: result.message,
        });
        emitResult(io, opts, result);
        return result.exitCode;
      }
      result.steps.push({ id: "verify", status: "ok", detail: "typecheck" });
    }
  }

  result.message = opts.dryRun
    ? "Dry run complete. Re-run without --dry-run to apply."
    : "Upgrade complete. If the app still fails to run, fix app-level code — do not patch @agent-native/*.";
  emitResult(io, opts, result);
  return 0;
}

function emitResult(
  io: UpgradeIo,
  opts: UpgradeCliOptions,
  result: UpgradeRunResult,
): void {
  if (opts.json) {
    const sink = result.ok ? io.log : io.err;
    sink(JSON.stringify(result, null, 2));
    return;
  }
  io.log(formatDoctorHuman(result.doctor));
  io.log("");
  for (const step of result.steps) {
    io.log(
      `[${step.status}] ${step.id}${step.detail ? ` — ${step.detail}` : ""}`,
    );
  }
  io.log("");
  if (result.ok) {
    io.log(result.message);
  } else {
    io.err(result.message);
    io.err("");
    io.err(FAILURE_GUIDANCE);
  }
}
