import fs from "node:fs";
import path from "node:path";

import { DEFAULT_MCP_INTEGRATIONS } from "../packages/core/src/client/resources/mcp-integration-catalog.js";
import { BUILT_IN_SETUP_READINESS_UI_IDS } from "../packages/core/src/client/setup-connections/catalog.js";
import { WORKSPACE_CONNECTION_PROVIDERS } from "../packages/core/src/connections/catalog.js";
import { BUILT_IN_INTEGRATION_ADAPTER_IDS } from "../packages/core/src/integrations/plugin.js";
import {
  assertAgentNativeEjectManifest,
  REQUIRED_AGENT_NATIVE_EJECT_CATALOGS,
  type AgentNativeEjectCatalog,
  type AgentNativeEjectManifest,
  type AgentNativeEjectUnit,
} from "../packages/core/src/package-lifecycle/eject-manifest.js";
import { PROVIDER_API_IDS } from "../packages/core/src/provider-api/index.js";

type PackageJson = {
  name?: string;
  files?: string[];
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  agentNativeManifest?: string;
  agentNativeEjectManifest?: string;
};

type LoadedManifest = {
  directory: string;
  packageJson: PackageJson;
  manifest: AgentNativeEjectManifest;
};

const repoRoot = process.cwd();
const violations: string[] = [];
const manifests = loadFirstPartyManifests();

for (const loaded of manifests) validateManifestFreshness(loaded);
validateGlobalOwnership(manifests);
validateToolkitExportCoverage(manifests);
validateCatalogCoverage(manifests);
validateDomainPackageCoverage(manifests);

if (violations.length > 0) {
  console.error("Eject manifest guard failed:");
  for (const violation of new Set(violations)) console.error(`- ${violation}`);
  process.exit(1);
}

const unitCount = manifests.reduce(
  (count, loaded) => count + loaded.manifest.units.length,
  0,
);
console.log(
  `Eject manifests cover ${unitCount} units across ${manifests.length} packages and all six first-party catalogs.`,
);

function loadFirstPartyManifests(): LoadedManifest[] {
  const loaded: LoadedManifest[] = [];
  const packageDirectories = fs
    .readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(repoRoot, "packages", entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, "package.json")));

  for (const directory of packageDirectories) {
    const packageJson = readJson<PackageJson>(
      path.join(directory, "package.json"),
    );
    const manifestPath = packageJson.agentNativeEjectManifest;
    if (!manifestPath) continue;
    if (!isSafeRelativePath(manifestPath)) {
      violations.push(
        `${packageJson.name ?? directory} has an unsafe agentNativeEjectManifest path`,
      );
      continue;
    }
    const absoluteManifestPath = path.join(directory, manifestPath);
    if (!fs.existsSync(absoluteManifestPath)) {
      violations.push(
        `${packageJson.name ?? directory} is missing ${manifestPath}`,
      );
      continue;
    }
    try {
      const manifest = readJson<unknown>(absoluteManifestPath);
      assertAgentNativeEjectManifest(manifest);
      loaded.push({ directory, packageJson, manifest });
    } catch (error) {
      violations.push(
        `${packageJson.name ?? directory} eject manifest is invalid: ${errorMessage(error)}`,
      );
    }
  }

  return loaded;
}

function validateGlobalOwnership(loaded: LoadedManifest[]): void {
  const units = new Map<string, string>();
  const catalogItems = new Map<string, string>();
  for (const { manifest } of loaded) {
    for (const unit of manifest.units) {
      const existingUnitPackage = units.get(unit.id);
      if (existingUnitPackage) {
        violations.push(
          `Eject unit ${unit.id} is claimed by both ${existingUnitPackage} and ${manifest.package}`,
        );
      } else {
        units.set(unit.id, manifest.package);
      }
      for (const item of unit.catalogItems) {
        const key = `${unit.catalog}:${item}`;
        const owner = `${manifest.package} (${unit.id})`;
        const existingOwner = catalogItems.get(key);
        if (existingOwner) {
          violations.push(
            `Eject catalog item ${key} is claimed by both ${existingOwner} and ${owner}`,
          );
        } else {
          catalogItems.set(key, owner);
        }
      }
    }
  }
}

