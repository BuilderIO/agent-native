import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_PATH_PREFIXES = [
  "docs/",
  "packages/core/docs/",
  "packages/docs/",
] as const;

const DOCS_CONTENT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
]);

const DOCS_SUPPORT_PATHS = new Set([
  "scripts/i18n-catalog-english-value-baseline.txt",
  "scripts/i18n-localized-doc-coverage-baseline.txt",
  "scripts/i18n-localized-docs-baseline.txt",
  "scripts/i18n-no-translate-terms.txt",
  "scripts/i18n-raw-literal-baseline.txt",
]);

const COMMUNITY_TEMPLATES_ROOT = "community-templates";

// Agent instructions are inputs to core (bundled skills, prompt resources) and
// to the skills package, and several guards read them, so they are not docs.
const INSTRUCTION_MARKDOWN_RE = /^(?:\.agents\/.+|skills\/.+|[^/]+)\.md$/u;
const INSTRUCTION_WORKSPACE_FILTERS = [
  "@agent-native/core",
  "@agent-native/skills",
] as const;

// Root guard scripts, root script tests, and the function-size baseline are
// exercised by the guards job; no workspace build or test imports them.
const SCRIPT_TEST_RE = /^scripts\/.+\.(?:test|spec)\.(?:ts|mts|mjs|js)$/u;
const GUARD_SCRIPT_RE = /^scripts\/(?:lib\/)?guard-[^/]+\.(?:ts|mts|mjs|js)$/u;
const GUARD_SCOPE_FILES = new Set([
  "scripts/serverless-function-baseline.json",
]);

const CHANGESET_CHECK_FILES = new Set([
  "scripts/check-changeset.mjs",
  "scripts/guard-no-major-changeset.mjs",
]);

const FULL_CHECK_FILES = new Set([
  ".github/workflows/ci.yml",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/ci-change-scope.ts",
  "scripts/ci-change-scope.test.ts",
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
  "build",
  "trusted_acceptance",
  "scaffold",
  "ssr_boot",
  "guards",
  "qa_static",
  "agentkit_acceptance",
  "neon_query_budget",
  "neon_connection_budget",
  "changeset",
] as const;

const QUERY_BUDGET_UNRELATED_SCRIPTS = new Set([
  "scripts/agent-friction-report.mjs",
  "scripts/ci-change-scope.ts",
  "scripts/ci-change-scope.test.ts",
]);

// Every first-party template the cold-request query budget builds and
// measures. A template change measures only that template; anything the
// templates share measures all of them.
export const QUERY_BUDGET_APPS = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "crm",
  "design",
  "dispatch",
  "factory",
  "forms",
  "mail",
  "plan",
  "slides",
  "tasks",
] as const;

// Apps the SSR cold-start smoke builds and imports. Shared packages rebuild
// every one; a template change rebuilds only that template.
export const SSR_BOOT_APPS = ["content", "plan", "clips", "assets"] as const;

type CheckName = (typeof CHECK_NAMES)[number];

export type CheckSelection = Record<CheckName, boolean>;

export type ChangeScope = {
  changedPaths: string[];
  docsOnly: boolean;
  full: boolean;
  nonDocsPaths: string[];
  checks: CheckSelection;
  workspaceFilters: string[];
  testWorkspaceFilters: string[];
  scriptTests: string[];
  queryBudgetApps: string[];
  ssrBootApps: string[];
};

export function normalizeChangedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isDocsPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);

  if (normalized.startsWith(".changeset/")) return true;
  if (DOCS_SUPPORT_PATHS.has(normalized)) return true;
  if (DOCS_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return DOCS_CONTENT_EXTENSIONS.has(extname(normalized).toLowerCase());
  }

  const fileName = basename(normalized);
  return (
    /^(?:CHANGELOG|CONTRIBUTING|README)\.md$/u.test(fileName) ||
    /^packages\/[^/]+\/changelog(?:\/|$)/u.test(normalized)
  );
}

export function isInstructionPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return !isDocsPath(normalized) && INSTRUCTION_MARKDOWN_RE.test(normalized);
}

