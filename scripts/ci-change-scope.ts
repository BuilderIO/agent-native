import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEPLOY_GUIDE_PATHS } from "./qa-deploy-paths-lib.ts";

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
const RELATED_SCRIPT_TESTS = new Map([
  [
    "scripts/design-e2e-regression-pin-identities.ts",
    "scripts/design-e2e-regression-pin-identities.test.ts",
  ],
  [
    ".github/workflows/deploy-canary.yml",
    "scripts/deploy-alerts-workflow.test.ts",
  ],
]);
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
  "scripts/ci-change-scope.test.ts",
  "tsconfig.json",
  "vitest.shared.ts",
]);

const TEMPLATE_RUNTIME_ENTRYPOINTS = new Set([
  "agent-native.config.ts",
  "agent-native.json",
  "react-router.config.ts",
  "ssr-entry.ts",
  "vite.config.ts",
]);

const TEST_ONLY_PUBLIC_ASSETS = new Set([
  "templates/slides/public/visual-edit-structure-proof.html",
]);

const DESIGN_CANVAS_E2E_FILES = new Set([
  "templates/design/e2e/base-url.ts",
  "templates/design/e2e/corner-radius-handle-drag.spec.ts",
  "templates/design/e2e/cross-screen-auto-layout.spec.ts",
  "templates/design/e2e/drag-and-drop.auto-layout.spec.ts",
  "templates/design/e2e/drag-and-drop.reparenting-rules.spec.ts",
  "templates/design/e2e/drag-and-drop.shared.ts",
  "templates/design/e2e/drag-out-of-screen-to-board.spec.ts",
  "templates/design/e2e/global-setup.ts",
  "templates/design/e2e/global-teardown.ts",
  "templates/design/e2e/helpers.ts",
  "templates/design/e2e/interaction-drag-reparent.spec.ts",
  "templates/design/e2e/interaction-report-interactions.spec.ts",
  "templates/design/e2e/interaction-oversized-nested.spec.ts",
  "templates/design/e2e/interaction-alt-drag-duplicate.spec.ts",
  "templates/design/e2e/css-style-helpers.ts",
  "templates/design/e2e/z-order-behavior.spec.ts",
  "templates/design/e2e/interaction-vector-endpoints.spec.ts",
  "templates/design/e2e/responsive-overview-regressions.spec.ts",
  "templates/design/playwright.config.ts",
]);

const DESIGN_CANVAS_E2E_ROOT = "templates/design/e2e";
const DESIGN_CANVAS_E2E_SOURCE_RE = /\.[cm]?[jt]sx?$/u;
const DESIGN_CANVAS_E2E_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

type E2eSourceToken = {
  kind: "identifier" | "punctuation" | "string";
  value: string;
  uncertain?: boolean;
};

const DESIGN_CANVAS_PIN_ATTESTATION_FILES = new Set([
  "scripts/design-e2e-regression-pin-identities.ts",
  "scripts/design-e2e-regression-pins.ts",
  "scripts/guard-design-e2e-regression-pins.ts",
  "templates/design/e2e/retry-failure-reporter.ts",
]);

const DESIGN_CANVAS_CONFIG_FILES = new Set([
  "templates/design/agent-native.config.ts",
  "templates/design/agent-native.json",
  "templates/design/package.json",
  "templates/design/react-router.config.ts",
  "templates/design/vite.config.ts",
]);

const PRE_AUTH_SESSION_REPLAY_E2E_FILES = new Set([
  "packages/core/src/app-config/analytics.ts",
  "packages/core/src/client/analytics.ts",
  "packages/core/src/client/session-replay.ts",
  "packages/core/src/shared/environment-lanes.ts",
  "packages/core/src/server/analytics.ts",
  "packages/toolkit/src/app/auth/AuthPage.tsx",
  "packages/toolkit/src/app/auth/entry.tsx",
  "templates/analytics/server/handlers/session-replay.ts",
  "templates/analytics/server/lib/session-replay.ts",
  "templates/clips/server/plugins/config.ts",
  "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
  "templates/design/playwright.config.ts",
  "templates/design/server/plugins/config.ts",
  "templates/slides/server/plugins/config.ts",
]);

