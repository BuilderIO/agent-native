import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as ts from "typescript";

const CORE_ROOT = "packages/core";
// The 64th entry is `tw-animate-css`, required by the public CSS export at
// packages/core/src/styles/agent-native.css. Keep the dependency ratchet at
// the actual 64-package baseline; any further runtime dependency must be
// removed or explicitly budgeted.
const MAX_RUNTIME_DEPENDENCIES = 64;
const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const FORBIDDEN_PACKAGE_PREFIXES = [
  "@radix-ui/",
  "@assistant-ui/",
  "@codemirror/",
];
const FORBIDDEN_PACKAGES = [
  "@agent-native/toolkit",
  "@uiw/react-codemirror",
  "react-dom/server",
  "recharts",
  "shiki",
  "lowlight",
  "highlight.js",
  "prismjs",
  "react-syntax-highlighter",
];

type PackageJson = {
  name: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type ImportEdge = { specifier: string; line: number };

export type CoreReachabilityIssue = {
  kind: "forbidden" | "undeclared" | "unresolved" | "budget";
  exportKey?: string;
  chain: string[];
  message: string;
};

export type CoreReachabilityResult = {
  issues: CoreReachabilityIssue[];
  runtimeDependencyCount: number;
};

function isTypeOnlyImport(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return (
      !clause.name &&
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    );
  }

  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    !!clause &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

export function scanStaticImports(file: string, source: string): ImportEdge[] {
  const scriptKind =
    file.endsWith(".tsx") || file.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const edges: ImportEdge[] = [];
  const add = (specifier: ts.Expression): void => {
    if (!ts.isStringLiteralLike(specifier)) return;
    const { line } = parsed.getLineAndCharacterOfPosition(
      specifier.getStart(parsed),
    );
    edges.push({ specifier: specifier.text, line: line + 1 });
  };

  for (const statement of parsed.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      !isTypeOnlyImport(statement)
    ) {
      add(statement.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression
    ) {
      add(statement.moduleReference.expression);
    }
  }

  return edges;
}

function collectRuntimeTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectRuntimeTargets);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(
      ([condition]) => condition !== "types" && condition !== "typesVersions",
    )
    .flatMap(([, target]) => collectRuntimeTargets(target));
}

function packageSpecifier(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#")
  ) {
    return null;
  }
  if (specifier.startsWith("node:") || builtinModules.includes(specifier))
    return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? null);
}

function isForbidden(specifier: string): boolean {
  return (
    FORBIDDEN_PACKAGES.some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    ) ||
    FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  );
}

function resolveCodeFile(candidate: string): string | null {
  const extension = path.extname(candidate);
  const extensionless = extension
    ? candidate.slice(0, -extension.length)
    : candidate;
  const extensions = extension
    ? [extension, ...CODE_EXTENSIONS.filter((item) => item !== extension)]
    : CODE_EXTENSIONS;
  const files = [
    ...extensions.map((item) => `${extensionless}${item}`),
    ...extensions.map((item) => path.join(extensionless, `index${item}`)),
  ];
  return (
    files.find((file) => existsSync(file) && statSync(file).isFile()) ?? null
  );
}

function sourceForExportTarget(
  coreRoot: string,
  target: string,
): string | null {
  if (!target.startsWith("./")) return null;
  const packagePath = path.resolve(coreRoot, target);
  const relative = path
    .relative(coreRoot, packagePath)
    .split(path.sep)
    .join("/");
  if (relative.startsWith("src/")) return resolveCodeFile(packagePath);
  if (!relative.startsWith("dist/")) return null;
  const sourceRelative = relative.slice("dist/".length);
  const extension = path.extname(sourceRelative);
  if (!CODE_EXTENSIONS.includes(extension)) return null;
  return resolveCodeFile(path.join(coreRoot, "src", sourceRelative));
}

function isCodeTarget(target: string): boolean {
  return CODE_EXTENSIONS.includes(path.extname(target));
}

function coreExportKey(packageName: string, specifier: string): string | null {
  if (specifier === packageName) return ".";
  if (!specifier.startsWith(`${packageName}/`)) return null;
  return `./${specifier.slice(packageName.length + 1)}`;
}

