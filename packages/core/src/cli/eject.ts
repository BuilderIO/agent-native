import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertAgentNativeEjectManifest,
  type AgentNativeEjectManifest,
  type AgentNativeEjectUnit,
} from "../package-lifecycle/eject-manifest.js";

export interface EjectIO {
  out(message: string): void;
  err(message: string): void;
}

export interface LoadedEjectManifest {
  manifest: AgentNativeEjectManifest;
  manifestDigest: string;
  packageDir: string;
  packageVersion: string;
}

export interface EjectRuntime {
  cwd?: string;
  io?: EjectIO;
  loadManifests?: (root: string) => Promise<LoadedEjectManifest[]>;
  spawn?: typeof spawnSync;
}

interface TargetRecord {
  path: string;
  hash: string;
  source: string;
  root?: "workspace";
}

interface RewriteRecord {
  path: string;
  beforeHash: string;
  afterHash: string;
  replacements: Array<{ from: string; to: string }>;
}

interface EjectionRecord {
  unit: string;
  source: {
    package: string;
    version: string;
    manifestDigest: string;
  };
  targets: TargetRecord[];
  importRewrites: RewriteRecord[];
  dependencyRewrite?: DependencyRewriteRecord;
}

interface DependencyRewriteRecord {
  path: string;
  beforeHash: string;
  afterHash: string;
  changes: Array<{ name: string; before: string | null; after: string }>;
}

interface EjectionProvenance {
  manifestVersion: 1;
  ejections: Record<string, EjectionRecord>;
}

interface FileMutation {
  path: string;
  action: "create" | "update" | "delete" | "noop";
  content?: Buffer;
}

interface EjectPlan {
  record: EjectionRecord;
  mutations: FileMutation[];
  collisions: string[];
}

const PROVENANCE_FILE = "agent-native.ejections.json";
const REMINDER =
  "Customization ladder: configure -> compose -> eject -> propose a shared seam. Prefer props and slots before taking source ownership.";
const SOURCE_FILE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const defaultIO: EjectIO = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

