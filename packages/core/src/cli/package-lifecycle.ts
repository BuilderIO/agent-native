import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertAgentNativePackageManifest,
  type AgentNativePackageManifest,
} from "../package-lifecycle/manifest.js";

export interface PackageLifecycleIO {
  out(message: string): void;
  err(message: string): void;
}

export interface LoadedLifecyclePackage {
  manifest: AgentNativePackageManifest;
  packageVersion: string;
  packageDir: string;
  packageJson: Record<string, unknown>;
  cleanup?: () => void;
}

export interface PackageLifecycleRuntime {
  cwd?: string;
  io?: PackageLifecycleIO;
  loadPackage?: (name: string, cwd: string) => Promise<LoadedLifecyclePackage>;
  spawn?: typeof spawnSync;
}

interface Change {
  path: string;
  action: "create" | "update" | "noop";
  kind:
    | "dependency"
    | "action"
    | "schema"
    | "skill"
    | "provenance"
    | "eject"
    | "workspace";
  content?: string | Buffer;
}

export interface PackageLifecycleReport {
  command: "inspect" | "add" | "eject";
  package: string;
  packageVersion: string;
  manifestVersion: number;
  targetRoot: string;
  layout: "standalone" | "workspace-app" | "workspace-root";
  apply: boolean;
  compatible: boolean;
  contributions: {
    actions: string[];
    schemaEntryPoint: string;
    skills: string[];
    requiredSecretKeys: string[];
    peerProviders: string[];
  };
  changes: Array<Omit<Change, "content">>;
  collisions: string[];
  warnings: string[];
}

const defaultIO: PackageLifecycleIO = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

export async function runPackageLifecycle(
  args: string[],
  runtime: PackageLifecycleRuntime = {},
): Promise<number> {
  const io = runtime.io ?? defaultIO;
  const command = args[0];
  const packageName = args[1];
  if (!isCommand(command) || !packageName) {
    io.err(packageLifecycleUsage());
    return 1;
  }
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  if (apply && command === "inspect") {
    io.err("package inspect is always read-only; remove --apply");
    return 1;
  }
  const cwd = path.resolve(
    flagValue(args, "--root") ?? runtime.cwd ?? process.cwd(),
  );
  let loaded: LoadedLifecyclePackage | undefined;
  try {
    loaded = await (runtime.loadPackage
      ? runtime.loadPackage(packageName, cwd)
      : loadLifecyclePackage(packageName, cwd, runtime.spawn ?? spawnSync));
    if (loaded.manifest.name !== packageName) {
      throw new Error(
        `Manifest name ${loaded.manifest.name} does not match requested package ${packageName}`,
      );
    }
    const target = resolveTarget(cwd, flagValue(args, "--app"));
    const planned =
      command === "eject"
        ? planEject(loaded, target.root, target.layout)
        : planAdd(loaded, target.root, target.layout, command === "inspect");
    const report = reportFor(command, loaded, target, apply, planned);
    if (report.collisions.length > 0) {
      report.compatible = false;
    }
    if (json) io.out(JSON.stringify(report, null, 2));
    else io.out(formatReport(report));
    if (!report.compatible) return 1;
    if (command === "inspect" || !apply) return 0;

    await applyTransaction(
      target.root,
      planned.changes.filter((change) => change.action !== "noop"),
      runtime.spawn ?? spawnSync,
    );
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    loaded?.cleanup?.();
  }
}