// The two-tab convergence lane also covers its own harness and the build it
// serves; other Content e2e specs and unit tests cannot move it.
const CONTENT_CONVERGENCE_FILES = new Set([
  "templates/content/agent-native.config.ts",
  "templates/content/agent-native.json",
  "templates/content/package.json",
  "templates/content/react-router.config.ts",
  "templates/content/ssr-entry.ts",
  "templates/content/vite.config.ts",
  "templates/content/e2e/convergence-summary.ts",
  "templates/content/e2e/global-setup.ts",
  "templates/content/e2e/helpers.ts",
  "templates/content/e2e/playwright.config.ts",
  "templates/content/e2e/two-tab-convergence.spec.ts",
]);

const CHECK_NAMES = [
  "lint",
  "typecheck",
  "fast_tests",
  "content",
  "content_convergence",
  "core_integration",
  "plan_e2e",
  "brain_evals",
  "build",
  "trusted_acceptance",
  "scaffold",
  "builder_code_starter_scaffold",
  "deploy_paths",
  "ssr_boot",
  "guards",
  "qa_static",
  "agentkit_acceptance",
  "neon_query_budget",
  "neon_connection_budget",
  "design_canvas_core_regression",
  "design_canvas_broad_workflows",
  "pre_auth_session_replay_e2e",
  "slides_chat_e2e",
  "slides_authoring_e2e",
  "slides_oracle",
  "changeset",
] as const;

const QUERY_BUDGET_UNRELATED_SCRIPTS = new Set([
  "scripts/agent-friction-report.mjs",
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

// These templates depend on @agent-native/creative-context at runtime.
const CREATIVE_CONTEXT_QUERY_BUDGET_APPS = [
  "analytics",
  "assets",
  "content",
  "design",
  "slides",
] as const satisfies readonly (typeof QUERY_BUDGET_APPS)[number][];

// The query budget splits its apps across this many jobs. Each job pays for
// its own checkout, install, and dist restore, so a third shard buys less.
export const QUERY_BUDGET_SHARD_COUNT = 2;

// Apps the SSR cold-start smoke builds and imports. Shared packages rebuild
// every one; a template change rebuilds only that template.
export const SSR_BOOT_APPS = ["content", "plan", "clips", "assets"] as const;

type CheckName = (typeof CHECK_NAMES)[number];

export type CheckSelection = Record<CheckName, boolean>;

export type ChangeScope = {
  changedPaths: string[];
  designCanvasE2eSpecs: string[];
  designCanvasE2eDiagnosticSpecs: string[];
  designCanvasE2eSpecCount: number;
  docsOnly: boolean;
  full: boolean;
  nonDocsPaths: string[];
  checks: CheckSelection;
  workspaceFilters: string[];
  testWorkspaceFilters: string[];
  scriptTests: string[];
  queryBudgetApps: string[];
  queryBudgetShards: QueryBudgetShard[];
  ssrBootApps: string[];
};

export type QueryBudgetShard = { shard: string; apps: string[] };

export function normalizeChangedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function runtimeSourceChangesInTestTitledPr(
  title: string,
  paths: readonly string[],
): string[] {
  if (!/^test(?:\([^)]+\))?!?:/iu.test(title.trim())) return [];

  return paths
    .map(normalizeChangedPath)
    .filter(
      (path) =>
        /^templates\/[^/]+\/(?:actions|app|server|shared|\.generated\/bridge)\//u.test(
          path,
        ) ||
        /^templates\/[^/]+\/public\//u.test(path) ||
        (path.split("/").length === 3 &&
          /^templates\/[^/]+\//u.test(path) &&
          TEMPLATE_RUNTIME_ENTRYPOINTS.has(
            path.slice(path.lastIndexOf("/") + 1),
          )) ||
        /^packages\/[^/]+\/src\//u.test(path),
    )
    .filter(
      (path) =>
        !/(?:^|\/)(?:__tests__|tests?|fixtures?|__fixtures__|__snapshots__|__mocks__)(?:\/|$)/u.test(
          path,
        ) &&
        !/\.(?:spec|test)(?:\.[^.]+)*$/u.test(path) &&
        !TEST_ONLY_PUBLIC_ASSETS.has(path) &&
        /\.(?:[cm]?[jt]sx?|css|html|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/iu.test(
          path,
        ),
    );
}

export function isDocsPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);

  if (normalized.startsWith(".changeset/")) return true;
  // Prototypes are standalone design artifacts (one HTML page each, published as Claude artifacts) that no
  // workspace imports, so no build, typecheck, or test can be affected by them; classing them as docs keeps a
  // prototype-only change off the full CI run that an unknown root path otherwise forces.
  if (normalized.startsWith("prototypes/")) return true;
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