function validateManifestFreshness(loaded: LoadedManifest): void {
  const { directory, packageJson, manifest } = loaded;
  if (manifest.package !== packageJson.name) {
    violations.push(
      `${manifest.package} does not match package.json name ${String(packageJson.name)}`,
    );
  }
  if (!packageJson.files?.includes(packageJson.agentNativeEjectManifest!)) {
    violations.push(`${manifest.package} does not publish its eject manifest`);
  }

  const exports = new Set(Object.keys(packageJson.exports ?? {}));
  const dependencies = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);

  for (const unit of manifest.units) {
    if (
      unit.strategy === "package-eject" &&
      packageJson.agentNativeEjectManifest &&
      !unit.sourceEntries?.includes(packageJson.agentNativeEjectManifest)
    ) {
      violations.push(
        `${unit.id} must copy ${packageJson.agentNativeEjectManifest} so the ejected package keeps its lifecycle manifest`,
      );
    }
    if (
      unit.strategy !== "protected-seam" &&
      unit.entrypoints.length === 0 &&
      (unit.styles?.length ?? 0) === 0
    ) {
      violations.push(
        `${unit.id} copies source but cannot rewrite any consumer import`,
      );
    }
    for (const entrypoint of [
      ...unit.entrypoints,
      ...(unit.styles ?? []).map((style) => style.entrypoint),
    ]) {
      if (!exports.has(entrypoint)) {
        violations.push(
          `${unit.id} owns ${entrypoint}, but ${manifest.package} does not export it`,
        );
      }
    }
    for (const entrypoint of unit.entrypoints) {
      const publicSpecifier =
        entrypoint === "."
          ? manifest.package
          : `${manifest.package}/${entrypoint.slice(2)}`;
      if (
        unit.strategy !== "protected-seam" &&
        unit.protectedImports?.some((protectedImport) =>
          matchesPackageImport(publicSpecifier, protectedImport),
        )
      ) {
        violations.push(
          `${unit.id} protects its owned entrypoint ${publicSpecifier}, so consumer imports cannot be rewritten`,
        );
      }
      if (
        unit.strategy !== "protected-seam" &&
        !sourceTargetForEntrypoint(directory, unit, entrypoint)
      ) {
        violations.push(
          `${unit.id} entrypoint ${entrypoint} has no copied source target`,
        );
      }
    }
    for (const source of unit.sourceEntries ?? []) {
      if (!fs.existsSync(path.join(directory, source))) {
        violations.push(`${unit.id} source entry does not exist: ${source}`);
      }
      if (!isPublishedSource(source, packageJson.files ?? [])) {
        violations.push(`${unit.id} source entry is not published: ${source}`);
      }
    }
    for (const style of unit.styles ?? []) {
      if (!fs.existsSync(path.join(directory, style.source))) {
        violations.push(
          `${unit.id} style source does not exist: ${style.source}`,
        );
      }
      if (!isPublishedSource(style.source, packageJson.files ?? [])) {
        violations.push(
          `${unit.id} style source is not published: ${style.source}`,
        );
      }
    }
    for (const dependency of unit.dependencies ?? []) {
      if (!dependencies.has(dependency)) {
        violations.push(
          `${unit.id} declares dependency ${dependency}, but the source package does not`,
        );
      }
    }
    validateProtectedImports(directory, unit);
    validateRelativeClosure(directory, unit);
    validateDeclaredDependencies(directory, manifest.package, unit);
  }
}

function validateDeclaredDependencies(
  packageDirectory: string,
  packageName: string,
  unit: AgentNativeEjectUnit,
): void {
  if (unit.strategy !== "source-copy") return;
  const declared = new Set(unit.dependencies ?? []);
  const protectedImports = unit.protectedImports ?? [];
  const queue = (unit.sourceEntries ?? [])
    .concat((unit.styles ?? []).map((style) => style.source))
    .flatMap((entry) => sourceFiles(path.join(packageDirectory, entry)));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!isSourceFile(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of moduleSpecifiers(source).filter((item) =>
      item.startsWith("."),
    )) {
      const resolved = resolveRelativeSource(file, specifier);
      if (resolved && isSourceFile(resolved)) queue.push(resolved);
    }
    for (const specifier of moduleSpecifiers(source).filter(
      (item) => !item.startsWith("."),
    )) {
      if (
        specifier.startsWith("node:") ||
        specifier === packageName ||
        specifier.startsWith(`${packageName}/`) ||
        protectedImports.some((protectedImport) =>
          matchesPackageImport(specifier, protectedImport),
        )
      ) {
        continue;
      }
      const dependency = packageNameFromSpecifier(specifier);
      if (!declared.has(dependency)) {
        violations.push(
          `${unit.id} must declare copied dependency ${dependency}`,
        );
      }
    }
  }
}