function relativeFile(repoRoot: string, file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function findImports(
  repoRoot: string,
  entry: string,
  packageJson: PackageJson,
): CoreReachabilityIssue[] {
  const coreRoot = path.join(repoRoot, CORE_ROOT);
  const exports = packageJson.exports ?? {};
  const exportSources = new Map<string, string[]>();
  for (const [key, value] of Object.entries(exports)) {
    if (key.startsWith("./client")) continue;
    exportSources.set(key, [
      ...new Set(
        collectRuntimeTargets(value)
          .map((target) => sourceForExportTarget(coreRoot, target))
          .filter((item): item is string => !!item),
      ),
    ]);
  }

  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
  const issues: CoreReachabilityIssue[] = [];

  const visit = (
    exportKey: string,
    file: string,
    chain: string[],
    seen: Set<string>,
  ): void => {
    const absoluteFile = path.resolve(file);
    if (seen.has(absoluteFile)) return;
    seen.add(absoluteFile);
    const source = readFileSync(absoluteFile, "utf8");
    const current = relativeFile(repoRoot, absoluteFile);

    for (const edge of scanStaticImports(current, source)) {
      const specifier = edge.specifier;
      const edgeChain = [...chain, `${current}:${edge.line} --${specifier}-->`];
      const selfKey = coreExportKey(packageJson.name, specifier);
      if (selfKey) {
        const selfSources = exportSources.get(selfKey);
        if (!selfSources?.length) {
          issues.push({
            kind: "unresolved",
            exportKey,
            chain: edgeChain,
            message: `Core self-import ${specifier} has no resolvable runtime export entry`,
          });
          continue;
        }
        for (const selfSource of selfSources)
          visit(exportKey, selfSource, edgeChain, seen);
        continue;
      }

      if (specifier.startsWith(".")) {
        const resolved = resolveCodeFile(
          path.resolve(path.dirname(absoluteFile), specifier),
        );
        if (resolved) {
          visit(exportKey, resolved, edgeChain, seen);
          continue;
        }
        if (
          /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|ttf|otf|wasm|json)$/i.test(
            specifier,
          )
        ) {
          continue;
        }
        issues.push({
          kind: "unresolved",
          exportKey,
          chain: edgeChain,
          message: `Cannot resolve Core source import ${specifier}`,
        });
        continue;
      }

      if (specifier.startsWith("#")) {
        issues.push({
          kind: "unresolved",
          exportKey,
          chain: edgeChain,
          message: `Cannot resolve package import ${specifier}`,
        });
        continue;
      }

      if (isForbidden(specifier)) {
        issues.push({
          kind: "forbidden",
          exportKey,
          chain: edgeChain,
          message: `Forbidden package ${specifier} is reachable from Core export ${exportKey}`,
        });
        continue;
      }

      const packageName = packageSpecifier(specifier);
      if (packageName && !declared.has(packageName)) {
        issues.push({
          kind: "undeclared",
          exportKey,
          chain: edgeChain,
          message: `Undeclared package ${packageName} is imported by Core export ${exportKey}`,
        });
      }
    }
  };

  const entrySources = exportSources.get(entry);
  const entryTargets = collectRuntimeTargets(exports[entry]);
  if (!entrySources?.length) {
    if (
      entryTargets.length > 0 &&
      entryTargets.every((target) => !isCodeTarget(target))
    ) {
      return [];
    }
    return [
      {
        kind: "unresolved",
        exportKey: entry,
        chain: [`export ${JSON.stringify(entry)}`],
        message: `Core export ${entry} has no resolvable source entry (targets: ${entryTargets.join(", ") || "none"})`,
      },
    ];
  }

  for (const source of entrySources) {
    visit(
      entry,
      source,
      [`export ${JSON.stringify(entry)}: ${relativeFile(repoRoot, source)}`],
      new Set(),
    );
  }
  return issues;
}

export function auditCorePackage(
  repoRoot: string,
  maxRuntimeDependencies = MAX_RUNTIME_DEPENDENCIES,
  includeReachability = true,
): CoreReachabilityResult {
  const coreRoot = path.join(repoRoot, CORE_ROOT);
  const packageJson = JSON.parse(
    readFileSync(path.join(coreRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const runtimeDependencyCount =
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.optionalDependencies ?? {}).length;
  const issues: CoreReachabilityIssue[] = [];
  if (runtimeDependencyCount > maxRuntimeDependencies) {
    issues.push({
      kind: "budget",
      chain: [],
      message: `Core has ${runtimeDependencyCount} dependencies + optionalDependencies; ratchet is ${maxRuntimeDependencies}`,
    });
  }

  if (includeReachability) {
    for (const key of Object.keys(packageJson.exports ?? {})) {
      if (key.startsWith("./client")) continue;
      issues.push(...findImports(repoRoot, key, packageJson));
    }
  }
  return { issues, runtimeDependencyCount };
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const budgetOnly = process.argv.includes("--budget-only");
  const result = auditCorePackage(
    repoRoot,
    MAX_RUNTIME_DEPENDENCIES,
    !budgetOnly,
  );
  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      const chain = issue.chain.length ? `\n  ${issue.chain.join("\n  ")}` : "";
      console.error(
        `[guard:core-package-reachability] ${issue.message}${chain}`,
      );
    }
    process.exitCode = result.issues.some(
      (issue) => issue.kind === "unresolved",
    )
      ? 2
      : 1;
    return;
  }
  console.log(
    `[guard:${budgetOnly ? "core-package-dependency-budget" : "core-package-reachability"}] clean (${result.runtimeDependencyCount} dependencies + optionalDependencies; peers excluded)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