// READMEs count as docs, but guard:readme-link-tags reads nothing else, so a
// README-only change set still has to reach the guards job.
function isReadmePath(path: string): boolean {
  return basename(normalizeChangedPath(path)) === "README.md";
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
    const relatedTest = RELATED_SCRIPT_TESTS.get(path);
    if (relatedTest && fileExists(relatedTest)) tests.add(relatedTest);
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

// The paths that can change which tests Vitest collects and how it modes them.
// The oracle ratchet reads those modes, so only these paths run its full pass.
export function isSlidesOraclePath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  if (normalized.startsWith("templates/slides/oracle/")) return true;
  if (
    normalized === "templates/slides/vitest.config.ts" ||
    normalized === "templates/slides/package.json" ||
    normalized === "packages/core/src/vitest-config.ts"
  ) {
    return true;
  }
  return (
    normalized.startsWith("templates/slides/") &&
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized)
  );
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

// The deploy-path check runs the commands these guides print, so an edit to a
// guide has to reach it even when the change is docs-only.
function isDeployGuidePath(path: string): boolean {
  return DEPLOY_GUIDE_PATHS.includes(normalizeChangedPath(path));
}

function isDesignCanvasE2eSpecPath(path: string): boolean {
  return (
    path.startsWith("templates/design/e2e/") &&
    path !== "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts" &&
    /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function isDesignCanvasE2eSupportPath(path: string): boolean {
  return (
    path.startsWith("templates/design/e2e/") &&
    DESIGN_CANVAS_E2E_SOURCE_EXTENSIONS.some((extension) =>
      path.endsWith(extension),
    ) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path) &&
    !DESIGN_CANVAS_PIN_ATTESTATION_FILES.has(path)
  );
}

function tokenizeE2eSource(source: string): {
  tokens: E2eSourceToken[];
  uncertain: boolean;
} {
  const tokens: E2eSourceToken[] = [];
  let index = 0;
  let uncertain = false;

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (character === "`" || character === "'" || character === '"') {
      const quote = character;
      index += 1;
      let value = "";
      let stringUncertain = false;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) {
          stringUncertain = true;
          value += source[index + 1];
          index += 2;
        } else {
          if (
            quote === "`" &&
            source[index] === "$" &&
            source[index + 1] === "{"
          ) {
            stringUncertain = true;
          }
          value += source[index];
          index += 1;
        }
      }
      const terminated = index < source.length;
      if (terminated) index += 1;
      else uncertain = true;
      tokens.push({
        kind: "string",
        value,
        uncertain: stringUncertain || !terminated,
      });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[\w$]/u.test(source[index])) index += 1;
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index),
      });
      continue;
    }
    tokens.push({ kind: "punctuation", value: character });
    index += 1;
  }

  return { tokens, uncertain };
}

