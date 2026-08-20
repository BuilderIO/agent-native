import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_PATH_PREFIXES = [
  "docs/",
  "packages/core/docs/",
  "packages/docs/",
] as const;

const DOCS_SUPPORT_PATHS = new Set([
  "scripts/i18n-catalog-english-value-baseline.txt",
  "scripts/i18n-localized-doc-coverage-baseline.txt",
  "scripts/i18n-localized-docs-baseline.txt",
  "scripts/i18n-no-translate-terms.txt",
  "scripts/i18n-raw-literal-baseline.txt",
]);

const FULL_CHECK_FILES = new Set([
  ".github/workflows/ci.yml",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.shared.ts",
]);

const CHECK_NAMES = [
  "lint",
  "typecheck",
  "fast_tests",
  "content",
  "core_integration",
  "plan_e2e",
  "brain_evals",
  "brain_privacy",
  "build",
  "trusted_acceptance",
  "scaffold",
  "ssr_boot",
  "guards",
  "drizzle",
  "qa_static",
] as const;

type CheckName = (typeof CHECK_NAMES)[number];

export type CheckSelection = Record<CheckName, boolean>;

export type ChangeScope = {
  changedPaths: string[];
  docsOnly: boolean;
  full: boolean;
  nonDocsPaths: string[];
  checks: CheckSelection;
  workspaceFilters: string[];
};

export function normalizeChangedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isDocsPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);

  if (normalized.startsWith(".changeset/")) return true;
  if (DOCS_SUPPORT_PATHS.has(normalized)) return true;
  if (DOCS_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  const fileName = basename(normalized);
  return /^(?:CHANGELOG|CONTRIBUTING|README)\.md$/u.test(fileName);
}

export function isWorkspacePath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return (
    normalized.startsWith("examples/") ||
    normalized.startsWith("packages/") ||
    normalized.startsWith("templates/")
  );
}

function workspaceRootForPath(path: string): string | undefined {
  const segments = normalizeChangedPath(path).split("/");
  const parent = segments[0];

  if ((parent === "examples" || parent === "packages") && segments[1]) {
    return `${parent}/${segments[1]}`;
  }

  if (parent !== "templates" || !segments[1]) return undefined;
  if (segments[1] === ".retired" && segments[2]) {
    return `templates/.retired/${segments[2]}`;
  }

  const nested = segments[2];
  if (
    nested &&
    (nested === "chrome-extension" || nested === "desktop") &&
    existsSync(
      join(process.cwd(), "templates", segments[1], nested, "package.json"),
    )
  ) {
    return `templates/${segments[1]}/${nested}`;
  }

  return `templates/${segments[1]}`;
}

export function workspaceFiltersForPaths(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const root = workspaceRootForPath(path);
    if (root) roots.add(root);
  }

  // Include the changed workspace and both its dependency/dependent closure.
  // Explicit path selectors work in detached PR checkouts and do not rely on
  // pnpm discovering a Git base revision.
  return [...roots].sort().map((root) => `...{${root}}...`);
}

function isFullPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);

  if (FULL_CHECK_FILES.has(normalized)) return true;
  if (normalized.startsWith(".github/")) return true;
  if (normalized.startsWith("scripts/") && !isDocsPath(normalized)) {
    return true;
  }

  // Unknown repository-level files are dependencies of the whole CI graph.
  // Run everything when they change so a new root tool cannot bypass checks.
  return !isWorkspacePath(normalized) && !isDocsPath(normalized);
}

function hasPath(paths: readonly string[], prefix: string): boolean {
  return paths.some((path) => path.startsWith(prefix));
}