function isCommand(
  value: string | undefined,
): value is "inspect" | "add" | "eject" {
  return value === "inspect" || value === "add" || value === "eject";
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function packageLifecycleUsage(): string {
  return [
    "Usage:",
    "  agent-native package inspect <package> [--root <dir>] [--app <name>] [--json]",
    "  agent-native package add <package> [--root <dir>] [--app <name>] [--apply] [--json]",
    "  agent-native package eject <package> [--root <dir>] [--app <name>] [--apply] [--json]",
    "",
    "add and eject are dry-run by default; pass --apply to write and run the package manager.",
  ].join("\n");
}

export async function loadLifecyclePackage(
  name: string,
  cwd: string,
  spawn: typeof spawnSync = spawnSync,
): Promise<LoadedLifecyclePackage> {
  const packageJsonPath = findInstalledPackageJson(name, cwd);
  if (packageJsonPath) {
    return loadStaticPackageDirectory(name, path.dirname(packageJsonPath));
  }
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid package name: ${name}`);
  }
  const stage = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-package-inspect-"),
  );
  try {
    const packed = spawn(
      "npm",
      ["pack", name, "--ignore-scripts", "--json", "--pack-destination", stage],
      { cwd, encoding: "utf8", stdio: "pipe" },
    );
    if (packed.status !== 0) {
      throw new Error(`Unable to download package metadata for '${name}'`);
    }
    const entries = JSON.parse(String(packed.stdout || "[]")) as Array<{
      filename?: string;
    }>;
    const filename = entries[0]?.filename;
    if (!filename || path.basename(filename) !== filename) {
      throw new Error(
        `npm pack returned an invalid archive name for '${name}'`,
      );
    }
    const archive = path.join(stage, filename);
    const listed = spawn("tar", ["-tzf", archive], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    if (listed.status !== 0) {
      throw new Error(`Unable to list package archive for '${name}'`);
    }
    const archiveEntries = String(listed.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean);
    if (
      archiveEntries.length === 0 ||
      archiveEntries.some(
        (entry) =>
          entry.includes("\\") ||
          entry.startsWith("/") ||
          !entry.startsWith("package/") ||
          entry.split("/").includes(".."),
      )
    ) {
      throw new Error(`Package archive for '${name}' contains an unsafe path`);
    }
    const extracted = spawn(
      "tar",
      [
        "-xzf",
        archive,
        "-C",
        stage,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (extracted.status !== 0) {
      throw new Error(`Unable to inspect package archive for '${name}'`);
    }
    const loaded = loadStaticPackageDirectory(
      name,
      path.join(stage, "package"),
    );
    loaded.cleanup = () => fs.rmSync(stage, { recursive: true, force: true });
    return loaded;
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function loadStaticPackageDirectory(
  name: string,
  packageDir: string,
): LoadedLifecyclePackage {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
    agentNativeManifest?: string;
    [key: string]: unknown;
  };
  if (packageJson.name !== name) {
    throw new Error(
      `Installed package name ${String(packageJson.name)} does not match ${name}`,
    );
  }
  if (!packageJson.version) {
    throw new Error(`Package '${name}' has no version`);
  }
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      packageJson.version,
    )
  ) {
    throw new Error(`Package '${name}' has an invalid version`);
  }
  const relativeManifest = packageJson.agentNativeManifest;
  if (!relativeManifest || path.isAbsolute(relativeManifest)) {
    throw new Error(
      `Package '${name}' does not declare a static agentNativeManifest`,
    );
  }
  const manifestPath = path.resolve(packageDir, relativeManifest);
  if (
    manifestPath !== packageDir &&
    !manifestPath.startsWith(`${path.resolve(packageDir)}${path.sep}`)
  ) {
    throw new Error(`Package '${name}' manifest escapes the package directory`);
  }
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`Package '${name}' static manifest must be a regular file`);
  }
  const realPackageDir = fs.realpathSync(packageDir);
  const realManifestPath = fs.realpathSync(manifestPath);
  if (!realManifestPath.startsWith(`${realPackageDir}${path.sep}`)) {
    throw new Error(
      `Package '${name}' static manifest escapes the package directory`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assertAgentNativePackageManifest(manifest);
  if (manifest.name !== name) {
    throw new Error(`Manifest name ${manifest.name} does not match ${name}`);
  }
  return {
    manifest,
    packageVersion: packageJson.version,
    packageDir,
    packageJson,
  };
}

function findInstalledPackageJson(name: string, from: string): string | null {
  let dir = from;
  while (true) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveTarget(
  root: string,
  appName?: string,
): { root: string; layout: PackageLifecycleReport["layout"] } {
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Target root has no package.json: ${root}`);
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const workspace =
    typeof pkg?.["agent-native"]?.workspaceCore === "string" &&
    fs.existsSync(path.join(root, "apps"));
  if (!workspace) return { root, layout: "standalone" };
  if (!appName) {
    return { root, layout: "workspace-root" };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appName)) {
    throw new Error(`Invalid workspace app name: ${appName}`);
  }
  const appRoot = path.join(root, "apps", appName);
  if (!fs.existsSync(path.join(appRoot, "package.json"))) {
    throw new Error(`Workspace app not found: ${appRoot}`);
  }
  return { root: appRoot, layout: "workspace-app" };
}