function moduleSpecifiersInE2eSource(source: string): {
  specifiers: string[];
  uncertain: boolean;
} {
  const tokenization = tokenizeE2eSource(source);
  const tokens = tokenization.tokens;
  const specifiers = new Set<string>();
  let uncertain = tokenization.uncertain;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "identifier") continue;

    if (token.value === "require" && tokens[index + 1]?.value === "(") {
      const argument = tokens[index + 2];
      if (argument?.kind === "string" && tokens[index + 3]?.value === ")") {
        specifiers.add(argument.value);
        uncertain ||= Boolean(argument.uncertain);
      } else {
        uncertain = true;
      }
      continue;
    }

    if (token.value === "import") {
      const next = tokens[index + 1];
      if (next?.value === ".") continue;
      if (next?.value === "(") {
        const argument = tokens[index + 2];
        if (argument?.kind === "string" && tokens[index + 3]?.value === ")") {
          specifiers.add(argument.value);
          uncertain ||= Boolean(argument.uncertain);
        } else {
          uncertain = true;
        }
        continue;
      }
      if (next?.kind === "string") {
        specifiers.add(next.value);
        uncertain ||= Boolean(next.uncertain);
        continue;
      }
    } else if (token.value === "export") {
      let firstClauseToken = tokens[index + 1];
      if (firstClauseToken?.value === "type") {
        firstClauseToken = tokens[index + 2];
      }
      if (firstClauseToken?.value !== "*" && firstClauseToken?.value !== "{") {
        continue;
      }
    } else {
      continue;
    }

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (
        tokens[cursor].value === "from" &&
        tokens[cursor + 1]?.kind === "string"
      ) {
        specifiers.add(tokens[cursor + 1].value);
        uncertain ||= Boolean(tokens[cursor + 1].uncertain);
        break;
      }
    }
  }

  return { specifiers: [...specifiers], uncertain };
}

function designCanvasE2eSourcePaths(repositoryRoot: string): string[] {
  const root = join(repositoryRoot, DESIGN_CANVAS_E2E_ROOT);
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (
        entry.isFile() &&
        DESIGN_CANVAS_E2E_SOURCE_RE.test(entry.name)
      ) {
        paths.push(
          normalizeChangedPath(relative(repositoryRoot, absolutePath)),
        );
      }
    }
  };

  visit(root);
  return paths.sort();
}

function designCanvasE2ePathsFromGit(repositoryRoot: string): string[] {
  const output = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      DESIGN_CANVAS_E2E_ROOT,
    ],
    { encoding: "utf8", cwd: repositoryRoot },
  );
  return output
    .split("\n")
    .filter((path) => DESIGN_CANVAS_E2E_SOURCE_RE.test(path))
    .sort();
}

function relativeE2eImportTargets(
  importerPath: string,
  specifier: string,
  repositoryRoot: string,
  e2eSourcePaths: ReadonlySet<string>,
): string[] {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return [];

  const absoluteTarget = resolve(
    repositoryRoot,
    dirname(importerPath),
    specifier,
  );
  const baseTarget = normalizeChangedPath(
    relative(repositoryRoot, absoluteTarget),
  );
  if (baseTarget === ".." || baseTarget.startsWith("../")) return [];

  const extension = extname(baseTarget);
  let candidates: string[];
  if (extension) {
    const stem = baseTarget.slice(0, -extension.length);
    const typedAlternates =
      extension === ".js"
        ? [".ts", ".tsx", ".mts", ".cts"]
        : extension === ".jsx"
          ? [".tsx", ".ts"]
          : extension === ".mjs"
            ? [".mts", ".ts"]
            : extension === ".cjs"
              ? [".cts", ".ts"]
              : [];
    candidates = [
      baseTarget,
      ...typedAlternates.map((alternate) => `${stem}${alternate}`),
    ];
  } else {
    candidates = [
      ...DESIGN_CANVAS_E2E_SOURCE_EXTENSIONS.map(
        (candidateExtension) => `${baseTarget}${candidateExtension}`,
      ),
      ...DESIGN_CANVAS_E2E_SOURCE_EXTENSIONS.map((candidateExtension) =>
        join(baseTarget, `index${candidateExtension}`),
      ),
    ];
  }

  const existingCandidates = candidates.filter((candidate) =>
    e2eSourcePaths.has(candidate),
  );
  if (existingCandidates.length > 0) return [existingCandidates[0]];
  return candidates.filter((candidate) =>
    DESIGN_CANVAS_E2E_SOURCE_RE.test(candidate),
  );
}