export async function runEject(
  args: string[],
  runtime: EjectRuntime = {},
): Promise<number> {
  const io = runtime.io ?? defaultIO;
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  const command = parseCommand(args);
  if (!command) {
    io.err(ejectUsage());
    return 1;
  }
  if (apply && ["list", "inspect", "diff"].includes(command.kind)) {
    io.err(`${command.kind} is read-only; remove --apply`);
    return 1;
  }

  try {
    const root = path.resolve(
      flagValue(args, "--root") ?? runtime.cwd ?? process.cwd(),
    );
    const targetRoot = resolveTarget(root, flagValue(args, "--app"));
    const manifests = await (runtime.loadManifests
      ? runtime.loadManifests(targetRoot)
      : loadInstalledEjectManifests(targetRoot));

    if (command.kind === "list") {
      const units = manifests
        .flatMap((loaded) =>
          loaded.manifest.units.map((unit) => ({
            id: unit.id,
            label: unit.label,
            catalog: unit.catalog,
            strategy: unit.strategy,
            package: loaded.manifest.package,
          })),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      io.out(
        json
          ? JSON.stringify({ units }, null, 2)
          : [
              "# Ejectable units",
              "",
              ...units.map(
                (unit) =>
                  `${unit.id.padEnd(36)} ${unit.strategy.padEnd(14)} ${unit.package}`,
              ),
            ].join("\n"),
      );
      return 0;
    }

    const provenance = readProvenance(targetRoot);
    const existingRecord = provenance.ejections[command.unit];
    const match = findUnit(manifests, command.unit);

    if (command.kind === "diff" && existingRecord) {
      const result = diffRecord(targetRoot, existingRecord, match?.loaded);
      io.out(json ? JSON.stringify(result, null, 2) : formatDiff(result));
      return result.clean ? 0 : 1;
    }

    if (command.kind === "restore" && existingRecord) {
      const drift = diffRecord(targetRoot, existingRecord, match?.loaded);
      if (!drift.restorable) {
        io.err(
          "Restore refused because local source or rewritten imports changed. Review this diff and preserve your edits before restoring.",
        );
        io.out(json ? JSON.stringify(drift, null, 2) : formatDiff(drift));
        return 1;
      }
      const mutations = planRestore(targetRoot, provenance, existingRecord);
      const report = mutationReport(
        "restore",
        command.unit,
        targetRoot,
        apply,
        mutations,
      );
      io.out(
        json ? JSON.stringify(report, null, 2) : formatMutationReport(report),
      );
      if (apply) {
        applyMutations(
          workspaceRootFor(targetRoot),
          mutations,
          runtime.spawn ?? spawnSync,
        );
      }
      return 0;
    }

    if (!match) {
      const firstParty = isFirstPartyUnit(command.unit);
      const result = firstParty
        ? {
            error:
              "This first-party unit is missing from the published coverage matrix. Treat this as a release defect; the first-party manifest guard must fail until coverage is restored.",
          }
        : {
            error:
              "No static eject definition was found for this third-party unit.",
            blueprint: blueprintFor(command.unit),
          };
      if (json) io.out(JSON.stringify(result, null, 2));
      else {
        io.err(result.error);
        if ("blueprint" in result) {
          io.out(
            [
              'Add this static blueprint to the owning package and reference it from package.json with "agentNativeEjectManifest": "agent-native.eject.json":',
              "",
              JSON.stringify(result.blueprint, null, 2),
            ].join("\n"),
          );
        }
      }
      return 1;
    }

    if (command.kind === "inspect") {
      const closure =
        match.unit.strategy === "protected-seam"
          ? []
          : collectSourceClosure(match.loaded.packageDir, match.unit);
      const result = {
        unit: match.unit,
        package: match.loaded.manifest.package,
        packageVersion: match.loaded.packageVersion,
        manifestDigest: match.loaded.manifestDigest,
        files: closure.map((file) => relative(match.loaded.packageDir, file)),
      };
      io.out(json ? JSON.stringify(result, null, 2) : formatInspect(result));
      return 0;
    }

    if (match.unit.strategy === "protected-seam") {
      const result = {
        unit: match.unit.id,
        protected: true,
        seam: match.unit.seam,
        message:
          "This runtime contract stays package-owned. Customize through the declared seam instead of copying protected source.",
      };
      io.out(json ? JSON.stringify(result, null, 2) : formatProtected(result));
      return 0;
    }

    if (command.kind === "diff") {
      const result = diffRecord(targetRoot, undefined, match.loaded);
      io.out(json ? JSON.stringify(result, null, 2) : formatDiff(result));
      return result.ejected && result.clean ? 0 : 1;
    }

    if (command.kind === "restore") {
      io.err(`Unit ${match.unit.id} has not been ejected in this app.`);
      return 1;
    }

    if (provenance.ejections[match.unit.id]) {
      const diff = diffRecord(
        targetRoot,
        provenance.ejections[match.unit.id],
        match.loaded,
      );
      io.out(json ? JSON.stringify(diff, null, 2) : formatDiff(diff));
      return diff.clean ? 0 : 1;
    }
    const plan = planEject(targetRoot, match.loaded, match.unit, provenance);
    const report = {
      ...mutationReport(
        "eject",
        match.unit.id,
        targetRoot,
        apply,
        plan.mutations,
      ),
      collisions: plan.collisions,
      verification: match.unit.verification ?? [],
      seam: match.unit.seam,
      protectedImports: match.unit.protectedImports ?? [],
      reminder: REMINDER,
    };
    io.out(json ? JSON.stringify(report, null, 2) : formatEjectReport(report));
    if (plan.collisions.length > 0) return 1;
    if (apply) {
      applyMutations(
        workspaceRootFor(targetRoot),
        plan.mutations,
        runtime.spawn ?? spawnSync,
      );
    }
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseCommand(
  args: string[],
):
  | { kind: "list" }
  | { kind: "inspect" | "diff" | "restore" | "eject"; unit: string }
  | null {
  if (args.includes("--list")) return { kind: "list" };
  const positional = args.filter((value, index) => {
    if (value.startsWith("--")) return false;
    return index === 0 || !["--root", "--app"].includes(args[index - 1] ?? "");
  });
  if (["inspect", "diff", "restore"].includes(positional[0] ?? "")) {
    return positional[1]
      ? {
          kind: positional[0] as "inspect" | "diff" | "restore",
          unit: positional[1],
        }
      : null;
  }
  return positional[0] ? { kind: "eject", unit: positional[0] } : null;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveTarget(root: string, appName?: string): string {
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Target root has no package.json: ${root}`);
  }
  const pkg = readJson(packageJsonPath);
  const workspace =
    typeof (pkg["agent-native"] as Record<string, unknown> | undefined)
      ?.workspaceCore === "string" && fs.existsSync(path.join(root, "apps"));
  if (!workspace) return root;
  if (!appName) {
    throw new Error("Workspace root is ambiguous; pass --app <name>");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appName)) {
    throw new Error(`Invalid workspace app name: ${appName}`);
  }
  const appRoot = path.join(root, "apps", appName);
  if (!fs.existsSync(path.join(appRoot, "package.json"))) {
    throw new Error(`Workspace app not found: ${appRoot}`);
  }
  return appRoot;
}

function workspaceRootFor(appRoot: string): string {
  let directory = appRoot;
  while (true) {
    const packageJsonPath = path.join(directory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = readJson(packageJsonPath);
      if (
        typeof (
          packageJson["agent-native"] as Record<string, unknown> | undefined
        )?.workspaceCore === "string" &&
        fs.existsSync(path.join(directory, "apps"))
      ) {
        return directory;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return appRoot;
    directory = parent;
  }
}

function resolveRecordedPath(root: string, target: TargetRecord): string {
  return resolveInside(
    target.root === "workspace" ? workspaceRootFor(root) : root,
    target.path,
  );
}

export function loadInstalledEjectManifests(
  root: string,
): LoadedEjectManifest[] {
  const packageJson = readJson(path.join(root, "package.json"));
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = packageJson[field] as
      | Record<string, unknown>
      | undefined;
    for (const name of Object.keys(dependencies ?? {})) names.add(name);
  }
  const ownName = packageJson.name;
  if (typeof ownName === "string") names.add(ownName);

  const manifests: LoadedEjectManifest[] = [];
  for (const name of [...names].sort()) {
    const packageDir = findInstalledPackageDirectory(name, root, packageJson);
    if (!packageDir) continue;
    const loaded = loadStaticEjectManifest(packageDir);
    if (loaded) manifests.push(loaded);
  }
  return manifests;
}

function findInstalledPackageDirectory(
  name: string,
  from: string,
  ownPackageJson: Record<string, unknown>,
): string | null {
  if (ownPackageJson.name === name && ownPackageJson.agentNativeEjectManifest) {
    return from;
  }
  let directory = from;
  while (true) {
    const candidate = path.join(directory, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function loadStaticEjectManifest(
  packageDir: string,
): LoadedEjectManifest | null {
  const packageJson = readJson(path.join(packageDir, "package.json"));
  const manifestRelative = packageJson.agentNativeEjectManifest;
  if (manifestRelative === undefined) return null;
  if (
    typeof manifestRelative !== "string" ||
    !isSafeRelative(manifestRelative)
  ) {
    throw new Error(
      `Package ${String(packageJson.name)} has an unsafe agentNativeEjectManifest`,
    );
  }
  const manifestPath = resolveInside(packageDir, manifestRelative);
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Static eject manifest must be a regular file");
  }
  assertRealPathInside(packageDir, manifestPath, "Static eject manifest");
  const source = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  assertAgentNativeEjectManifest(manifest);
  if (manifest.package !== packageJson.name) {
    throw new Error(
      `Eject manifest package ${manifest.package} does not match ${String(packageJson.name)}`,
    );
  }
  if (typeof packageJson.version !== "string") {
    throw new Error(`Package ${manifest.package} has no version`);
  }
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      packageJson.version,
    )
  ) {
    throw new Error(`Package ${manifest.package} has an invalid version`);
  }
  return {
    manifest,
    manifestDigest: sha256(source),
    packageDir,
    packageVersion: packageJson.version,
  };
}

function findUnit(
  manifests: LoadedEjectManifest[],
  id: string,
): { loaded: LoadedEjectManifest; unit: AgentNativeEjectUnit } | null {
  const matches = manifests.flatMap((loaded) =>
    loaded.manifest.units
      .filter((unit) => unit.id === id)
      .map((unit) => ({ loaded, unit })),
  );
  if (matches.length > 1)
    throw new Error(`Duplicate installed eject unit: ${id}`);
  return matches[0] ?? null;
}

function collectSourceClosure(
  packageDir: string,
  unit: AgentNativeEjectUnit,
): string[] {
  const queue: string[] = [];
  for (const entry of [
    ...(unit.sourceEntries ?? []),
    ...(unit.styles ?? []).map((style) => style.source),
  ]) {
    const source = resolveInside(packageDir, entry);
    if (!fs.existsSync(source))
      throw new Error(`Eject source is missing: ${entry}`);
    assertRealPathInside(packageDir, source, `Eject source ${entry}`);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink())
      throw new Error(`Refusing package symlink: ${entry}`);
    if (stat.isDirectory()) queue.push(...walkSourceFiles(source));
    else if (stat.isFile()) queue.push(source);
  }

  const found = new Set<string>();
  while (queue.length > 0) {
    const source = queue.shift()!;
    if (found.has(source) || isTestFile(source)) continue;
    found.add(source);
    if (!SOURCE_FILE_EXTENSIONS.has(path.extname(source))) continue;
    const content = fs.readFileSync(source, "utf8");
    for (const specifier of relativeSpecifiers(content)) {
      const dependency = resolveSourceImport(source, specifier, packageDir);
      if (dependency && !found.has(dependency)) queue.push(dependency);
    }
  }
  return [...found].sort();
}

function walkSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing package symlink: ${full}`);
    if (entry.isDirectory()) files.push(...walkSourceFiles(full));
    else if (entry.isFile() && !isTestFile(full)) files.push(full);
  }
  return files;
}

function isTestFile(file: string): boolean {
  return /(?:^|\.)((?:spec)|(?:test))\.[^.]+$/.test(path.basename(file));
}

function relativeSpecifiers(source: string): string[] {
  const values = new Set<string>();
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]?.startsWith(".")) values.add(match[1]);
  }
  for (const match of source.matchAll(
    /@import\s+(?:url\(\s*)?["'](\.[^"']+)["']/g,
  )) {
    if (match[1]) values.add(match[1]);
  }
  return [...values];
}