function planAdd(
  loaded: LoadedLifecyclePackage,
  targetRoot: string,
  layout: PackageLifecycleReport["layout"],
  inspectOnly: boolean,
): { changes: Change[]; collisions: string[]; warnings: string[] } {
  const { manifest, packageDir } = loaded;
  const collisions: string[] = [];
  const warnings: string[] = [];
  if (layout === "workspace-root") {
    collisions.push("Workspace root is ambiguous; pass --app <name> for add");
    return { changes: [], collisions, warnings };
  }
  const packageJsonPath = path.join(targetRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  pkg.dependencies ??= {};
  const wantedRange = `^${loaded.packageVersion}`;
  const currentRange = pkg.dependencies[manifest.name];
  if (currentRange !== wantedRange && currentRange !== "workspace:*") {
    pkg.dependencies[manifest.name] = wantedRange;
  }
  const changes: Change[] = [
    textChange(
      targetRoot,
      packageJsonPath,
      `${JSON.stringify(pkg, null, 2)}\n`,
      "dependency",
    ),
  ];
  for (const action of manifest.actions) {
    const target = path.join(targetRoot, "actions", `${action}.ts`);
    const content = `export { default } from "${manifest.name}/actions/${action}";\n`;
    changes.push(
      collisionCheckedText(targetRoot, target, content, "action", collisions),
    );
  }

  const schemaPath = path.join(targetRoot, "server", "db", "schema.ts");
  if (!fs.existsSync(schemaPath)) {
    collisions.push(
      `Required schema file is missing: ${relative(targetRoot, schemaPath)}`,
    );
  } else {
    const current = fs.readFileSync(schemaPath, "utf8");
    const marker = `// agent-native-package:${manifest.name}`;
    const contribution = `${marker}\nexport * from "${manifest.schemaEntryPoint}";`;
    if (current.includes(marker) && !current.includes(contribution)) {
      collisions.push(
        "Existing package-owned schema block has unexpected content",
      );
    }
    const next = current.includes(contribution)
      ? current
      : `${current.trimEnd()}\n\n${contribution}\n`;
    changes.push(textChange(targetRoot, schemaPath, next, "schema"));
  }

  const ownedPaths: string[] = [];
  for (const skill of manifest.docs.skills) {
    const source = path.join(packageDir, "docs", "skills", skill);
    if (!fs.existsSync(source)) {
      collisions.push(`Manifest skill source is missing: docs/skills/${skill}`);
      continue;
    }
    for (const sourceFile of walkFiles(source)) {
      const target = path.join(
        targetRoot,
        ".agents",
        "skills",
        skill,
        path.relative(source, sourceFile),
      );
      changes.push(
        collisionCheckedBuffer(
          targetRoot,
          target,
          fs.readFileSync(sourceFile),
          "skill",
          collisions,
        ),
      );
      ownedPaths.push(relative(targetRoot, target));
    }
  }
  const provenancePath = path.join(
    targetRoot,
    ".agent-native",
    "packages",
    `${manifest.name.replaceAll("/", "__")}.json`,
  );
  const provenance = {
    manifestVersion: manifest.manifestVersion,
    package: manifest.name,
    version: loaded.packageVersion,
    actions: manifest.actions,
    schemaEntryPoint: manifest.schemaEntryPoint,
    skills: manifest.docs.skills,
    files: ownedPaths.sort(),
  };
  changes.push(
    textChange(
      targetRoot,
      provenancePath,
      `${JSON.stringify(provenance, null, 2)}\n`,
      "provenance",
    ),
  );
  if (inspectOnly)
    warnings.push("inspect is read-only; shown changes are the add plan");
  return { changes, collisions, warnings };
}

function planEject(
  loaded: LoadedLifecyclePackage,
  targetRoot: string,
  layout: PackageLifecycleReport["layout"],
): { changes: Change[]; collisions: string[]; warnings: string[] } {
  const collisions: string[] = [];
  const warnings: string[] = [];
  if (loaded.manifest.name !== "@agent-native/scheduling") {
    collisions.push("Eject currently supports only @agent-native/scheduling");
    return { changes: [], collisions, warnings };
  }
  if (!loaded.manifest.eject) {
    collisions.push("Package manifest does not declare eject metadata");
    return { changes: [], collisions, warnings };
  }
  const workspaceRoot =
    layout === "workspace-app" ? path.resolve(targetRoot, "../..") : targetRoot;
  const pnpmWorkspace = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (!fs.existsSync(pnpmWorkspace)) {
    collisions.push(
      "Eject currently requires an existing pnpm workspace; refusing to create a workspace:* dependency for another package manager",
    );
    return { changes: [], collisions, warnings };
  }
  const targetDir = path.join(
    workspaceRoot,
    loaded.manifest.eject.targetDirectory,
  );
  if (fs.existsSync(targetDir)) {
    collisions.push(
      `Eject target already exists: ${relative(workspaceRoot, targetDir)}`,
    );
    return { changes: [], collisions, warnings };
  }
  const sourceRoot = path.join(
    loaded.packageDir,
    loaded.manifest.eject.sourceRoot,
  );
  if (!fs.existsSync(sourceRoot)) {
    collisions.push(
      `Published eject source is missing: ${loaded.manifest.eject.sourceRoot}`,
    );
    return { changes: [], collisions, warnings };
  }
  const changes: Change[] = [];
  for (const source of walkFiles(sourceRoot)) {
    const target = path.join(
      targetDir,
      "src",
      path.relative(sourceRoot, source),
    );
    changes.push({
      path: target,
      action: "create",
      kind: "eject",
      content: fs.readFileSync(source),
    });
  }
  for (const name of ["tsconfig.json", "agent-native.package.json"]) {
    const source = path.join(loaded.packageDir, name);
    if (fs.existsSync(source)) {
      changes.push({
        path: path.join(targetDir, name),
        action: "create",
        kind: "eject",
        content: fs.readFileSync(source),
      });
    }
  }
  changes.push({
    path: path.join(targetDir, "package.json"),
    action: "create",
    kind: "eject",
    content: `${JSON.stringify(
      normalizeEjectedPackageJson(loaded.packageJson, workspaceRoot),
      null,
      2,
    )}\n`,
  });
  const consumerPackageJson = path.join(targetRoot, "package.json");
  const consumer = JSON.parse(fs.readFileSync(consumerPackageJson, "utf8"));
  consumer.dependencies ??= {};
  consumer.dependencies[loaded.manifest.name] = "workspace:*";
  changes.push(
    textChange(
      workspaceRoot,
      consumerPackageJson,
      `${JSON.stringify(consumer, null, 2)}\n`,
      "dependency",
    ),
  );
  if (fs.existsSync(pnpmWorkspace)) {
    const text = fs.readFileSync(pnpmWorkspace, "utf8");
    if (!text.includes("packages/*") && !text.includes("packages/**")) {
      collisions.push(
        "pnpm-workspace.yaml does not include packages/*; refusing to rewrite YAML",
      );
    }
  } else {
    changes.push({
      path: pnpmWorkspace,
      action: "create",
      kind: "workspace",
      content: 'packages:\n  - "packages/*"\n',
    });
  }
  warnings.push(
    "Imports keep the canonical @agent-native/scheduling specifier; workspace resolution switches them to the local package.",
  );
  return { changes, collisions, warnings };
}

function normalizeEjectedPackageJson(
  input: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  const output = structuredClone(input) as Record<string, any>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = output[field] as Record<string, unknown> | undefined;
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (
        typeof range !== "string" ||
        (!range.startsWith("workspace:") && !range.startsWith("catalog:"))
      ) {
        continue;
      }
      const installed = findInstalledPackageJson(name, workspaceRoot);
      if (!installed) {
        throw new Error(
          `Cannot normalize ${field}.${name}; the installed dependency version is unavailable`,
        );
      }
      const version = JSON.parse(fs.readFileSync(installed, "utf8")).version;
      if (!version)
        throw new Error(`Installed dependency ${name} has no version`);
      dependencies[name] = `^${version}`;
    }
  }
  return output;
}