export function designCanvasE2eSpecsForPaths(
  paths: readonly string[],
  repositoryRoot = process.cwd(),
): string[] {
  const changedPaths = paths.map(normalizeChangedPath);
  const directSpecs = changedPaths.filter(isDesignCanvasE2eSpecPath);
  const changedHelpers = changedPaths.filter(isDesignCanvasE2eSupportPath);
  if (changedHelpers.length === 0) return [...new Set(directSpecs)].sort();

  let sourcePaths: string[];
  try {
    sourcePaths = designCanvasE2eSourcePaths(repositoryRoot);
  } catch {
    sourcePaths = designCanvasE2ePathsFromGit(repositoryRoot);
  }
  const sourcePathSet = new Set(sourcePaths);
  const importersByPath = new Map<string, string[]>();
  const allEligibleSpecs = () => {
    let specs = sourcePaths.filter(isDesignCanvasE2eSpecPath);
    if (specs.length === 0) {
      specs = designCanvasE2ePathsFromGit(repositoryRoot).filter(
        isDesignCanvasE2eSpecPath,
      );
    }
    if (specs.length === 0) {
      throw new Error(
        "Cannot safely route Design E2E helper changes because no eligible specs were found.",
      );
    }
    return [...new Set([...directSpecs, ...specs])].sort();
  };
  let uncertainDependency = false;

  try {
    for (const sourcePath of sourcePaths) {
      const modules = moduleSpecifiersInE2eSource(
        readFileSync(join(repositoryRoot, sourcePath), "utf8"),
      );
      uncertainDependency ||= modules.uncertain;
      for (const specifier of modules.specifiers) {
        for (const importedPath of relativeE2eImportTargets(
          sourcePath,
          specifier,
          repositoryRoot,
          sourcePathSet,
        )) {
          const importers = importersByPath.get(importedPath) ?? [];
          importers.push(sourcePath);
          importersByPath.set(importedPath, importers);
        }
      }
    }
  } catch {
    // If a partial checkout prevents tracing imports, select every eligible spec found.
    return allEligibleSpecs();
  }

  const selectedSpecs = new Set(directSpecs);
  if (uncertainDependency) {
    return allEligibleSpecs();
  }

  for (const helperPath of changedHelpers) {
    const visited = new Set<string>([helperPath]);
    const pending = [helperPath];
    const consumers = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for (const importer of importersByPath.get(current) ?? []) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        if (isDesignCanvasE2eSpecPath(importer)) {
          consumers.add(importer);
        }
        pending.push(importer);
      }
    }

    if (consumers.size === 0) {
      for (const spec of allEligibleSpecs()) selectedSpecs.add(spec);
    } else {
      for (const spec of consumers) selectedSpecs.add(spec);
    }
  }

  return [...selectedSpecs].sort();
}

function isDesignDndRuntimePath(path: string): boolean {
  if (
    DESIGN_CANVAS_E2E_FILES.has(path) ||
    DESIGN_CANVAS_CONFIG_FILES.has(path) ||
    isDesignCanvasE2eSpecPath(path) ||
    isDesignCanvasE2eSupportPath(path)
  ) {
    return true;
  }

  const designAppSource =
    path.startsWith("templates/design/app/") &&
    !path.startsWith("templates/design/app/i18n/") &&
    !path.startsWith("templates/design/app/assets/") &&
    !/\/i18n-[^/]+\.ts$/u.test(path) &&
    /\.(?:[cm]?[jt]sx?|css)$/u.test(path);
  const designSharedRuntimeSource =
    (path.startsWith("templates/design/actions/") ||
      path.startsWith("templates/design/server/") ||
      path.startsWith("templates/design/shared/") ||
      path.startsWith("templates/design/.generated/bridge/")) &&
    /\.(?:[cm]?[jt]sx?)$/u.test(path);

  return designAppSource || designSharedRuntimeSource;
}