export function isGuardScopedScriptPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  if (normalized.startsWith("scripts/ci-")) return false;
  if (CHANGESET_CHECK_FILES.has(normalized)) return false;
  return (
    GUARD_SCOPE_FILES.has(normalized) ||
    SCRIPT_TEST_RE.test(normalized) ||
    GUARD_SCRIPT_RE.test(normalized)
  );
}

function isChangesetPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return (
    normalized.startsWith("packages/") ||
    normalized.startsWith(".changeset/") ||
    CHANGESET_CHECK_FILES.has(normalized)
  );
}

/** Changed root script tests plus the sibling test of each changed guard. */
export function scriptTestsForPaths(
  paths: readonly string[],
  fileExists: (path: string) => boolean = (path) =>
    existsSync(join(process.cwd(), path)),
): string[] {
  const tests = new Set<string>();
  for (const path of paths.map(normalizeChangedPath)) {
    if (SCRIPT_TEST_RE.test(path)) {
      if (fileExists(path)) tests.add(path);
      continue;
    }
    if (
      !isGuardScopedScriptPath(path) &&
      path !== "scripts/ci-change-scope.ts"
    ) {
      continue;
    }
    const stem = path.replace(/\.(?:ts|mts|mjs|js)$/u, "");
    for (const suffix of [".test.ts", ".test.mjs", ".spec.ts", ".spec.mjs"]) {
      if (fileExists(`${stem}${suffix}`)) tests.add(`${stem}${suffix}`);
    }
  }
  return [...tests].sort();
}

export function isWorkspacePath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return (
    normalized.startsWith("packages/") ||
    normalized.startsWith("templates/") ||
    normalized.startsWith(`${COMMUNITY_TEMPLATES_ROOT}/`)
  );
}

function workspaceRootForPath(path: string): string | undefined {
  const segments = normalizeChangedPath(path).split("/");
  const parent = segments[0];

  if (parent === "packages" && segments[1]) {
    return `${parent}/${segments[1]}`;
  }

  if (parent === COMMUNITY_TEMPLATES_ROOT && segments[1]) {
    const packageRoot = join(process.cwd(), parent, segments[1]);
    return segments.length > 2 || existsSync(join(packageRoot, "package.json"))
      ? `${parent}/${segments[1]}`
      : parent;
  }

  if (parent !== "templates" || !segments[1]) return undefined;

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

function workspaceRootsForPaths(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const root = workspaceRootForPath(path);
    if (root) roots.add(root);
  }

  return [...roots].sort();
}

function communityWorkspaceRoots(): string[] {
  const root = join(process.cwd(), COMMUNITY_TEMPLATES_ROOT);
  if (!existsSync(join(root, "package.json"))) return [];
  return [
    COMMUNITY_TEMPLATES_ROOT,
    ...readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(root, entry.name, "package.json")),
      )
      .map((entry) => `${COMMUNITY_TEMPLATES_ROOT}/${entry.name}`),
  ].sort();
}

function workspaceFiltersForRoots(
  roots: readonly string[],
  includeDependencies: boolean,
): string[] {
  const selectedCommunityRoots = new Set(
    roots.filter(
      (root) =>
        root === COMMUNITY_TEMPLATES_ROOT ||
        root.startsWith(`${COMMUNITY_TEMPLATES_ROOT}/`),
    ),
  );
  const selected = roots.map((root) =>
    selectedCommunityRoots.has(root)
      ? `./${root}`
      : `...{${root}}${includeDependencies ? "..." : ""}`,
  );
  const communityRoots = communityWorkspaceRoots();
  const excludedCommunityRoots =
    selectedCommunityRoots.size === 0
      ? [`!./${COMMUNITY_TEMPLATES_ROOT}/**`]
      : communityRoots
          .filter((root) => !selectedCommunityRoots.has(root))
          .map((root) => `!./${root}`);
  return [...selected, ...excludedCommunityRoots];
}