function validateRelativeClosure(
  packageDirectory: string,
  unit: AgentNativeEjectUnit,
): void {
  if (unit.strategy === "protected-seam") return;
  const queue = (unit.sourceEntries ?? [])
    .concat((unit.styles ?? []).map((style) => style.source))
    .flatMap((entry) => sourceFiles(path.join(packageDirectory, entry)))
    .filter(isClosureFile);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    const relativeImports = moduleSpecifiers(source)
      .concat(
        [...source.matchAll(/@import\s+["'](\.[^"']+)["']/g)].map(
          (match) => match[1]!,
        ),
      )
      .filter((specifier) => specifier.startsWith("."));
    for (const specifier of relativeImports) {
      const resolved = resolveRelativeSource(file, specifier);
      if (!resolved) {
        violations.push(
          `${unit.id} has an unresolved relative import in ${path.relative(packageDirectory, file)}: ${specifier}`,
        );
        continue;
      }
      if (!resolved.startsWith(`${packageDirectory}${path.sep}`)) {
        violations.push(
          `${unit.id} relative closure escapes its source package`,
        );
        continue;
      }
      if (fs.lstatSync(resolved).isSymbolicLink()) {
        violations.push(`${unit.id} relative closure contains a symlink`);
        continue;
      }
      if (isClosureFile(resolved)) queue.push(resolved);
    }
  }
}