function resolveSourceImport(
  sourceFile: string,
  specifier: string,
  packageDir: string,
): string | null {
  const clean = specifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(sourceFile), clean);
  if (!inside(packageDir, base)) {
    throw new Error(`Relative import escapes package: ${specifier}`);
  }
  const candidates = [base];
  if (/\.(?:js|jsx|mjs)$/.test(base)) {
    const stem = base.replace(/\.(?:js|jsx|mjs)$/, "");
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  if (!path.extname(base)) {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.css`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js"),
    );
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink())
      throw new Error(`Refusing package symlink: ${candidate}`);
    if (stat.isFile()) {
      assertRealPathInside(packageDir, candidate, "Relative eject import");
      return candidate;
    }
  }
  return null;
}

function planEject(
  targetRoot: string,
  loaded: LoadedEjectManifest,
  unit: AgentNativeEjectUnit,
  provenance: EjectionProvenance,
): EjectPlan {
  if (unit.strategy === "package-eject") {
    return planPackageEject(targetRoot, loaded, unit, provenance);
  }
  const closure = collectSourceClosure(loaded.packageDir, unit);
  const mapping = new Map<string, string>();
  for (const source of closure) {
    mapping.set(
      source,
      targetForSource(targetRoot, unit, loaded.packageDir, source),
    );
  }
  const mutations: FileMutation[] = [];
  const collisions: string[] = [];
  const targetRecords: TargetRecord[] = [];
  const trackedTargets = new Set(
    Object.values(provenance.ejections).flatMap((record) =>
      record.targets.map((target) => target.path),
    ),
  );
  for (const source of closure) {
    const target = mapping.get(source)!;
    const raw = fs.readFileSync(source);
    const content = SOURCE_FILE_EXTENSIONS.has(path.extname(source))
      ? Buffer.from(
          rewritePackageSpecifiers(
            raw.toString("utf8"),
            target,
            loaded.manifest.package,
            unit,
            loaded.packageDir,
            targetRoot,
          ).content,
        )
      : raw;
    if (fs.existsSync(target)) {
      if (!trackedTargets.has(relative(targetRoot, target))) {
        collisions.push(
          `Refusing to overwrite untracked ${relative(targetRoot, target)}`,
        );
      } else if (!fs.readFileSync(target).equals(content)) {
        collisions.push(
          `Refusing to overwrite changed ${relative(targetRoot, target)}`,
        );
      }
      mutations.push({ path: target, action: "noop" });
    } else {
      mutations.push({ path: target, action: "create", content });
    }
    targetRecords.push({
      path: relative(targetRoot, target),
      source: relative(loaded.packageDir, source),
      hash: sha256(content),
    });
  }

  const importRewrites: RewriteRecord[] = [];
  for (const consumer of walkConsumerFiles(targetRoot, unit.targetRoot!)) {
    const before = fs.readFileSync(consumer, "utf8");
    const rewritten = rewritePackageSpecifiers(
      before,
      consumer,
      loaded.manifest.package,
      unit,
      loaded.packageDir,
      targetRoot,
    );
    if (rewritten.content === before) continue;
    mutations.push({
      path: consumer,
      action: "update",
      content: Buffer.from(rewritten.content),
    });
    importRewrites.push({
      path: relative(targetRoot, consumer),
      beforeHash: sha256(before),
      afterHash: sha256(rewritten.content),
      replacements: rewritten.replacements,
    });
  }

  const dependencyRewrite = planDependencyRewrite(
    targetRoot,
    loaded,
    unit,
    mutations,
    collisions,
  );

  const record: EjectionRecord = {
    unit: unit.id,
    source: {
      package: loaded.manifest.package,
      version: loaded.packageVersion,
      manifestDigest: loaded.manifestDigest,
    },
    targets: targetRecords,
    importRewrites,
    ...(dependencyRewrite ? { dependencyRewrite } : {}),
  };
  const nextProvenance = structuredClone(provenance);
  nextProvenance.ejections[unit.id] = record;
  const provenancePath = path.join(targetRoot, PROVENANCE_FILE);
  mutations.push({
    path: provenancePath,
    action: fs.existsSync(provenancePath) ? "update" : "create",
    content: Buffer.from(`${JSON.stringify(nextProvenance, null, 2)}\n`),
  });
  return { record, mutations, collisions };
}

function planPackageEject(
  targetRoot: string,
  loaded: LoadedEjectManifest,
  unit: AgentNativeEjectUnit,
  provenance: EjectionProvenance,
): EjectPlan {
  const workspaceRoot = workspaceRootFor(targetRoot);
  const workspaceFile = path.join(workspaceRoot, "pnpm-workspace.yaml");
  const collisions: string[] = [];
  if (!fs.existsSync(workspaceFile)) {
    collisions.push(
      "Package ejection requires an existing pnpm workspace; refusing to create a workspace dependency for another package manager",
    );
  } else {
    const workspace = fs.readFileSync(workspaceFile, "utf8");
    if (
      !workspace.includes("packages/*") &&
      !workspace.includes("packages/**")
    ) {
      collisions.push(
        "pnpm-workspace.yaml does not include packages/*; refusing to rewrite YAML",
      );
    }
  }

  const closure = collectSourceClosure(loaded.packageDir, unit);
  const targetDirectory = resolveInside(workspaceRoot, unit.targetRoot!);
  if (fs.existsSync(targetDirectory)) {
    collisions.push(
      `Package eject target already exists: ${relative(workspaceRoot, targetDirectory)}`,
    );
  }
  const mutations: FileMutation[] = [];
  const targetRecords: TargetRecord[] = [];
  for (const source of closure) {
    const packageRelative = relative(loaded.packageDir, source);
    const target = resolveInside(targetDirectory, packageRelative);
    let content = fs.readFileSync(source);
    if (packageRelative === "package.json") {
      content = Buffer.from(
        normalizeEjectedPackageJson(content.toString("utf8"), targetRoot),
      );
    }
    mutations.push({ path: target, action: "create", content });
    targetRecords.push({
      path: relative(workspaceRoot, target),
      source: packageRelative,
      hash: sha256(content),
      root: "workspace",
    });
  }

  const dependencyRewrite = planForcedDependencyRewrite(
    targetRoot,
    loaded.manifest.package,
    "workspace:*",
    mutations,
  );
  const record: EjectionRecord = {
    unit: unit.id,
    source: {
      package: loaded.manifest.package,
      version: loaded.packageVersion,
      manifestDigest: loaded.manifestDigest,
    },
    targets: targetRecords,
    importRewrites: [],
    ...(dependencyRewrite ? { dependencyRewrite } : {}),
  };
  const nextProvenance = structuredClone(provenance);
  nextProvenance.ejections[unit.id] = record;
  const provenancePath = path.join(targetRoot, PROVENANCE_FILE);
  mutations.push({
    path: provenancePath,
    action: fs.existsSync(provenancePath) ? "update" : "create",
    content: Buffer.from(`${JSON.stringify(nextProvenance, null, 2)}\n`),
  });
  return { record, mutations, collisions };
}

function normalizeEjectedPackageJson(source: string, root: string): string {
  const packageJson = JSON.parse(source) as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = packageJson[field] as
      | Record<string, string>
      | undefined;
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (
        !range.startsWith("workspace:") &&
        !range.startsWith("catalog:") &&
        !range.startsWith("link:")
      ) {
        continue;
      }
      const normalized = normalizeDependencyRange(name, range, root);
      if (!normalized) {
        throw new Error(
          `Cannot normalize ${field}.${name}; the installed dependency version is unavailable`,
        );
      }
      dependencies[name] = normalized;
    }
  }
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function planForcedDependencyRewrite(
  targetRoot: string,
  name: string,
  wanted: string,
  mutations: FileMutation[],
): DependencyRewriteRecord | undefined {
  const packageJsonPath = path.join(targetRoot, "package.json");
  const before = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(before) as Record<string, unknown>;
  const dependencies = (packageJson.dependencies ??= {}) as Record<
    string,
    string
  >;
  const current = dependencies[name] ?? null;
  if (current === wanted) return undefined;
  dependencies[name] = wanted;
  const after = `${JSON.stringify(packageJson, null, 2)}\n`;
  mutations.push({
    path: packageJsonPath,
    action: "update",
    content: Buffer.from(after),
  });
  return {
    path: PROVENANCE_PACKAGE_JSON_PATH,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    changes: [{ name, before: current, after: wanted }],
  };
}

function planDependencyRewrite(
  targetRoot: string,
  loaded: LoadedEjectManifest,
  unit: AgentNativeEjectUnit,
  mutations: FileMutation[],
  collisions: string[],
): DependencyRewriteRecord | undefined {
  if (!unit.dependencies?.length) return undefined;
  const packageJsonPath = path.join(targetRoot, "package.json");
  const before = fs.readFileSync(packageJsonPath, "utf8");
  const targetPackage = JSON.parse(before) as Record<string, unknown>;
  const dependencies = (targetPackage.dependencies ??= {}) as Record<
    string,
    string
  >;
  const sourcePackage = readJson(path.join(loaded.packageDir, "package.json"));
  const changes: DependencyRewriteRecord["changes"] = [];
  for (const name of unit.dependencies) {
    if (dependencies[name]) continue;
    const declared = dependencyRange(sourcePackage, name);
    const range = normalizeDependencyRange(name, declared, targetRoot);
    if (!range) {
      collisions.push(
        `Cannot resolve a version for required dependency ${name}`,
      );
      continue;
    }
    dependencies[name] = range;
    changes.push({ name, before: null, after: range });
  }
  if (!changes.length) return undefined;
  const after = `${JSON.stringify(targetPackage, null, 2)}\n`;
  mutations.push({
    path: packageJsonPath,
    action: "update",
    content: Buffer.from(after),
  });
  return {
    path: PROVENANCE_PACKAGE_JSON_PATH,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    changes,
  };
}

const PROVENANCE_PACKAGE_JSON_PATH = "package.json";

function dependencyRange(
  packageJson: Record<string, unknown>,
  name: string,
): string | undefined {
  for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
    const value = (packageJson[field] as Record<string, unknown> | undefined)?.[
      name
    ];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function normalizeDependencyRange(
  name: string,
  range: string | undefined,
  root: string,
): string | null {
  if (
    range &&
    !range.startsWith("workspace:") &&
    !range.startsWith("catalog:") &&
    !range.startsWith("link:")
  ) {
    return range;
  }
  const packageJsonPath = findInstalledPackageJson(name, root);
  if (!packageJsonPath) return null;
  const version = readJson(packageJsonPath).version;
  return typeof version === "string" ? `^${version}` : null;
}

function findInstalledPackageJson(name: string, from: string): string | null {
  let directory = from;
  while (true) {
    const candidate = path.join(
      directory,
      "node_modules",
      name,
      "package.json",
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function targetForSource(
  targetRoot: string,
  unit: AgentNativeEjectUnit,
  packageDir: string,
  source: string,
): string {
  const packageRelative = relative(packageDir, source);
  const sourceRelative = packageRelative.startsWith("src/")
    ? packageRelative.slice("src/".length)
    : packageRelative;
  return resolveInside(targetRoot, path.join(unit.targetRoot!, sourceRelative));
}

function walkConsumerFiles(root: string, ejectedTargetRoot: string): string[] {
  const excluded = path.resolve(root, ejectedTargetRoot);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name === PROVENANCE_FILE)
        continue;
      const full = path.join(directory, entry.name);
      if (full === excluded || full.startsWith(`${excluded}${path.sep}`))
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (
        entry.isFile() &&
        SOURCE_FILE_EXTENSIONS.has(path.extname(full))
      ) {
        files.push(full);
      }
    }
  };
  visit(root);
  return files.sort();
}

function rewritePackageSpecifiers(
  content: string,
  consumer: string,
  packageName: string,
  unit: AgentNativeEjectUnit,
  packageDir: string,
  targetRoot: string,
): { content: string; replacements: Array<{ from: string; to: string }> } {
  const replacements: Array<{ from: string; to: string }> = [];
  const pattern =
    /(\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|@import\s+(?:url\(\s*)?)(["'])([^"'\r\n]+)\2/g;
  const next = content.replace(
    pattern,
    (literal, prefix: string, quote: string, specifier: string) => {
      if (
        (unit.protectedImports ?? []).some(
          (item) => specifier === item || specifier.startsWith(`${item}/`),
        )
      ) {
        return literal;
      }
      const target = targetForSpecifier(
        specifier,
        packageName,
        unit,
        packageDir,
        targetRoot,
      );
      if (!target) return literal;
      let replacement = path
        .relative(path.dirname(consumer), target)
        .replaceAll(path.sep, "/");
      replacement = replacement.replace(/\.(?:tsx?|jsx?|mjs)$/, "");
      replacement = replacement.replace(/\/index$/, "");
      if (!replacement.startsWith(".")) replacement = `./${replacement}`;
      replacements.push({ from: specifier, to: replacement });
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );
  return { content: next, replacements };
}

function targetForSpecifier(
  specifier: string,
  packageName: string,
  unit: AgentNativeEjectUnit,
  packageDir: string,
  targetRoot: string,
): string | null {
  for (const style of unit.styles ?? []) {
    if (specifier === packageSpecifier(packageName, style.entrypoint)) {
      return targetForSource(
        targetRoot,
        unit,
        packageDir,
        resolveInside(packageDir, style.source),
      );
    }
  }
  for (const entrypoint of unit.entrypoints) {
    const publicSpecifier = packageSpecifier(packageName, entrypoint);
    if (entrypoint.includes("*")) {
      const [prefix, suffix = ""] = publicSpecifier.split("*");
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix))
        continue;
      const wildcard = specifier.slice(
        prefix.length,
        specifier.length - suffix.length || undefined,
      );
      const sourceEntry = pickSourceEntry(unit, entrypoint, packageDir);
      const sourceBase = fs.lstatSync(sourceEntry).isDirectory()
        ? sourceEntry
        : path.dirname(sourceEntry);
      return targetForSource(
        targetRoot,
        unit,
        packageDir,
        path.join(sourceBase, wildcard),
      );
    }
    if (specifier === publicSpecifier) {
      return targetForSource(
        targetRoot,
        unit,
        packageDir,
        pickSourceEntry(unit, entrypoint, packageDir),
      );
    }
  }
  return null;
}

function pickSourceEntry(
  unit: AgentNativeEjectUnit,
  entrypoint: string,
  packageDir: string,
): string {
  const sources = (unit.sourceEntries ?? []).map((entry) =>
    resolveInside(packageDir, entry),
  );
  const subpath =
    entrypoint === "." ? "index" : entrypoint.slice(2).replace(/\/\*$/, "");
  const matched = sources.find((source) => {
    const rel = relative(packageDir, source).replace(/^src\//, "");
    return (
      rel === subpath ||
      rel.replace(/\.(?:tsx?|jsx?|mjs)$/, "") === subpath ||
      rel.replace(/\/index\.(?:tsx?|jsx?|mjs)$/, "") === subpath
    );
  });
  const source = matched ?? sources[0];
  if (!source) throw new Error(`Unit ${unit.id} has no source entry`);
  if (fs.lstatSync(source).isDirectory()) {
    for (const name of ["index.ts", "index.tsx", "index.js", "index.jsx"]) {
      const index = path.join(source, name);
      if (fs.existsSync(index)) return index;
    }
  }
  return source;
}

function packageSpecifier(packageName: string, entrypoint: string): string {
  return entrypoint === "."
    ? packageName
    : `${packageName}/${entrypoint.slice(2)}`;
}

function diffRecord(
  targetRoot: string,
  record: EjectionRecord | undefined,
  loaded?: LoadedEjectManifest,
): {
  unit: string | null;
  ejected: boolean;
  clean: boolean;
  restorable: boolean;
  differences: string[];
} {
  if (!record) {
    return {
      unit: null,
      ejected: false,
      clean: false,
      restorable: false,
      differences: ["No committed ejection record"],
    };
  }
  const differences: string[] = [];
  const localDifferences: string[] = [];
  if (!loaded) {
    differences.push("Published eject definition is unavailable");
  } else if (record.source.package !== loaded.manifest.package) {
    differences.push(
      `Source package changed: ${record.source.package} -> ${loaded.manifest.package}`,
    );
  }
  if (loaded && record.source.version !== loaded.packageVersion) {
    differences.push(
      `Source version changed: ${record.source.version} -> ${loaded.packageVersion}`,
    );
  }
  if (loaded && record.source.manifestDigest !== loaded.manifestDigest) {
    differences.push("Published eject manifest changed");
  }
  for (const target of record.targets) {
    const file = resolveRecordedPath(targetRoot, target);
    if (!fs.existsSync(file))
      localDifferences.push(`Missing target: ${target.path}`);
    else if (sha256(fs.readFileSync(file)) !== target.hash)
      localDifferences.push(`Changed target: ${target.path}`);
  }
  for (const rewrite of record.importRewrites) {
    const file = resolveInside(targetRoot, rewrite.path);
    if (!fs.existsSync(file)) {
      localDifferences.push(`Missing rewritten consumer: ${rewrite.path}`);
    } else if (sha256(fs.readFileSync(file)) !== rewrite.afterHash) {
      localDifferences.push(`Changed rewritten consumer: ${rewrite.path}`);
    }
  }
  if (record.dependencyRewrite) {
    const file = resolveInside(targetRoot, record.dependencyRewrite.path);
    if (!fs.existsSync(file)) {
      localDifferences.push(
        `Missing dependency consumer: ${record.dependencyRewrite.path}`,
      );
    } else if (
      sha256(fs.readFileSync(file)) !== record.dependencyRewrite.afterHash
    ) {
      localDifferences.push(
        `Changed dependency consumer: ${record.dependencyRewrite.path}`,
      );
    }
  }
  differences.push(...localDifferences);
  return {
    unit: record.unit,
    ejected: true,
    clean: differences.length === 0,
    restorable: localDifferences.length === 0,
    differences,
  };
}

function planRestore(
  targetRoot: string,
  provenance: EjectionProvenance,
  record: EjectionRecord,
): FileMutation[] {
  const mutations: FileMutation[] = [];
  for (const rewrite of record.importRewrites) {
    const file = resolveInside(targetRoot, rewrite.path);
    let content = fs.readFileSync(file, "utf8");
    for (const replacement of rewrite.replacements) {
      content = content.split(replacement.to).join(replacement.from);
    }
    if (sha256(content) !== rewrite.beforeHash) {
      throw new Error(`Cannot reverse import rewrite exactly: ${rewrite.path}`);
    }
    mutations.push({
      path: file,
      action: "update",
      content: Buffer.from(content),
    });
  }
  if (record.dependencyRewrite) {
    const rewrite = record.dependencyRewrite;
    const file = resolveInside(targetRoot, rewrite.path);
    const packageJson = readJson(file);
    const dependencies = (packageJson.dependencies ??= {}) as Record<
      string,
      string
    >;
    for (const change of rewrite.changes) {
      if (change.before === null) delete dependencies[change.name];
      else dependencies[change.name] = change.before;
    }
    const content = `${JSON.stringify(packageJson, null, 2)}\n`;
    if (sha256(content) !== rewrite.beforeHash) {
      throw new Error(
        `Cannot reverse dependency rewrite exactly: ${rewrite.path}`,
      );
    }
    mutations.push({
      path: file,
      action: "update",
      content: Buffer.from(content),
    });
  }
  const otherTargets = new Set(
    Object.values(provenance.ejections)
      .filter((candidate) => candidate.unit !== record.unit)
      .flatMap((candidate) =>
        candidate.targets.map(
          (target) => `${target.root ?? "app"}:${target.path}`,
        ),
      ),
  );
  for (const target of record.targets) {
    if (!otherTargets.has(`${target.root ?? "app"}:${target.path}`)) {
      mutations.push({
        path: resolveRecordedPath(targetRoot, target),
        action: "delete",
      });
    }
  }
  const next = structuredClone(provenance);
  delete next.ejections[record.unit];
  const provenancePath = path.join(targetRoot, PROVENANCE_FILE);
  mutations.push(
    Object.keys(next.ejections).length > 0
      ? {
          path: provenancePath,
          action: "update",
          content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`),
        }
      : { path: provenancePath, action: "delete" },
  );
  return mutations;
}