function collisionCheckedText(
  root: string,
  target: string,
  content: string,
  kind: Change["kind"],
  collisions: string[],
): Change {
  return collisionCheckedBuffer(
    root,
    target,
    Buffer.from(content),
    kind,
    collisions,
  );
}

function collisionCheckedBuffer(
  root: string,
  target: string,
  content: Buffer,
  kind: Change["kind"],
  collisions: string[],
): Change {
  if (!fs.existsSync(target)) {
    return { path: target, action: "create", kind, content };
  }
  const current = fs.readFileSync(target);
  if (current.equals(content)) return { path: target, action: "noop", kind };
  collisions.push(`Refusing to overwrite ${relative(root, target)}`);
  return { path: target, action: "noop", kind };
}

function textChange(
  root: string,
  target: string,
  content: string,
  kind: Change["kind"],
): Change {
  if (!fs.existsSync(target))
    return { path: target, action: "create", kind, content };
  return {
    path: target,
    action: fs.readFileSync(target, "utf8") === content ? "noop" : "update",
    kind,
    content,
  };
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing package symlink: ${full}`);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort();
}

function reportFor(
  command: PackageLifecycleReport["command"],
  loaded: LoadedLifecyclePackage,
  target: { root: string; layout: PackageLifecycleReport["layout"] },
  apply: boolean,
  planned: { changes: Change[]; collisions: string[]; warnings: string[] },
): PackageLifecycleReport {
  const { manifest } = loaded;
  return {
    command,
    package: manifest.name,
    packageVersion: loaded.packageVersion,
    manifestVersion: manifest.manifestVersion,
    targetRoot: target.root,
    layout: target.layout,
    apply,
    compatible: planned.collisions.length === 0,
    contributions: {
      actions: manifest.actions,
      schemaEntryPoint: manifest.schemaEntryPoint,
      skills: manifest.docs.skills,
      requiredSecretKeys: manifest.requiredSecrets.map((secret) => secret.key),
      peerProviders: manifest.peerProviders,
    },
    changes: planned.changes.map(({ path: file, action, kind }) => ({
      path: relative(target.root, file),
      action,
      kind,
    })),
    collisions: planned.collisions,
    warnings: planned.warnings,
  };
}

function formatReport(report: PackageLifecycleReport): string {
  const lines = [
    `# ${report.command} ${report.package}@${report.packageVersion}`,
    `Manifest: v${report.manifestVersion}`,
    `Target: ${report.targetRoot} (${report.layout})`,
    `Mode: ${report.apply ? "apply" : "dry-run"}`,
    `Compatible: ${report.compatible ? "yes" : "no"}`,
    "",
    `Actions: ${report.contributions.actions.length}`,
    `Schema: ${report.contributions.schemaEntryPoint}`,
    `Skills: ${report.contributions.skills.join(", ") || "none"}`,
    `Required secret keys: ${report.contributions.requiredSecretKeys.join(", ") || "none"}`,
    `Peer providers: ${report.contributions.peerProviders.join(", ") || "none"}`,
    "",
    "Changes:",
    ...report.changes.map(
      (change) =>
        `  ${change.action.padEnd(6)} ${change.path} (${change.kind})`,
    ),
  ];
  if (report.collisions.length) {
    lines.push(
      "",
      "Collisions:",
      ...report.collisions.map((item) => `  - ${item}`),
    );
  }
  if (report.warnings.length) {
    lines.push("", "Notes:", ...report.warnings.map((item) => `  - ${item}`));
  }
  if (!report.apply && report.command !== "inspect") {
    lines.push("", "Dry-run only. Re-run with --apply to write these changes.");
  }
  return lines.join("\n");
}