function isContentConvergenceRuntimePath(path: string): boolean {
  if (CONTENT_CONVERGENCE_FILES.has(path)) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;

  // Most Toolkit changes are chat and shell UI that cannot lose page text.
  const toolkitEditorSource =
    path.startsWith("packages/toolkit/src/editor/") ||
    path.startsWith("packages/toolkit/src/collab-ui/") ||
    path === "packages/toolkit/package.json";

  const contentAppSource =
    path.startsWith("templates/content/app/") &&
    !path.startsWith("templates/content/app/i18n/") &&
    !/\/i18n-[^/]+\.ts$/u.test(path) &&
    /\.(?:[cm]?[jt]sx?|css)$/u.test(path);
  const contentSharedRuntimeSource =
    (path.startsWith("templates/content/actions/") ||
      path.startsWith("templates/content/server/") ||
      path.startsWith("templates/content/shared/")) &&
    /\.(?:[cm]?[jt]sx?|json)$/u.test(path);

  return toolkitEditorSource || contentAppSource || contentSharedRuntimeSource;
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
  const selectedApps = new Set(changedQueryBudgetApps(changedPaths));
  if (hasPath(changedPaths, "packages/creative-context/")) {
    for (const app of CREATIVE_CONTEXT_QUERY_BUDGET_APPS) {
      selectedApps.add(app);
    }
  }
  return QUERY_BUDGET_APPS.filter((app) => selectedApps.has(app));
}

export function shardQueryBudgetApps(
  apps: readonly string[],
): QueryBudgetShard[] {
  const shards = Array.from(
    { length: Math.min(QUERY_BUDGET_SHARD_COUNT, apps.length) },
    () => [] as string[],
  );
  apps.forEach((app, index) => shards[index % shards.length].push(app));
  return shards.map((shardApps, index) => ({
    shard: `${index + 1}/${shards.length}`,
    apps: shardApps,
  }));
}