function validateProtectedImports(
  packageDirectory: string,
  unit: AgentNativeEjectUnit,
): void {
  if (unit.strategy === "protected-seam") {
    if (
      !unit.protectedImports?.some((specifier) =>
        matchesPackageImport(unit.seam!, specifier),
      )
    ) {
      violations.push(`${unit.id} must record its seam as a protected import`);
    }
    return;
  }

  const protectedImports = unit.protectedImports ?? [];
  for (const sourceEntry of unit.sourceEntries ?? []) {
    const absoluteEntry = path.join(packageDirectory, sourceEntry);
    for (const file of sourceFiles(absoluteEntry)) {
      const source = fs.readFileSync(file, "utf8");
      for (const specifier of source.matchAll(
        /(?:from\s+|import\s*\()(["'])(@agent-native\/core(?:\/[^"']*)?)\1/g,
      )) {
        const imported = specifier[2]!;
        if (
          !protectedImports.some((protectedImport) =>
            matchesPackageImport(imported, protectedImport),
          )
        ) {
          violations.push(
            `${unit.id} must keep runtime import ${imported} protected`,
          );
        }
      }
    }
  }
}

function validateToolkitExportCoverage(loaded: LoadedManifest[]): void {
  const toolkit = loaded.find(
    (candidate) => candidate.manifest.package === "@agent-native/toolkit",
  );
  if (!toolkit) {
    violations.push("@agent-native/toolkit has no eject manifest");
    return;
  }
  const ignoredMetadataExports = new Set(["./agent-native.eject.json"]);
  const actual = new Set(
    Object.keys(toolkit.packageJson.exports ?? {}).filter(
      (entrypoint) => !ignoredMetadataExports.has(entrypoint),
    ),
  );
  const covered = new Set(
    toolkit.manifest.units.flatMap((unit) => [
      ...unit.entrypoints,
      ...(unit.styles ?? []).map((style) => style.entrypoint),
    ]),
  );
  compareSets("Toolkit public entrypoints", actual, covered);
}

function validateCatalogCoverage(loaded: LoadedManifest[]): void {
  const expected: Record<
    Exclude<AgentNativeEjectCatalog, "toolkit-ui" | "domain-packages">,
    Set<string>
  > = {
    "remote-mcp-presets": new Set(
      DEFAULT_MCP_INTEGRATIONS.map((entry) => entry.id),
    ),
    "workspace-connections": new Set(
      WORKSPACE_CONNECTION_PROVIDERS.map((entry) => entry.id),
    ),
    "provider-api-definitions": new Set(PROVIDER_API_IDS),
    "messaging-adapters": new Set(BUILT_IN_INTEGRATION_ADAPTER_IDS),
    "setup-readiness-ui": new Set(BUILT_IN_SETUP_READINESS_UI_IDS),
  };

  const covered = collectCatalogItems(loaded);
  for (const catalog of REQUIRED_AGENT_NATIVE_EJECT_CATALOGS) {
    if (catalog === "domain-packages") continue;
    compareSets(`${catalog} catalog`, expected[catalog], covered.get(catalog));
  }
  for (const { manifest } of loaded) {
    for (const unit of manifest.units) {
      if (
        (REQUIRED_AGENT_NATIVE_EJECT_CATALOGS as readonly string[]).includes(
          unit.catalog,
        ) &&
        unit.strategy === "protected-seam"
      ) {
        violations.push(
          `${unit.id} cannot satisfy ${unit.catalog} coverage through a protected seam`,
        );
      }
    }
  }
}

function validateDomainPackageCoverage(loaded: LoadedManifest[]): void {
  const expected = new Set<string>();
  for (const entry of fs.readdirSync(path.join(repoRoot, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join(
      repoRoot,
      "packages",
      entry.name,
      "package.json",
    );
    if (!fs.existsSync(packageJsonPath)) continue;
    const packageJson = readJson<PackageJson>(packageJsonPath);
    if (!packageJson.agentNativeManifest || !packageJson.name) continue;
    expected.add(packageJson.name.replace(/^@agent-native\//, ""));
    if (!packageJson.agentNativeEjectManifest) {
      violations.push(
        `${packageJson.name} is a first-party domain package without an eject manifest`,
      );
    }
  }
  compareSets(
    "domain-packages catalog",
    expected,
    collectCatalogItems(loaded).get("domain-packages"),
  );
}

function collectCatalogItems(
  loaded: LoadedManifest[],
): Map<AgentNativeEjectCatalog, Set<string>> {
  const result = new Map<AgentNativeEjectCatalog, Set<string>>();
  for (const { manifest } of loaded) {
    for (const unit of manifest.units) {
      const items = result.get(unit.catalog) ?? new Set<string>();
      for (const item of unit.catalogItems) items.add(item);
      result.set(unit.catalog, items);
    }
  }
  return result;
}

function compareSets(
  label: string,
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string> | undefined,
): void {
  const actualItems = actual ?? new Set<string>();
  const missing = [...expected].filter((item) => !actualItems.has(item)).sort();
  const extra = [...actualItems].filter((item) => !expected.has(item)).sort();
  if (missing.length > 0)
    violations.push(`${label} is missing: ${missing.join(", ")}`);
  if (extra.length > 0)
    violations.push(`${label} has stale items: ${extra.join(", ")}`);
}

function sourceFiles(entry: string): string[] {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return isClosureFile(entry) ? [entry] : [];
  return fs
    .readdirSync(entry, { withFileTypes: true })
    .flatMap((child) => sourceFiles(path.join(entry, child.name)))
    .filter((file) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file));
}

function resolveRelativeSource(
  sourceFile: string,
  specifier: string,
): string | null {
  const base = path.resolve(
    path.dirname(sourceFile),
    specifier.split(/[?#]/, 1)[0]!,
  );
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
      `${base}.json`,
      `${base}.css`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js"),
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function isSourceFile(file: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(file);
}

function isClosureFile(file: string): boolean {
  return isSourceFile(file) || /\.css$/.test(file);
}

function sourceTargetForEntrypoint(
  packageDirectory: string,
  unit: AgentNativeEjectUnit,
  entrypoint: string,
): string | null {
  const sources = (unit.sourceEntries ?? []).map((entry) =>
    path.join(packageDirectory, entry),
  );
  const subpath =
    entrypoint === "." ? "index" : entrypoint.slice(2).replace(/\/\*$/, "");
  const matched = sources.find((source) => {
    const relative = path
      .relative(packageDirectory, source)
      .replace(/^src\//, "");
    return (
      relative === subpath ||
      relative.replace(/\.(?:tsx?|jsx?|mjs)$/, "") === subpath ||
      relative.replace(/\/index\.(?:tsx?|jsx?|mjs)$/, "") === subpath
    );
  });
  const source = matched ?? sources[0];
  if (!source || !fs.existsSync(source)) return null;
  if (fs.lstatSync(source).isDirectory()) {
    const index = ["index.ts", "index.tsx", "index.js", "index.jsx"]
      .map((name) => path.join(source, name))
      .find((candidate) => fs.existsSync(candidate));
    return index ?? (entrypoint.includes("*") ? source : null);
  }
  return source;
}

function isPublishedSource(source: string, files: string[]): boolean {
  if (source === "package.json") return true;
  return files.some(
    (published) =>
      !published.startsWith("!") &&
      (source === published || source.startsWith(`${published}/`)),
  );
}

function matchesPackageImport(
  imported: string,
  protectedImport: string,
): boolean {
  return (
    imported === protectedImport || imported.startsWith(`${protectedImport}/`)
  );
}

function packageNameFromSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function moduleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /^\s*(?:import|export)\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[\s\S]*?\})?)\s+from\s+["']([^"']+)["']/gm,
    /^\s*export\s+\*\s+from\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "..")
  );
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