async function applyTransaction(
  root: string,
  changes: Change[],
  spawn: typeof spawnSync,
): Promise<void> {
  const stage = fs.mkdtempSync(path.join(root, ".agent-native-package-stage-"));
  const snapshots = new Map<string, Buffer | null>();
  const installRoot = findPackageManagerRoot(root);
  const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"].map(
    (name) => path.join(installRoot, name),
  );
  try {
    for (const change of changes) {
      snapshots.set(
        change.path,
        fs.existsSync(change.path) ? fs.readFileSync(change.path) : null,
      );
      const staged = path.join(stage, String(snapshots.size));
      fs.writeFileSync(staged, change.content!);
    }
    for (const lockfile of lockfiles) {
      snapshots.set(
        lockfile,
        fs.existsSync(lockfile) ? fs.readFileSync(lockfile) : null,
      );
    }
    let index = 0;
    for (const change of changes) {
      index += 1;
      fs.mkdirSync(path.dirname(change.path), { recursive: true });
      fs.renameSync(path.join(stage, String(index)), change.path);
    }
    const packageManager = detectPackageManager(installRoot);
    const result = spawn(packageManager, ["install"], {
      cwd: installRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(
        `${packageManager} install failed with status ${result.status}`,
      );
    }
  } catch (error) {
    for (const [file, snapshot] of [...snapshots.entries()].reverse()) {
      if (snapshot === null) fs.rmSync(file, { force: true, recursive: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, snapshot);
      }
    }
    for (const change of [...changes].reverse()) {
      removeEmptyParents(path.dirname(change.path), root);
    }
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function removeEmptyParents(directory: string, stop: string): void {
  let current = directory;
  const boundary = path.resolve(stop);
  while (current.startsWith(`${boundary}${path.sep}`)) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function detectPackageManager(root: string): "pnpm" | "yarn" | "npm" {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function findPackageManagerRoot(from: string): string {
  let dir = from;
  while (true) {
    if (
      fs.existsSync(path.join(dir, "pnpm-lock.yaml")) ||
      fs.existsSync(path.join(dir, "yarn.lock")) ||
      fs.existsSync(path.join(dir, "package-lock.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

function relative(root: string, file: string): string {
  const value = path.relative(root, file);
  return value || ".";
}
