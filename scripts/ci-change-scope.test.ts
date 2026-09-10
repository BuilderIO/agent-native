import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyChangedPaths,
  isDocsPath,
  isWorkspacePath,
  normalizeChangedPath,
  workspaceFiltersForPaths,
} from "./ci-change-scope.ts";

test("recognizes documentation surfaces and package metadata", () => {
  assert.equal(isDocsPath("packages/core/docs/content/actions.mdx"), true);
  assert.equal(isDocsPath("packages/docs/CHANGELOG.md"), true);
  assert.equal(isDocsPath("docs/environment-variables.md"), true);
  assert.equal(isDocsPath("templates/chat/README.md"), true);
  assert.equal(isDocsPath("packages/core/CHANGELOG.md"), true);
  assert.equal(isDocsPath(".changeset/docs-refresh.md"), true);
  assert.equal(isDocsPath("scripts/i18n-raw-literal-baseline.txt"), true);
  assert.equal(
    isDocsPath("scripts/i18n-localized-doc-coverage-baseline.txt"),
    true,
  );
});

test("does not treat implementation and instruction paths as docs-only", () => {
  assert.equal(isDocsPath("packages/core/src/index.ts"), false);
  assert.equal(isDocsPath("templates/chat/AGENTS.md"), false);
  assert.equal(isDocsPath(".agents/skills/qa/SKILL.md"), false);
  assert.equal(isDocsPath(".github/workflows/ci.yml"), false);
  assert.equal(isDocsPath("scripts/ci-test-lanes.ts"), false);
});

test("normalizes paths from git output", () => {
  assert.equal(
    normalizeChangedPath("./packages/docs/app/routes/docs.tsx"),
    "packages/docs/app/routes/docs.tsx",
  );
  assert.equal(
    normalizeChangedPath("packages\\docs\\README.md"),
    "packages/docs/README.md",
  );
});

test("fails closed for empty and unknown root change sets", () => {
  const empty = classifyChangedPaths([]);
  assert.equal(empty.docsOnly, false);
  assert.equal(empty.full, true);
  assert.equal(empty.checks.build, true);

  const unknown = classifyChangedPaths(["scripts/new-ci-tool.ts"]);
  assert.equal(unknown.docsOnly, false);
  assert.equal(unknown.full, true);
  for (const enabled of Object.values(unknown.checks)) {
    assert.equal(enabled, true);
  }
});

test("selects only docs checks for an all-docs change set", () => {
  const scope = classifyChangedPaths([
    "packages/core/docs/content/actions.mdx",
    "packages/docs/public/architecture.svg",
    "README.md",
  ]);

  assert.equal(scope.docsOnly, true);
  assert.equal(scope.full, false);
  assert.deepEqual(Object.values(scope.checks).filter(Boolean), []);
});

test("treats docs-app source and config as code, not documentation", () => {
  assert.equal(isDocsPath("packages/docs/app/routes/docs.$slug.tsx"), false);
  assert.equal(
    isDocsPath("packages/docs/server/routes/[...page].get.ts"),
    false,
  );
  assert.equal(isDocsPath("packages/docs/netlify.toml"), false);
  assert.equal(isDocsPath("packages/docs/react-router.config.ts"), false);
});

test("runs guards for a docs-app cache-header change", () => {
  // The docs static-cache headers live in this file. Classifying it as
  // documentation skipped every check, guards included, for 13 days.
  const scope = classifyChangedPaths(["packages/docs/netlify.toml"]);

  assert.equal(scope.docsOnly, false);
  assert.equal(scope.checks.guards, true);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.build, true);
});

test("selects dependency-aware checks for a template change", () => {
  const scope = classifyChangedPaths([
    "templates/calendar/app/components/EventCard.tsx",
  ]);

  assert.equal(scope.docsOnly, false);
  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, ["...{templates/calendar}..."]);
  assert.equal(scope.checks.lint, true);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.fast_tests, true);
  assert.equal(scope.checks.build, true);
  assert.equal(scope.checks.scaffold, true);
  assert.equal(scope.checks.trusted_acceptance, true);
  assert.equal(scope.checks.qa_static, true);
  assert.equal(scope.checks.core_integration, false);
  assert.equal(scope.checks.brain_evals, false);
});

test("runs shared coverage when core changes", () => {
  const scope = classifyChangedPaths(["packages/core/src/agent/engine/run.ts"]);

  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, ["...{packages/core}..."]);
  assert.equal(scope.checks.content, true);
  assert.equal(scope.checks.core_integration, true);
  assert.equal(scope.checks.plan_e2e, true);
  assert.equal(scope.checks.brain_evals, true);
  assert.equal(scope.checks.brain_privacy, true);
  assert.equal(scope.checks.scaffold, true);
  assert.equal(scope.checks.ssr_boot, true);
  assert.equal(scope.checks.trusted_acceptance, true);
});

test("keeps package metadata targeted but runs the drizzle guard", () => {
  const scope = classifyChangedPaths(["templates/calendar/package.json"]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.build, true);
  assert.equal(scope.checks.fast_tests, true);
  assert.equal(scope.checks.drizzle, true);
});

test("includes nested template workspaces in selectors", () => {
  assert.deepEqual(
    workspaceFiltersForPaths(["templates/clips/desktop/src/main.ts"]),
    ["...{templates/clips/desktop}..."],
  );
});

test("does not run code checks for a mixed docs-only package change", () => {
  const scope = classifyChangedPaths([
    "packages/core/CHANGELOG.md",
    "templates/chat/README.md",
  ]);

  assert.equal(scope.docsOnly, true);
  assert.equal(scope.full, false);
  assert.deepEqual(Object.values(scope.checks).filter(Boolean), []);
});
