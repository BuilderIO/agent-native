import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import {
  isMigrationManifestActive,
  loadMigrationManifestsForProject,
  type MigrationDependency,
  type MigrationDependencyCondition,
} from "../package-lifecycle/migration-manifest.js";
import { loadOptionalPeer } from "../shared/optional-peer.js";
import type { MigrationCodemodResult } from "./migration-codemod.js";

const AGENT_NATIVE_SCOPE = "@agent-native/";
const PINNABLE_VERSION = "latest";
const PINNABLE_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

export type UpgradeCommand = "run" | "check" | "help";

export interface UpgradeCliOptions {
  command: UpgradeCommand;
  cwd?: string;
  dryRun?: boolean;
  codemods?: boolean;
  yes?: boolean;
  skipInstall?: boolean;
  skipVerify?: boolean;
  skipSkills?: boolean;
  json?: boolean;
  help?: boolean;
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
  workspaces?: string[] | { packages?: string[] };
  "agent-native"?: { workspaceCore?: string };
}

export interface FrameworkOverrideFinding {
  file: string;
  field: string;
  key: string;
  value: string;
}

export interface AgentNativeDepBump {
  file: string;
  section: (typeof PINNABLE_SECTIONS)[number];
  name: string;
  from: string;
  to: string;
}

export interface AgentNativeDepPin {
  file: string;
  section: (typeof PINNABLE_SECTIONS)[number];
  name: string;
  version: string;
}

export interface UpgradeDependencyAddition {
  file: string;
  name: string;
  version: string;
  action: "add" | "promote" | "update";
  from?: string;
}

