import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  Project,
  QuoteKind,
  type ImportDeclaration,
  type ImportSpecifierStructure,
  type SourceFile,
} from "ts-morph";

import {
  bundledCorePackageVersion,
  isMigrationManifestActive,
  loadMigrationManifestsForProject,
  migrationMoveStatus,
  resolveMigrationSymbolMove,
  type MigrationManifest,
  type MigrationMove,
} from "../package-lifecycle/migration-manifest.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface MigrationCodemodFileChange {
  file: string;
  before: string;
  after: string;
}

export interface MigrationCodemodResult {
  changes: MigrationCodemodFileChange[];
  dependencyFiles: string[];
  warnings: string[];
}

export interface RunMigrationCodemodsOptions {
  root: string;
  manifests?: MigrationManifest[];
  apply?: boolean;
  targetExists?: (specifier: string) => boolean;
}

interface PendingDependency {
  packageFile: string;
  packageName: string;
}

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (
        SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function mergeManifestMoves(
  manifests: MigrationManifest[],
): Record<string, MigrationMove> {
  const moves: Record<string, MigrationMove> = {};
  for (const manifest of manifests) {
    Object.assign(moves, manifest.moves);
  }
  return moves;
}

export function loadMigrationManifests(
  projectRoot: string,
): MigrationManifest[] {
  const packageVersion = bundledCorePackageVersion();
  return loadMigrationManifestsForProject(projectRoot).filter((manifest) =>
    isMigrationManifestActive(manifest, packageVersion),
  );
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  const [name] = specifier.split("/");
  return name && !name.startsWith(".") ? name : null;
}

function nearestPackageFile(file: string, root: string): string | null {
  let directory = path.dirname(file);
  const boundary = path.resolve(root);
  while (directory.startsWith(boundary)) {
    const packageFile = path.join(directory, "package.json");
    if (fs.existsSync(packageFile)) return packageFile;
    if (directory === boundary) break;
    directory = path.dirname(directory);
  }
  return null;
}

function recordIntroducedDependency(
  pending: PendingDependency[],
  sourceFile: string,
  root: string,
  from: string,
  to: string,
): void {
  const fromPackage = packageNameFromSpecifier(from);
  const toPackage = packageNameFromSpecifier(to);
  if (!toPackage || toPackage === fromPackage) return;
  const packageFile = nearestPackageFile(sourceFile, root);
  if (!packageFile) return;
  if (
    !pending.some(
      (entry) =>
        entry.packageFile === packageFile && entry.packageName === toPackage,
    )
  ) {
    pending.push({ packageFile, packageName: toPackage });
  }
}

function importedNameStructure(
  importedName: string,
  localName: string,
  nextName: string,
  typeOnly: boolean,
): ImportSpecifierStructure {
  return {
    name: nextName,
    alias:
      localName !== nextName
        ? localName
        : importedName !== nextName
          ? importedName
          : undefined,
    isTypeOnly: typeOnly,
  };
}

function warnSkippedTarget(
  warnings: string[],
  sourceFile: string,
  target: string,
  reason: "planned" | "unresolved",
): void {
  const message =
    reason === "planned"
      ? `${sourceFile}: migration to ${target} is planned but not active; no rewrite was applied`
      : `${sourceFile}: migration target ${target} is not exported by an installed package; no rewrite was applied`;
  if (!warnings.includes(message)) warnings.push(message);
}

function rewriteImportDeclaration(
  declaration: ImportDeclaration,
  move: MigrationMove,
  root: string,
  pendingDependencies: PendingDependency[],
  warnings: string[],
  targetExists: (specifier: string) => boolean,
): boolean {
  const originalSpecifier = declaration.getModuleSpecifierValue();
  const sourceFile = declaration.getSourceFile();
  const namedImports = declaration.getNamedImports();

  if (!move.symbols) {
    if (migrationMoveStatus(move) === "planned") {
      warnSkippedTarget(warnings, sourceFile.getFilePath(), move.to, "planned");
      return false;
    }
    if (!targetExists(move.to)) {
      warnSkippedTarget(
        warnings,
        sourceFile.getFilePath(),
        move.to,
        "unresolved",
      );
      return false;
    }
    declaration.setModuleSpecifier(move.to);
    recordIntroducedDependency(
      pendingDependencies,
      sourceFile.getFilePath(),
      root,
      originalSpecifier,
      move.to,
    );
    return originalSpecifier !== move.to;
  }

  if (namedImports.length === 0) {
    warnings.push(
      `${sourceFile.getFilePath()}: cannot split default, namespace, or side-effect import from ${originalSpecifier}`,
    );
    return false;
  }

  const groups = new Map<string, ImportSpecifierStructure[]>();
  const movedImports = new Set<(typeof namedImports)[number]>();
  for (const namedImport of namedImports) {
    const importedName = namedImport.getName();
    const resolved = resolveMigrationSymbolMove(move, importedName);
    if (!resolved || resolved.to === originalSpecifier) continue;
    if (resolved.status === "planned") {
      warnSkippedTarget(
        warnings,
        sourceFile.getFilePath(),
        resolved.to,
        "planned",
      );
      continue;
    }
    if (!targetExists(resolved.to)) {
      warnSkippedTarget(
        warnings,
        sourceFile.getFilePath(),
        resolved.to,
        "unresolved",
      );
      continue;
    }
    const localName = namedImport.getAliasNode()?.getText() ?? importedName;
    const group = groups.get(resolved.to) ?? [];
    group.push(
      importedNameStructure(
        importedName,
        localName,
        resolved.name,
        !declaration.isTypeOnly() && namedImport.isTypeOnly(),
      ),
    );
    groups.set(resolved.to, group);
    movedImports.add(namedImport);
    recordIntroducedDependency(
      pendingDependencies,
      sourceFile.getFilePath(),
      root,
      originalSpecifier,
      resolved.to,
    );
  }
  if (groups.size === 0) return false;

  const declarationIndex = declaration.getChildIndex();
  for (const namedImport of movedImports) namedImport.remove();
  let offset = 1;
  for (const [target, imports] of groups) {
    sourceFile.insertImportDeclaration(declarationIndex + offset, {
      moduleSpecifier: target,
      isTypeOnly: declaration.isTypeOnly(),
      namedImports: imports,
    });
    offset += 1;
  }
  if (
    declaration.getNamedImports().length === 0 &&
    !declaration.getDefaultImport() &&
    !declaration.getNamespaceImport()
  ) {
    declaration.remove();
  }
  return true;
}

function rewriteExportDeclarations(
  sourceFile: SourceFile,
  moves: Record<string, MigrationMove>,
  root: string,
  pendingDependencies: PendingDependency[],
  warnings: string[],
  targetExists: (specifier: string) => boolean,
): void {
  for (const declaration of [...sourceFile.getExportDeclarations()]) {
    const originalSpecifier = declaration.getModuleSpecifierValue();
    if (!originalSpecifier) continue;
    const move = moves[originalSpecifier];
    if (!move) continue;
    const namedExports = declaration.getNamedExports();

    if (!move.symbols) {
      if (migrationMoveStatus(move) === "planned") {
        warnSkippedTarget(
          warnings,
          sourceFile.getFilePath(),
          move.to,
          "planned",
        );
        continue;
      }
      if (!targetExists(move.to)) {
        warnSkippedTarget(
          warnings,
          sourceFile.getFilePath(),
          move.to,
          "unresolved",
        );
        continue;
      }
      declaration.setModuleSpecifier(move.to);
      recordIntroducedDependency(
        pendingDependencies,
        sourceFile.getFilePath(),
        root,
        originalSpecifier,
        move.to,
      );
      continue;
    }
    if (namedExports.length === 0) {
      warnings.push(
        `${sourceFile.getFilePath()}: cannot split export star from ${originalSpecifier}`,
      );
      continue;
    }

    const groups = new Map<
      string,
      Array<{ name: string; alias?: string; isTypeOnly?: boolean }>
    >();
    const movedExports = new Set<(typeof namedExports)[number]>();
    for (const namedExport of namedExports) {
      const exportedFromName = namedExport.getName();
      const resolved = resolveMigrationSymbolMove(move, exportedFromName);
      if (!resolved || resolved.to === originalSpecifier) continue;
      if (resolved.status === "planned") {
        warnSkippedTarget(
          warnings,
          sourceFile.getFilePath(),
          resolved.to,
          "planned",
        );
        continue;
      }
      if (!targetExists(resolved.to)) {
        warnSkippedTarget(
          warnings,
          sourceFile.getFilePath(),
          resolved.to,
          "unresolved",
        );
        continue;
      }
      const publicName =
        namedExport.getAliasNode()?.getText() ?? exportedFromName;
      const group = groups.get(resolved.to) ?? [];
      group.push({
        name: resolved.name,
        alias:
          publicName !== resolved.name
            ? publicName
            : exportedFromName !== resolved.name
              ? exportedFromName
              : undefined,
        isTypeOnly:
          !declaration.isTypeOnly() && namedExport.isTypeOnly()
            ? true
            : undefined,
      });
      groups.set(resolved.to, group);
      movedExports.add(namedExport);
      recordIntroducedDependency(
        pendingDependencies,
        sourceFile.getFilePath(),
        root,
        originalSpecifier,
        resolved.to,
      );
    }
    if (groups.size === 0) continue;

    const declarationIndex = declaration.getChildIndex();
    for (const namedExport of movedExports) namedExport.remove();
    let offset = 1;
    for (const [target, exports] of groups) {
      sourceFile.insertExportDeclaration(declarationIndex + offset, {
        moduleSpecifier: target,
        isTypeOnly: declaration.isTypeOnly(),
        namedExports: exports,
      });
      offset += 1;
    }
    if (declaration.getNamedExports().length === 0) declaration.remove();
  }
}

function readPackageJson(packageFile: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(packageFile, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function addDependencies(
  pending: PendingDependency[],
  apply: boolean,
): MigrationCodemodFileChange[] {
  const changes: MigrationCodemodFileChange[] = [];
  const byFile = new Map<string, Set<string>>();
  for (const entry of pending) {
    const packages = byFile.get(entry.packageFile) ?? new Set<string>();
    packages.add(entry.packageName);
    byFile.set(entry.packageFile, packages);
  }
  for (const [packageFile, packageNames] of byFile) {
    const packageJson = readPackageJson(packageFile);
    if (!packageJson) continue;
    const allDependencySections = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];
    const missing = [...packageNames].filter(
      (packageName) =>
        !allDependencySections.some((section) => {
          const dependencies = packageJson[section];
          return (
            dependencies &&
            typeof dependencies === "object" &&
            packageName in dependencies
          );
        }),
    );
    if (missing.length === 0) continue;
    const before = `${JSON.stringify(packageJson, null, 2)}\n`;
    const dependencies =
      packageJson.dependencies && typeof packageJson.dependencies === "object"
        ? (packageJson.dependencies as Record<string, string>)
        : {};
    for (const packageName of missing.sort())
      dependencies[packageName] = "latest";
    packageJson.dependencies = Object.fromEntries(
      Object.entries(dependencies).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    const after = `${JSON.stringify(packageJson, null, 2)}\n`;
    changes.push({ file: packageFile, before, after });
    if (apply) fs.writeFileSync(packageFile, after);
  }
  return changes;
}

export function runMigrationCodemods(
  options: RunMigrationCodemodsOptions,
): MigrationCodemodResult {
  const root = path.resolve(options.root);
  const manifests = options.manifests ?? loadMigrationManifests(root);
  const moves = mergeManifestMoves(manifests);
  const requireFromProject = createRequire(path.join(root, "package.json"));
  const targetExists =
    options.targetExists ??
    ((specifier: string): boolean => {
      try {
        requireFromProject.resolve(specifier);
        return true;
      } catch {
        return false;
      }
    });
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: { quoteKind: QuoteKind.Double },
  });
  const sourceFiles = project.addSourceFilesAtPaths(collectSourceFiles(root));
  const pendingDependencies: PendingDependency[] = [];
  const warnings: string[] = [];
  const changes: MigrationCodemodFileChange[] = [];

  for (const sourceFile of sourceFiles) {
    const before = sourceFile.getFullText();
    for (const declaration of [...sourceFile.getImportDeclarations()]) {
      const move = moves[declaration.getModuleSpecifierValue()];
      if (!move) continue;
      rewriteImportDeclaration(
        declaration,
        move,
        root,
        pendingDependencies,
        warnings,
        targetExists,
      );
    }
    rewriteExportDeclarations(
      sourceFile,
      moves,
      root,
      pendingDependencies,
      warnings,
      targetExists,
    );
    const after = sourceFile.getFullText();
    if (before === after) continue;
    changes.push({ file: sourceFile.getFilePath(), before, after });
    if (options.apply) sourceFile.saveSync();
  }

  const dependencyChanges = addDependencies(
    pendingDependencies,
    Boolean(options.apply),
  );
  return {
    changes: [...changes, ...dependencyChanges],
    dependencyFiles: dependencyChanges.map((change) => change.file),
    warnings,
  };
}

function focusedDiff(change: MigrationCodemodFileChange, root: string): string {
  const beforeLines = change.before.split("\n");
  const afterLines = change.after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const beforeChanged = beforeLines.slice(prefix, beforeLines.length - suffix);
  const afterChanged = afterLines.slice(prefix, afterLines.length - suffix);
  return [
    `--- ${path.relative(root, change.file)}`,
    `+++ ${path.relative(root, change.file)}`,
    `@@ -${prefix + 1} +${prefix + 1} @@`,
    ...beforeChanged.map((line) => `-${line}`),
    ...afterChanged.map((line) => `+${line}`),
  ].join("\n");
}

export function formatMigrationCodemodDiff(
  result: MigrationCodemodResult,
  root: string,
): string {
  return result.changes
    .map((change) => focusedDiff(change, path.resolve(root)))
    .join("\n");
}