function workspaceFiltersForChangedPaths(
  paths: readonly string[],
  includeDependencies: boolean,
): string[] {
  const filters = workspaceFiltersForRoots(
    workspaceRootsForPaths(paths),
    includeDependencies,
  );
  if (paths.some(isInstructionPath)) {
    filters.push(...INSTRUCTION_WORKSPACE_FILTERS);
  }
  return filters;
}

export function workspaceFiltersForPaths(paths: readonly string[]): string[] {
  return workspaceFiltersForChangedPaths(paths, true);
}

export function testWorkspaceFiltersForPaths(
  paths: readonly string[],
): string[] {
  return workspaceFiltersForChangedPaths(paths, false);
}

function isFullPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);

  if (FULL_CHECK_FILES.has(normalized)) return true;
  if (normalized.startsWith(".github/")) return true;
  if (isInstructionPath(normalized) || isGuardScopedScriptPath(normalized)) {
    return false;
  }
  if (normalized.startsWith("scripts/") && !isDocsPath(normalized)) {
    return true;
  }

  return !isWorkspacePath(normalized) && !isDocsPath(normalized);
}

function hasPath(paths: readonly string[], prefix: string): boolean {
  return paths.some((path) => path.startsWith(prefix));
}

function isKnownQueryBudgetUnrelatedPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return (
    normalized === "AGENTS.md" ||
    normalized.startsWith(".agents/") ||
    QUERY_BUDGET_UNRELATED_SCRIPTS.has(normalized)
  );
}

function measuresEveryQueryBudgetApp(paths: readonly string[]): boolean {
  return (
    hasPath(paths, "packages/core/") ||
    hasPath(paths, "packages/creative-context/") ||
    hasPath(paths, "scripts/neon-query-budget")
  );
}

function changedQueryBudgetApps(paths: readonly string[]): string[] {
  return QUERY_BUDGET_APPS.filter((app) => hasPath(paths, `templates/${app}/`));
}

function queryBudgetAppsFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): string[] {
  if (!checks.neon_query_budget) return [];
  if (full || measuresEveryQueryBudgetApp(changedPaths)) {
    return [...QUERY_BUDGET_APPS];
  }
  return changedQueryBudgetApps(changedPaths);
}

function ssrBootSharedPackageChanged(paths: readonly string[]): boolean {
  return [
    "packages/core/",
    "packages/toolkit/",
    "packages/recap-cli/",
    "packages/creative-context/",
  ].some((prefix) => hasPath(paths, prefix));
}

function ssrBootAppsFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): string[] {
  if (!checks.ssr_boot) return [];
  if (full || ssrBootSharedPackageChanged(changedPaths)) {
    return [...SSR_BOOT_APPS];
  }
  return SSR_BOOT_APPS.filter((app) =>
    hasPath(changedPaths, `templates/${app}/`),
  );
}