function buildChecks(
  changedPaths: readonly string[],
  full: boolean,
): CheckSelection {
  if (full) {
    return Object.fromEntries(
      CHECK_NAMES.map((name) => [name, true]),
    ) as CheckSelection;
  }

  const workspaceChanged = changedPaths.some(isWorkspacePath);
  const coreChanged = hasPath(changedPaths, "packages/core/");
  const toolkitChanged = hasPath(changedPaths, "packages/toolkit/");
  const schedulingChanged = hasPath(changedPaths, "packages/scheduling/");
  const dispatchChanged = hasPath(changedPaths, "packages/dispatch/");
  const contentChanged = hasPath(changedPaths, "templates/content/");
  const calendarChanged = hasPath(changedPaths, "templates/calendar/");
  const templateChanged = hasPath(changedPaths, "templates/");
  const planChanged = hasPath(changedPaths, "templates/plan/");
  const brainChanged = hasPath(changedPaths, "templates/brain/");
  const clipsChanged = hasPath(changedPaths, "templates/clips/");
  const assetsChanged = hasPath(changedPaths, "templates/assets/");
  const recapCliChanged = hasPath(changedPaths, "packages/recap-cli/");
  const creativeContextChanged = hasPath(
    changedPaths,
    "packages/creative-context/",
  );

  return {
    lint: workspaceChanged,
    typecheck: workspaceChanged,
    fast_tests: workspaceChanged,
    content: contentChanged || coreChanged || schedulingChanged,
    core_integration: coreChanged || toolkitChanged,
    plan_e2e: coreChanged || planChanged,
    brain_evals: coreChanged || brainChanged,
    brain_privacy: coreChanged || brainChanged,
    build: workspaceChanged,
    trusted_acceptance:
      coreChanged || contentChanged || calendarChanged || dispatchChanged,
    scaffold:
      coreChanged ||
      dispatchChanged ||
      schedulingChanged ||
      hasPath(changedPaths, "templates/chat/") ||
      calendarChanged ||
      hasPath(changedPaths, "templates/dispatch/"),
    ssr_boot:
      coreChanged ||
      toolkitChanged ||
      recapCliChanged ||
      creativeContextChanged ||
      contentChanged ||
      planChanged ||
      clipsChanged ||
      assetsChanged,
    guards: workspaceChanged,
    drizzle: changedPaths.some((path) => {
      const normalized = normalizeChangedPath(path);
      return (
        normalized === "netlify.toml" ||
        normalized.endsWith("/netlify.toml") ||
        normalized === "package.json" ||
        normalized.endsWith("/package.json")
      );
    }),
    qa_static: templateChanged,
  };
}

export function classifyChangedPaths(paths: readonly string[]): ChangeScope {
  const changedPaths = paths.map(normalizeChangedPath);
  const nonDocsPaths = changedPaths.filter((path) => !isDocsPath(path));
  const docsOnly = changedPaths.length > 0 && nonDocsPaths.length === 0;
  const workspaceFilters = workspaceFiltersForPaths(changedPaths);
  const full =
    changedPaths.length === 0 ||
    changedPaths.some(isFullPath) ||
    (changedPaths.some(isWorkspacePath) && workspaceFilters.length === 0);

  return {
    changedPaths,
    docsOnly,
    full,
    nonDocsPaths,
    checks: docsOnly
      ? (Object.fromEntries(
          CHECK_NAMES.map((name) => [name, false]),
        ) as CheckSelection)
      : buildChecks(changedPaths, full),
    workspaceFilters,
  };
}

export function readChangedPaths(baseSha: string, headSha: string): string[] {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${baseSha}...${headSha}`],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

function writeOutputs(scope: ChangeScope): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const lines = [
      `docs_only=${scope.docsOnly ? "true" : "false"}`,
      `full=${scope.full ? "true" : "false"}`,
      `changed_count=${scope.changedPaths.length}`,
      `workspace_filters=${JSON.stringify(scope.workspaceFilters)}`,
      ...Object.entries(scope.checks).map(
        ([name, enabled]) => `${name}=${enabled ? "true" : "false"}`,
      ),
    ];
    appendFileSync(outputPath, `${lines.join("\n")}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const selectedChecks = CHECK_NAMES.filter((name) => scope.checks[name]);
    const preview = scope.changedPaths.slice(0, 20);
    appendFileSync(
      summaryPath,
      [
        "## CI change scope",
        "",
        `- Changed paths: **${scope.changedPaths.length}**`,
        `- Docs-only change: **${scope.docsOnly ? "yes" : "no"}**`,
        `- Full fallback: **${scope.full ? "yes" : "no"}**`,
        `- Workspace selectors: **${scope.workspaceFilters.join(", ") || "none"}**`,
        `- Selected checks: **${selectedChecks.join(", ") || "docs"}**`,
        ...(preview.length > 0
          ? [
              "",
              "Changed path preview:",
              ...preview.map((path) => `- \`${path}\``),
            ]
          : []),
        ...(scope.changedPaths.length > preview.length
          ? ["", `_(showing first ${preview.length} paths)_`]
          : []),
        "",
      ].join("\n"),
    );
  }
}

function main(): void {
  const baseSha = process.env.CI_BASE_SHA;
  const headSha = process.env.CI_HEAD_SHA;
  if (!baseSha || !headSha) {
    throw new Error("CI_BASE_SHA and CI_HEAD_SHA are required");
  }

  const scope = classifyChangedPaths(readChangedPaths(baseSha, headSha));
  console.log(JSON.stringify(scope, null, 2));
  writeOutputs(scope);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