function readProvenance(root: string): EjectionProvenance {
  const file = path.join(root, PROVENANCE_FILE);
  if (!fs.existsSync(file)) return { manifestVersion: 1, ejections: {} };
  const value = readJson(file) as unknown as EjectionProvenance;
  if (
    value.manifestVersion !== 1 ||
    !value.ejections ||
    typeof value.ejections !== "object"
  ) {
    throw new Error(`Unsupported ${PROVENANCE_FILE}`);
  }
  return value;
}

function applyMutations(
  root: string,
  mutations: FileMutation[],
  spawn: typeof spawnSync,
): void {
  const changes = mutations.filter((mutation) => mutation.action !== "noop");
  const stage = fs.mkdtempSync(path.join(root, ".agent-native-eject-stage-"));
  const snapshots = new Map<string, Buffer | null>();
  const installRoot = findPackageManagerRoot(root);
  const lockfiles = [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ].map((name) => path.join(installRoot, name));
  const needsInstall = changes.some(
    (mutation) => path.basename(mutation.path) === "package.json",
  );
  try {
    for (const [index, mutation] of changes.entries()) {
      if (!inside(root, mutation.path))
        throw new Error(`Mutation escapes app root: ${mutation.path}`);
      snapshots.set(
        mutation.path,
        fs.existsSync(mutation.path) ? fs.readFileSync(mutation.path) : null,
      );
      if (mutation.action !== "delete") {
        fs.writeFileSync(path.join(stage, String(index)), mutation.content!);
      }
    }
    if (needsInstall) {
      for (const lockfile of lockfiles) {
        snapshots.set(
          lockfile,
          fs.existsSync(lockfile) ? fs.readFileSync(lockfile) : null,
        );
      }
    }
    for (const [index, mutation] of changes.entries()) {
      if (mutation.action === "delete")
        fs.rmSync(mutation.path, { force: true });
      else {
        fs.mkdirSync(path.dirname(mutation.path), { recursive: true });
        fs.renameSync(path.join(stage, String(index)), mutation.path);
      }
    }
    if (needsInstall) {
      const packageManager = detectPackageManager(installRoot);
      const result = spawn(packageManager, ["install"], {
        cwd: installRoot,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        throw new Error(
          `${packageManager} install failed with status ${String(result.status)}`,
        );
      }
    }
  } catch (error) {
    for (const [file, snapshot] of [...snapshots.entries()].reverse()) {
      if (snapshot === null) fs.rmSync(file, { force: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, snapshot);
      }
    }
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function findPackageManagerRoot(from: string): string {
  let directory = from;
  while (true) {
    if (
      fs.existsSync(path.join(directory, "pnpm-lock.yaml")) ||
      fs.existsSync(path.join(directory, "yarn.lock")) ||
      fs.existsSync(path.join(directory, "package-lock.json")) ||
      fs.existsSync(path.join(directory, "bun.lock")) ||
      fs.existsSync(path.join(directory, "bun.lockb"))
    ) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return from;
    directory = parent;
  }
}

function detectPackageManager(root: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (
    fs.existsSync(path.join(root, "bun.lock")) ||
    fs.existsSync(path.join(root, "bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function mutationReport(
  command: "eject" | "restore",
  unit: string,
  root: string,
  apply: boolean,
  mutations: FileMutation[],
) {
  return {
    command,
    unit,
    targetRoot: root,
    apply,
    changes: mutations.map((mutation) => ({
      action: mutation.action,
      path: relative(root, mutation.path),
    })),
  };
}

function formatInspect(result: {
  unit: AgentNativeEjectUnit;
  package: string;
  packageVersion: string;
  manifestDigest: string;
  files: string[];
}): string {
  return [
    `# ${result.unit.id}`,
    `${result.unit.label} (${result.unit.strategy})`,
    `Source: ${result.package}@${result.packageVersion}`,
    `Catalog: ${result.unit.catalog}`,
    `Manifest: ${result.manifestDigest}`,
    `Entrypoints: ${result.unit.entrypoints.join(", ")}`,
    ...(result.unit.seam ? [`Register through: ${result.unit.seam}`] : []),
    ...(result.unit.protectedImports?.length
      ? [`Protected imports: ${result.unit.protectedImports.join(", ")}`]
      : []),
    `Files: ${result.files.length}`,
    ...result.files.map((file) => `  ${file}`),
  ].join("\n");
}

function formatProtected(result: {
  unit: string;
  seam?: string;
  message: string;
}): string {
  return [`# ${result.unit}`, result.message, `Use: ${result.seam}`].join("\n");
}

function formatDiff(result: {
  unit: string | null;
  ejected: boolean;
  clean: boolean;
  restorable: boolean;
  differences: string[];
}): string {
  return [
    `# Eject diff${result.unit ? ` ${result.unit}` : ""}`,
    `Status: ${result.clean ? "clean" : "changed"}`,
    ...(result.differences.length
      ? result.differences.map((item) => `  - ${item}`)
      : ["  No differences."]),
  ].join("\n");
}

function formatMutationReport(
  report: ReturnType<typeof mutationReport>,
): string {
  return [
    `# ${report.command} ${report.unit}`,
    `Mode: ${report.apply ? "apply" : "dry-run"}`,
    ...report.changes.map(
      (change) => `  ${change.action.padEnd(6)} ${change.path}`,
    ),
    ...(!report.apply
      ? ["", "Dry-run only. Re-run with --apply to write these changes."]
      : []),
  ].join("\n");
}

function formatEjectReport(
  report: ReturnType<typeof mutationReport> & {
    collisions: string[];
    verification: string[];
    seam?: string;
    protectedImports: string[];
    reminder: string;
  },
): string {
  return [
    formatMutationReport(report),
    ...(report.collisions.length
      ? ["", "Collisions:", ...report.collisions.map((item) => `  - ${item}`)]
      : []),
    ...(report.verification.length
      ? ["", "Verify:", ...report.verification.map((item) => `  ${item}`)]
      : []),
    ...(report.seam ? ["", `Register through: ${report.seam}`] : []),
    ...(report.protectedImports.length
      ? ["", `Protected imports: ${report.protectedImports.join(", ")}`]
      : []),
    "",
    report.reminder,
  ].join("\n");
}

function blueprintFor(unit: string): AgentNativeEjectManifest {
  const packageName = unit.startsWith("@")
    ? unit.split("/").slice(0, 2).join("/")
    : `@example/${unit.split("/")[0] || "package"}`;
  return {
    manifestVersion: 1,
    package: packageName,
    catalogs: ["domain-packages"],
    units: [
      {
        id: unit,
        label: "Describe this ejectable unit",
        catalog: "domain-packages",
        catalogItems: [unit],
        entrypoints: ["."],
        strategy: "source-copy",
        sourceEntries: ["src/index.ts"],
        targetRoot: `app/ejected/${unit.replaceAll("/", "-")}`,
        protectedImports: [],
        verification: ["pnpm typecheck"],
      },
    ],
  };
}

function isFirstPartyUnit(unit: string): boolean {
  if (unit.startsWith("@agent-native/")) return true;
  return [
    "core/",
    "creative-context/",
    "dispatch/",
    "domain/",
    "integration/",
    "integrations/",
    "mcp/",
    "messaging/",
    "package/",
    "pinpoint/",
    "provider/",
    "provider-api/",
    "remote-mcp/",
    "scheduling/",
    "setup/",
    "toolkit/",
    "workspace/",
  ].some((prefix) => unit.startsWith(prefix));
}

function ejectUsage(): string {
  return [
    "Feature source ownership lifecycle:",
    "",
    "Usage:",
    "  agent-native eject --list [--root <dir>] [--app <name>] [--json]",
    "  agent-native eject inspect <unit> [--root <dir>] [--app <name>] [--json]",
    "  agent-native eject <unit> [--root <dir>] [--app <name>] [--apply] [--json]",
    "  agent-native eject diff <unit> [--root <dir>] [--app <name>] [--json]",
    "  agent-native eject restore <unit> [--root <dir>] [--app <name>] [--apply] [--json]",
    "",
    "eject and restore are dry-run by default.",
  ].join("\n");
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function resolveInside(root: string, relativePath: string): string {
  if (!isSafeRelative(relativePath))
    throw new Error(`Unsafe relative path: ${relativePath}`);
  const resolved = path.resolve(root, relativePath);
  if (!inside(root, resolved))
    throw new Error(`Path escapes root: ${relativePath}`);
  return resolved;
}

function assertRealPathInside(
  root: string,
  candidate: string,
  label: string,
): void {
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  if (!inside(realRoot, realCandidate)) {
    throw new Error(`${label} escapes the package directory`);
  }
}

function isSafeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function inside(root: string, candidate: string): boolean {
  const boundary = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === boundary || resolved.startsWith(`${boundary}${path.sep}`);
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/") || ".";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