function buildChecks(
  changedPaths: readonly string[],
  full: boolean,
): CheckSelection {
  if (full) {
    const checks = Object.fromEntries(
      CHECK_NAMES.map((name) => [name, true]),
    ) as CheckSelection;
    if (
      changedPaths.length > 0 &&
      changedPaths.every(isKnownQueryBudgetUnrelatedPath)
    ) {
      checks.neon_query_budget = false;
      checks.neon_connection_budget = false;
    }
    return checks;
  }

  const workspaceChanged = changedPaths.some(isWorkspacePath);
  const instructionsChanged = changedPaths.some(isInstructionPath);
  const guardScriptsChanged = changedPaths.some(isGuardScopedScriptPath);
  const coreChanged = hasPath(changedPaths, "packages/core/");
  const toolkitChanged = hasPath(changedPaths, "packages/toolkit/");
  const agentkitChanged = hasPath(changedPaths, "packages/agentkit/");
  const sharedAppConfigChanged = hasPath(
    changedPaths,
    "packages/shared-app-config/",
  );
  const chatChanged = hasPath(changedPaths, "templates/chat/");
  const schedulingChanged = hasPath(changedPaths, "packages/scheduling/");
  const dispatchChanged = hasPath(changedPaths, "packages/dispatch/");
  const contentChanged = hasPath(changedPaths, "templates/content/");
  const calendarChanged = hasPath(changedPaths, "templates/calendar/");
  const templateChanged = hasPath(changedPaths, "templates/");
  const planChanged = hasPath(changedPaths, "templates/plan/");
  const brainChanged = hasPath(changedPaths, "templates/brain/");
  const clipsChanged = hasPath(changedPaths, "templates/clips/");
  const assetsChanged = hasPath(changedPaths, "templates/assets/");
  const neonQueryBudgetChanged =
    measuresEveryQueryBudgetApp(changedPaths) ||
    changedQueryBudgetApps(changedPaths).length > 0;

  return {
    lint: workspaceChanged || instructionsChanged || guardScriptsChanged,
    typecheck: workspaceChanged,
    fast_tests: workspaceChanged || instructionsChanged,
    content: contentChanged || coreChanged || schedulingChanged,
    core_integration: coreChanged || toolkitChanged,
    plan_e2e: coreChanged || planChanged,
    brain_evals: coreChanged || brainChanged,
    build: workspaceChanged || instructionsChanged,
    trusted_acceptance:
      coreChanged || contentChanged || calendarChanged || dispatchChanged,
    scaffold:
      coreChanged ||
      dispatchChanged ||
      schedulingChanged ||
      chatChanged ||
      calendarChanged ||
      hasPath(changedPaths, "templates/dispatch/"),
    ssr_boot:
      ssrBootSharedPackageChanged(changedPaths) ||
      contentChanged ||
      planChanged ||
      clipsChanged ||
      assetsChanged,
    guards: workspaceChanged || instructionsChanged || guardScriptsChanged,
    qa_static: templateChanged,
    agentkit_acceptance:
      coreChanged ||
      toolkitChanged ||
      agentkitChanged ||
      sharedAppConfigChanged ||
      chatChanged,
    neon_query_budget: neonQueryBudgetChanged,
    // The probe imports only core's database client, so templates cannot
    // move it.
    neon_connection_budget: coreChanged,
    changeset: changedPaths.some(isChangesetPath),
  };
}

export function classifyChangedPaths(paths: readonly string[]): ChangeScope {
  const changedPaths = paths.map(normalizeChangedPath);
  const nonDocsPaths = changedPaths.filter((path) => !isDocsPath(path));
  const docsOnly = changedPaths.length > 0 && nonDocsPaths.length === 0;
  const workspaceFilters = workspaceFiltersForPaths(changedPaths);
  const testWorkspaceFilters = testWorkspaceFiltersForPaths(changedPaths);
  const full =
    changedPaths.length === 0 ||
    changedPaths.some(isFullPath) ||
    (changedPaths.some(isWorkspacePath) && workspaceFilters.length === 0);

  const checks = docsOnly
    ? (Object.fromEntries(
        CHECK_NAMES.map((name) => [
          name,
          name === "lint" ||
            (name === "changeset" && changedPaths.some(isChangesetPath)),
        ]),
      ) as CheckSelection)
    : buildChecks(changedPaths, full);

  return {
    changedPaths,
    docsOnly,
    full,
    nonDocsPaths,
    checks,
    workspaceFilters,
    testWorkspaceFilters,
    scriptTests: scriptTestsForPaths(changedPaths),
    queryBudgetApps: queryBudgetAppsFor(changedPaths, full, checks),
    ssrBootApps: ssrBootAppsFor(changedPaths, full, checks),
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
      `script_tests=${JSON.stringify(scope.scriptTests)}`,
      `query_budget_apps=${JSON.stringify(scope.queryBudgetApps)}`,
      `ssr_boot_apps=${JSON.stringify(scope.ssrBootApps)}`,
      `test_workspace_filters=${JSON.stringify(scope.testWorkspaceFilters)}`,
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
        `- Build selectors: **${scope.workspaceFilters.join(", ") || "none"}**`,
        `- Test/typecheck selectors: **${scope.testWorkspaceFilters.join(", ") || "none"}**`,
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