function ssrBootSharedPackageChanged(paths: readonly string[]): boolean {
  return [
    "packages/core/",
    "packages/otel/",
    "packages/toolkit/",
    "packages/recap-cli/",
    "packages/creative-context/",
    "packages/otel/",
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
  const readmeChanged = changedPaths.some(isReadmePath);
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
    hasPath(changedPaths, "packages/creative-context/") ||
    changedQueryBudgetApps(changedPaths).length > 0;
  const slidesE2eChanged =
    hasPath(changedPaths, "templates/slides/") ||
    coreChanged ||
    toolkitChanged ||
    hasPath(changedPaths, "packages/creative-context/");
  const slidesChatE2eChanged = slidesE2eChanged || agentkitChanged;
  const designCanvasInteractionE2eChanged =
    changedPaths.some(isDesignDndRuntimePath) ||
    coreChanged ||
    toolkitChanged ||
    agentkitChanged ||
    hasPath(changedPaths, "packages/creative-context/");
  const designCanvasPinAttestationChanged = changedPaths.some((path) =>
    DESIGN_CANVAS_PIN_ATTESTATION_FILES.has(path),
  );
  const preAuthSessionReplayE2eChanged = changedPaths.some((path) =>
    PRE_AUTH_SESSION_REPLAY_E2E_FILES.has(path),
  );
  const contentConvergenceChanged =
    changedPaths.some(isContentConvergenceRuntimePath) || coreChanged;

  return {
    lint: workspaceChanged || instructionsChanged || guardScriptsChanged,
    typecheck: workspaceChanged,
    fast_tests: workspaceChanged || instructionsChanged,
    content: contentChanged || coreChanged || schedulingChanged,
    content_convergence: contentConvergenceChanged,
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
    // The bundled Builder Code starter is a layer in core over templates/chat.
    builder_code_starter_scaffold: coreChanged || chatChanged,
    // Installs the packages a standalone Chat app depends on, so a change to
    // any of them can break a deploy path.
    deploy_paths:
      coreChanged ||
      toolkitChanged ||
      agentkitChanged ||
      sharedAppConfigChanged ||
      hasPath(changedPaths, "packages/otel/") ||
      hasPath(changedPaths, "packages/recap-cli/") ||
      chatChanged ||
      changedPaths.some(isDeployGuidePath),
    ssr_boot:
      ssrBootSharedPackageChanged(changedPaths) ||
      contentChanged ||
      planChanged ||
      clipsChanged ||
      assetsChanged,
    guards:
      workspaceChanged ||
      instructionsChanged ||
      guardScriptsChanged ||
      readmeChanged,
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
    design_canvas_core_regression:
      designCanvasInteractionE2eChanged || designCanvasPinAttestationChanged,
    design_canvas_broad_workflows: designCanvasInteractionE2eChanged,
    pre_auth_session_replay_e2e: preAuthSessionReplayE2eChanged,
    slides_chat_e2e: slidesChatE2eChanged,
    slides_authoring_e2e: slidesE2eChanged,
    slides_oracle: changedPaths.some(isSlidesOraclePath),
    changeset: changedPaths.some(isChangesetPath),
  };
}

export function classifyChangedPaths(
  paths: readonly string[],
  sameDirectoryPureDesignSpecRenames: readonly string[] = [],
  repositoryRoot = process.cwd(),
): ChangeScope {
  const changedPaths = paths.map(normalizeChangedPath);
  const nonDocsPaths = changedPaths.filter((path) => !isDocsPath(path));
  const sameDirectoryPureDesignSpecRenameSet = new Set(
    sameDirectoryPureDesignSpecRenames.map(normalizeChangedPath),
  );
  const docsOnly = changedPaths.length > 0 && nonDocsPaths.length === 0;
  const workspaceFilters = workspaceFiltersForPaths(changedPaths);
  const testWorkspaceFilters = testWorkspaceFiltersForPaths(changedPaths);
  const designCanvasE2eSpecs = designCanvasE2eSpecsForPaths(
    changedPaths,
    repositoryRoot,
  );
  const full =
    changedPaths.length === 0 ||
    changedPaths.some(isFullPath) ||
    (changedPaths.some(isWorkspacePath) && workspaceFilters.length === 0);

  const checks = docsOnly
    ? (Object.fromEntries(
        CHECK_NAMES.map((name) => [
          name,
          name === "lint" ||
            (name === "guards" && changedPaths.some(isReadmePath)) ||
            (name === "deploy_paths" && changedPaths.some(isDeployGuidePath)) ||
            (name === "changeset" && changedPaths.some(isChangesetPath)),
        ]),
      ) as CheckSelection)
    : buildChecks(changedPaths, full);
  const queryBudgetApps = queryBudgetAppsFor(changedPaths, full, checks);
  const changedDesignDiagnosticSpecs = designCanvasE2eSpecs.filter(
    (path) => !sameDirectoryPureDesignSpecRenameSet.has(path),
  );

  return {
    changedPaths,
    designCanvasE2eSpecs,
    designCanvasE2eDiagnosticSpecs: changedDesignDiagnosticSpecs,
    designCanvasE2eSpecCount: designCanvasE2eSpecs.length,
    docsOnly,
    full,
    nonDocsPaths,
    checks,
    workspaceFilters,
    testWorkspaceFilters,
    scriptTests: scriptTestsForPaths(changedPaths),
    queryBudgetApps,
    queryBudgetShards: shardQueryBudgetApps(queryBudgetApps),
    ssrBootApps: ssrBootAppsFor(changedPaths, full, checks),
  };
}

export function readChangedPaths(
  baseSha: string,
  headSha: string,
  cwd = process.cwd(),
): string[] {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${baseSha}...${headSha}`],
    {
      encoding: "utf8",
      cwd,
    },
  );
  return output.split("\0").filter(Boolean);
}

export function readSameDirectoryPureDesignSpecRenames(
  baseSha: string,
  headSha: string,
  cwd = process.cwd(),
): string[] {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--raw",
      "--no-abbrev",
      "--find-renames=100%",
      "-z",
      `${baseSha}...${headSha}`,
    ],
    {
      encoding: "utf8",
      cwd,
    },
  );
  const fields = output.split("\0");
  const renamedSpecs: string[] = [];

  for (let index = 0; index < fields.length - 1; ) {
    const header = fields[index++];
    const match =
      /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/u.exec(header);
    if (!match) {
      throw new Error(`Unexpected git diff --raw record: ${header}`);
    }

    const [, oldMode, newMode, oldBlob, newBlob, status, score] = match;
    const oldPath = fields[index++];
    if (oldPath === undefined || oldPath === "") {
      throw new Error("Missing old path in git diff --raw output");
    }
    if (status !== "R") continue;

    const newPath = fields[index++];
    if (newPath === undefined || newPath === "") {
      throw new Error("Missing new path in git diff --raw rename output");
    }

    const normalizedOldPath = normalizeChangedPath(oldPath);
    const normalizedNewPath = normalizeChangedPath(newPath);
    const oldDirectory = normalizedOldPath.slice(
      0,
      normalizedOldPath.lastIndexOf("/"),
    );
    const newDirectory = normalizedNewPath.slice(
      0,
      normalizedNewPath.lastIndexOf("/"),
    );

    if (
      score === "100" &&
      oldMode === newMode &&
      oldBlob === newBlob &&
      oldDirectory === newDirectory &&
      isDesignCanvasE2eSpecPath(normalizedOldPath) &&
      isDesignCanvasE2eSpecPath(normalizedNewPath)
    ) {
      renamedSpecs.push(normalizedNewPath);
    }
  }

  return renamedSpecs.sort();
}

function writeOutputs(scope: ChangeScope): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const lines = [
      `docs_only=${scope.docsOnly ? "true" : "false"}`,
      `full=${scope.full ? "true" : "false"}`,
      `changed_count=${scope.changedPaths.length}`,
      `design_canvas_e2e_specs=${JSON.stringify(scope.designCanvasE2eSpecs)}`,
      `design_canvas_e2e_diagnostic_specs=${JSON.stringify(scope.designCanvasE2eDiagnosticSpecs)}`,
      `workspace_filters=${JSON.stringify(scope.workspaceFilters)}`,
      `script_tests=${JSON.stringify(scope.scriptTests)}`,
      `query_budget_matrix=${JSON.stringify({ include: scope.queryBudgetShards })}`,
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
        `- Design E2E changed spec files: **${scope.designCanvasE2eSpecCount}**`,
        `- Design E2E diagnostic spec files: **${scope.designCanvasE2eDiagnosticSpecs.length}**`,
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

  const changedPaths = readChangedPaths(baseSha, headSha);
  const sameDirectoryPureDesignSpecRenames =
    readSameDirectoryPureDesignSpecRenames(baseSha, headSha);
  const runtimeSourceChanges = runtimeSourceChangesInTestTitledPr(
    process.env.CI_PR_TITLE ?? "",
    changedPaths,
  );
  if (runtimeSourceChanges.length > 0) {
    throw new Error(
      [
        'A "test:" PR title cannot include runtime source changes. Use a "fix:" or "feat:" title:',
        ...runtimeSourceChanges.map((path) => `- ${path}`),
      ].join("\n"),
    );
  }

  const scope = classifyChangedPaths(
    changedPaths,
    sameDirectoryPureDesignSpecRenames,
  );
  console.log(JSON.stringify(scope, null, 2));
  writeOutputs(scope);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