export interface AgentNativePinResult {
  pins: AgentNativeDepPin[];
  unresolved: string[];
  unreadable: string[];
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
  unreadable: string[];
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
  codemod?: {
    files: string[];
    warnings: string[];
    diff: string;
  };
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
    } else if (arg === "--codemods") {
      opts.codemods = true;
    } else if (arg === "--yes") {
      opts.yes = true;
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
      "  agent-native upgrade --codemods   Apply manifest-driven import migrations",
      "",
      "Options:",
      "  --skip-install   Bump package.json only; do not run the package manager",
      "  --codemods       Rewrite moved Agent-Native imports and exports",
      "  --dry-run        Preview the upgrade and codemods without writing files",
      "  --yes            Accepted for compatibility; codemods apply by default",
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

type JsonFileRead =
  | { ok: true; value: PackageJsonLike }
  | { ok: false; reason: "missing" | "unreadable"; message: string };

function readJsonFile(filePath: string): JsonFileRead {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      reason: code === "ENOENT" ? "missing" : "unreadable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as PackageJsonLike };
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      message: err instanceof Error ? err.message : String(err),
    };
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
  for (const section of PINNABLE_SECTIONS) {
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

function firstConfigured(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

function hasSentryKeyTuple(environment: NodeJS.ProcessEnv): boolean {
  return (
    firstConfigured(
      environment.SENTRY_CLIENT_KEY,
      environment.VITE_SENTRY_CLIENT_KEY,
    ) &&
    firstConfigured(
      environment.SENTRY_PROJECT_ID,
      environment.VITE_SENTRY_PROJECT_ID,
    ) &&
    firstConfigured(
      environment.SENTRY_INGEST_HOST,
      environment.VITE_SENTRY_INGEST_HOST,
    )
  );
}

function isEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

export function selectMigrationDependencies(
  dependencies: MigrationDependency[],
  environment: NodeJS.ProcessEnv,
): MigrationDependency[] {
  const appName =
    environment.AGENT_NATIVE_WORKSPACE_APP_ID?.trim() ||
    environment.VITE_AGENT_NATIVE_WORKSPACE_APP_ID?.trim() ||
    environment.APP_NAME?.trim();
  const appDatabaseUrl = appName
    ? environment[
        `${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`
      ]?.trim()
    : undefined;
  const databaseUrl = appDatabaseUrl || environment.DATABASE_URL?.trim();
  const sentryKeyTuple = hasSentryKeyTuple(environment);
  const enabled = new Set<MigrationDependencyCondition>();

  if (!databaseUrl || /^pglite:/i.test(databaseUrl)) {
    enabled.add("pglite-database");
  }
  if (
    firstConfigured(environment.SENTRY_SERVER_DSN, environment.SENTRY_DSN) ||
    sentryKeyTuple
  ) {
    enabled.add("server-sentry");
  }
  if (
    firstConfigured(
      environment.SENTRY_CLIENT_DSN,
      environment.VITE_SENTRY_CLIENT_DSN,
      environment.VITE_SENTRY_DSN,
      environment.SENTRY_DSN,
    ) ||
    sentryKeyTuple
  ) {
    enabled.add("browser-sentry");
  }
  if (
    firstConfigured(environment.SENTRY_AUTH_TOKEN) &&
    firstConfigured(environment.SENTRY_ORG, environment.SENTRY_ORG_SLUG) &&
    firstConfigured(
      environment.SENTRY_PROJECT,
      environment.SENTRY_CLIENT_PROJECT,
    )
  ) {
    enabled.add("sentry-source-map-upload");
  }
  if (isEnabled(environment.AUTH_SSO)) enabled.add("sso");
  if (isEnabled(environment.AUTH_SCIM)) enabled.add("scim");
  if (firstConfigured(environment.VITE_AMPLITUDE_API_KEY)) {
    enabled.add("amplitude");
  }
  if (
    firstConfigured(environment.MICROSOFT_TEAMS_APP_ID) &&
    firstConfigured(environment.MICROSOFT_TEAMS_APP_PASSWORD)
  ) {
    enabled.add("microsoft-teams");
  }

  const selected = new Map<string, MigrationDependency>();
  for (const dependency of dependencies) {
    if (enabled.has(dependency.when)) selected.set(dependency.name, dependency);
  }
  return [...selected.values()];
}

export function isDirectCoreDependency(pkg: PackageJsonLike): boolean {
  return [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies].some(
    (dependencies) => Boolean(dependencies?.["@agent-native/core"]),
  );
}

function findWorkspaceEnvironmentRoot(
  packageDir: string,
  fallbackRoot: string,
): string {
  let dir = packageDir;
  while (true) {
    const packageRead = readJsonFile(path.join(dir, "package.json"));
    const isWorkspaceRoot =
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      (packageRead.ok &&
        (packageWorkspacePatterns(packageRead.value).length > 0 ||
          Boolean(packageRead.value["agent-native"]?.workspaceCore)));
    if (isWorkspaceRoot) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return fallbackRoot;
    dir = parent;
  }
}

export function readUpgradeEnvironment(
  projectRoot: string,
  packageDir: string,
  shellEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const workspaceRoot = findWorkspaceEnvironmentRoot(packageDir, projectRoot);
  const directories = [...new Set([workspaceRoot, projectRoot, packageDir])]
    .filter((directory) => {
      const relative = path.relative(directory, packageDir);
      return (
        !path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`)
      );
    })
    .sort(
      (left, right) =>
        left.split(path.sep).length - right.split(path.sep).length,
    );
  const environment: NodeJS.ProcessEnv = {};
  for (const directory of directories) {
    for (const file of [".env", ".env.local"]) {
      const filePath = path.join(directory, file);
      let contents: string;
      try {
        contents = fs.readFileSync(filePath, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error(
          `Could not read ${path.relative(projectRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      Object.assign(environment, dotenv.parse(contents));
    }
  }
  Object.assign(environment, shellEnvironment);
  return environment;
}

export function loadActiveMigrationDependencies(
  projectRoot: string,
  packageVersion: string | null,
  manifests = loadMigrationManifestsForProject(projectRoot),
): MigrationDependency[] {
  return manifests
    .filter((manifest) => isMigrationManifestActive(manifest, packageVersion))
    .flatMap((manifest) => manifest.dependencies ?? []);
}

export function planMigrationDependencyAdditions(
  project: UpgradeProject,
  shellEnvironment: NodeJS.ProcessEnv = process.env,
): UpgradeDependencyAddition[] {
  const cliCoreVersion = readCliCoreVersion();
  if (!cliCoreVersion) {
    throw new Error(
      "Could not read the Core version for dependency migration.",
    );
  }
  const dependencies = loadActiveMigrationDependencies(
    project.root,
    cliCoreVersion,
  );
  if (dependencies.length === 0) return [];

  const additions: UpgradeDependencyAddition[] = [];
  for (const file of project.packageFiles) {
    const read = readJsonFile(file);
    if (!read.ok || !isDirectCoreDependency(read.value)) continue;
    const packageJson = read.value;
    const packageDependencies = selectMigrationDependencies(
      dependencies,
      readUpgradeEnvironment(
        project.root,
        path.dirname(file),
        shellEnvironment,
      ),
    );
    for (const dependency of packageDependencies) {
      const runtimeVersion = packageJson.dependencies?.[dependency.name];
      const otherVersions = [
        packageJson.devDependencies?.[dependency.name],
        packageJson.optionalDependencies?.[dependency.name],
        packageJson.peerDependencies?.[dependency.name],
      ];
      const existingVersion = runtimeVersion ?? otherVersions.find(Boolean);
      const version = preserveCompatibleMigrationVersion(
        existingVersion,
        dependency.version,
      );
      const hasOtherDeclarations = otherVersions.some(Boolean);
      if (runtimeVersion === version && !hasOtherDeclarations) continue;
      additions.push({
        file,
        name: dependency.name,
        version,
        action: runtimeVersion ? "update" : existingVersion ? "promote" : "add",
        ...(existingVersion && existingVersion !== version
          ? { from: existingVersion }
          : {}),
      });
    }
  }
  return additions;
}

function preserveCompatibleMigrationVersion(
  existing: string | undefined,
  required: string,
): string {
  if (!existing) return required;
  return required.split("||").some((range) => range.trim() === existing.trim())
    ? existing
    : required;
}

function applyMigrationDependencyAdditions(
  additions: UpgradeDependencyAddition[],
): void {
  const byFile = new Map<string, UpgradeDependencyAddition[]>();
  for (const addition of additions) {
    const list = byFile.get(addition.file) ?? [];
    list.push(addition);
    byFile.set(addition.file, list);
  }
  for (const [file, fileAdditions] of byFile) {
    const read = readJsonFile(file);
    if (!read.ok) continue;
    const dependencies = (read.value.dependencies ??= {});
    for (const addition of fileAdditions) {
      dependencies[addition.name] = addition.version;
      for (const section of [
        read.value.devDependencies,
        read.value.optionalDependencies,
        read.value.peerDependencies,
      ]) {
        if (section) delete section[addition.name];
      }
      for (const field of [
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ] as const) {
        const section = read.value[field];
        if (section && Object.keys(section).length === 0) {
          delete read.value[field];
        }
      }
    }
    writeJsonFile(file, read.value);
  }
}

export function addConfiguredMigrationDependencies(
  project: UpgradeProject,
  shellEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  applyMigrationDependencyAdditions(
    planMigrationDependencyAdditions(project, shellEnvironment),
  );
}

export function pinResolvedAgentNativeVersions(
  project: UpgradeProject,
): AgentNativePinResult {
  const pins: AgentNativeDepPin[] = [];
  const unresolved: string[] = [];
  const unreadable: string[] = [];
  for (const file of project.packageFiles) {
    const read = readJsonFile(file);
    if (!read.ok) {
      if (read.reason === "unreadable") {
        unreadable.push(`${relativeTo(project.root, file)}: ${read.message}`);
      }
      continue;
    }
    const pkg = read.value;
    let changed = false;
    for (const section of PINNABLE_SECTIONS) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (!isAgentNativePackageName(name)) continue;
        if (version.trim() !== PINNABLE_VERSION) continue;
        const resolved = resolveInstalledPackageVersion(
          path.dirname(file),
          name,
        );
        if (!resolved) {
          unresolved.push(`${relativeTo(project.root, file)} ${name}`);
          continue;
        }
        deps[name] = resolved;
        pins.push({ file, section, name, version: resolved });
        changed = true;
      }
    }
    if (changed) writeJsonFile(file, pkg);
  }
  return { pins, unresolved, unreadable };
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
      const read = readJsonFile(pkgPath);
      const pkg = read.ok ? read.value : undefined;
      const hasCore =
        Boolean(pkg?.dependencies?.["@agent-native/core"]) ||
        Boolean(pkg?.devDependencies?.["@agent-native/core"]);
      const workspaceYaml = path.join(dir, "pnpm-workspace.yaml");
      const hasWorkspaceYaml = fs.existsSync(workspaceYaml);
      const workspacePatterns = packageWorkspacePatterns(pkg);
      const isWorkspace = hasWorkspaceYaml || workspacePatterns.length > 0;
      const unreadable = !read.ok && read.reason === "unreadable";
      if (hasCore || isWorkspace || unreadable) {
        const packageFiles = [pkgPath];
        if (hasWorkspaceYaml) {
          packageFiles.push(...workspacePackageFiles(dir, workspaceYaml));
        } else if (workspacePatterns.length > 0) {
          packageFiles.push(
            ...workspacePackageFilesForPatterns(dir, workspacePatterns),
          );
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

function packageWorkspacePatterns(pkg: PackageJsonLike | undefined): string[] {
  if (!pkg?.workspaces) return [];
  return Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces.packages ?? []);
}

function workspacePackageFiles(root: string, workspaceYaml: string): string[] {
  const patterns = parseWorkspacePackagePatterns(workspaceYaml);
  return workspacePackageFilesForPatterns(root, patterns);
}

function workspacePackageFilesForPatterns(
  root: string,
  patterns: string[],
): string[] {
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

function isYarnPnpProject(projectRoot: string): boolean {
  let dir = projectRoot;
  while (true) {
    if (
      fs.existsSync(path.join(dir, ".pnp.cjs")) ||
      fs.existsSync(path.join(dir, ".pnp.data.json"))
    ) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function resolveInstalledPackageVersion(
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
      const read = readJsonFile(candidate);
      if (!read.ok) return null;
      return typeof read.value.version === "string" ? read.value.version : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!isYarnPnpProject(projectRoot)) return null;
  try {
    const requireFromProject = createRequire(
      path.join(projectRoot, "package.json"),
    );
    const packageJsonPath = requireFromProject.resolve(
      `${packageName}/package.json`,
    );
    const read = readJsonFile(packageJsonPath);
    return read.ok && typeof read.value.version === "string"
      ? read.value.version
      : null;
  } catch {
    try {
      const requireFromProject = createRequire(
        path.join(projectRoot, "package.json"),
      );
      let dir = path.dirname(requireFromProject.resolve(packageName));
      while (true) {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) {
          const read = readJsonFile(candidate);
          if (
            read.ok &&
            read.value.name === packageName &&
            typeof read.value.version === "string"
          ) {
            return read.value.version;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Not running under a resolver that can find this package.
    }
  }
  return null;
}

export function readCliCoreVersion(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../../package.json");
    const read = readJsonFile(pkgPath);
    if (!read.ok) return null;
    return typeof read.value.version === "string" ? read.value.version : null;
  } catch {
    return null;
  }
}

function detectPackageManager(projectRoot: string): "pnpm" | "npm" | "yarn" {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "npm";
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
  const unreadable: string[] = [];
  for (const file of project.packageFiles) {
    const read = readJsonFile(file);
    if (!read.ok) {
      if (read.reason === "unreadable") {
        unreadable.push(`${relativeTo(project.root, file)}: ${read.message}`);
      }
      continue;
    }
    findings.push(...collectOverrideFindings(file, read.value));
    bumps.push(...collectBumps(file, read.value));
  }
  const installedCoreVersion = resolveInstalledPackageVersion(
    project.root,
    "@agent-native/core",
  );
  const cliCoreVersion = readCliCoreVersion();
  const skillsUpdateScript = project.packageFiles.some((file) => {
    const read = readJsonFile(file);
    return read.ok && Boolean(read.value.scripts?.["skills:update"]);
  });
  return {
    project,
    findings,
    bumps,
    unreadable,
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
  if (report.unreadable.length > 0) {
    lines.push("Unreadable package.json (not checked):");
    for (const entry of report.unreadable) {
      lines.push(`  - ${entry}`);
    }
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

function applyCodemodDependencyPlan(
  codemodResult: MigrationCodemodResult,
): MigrationCodemodResult["changes"] {
  const dependencyFiles = new Set(codemodResult.dependencyFiles);
  const applied: MigrationCodemodResult["changes"] = [];
  for (const change of codemodResult.changes) {
    if (!dependencyFiles.has(change.file)) continue;
    fs.writeFileSync(change.file, change.after);
    applied.push(change);
  }
  return applied;
}

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
      "No Agent-Native app/workspace found. Run from an app or workspace root that depends on @agent-native/core.";
    if (opts.json) {
      io.err(JSON.stringify({ ok: false, message }, null, 2));
    } else {
      io.err(message);
    }
    return 1;
  }

  const doctor = buildUpgradeDoctorReport(project);
  const doctorOk =
    doctor.findings.length === 0 && doctor.unreadable.length === 0;
  if (opts.command === "check") {
    if (opts.json) {
      io.log(JSON.stringify({ ok: doctorOk, doctor }, null, 2));
    } else {
      io.log(formatDoctorHuman(doctor));
      if (doctor.findings.length > 0) {
        io.err("");
        io.err(FAILURE_GUIDANCE);
      }
    }
    return doctorOk ? 0 : 1;
  }

  const dryRun = Boolean(opts.dryRun);
  const result: UpgradeRunResult = {
    ok: true,
    dryRun,
    doctor,
    steps: [],
    message: "",
    exitCode: 0,
  };

  if (doctor.unreadable.length > 0) {
    result.ok = false;
    result.exitCode = 1;
    result.message = `Blocked: these package.json files could not be parsed, so their overrides and @agent-native/* specs were never checked: ${doctor.unreadable.join("; ")}`;
    result.steps.push({
      id: "doctor",
      status: "failed",
      detail: result.message,
    });
    emitResult(io, opts, result);
    return result.exitCode;
  }

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

  let dependencyAdditions: UpgradeDependencyAddition[];
  try {
    dependencyAdditions = planMigrationDependencyAdditions(project);
  } catch (error) {
    result.ok = false;
    result.exitCode = 1;
    result.message =
      error instanceof Error
        ? error.message
        : "Could not plan feature dependency migrations.";
    result.steps.push({
      id: "feature-dependencies",
      status: "failed",
      detail: result.message,
    });
    emitResult(io, opts, result);
    return result.exitCode;
  }

  const conditionalPeers = [
    ...new Set(
      loadActiveMigrationDependencies(project.root, doctor.cliCoreVersion).map(
        ({ name }) => name,
      ),
    ),
  ];
  const deploymentEnvironmentNote = `Remote deployment environment and database-backed feature settings cannot be inspected by this command; verify configured features against these conditional peers: ${conditionalPeers.join(", ") || "none declared"}.`;

  if (dependencyAdditions.length === 0) {
    result.steps.push({
      id: "feature-dependencies",
      status: "skipped",
      detail: `No local dependency additions are pending. ${deploymentEnvironmentNote}`,
    });
  } else {
    const detail = dependencyAdditions
      .map(
        (addition) =>
          `${addition.action} ${relativeTo(project.root, addition.file)} ${addition.name}${addition.from ? ` ${addition.from} →` : ""} ${addition.version}`,
      )
      .join("; ");
    if (dryRun) {
      result.steps.push({
        id: "feature-dependencies",
        status: "planned",
        detail: `Would align ${detail}. ${deploymentEnvironmentNote}`,
      });
    } else {
      applyMigrationDependencyAdditions(dependencyAdditions);
      result.steps.push({
        id: "feature-dependencies",
        status: "ok",
        detail: `Aligned ${detail}. ${deploymentEnvironmentNote}`,
      });
    }
  }

  if (doctor.bumps.length === 0) {
    result.steps.push({
      id: "bump",
      status: "skipped",
      detail: "All @agent-native/* deps already use latest or local pins",
    });
  } else if (dryRun) {
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
      const read = readJsonFile(file);
      if (!read.ok) continue;
      applyBumps(read.value, bumps);
      writeJsonFile(file, read.value);
    }
    result.steps.push({
      id: "bump",
      status: "ok",
      detail: `Updated ${doctor.bumps.length} @agent-native/* dependency pin(s)`,
    });
  }

  let codemodPlan:
    | {
        module: typeof import("./migration-codemod.js");
        dependencyChanges: MigrationCodemodResult["changes"];
      }
    | undefined;

  if (opts.codemods) {
    // Keep this specifier computed so client builds do not package the Node-only codemod.
    const codemodModulePath = new URL(
      [
        "./migration-codemod",
        import.meta.url.endsWith(".ts") ? "ts" : "js",
      ].join("."),
      import.meta.url,
    ).href;
    const codemodModule = await loadOptionalPeer<
      typeof import("./migration-codemod.js")
    >("ts-morph", () => import(/* @vite-ignore */ codemodModulePath));
    const codemodResult = codemodModule.runMigrationCodemods({
      root: project.root,
      targetExists: codemodModule.createMigrationPlanningTargetResolver(
        project.root,
      ),
    });
    const diff = codemodModule.formatMigrationCodemodDiff(
      codemodResult,
      project.root,
    );
    const dependencyChanges = dryRun
      ? []
      : applyCodemodDependencyPlan(codemodResult);
    codemodPlan = {
      module: codemodModule,
      dependencyChanges,
    };

    if (dryRun) {
      result.codemod = {
        files: codemodResult.changes.map((change) =>
          relativeTo(project.root, change.file),
        ),
        warnings: codemodResult.warnings,
        diff,
      };
    }
    if (dryRun) {
      result.steps.push({
        id: "codemods",
        status: codemodResult.changes.length === 0 ? "skipped" : "planned",
        detail:
          codemodResult.changes.length === 0
            ? "No manifest migrations found"
            : `Would update ${codemodResult.changes.length} file(s)`,
      });
    }
    if (dryRun && !opts.json && diff) {
      io.log(diff);
      io.log("");
    }
    if (dryRun && !opts.json) {
      for (const warning of codemodResult.warnings) {
        io.err(`[codemods] ${warning}`);
      }
    }
  }

  if (opts.skipInstall) {
    result.steps.push({
      id: "install",
      status: "skipped",
      detail: "--skip-install",
    });
  } else if (dryRun) {
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
      if (codemodPlan && codemodPlan.dependencyChanges.length > 0) {
        const dependencyResult: MigrationCodemodResult = {
          changes: codemodPlan.dependencyChanges,
          dependencyFiles: codemodPlan.dependencyChanges.map(
            (change) => change.file,
          ),
          warnings: [],
        };
        const diff = codemodPlan.module.formatMigrationCodemodDiff(
          dependencyResult,
          project.root,
        );
        result.codemod = {
          files: dependencyResult.changes.map((change) =>
            relativeTo(project.root, change.file),
          ),
          warnings: [],
          diff,
        };
        if (!opts.json && diff) {
          io.log(diff);
          io.log("");
        }
      }
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

  if (opts.skipInstall) {
    result.steps.push({
      id: "pin",
      status: "skipped",
      detail: "--skip-install leaves specs unresolved",
    });
  } else if (dryRun) {
    result.steps.push({
      id: "pin",
      status: "planned",
      detail: "pin @agent-native/* to the installed versions",
    });
  } else {
    const { pins, unresolved, unreadable } =
      pinResolvedAgentNativeVersions(project);
    if (unresolved.length > 0 || unreadable.length > 0) {
      result.ok = false;
      result.exitCode = 1;
      result.message = [
        unresolved.length > 0
          ? `Install succeeded but no installed version could be read for: ${unresolved.join(", ")}.`
          : "",
        unreadable.length > 0
          ? `These package.json files could not be parsed, so their specs were left untouched: ${unreadable.join("; ")}.`
          : "",
        'Those specs are still "latest", so the next install will resolve them again — pin them by hand or re-run upgrade.',
      ]
        .filter(Boolean)
        .join(" ");
      result.steps.push({
        id: "pin",
        status: "failed",
        detail: result.message,
      });
      emitResult(io, opts, result);
      return result.exitCode;
    }
    const pinned = [...new Set(pins.map((p) => `${p.name}@${p.version}`))];
    result.steps.push({
      id: "pin",
      status: pinned.length === 0 ? "skipped" : "ok",
      detail:
        pinned.length === 0
          ? "No floating @agent-native/* specs"
          : pinned.join(", "),
    });
  }

  if (codemodPlan && !dryRun) {
    const applied = codemodPlan.module.runMigrationCodemods({
      root: project.root,
      apply: true,
    });
    const actualResult: MigrationCodemodResult = {
      changes: [...codemodPlan.dependencyChanges, ...applied.changes],
      dependencyFiles: codemodPlan.dependencyChanges.map(
        (change) => change.file,
      ),
      warnings: applied.warnings,
    };
    const diff = codemodPlan.module.formatMigrationCodemodDiff(
      actualResult,
      project.root,
    );
    const files = [
      ...new Set(actualResult.changes.map((change) => change.file)),
    ];
    result.codemod = {
      files: files.map((file) => relativeTo(project.root, file)),
      warnings: actualResult.warnings,
      diff,
    };
    result.steps.push({
      id: "codemods",
      status: files.length === 0 ? "skipped" : "ok",
      detail:
        files.length === 0
          ? "No resolvable manifest migrations found"
          : opts.skipInstall
            ? `Updated ${files.length} file(s) without installing dependencies`
            : `Updated ${files.length} file(s) after dependency installation`,
    });
    if (!opts.json && diff) {
      io.log(diff);
      io.log("");
    }
    if (!opts.json) {
      for (const warning of actualResult.warnings) {
        io.err(`[codemods] ${warning}`);
      }
    }
  }

  if (opts.skipSkills) {
    result.steps.push({
      id: "skills",
      status: "skipped",
      detail: "--skip-skills",
    });
  } else if (dryRun) {
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

  if (opts.skipVerify) {
    result.steps.push({
      id: "verify",
      status: "skipped",
      detail: "--skip-verify",
    });
  } else if (dryRun) {
    result.steps.push({
      id: "verify",
      status: "planned",
      detail: "typecheck (when available)",
    });
  } else {
    const rootPkg = readJsonFile(path.join(project.root, "package.json"));
    const hasTypecheck =
      rootPkg.ok && Boolean(rootPkg.value.scripts?.typecheck);
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

  result.message = dryRun
    ? opts.codemods
      ? "Codemod preview complete. Re-run without --dry-run to apply."
      : "Dry run complete. Re-run without --dry-run to apply."
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
