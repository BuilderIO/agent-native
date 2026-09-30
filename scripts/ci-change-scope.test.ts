import assert from "node:assert/strict";
import test from "node:test";

import {
  QUERY_BUDGET_APPS,
  SSR_BOOT_APPS,
  classifyChangedPaths,
  shardQueryBudgetApps,
  isDocsPath,
  isGuardScopedScriptPath,
  isInstructionPath,
  isWorkspacePath,
  normalizeChangedPath,
  scriptTestsForPaths,
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
  assert.equal(
    isWorkspacePath("community-templates/demo-clip-library/src/index.ts"),
    true,
  );
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
  assert.deepEqual(
    Object.entries(scope.checks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    ["lint", "changeset"],
  );
});

test("keeps the format check on for a docs-only change set", () => {
  const scope = classifyChangedPaths([
    "packages/core/docs/content/integrations.mdx",
    "docs/plans/2026-09-04-booking-host-working-hours-status.md",
  ]);
  assert.equal(scope.docsOnly, true);
  assert.equal(scope.checks.lint, true);
  assert.equal(scope.checks.typecheck, false);
  assert.equal(scope.checks.build, false);
  assert.equal(scope.checks.fast_tests, false);
  assert.equal(scope.checks.guards, false);
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
  const scope = classifyChangedPaths(["packages/docs/netlify.toml"]);

  assert.equal(scope.docsOnly, false);
  assert.equal(scope.checks.guards, true);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.build, true);
});

test("runs cold-request query budgets for framework and template changes", () => {
  const core = classifyChangedPaths(["packages/core/src/db/client.ts"]);
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const docs = classifyChangedPaths(["docs/guide.md"]);

  assert.equal(core.checks.neon_query_budget, true);
  assert.equal(template.checks.neon_query_budget, true);
  assert.equal(docs.checks.neon_query_budget, false);
});

test("measures only the changed templates for a template-only change", () => {
  const scope = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
    "templates/mail/app/routes/inbox.tsx",
  ]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.neon_query_budget, true);
  assert.deepEqual(scope.queryBudgetApps, ["forms", "mail"]);
});

test("measures every template for Core and budget changes, and Creative Context consumers", () => {
  const core = classifyChangedPaths([
    "packages/core/src/db/client.ts",
    "templates/forms/actions/list-forms.ts",
  ]);
  const creativeContext = classifyChangedPaths([
    "packages/creative-context/src/jobs/server-worker.ts",
  ]);
  const budget = classifyChangedPaths(["scripts/neon-query-budgets.json"]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);

  assert.deepEqual(core.queryBudgetApps, [...QUERY_BUDGET_APPS]);
  assert.equal(creativeContext.checks.neon_query_budget, true);
  assert.deepEqual(creativeContext.queryBudgetApps, [
    "analytics",
    "assets",
    "content",
    "design",
    "slides",
  ]);
  assert.equal(budget.checks.neon_query_budget, true);
  assert.deepEqual(budget.queryBudgetApps, [...QUERY_BUDGET_APPS]);
  assert.equal(full.full, true);
  assert.deepEqual(full.queryBudgetApps, [...QUERY_BUDGET_APPS]);
});

test("splits every query budget template across two shards", () => {
  const scope = classifyChangedPaths(["packages/core/src/db/client.ts"]);

  assert.deepEqual(
    scope.queryBudgetShards.map((shard) => shard.shard),
    ["1/2", "2/2"],
  );
  const [first, second] = scope.queryBudgetShards.map((shard) => shard.apps);
  assert.ok(Math.abs(first.length - second.length) <= 1);
  assert.deepEqual([...first, ...second].sort(), [...QUERY_BUDGET_APPS].sort());
});

test("runs one query budget job for a one-template change and none when off", () => {
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const docs = classifyChangedPaths(["docs/guide.md"]);

  assert.deepEqual(template.queryBudgetShards, [
    { shard: "1/1", apps: ["forms"] },
  ]);
  assert.deepEqual(docs.queryBudgetShards, []);
  assert.deepEqual(shardQueryBudgetApps([]), []);
});

test("skips the query budget for a template it does not measure", () => {
  const scope = classifyChangedPaths(["templates/videos/package.json"]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.neon_query_budget, false);
  assert.deepEqual(scope.queryBudgetApps, []);
});

test("selects no query budget templates when the check is off", () => {
  const docs = classifyChangedPaths(["docs/guide.md"]);
  const tooling = classifyChangedPaths(["AGENTS.md"]);

  assert.deepEqual(docs.queryBudgetApps, []);
  assert.deepEqual(tooling.queryBudgetApps, []);
});

test("skips cold-request query budgets for full tooling and instruction changes", () => {
  const scope = classifyChangedPaths([
    "scripts/agent-friction-report.mjs",
    "AGENTS.md",
    ".agents/skills/review-latest-feedback/SKILL.md",
  ]);

  assert.equal(scope.full, true);
  assert.equal(scope.checks.fast_tests, true);
  assert.equal(scope.checks.neon_query_budget, false);
});

test("runs the connection budget only for core changes", () => {
  const core = classifyChangedPaths(["packages/core/src/db/client.ts"]);
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  const tooling = classifyChangedPaths([
    "scripts/agent-friction-report.mjs",
    "AGENTS.md",
  ]);

  assert.equal(core.checks.neon_connection_budget, true);
  assert.equal(template.checks.neon_query_budget, true);
  assert.equal(template.checks.neon_connection_budget, false);
  assert.equal(full.checks.neon_connection_budget, true);
  assert.equal(tooling.full, true);
  assert.equal(tooling.checks.neon_connection_budget, false);
});

test("smokes only the changed SSR templates for a template-only change", () => {
  const scope = classifyChangedPaths([
    "templates/clips/app/routes/index.tsx",
    "templates/forms/actions/list-forms.ts",
  ]);
  const unsmoked = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.ssr_boot, true);
  assert.deepEqual(scope.ssrBootApps, ["clips"]);
  assert.equal(unsmoked.checks.ssr_boot, false);
  assert.deepEqual(unsmoked.ssrBootApps, []);
});

test("smokes every SSR template when a shared package or CI changes", () => {
  const toolkit = classifyChangedPaths([
    "packages/toolkit/src/index.ts",
    "templates/plan/app/root.tsx",
  ]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);

  assert.deepEqual(toolkit.ssrBootApps, [...SSR_BOOT_APPS]);
  assert.equal(full.full, true);
  assert.deepEqual(full.ssrBootApps, [...SSR_BOOT_APPS]);
});

test("keeps build dependencies while tests follow changed-package dependents", () => {
  const scope = classifyChangedPaths([
    "templates/calendar/app/components/EventCard.tsx",
  ]);

  assert.equal(scope.docsOnly, false);
  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, [
    "...{templates/calendar}...",
    "!./community-templates/**",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters, [
    "...{templates/calendar}",
    "!./community-templates/**",
  ]);
  assert.equal(scope.checks.lint, true);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.fast_tests, true);
  assert.equal(scope.checks.build, true);
  assert.equal(scope.checks.scaffold, true);
  assert.equal(scope.checks.trusted_acceptance, true);
  assert.equal(scope.checks.agentkit_acceptance, false);
  assert.equal(scope.checks.qa_static, true);
  assert.equal(scope.checks.core_integration, false);
  assert.equal(scope.checks.brain_evals, false);
});

test("does not select Design dependencies for test or typecheck", () => {
  const scope = classifyChangedPaths([
    "templates/design/app/components/Canvas.tsx",
  ]);

  assert.deepEqual(scope.workspaceFilters, [
    "...{templates/design}...",
    "!./community-templates/**",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters, [
    "...{templates/design}",
    "!./community-templates/**",
  ]);
});

test("runs shared coverage when core changes", () => {
  const scope = classifyChangedPaths(["packages/core/src/agent/engine/run.ts"]);

  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, [
    "...{packages/core}...",
    "!./community-templates/**",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters, [
    "...{packages/core}",
    "!./community-templates/**",
  ]);
  assert.equal(scope.checks.content, true);
  assert.equal(scope.checks.core_integration, true);
  assert.equal(scope.checks.plan_e2e, true);
  assert.equal(scope.checks.brain_evals, true);
  assert.equal(scope.checks.scaffold, true);
  assert.equal(scope.checks.ssr_boot, true);
  assert.equal(scope.checks.trusted_acceptance, true);
  assert.equal(scope.checks.agentkit_acceptance, true);
});

test("selects standalone AgentKit acceptance only for its production surface", () => {
  for (const path of [
    "packages/agentkit/src/index.ts",
    "packages/agentkit/src/protocol/index.ts",
    "packages/agentkit/src/client/index.ts",
    "packages/agentkit/src/adapters/http.ts",
    "packages/agentkit/src/conformance/index.ts",
    "packages/agentkit/src/react/components.tsx",
    "packages/core/src/client/chat/agentkit-protocol.ts",
    "packages/toolkit/src/composer/PromptComposer.tsx",
    "packages/shared-app-config/templates.ts",
    "templates/chat/app/routes/_index.tsx",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.agentkit_acceptance,
      true,
      `${path} must select standalone AgentKit acceptance`,
    );
  }

  assert.equal(
    classifyChangedPaths(["templates/calendar/app/routes/index.tsx"]).checks
      .agentkit_acceptance,
    false,
  );
  assert.equal(
    classifyChangedPaths(["packages/dispatch/src/index.ts"]).checks
      .agentkit_acceptance,
    false,
  );
});

test("fails closed to AgentKit acceptance for unknown and empty scopes", () => {
  assert.equal(classifyChangedPaths([]).checks.agentkit_acceptance, true);
  assert.equal(
    classifyChangedPaths(["unknown-root-config.ts"]).checks.agentkit_acceptance,
    true,
  );
});

test("keeps package metadata targeted but runs the guards that scan it", () => {
  const scope = classifyChangedPaths(["templates/calendar/package.json"]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.build, true);
  assert.equal(scope.checks.fast_tests, true);
  // pnpm guards includes guard:no-drizzle-push.
  assert.equal(scope.checks.guards, true);
});

test("routes agent instructions to core and skills instead of the full suite", () => {
  for (const path of [
    ".agents/skills/qa/SKILL.md",
    "skills/an/SKILL.md",
    "AGENTS.md",
    "CLAUDE.md",
    "DEVELOPMENT.md",
  ]) {
    assert.equal(isInstructionPath(path), true, path);
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.full, false, path);
    assert.equal(scope.docsOnly, false, path);
    const instructionFilters = [
      "!./community-templates/**",
      "@agent-native/core",
      "@agent-native/skills",
    ];
    assert.deepEqual(scope.workspaceFilters, instructionFilters, path);
    assert.deepEqual(scope.testWorkspaceFilters, instructionFilters, path);
    assert.deepEqual(
      Object.entries(scope.checks)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      ["lint", "fast_tests", "build", "guards"],
      path,
    );
  }

  assert.equal(isInstructionPath("README.md"), false);
  assert.equal(isInstructionPath("templates/chat/AGENTS.md"), false);
  assert.equal(isInstructionPath(".agents/skills/qa/config.json"), false);
  assert.equal(classifyChangedPaths([".agents/plugin.json"]).full, true);
});

test("keeps workspace selectors when instructions change with a template", () => {
  const scope = classifyChangedPaths([
    ".agents/skills/qa/SKILL.md",
    "templates/calendar/app/root.tsx",
  ]);
  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, [
    "...{templates/calendar}...",
    "!./community-templates/**",
    "@agent-native/core",
    "@agent-native/skills",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters, [
    "...{templates/calendar}",
    "!./community-templates/**",
    "@agent-native/core",
    "@agent-native/skills",
  ]);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.qa_static, true);
});

test("runs guard scripts and root script tests in the guards job only", () => {
  for (const path of [
    "scripts/guard-no-drizzle-push.mjs",
    "scripts/guard-agentkit-stream-ownership.test.ts",
    "scripts/lib/guard-run-summary.ts",
    "scripts/neon-transfer-alert.spec.ts",
    "scripts/trusted-acceptance/controller.spec.ts",
    "scripts/serverless-function-baseline.json",
  ]) {
    assert.equal(isGuardScopedScriptPath(path), true, path);
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.full, false, path);
    assert.deepEqual(
      Object.entries(scope.checks)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      ["lint", "guards"],
      path,
    );
  }

  for (const path of [
    "scripts/ci-change-scope.test.ts",
    "scripts/ci-test-lanes.ts",
    "scripts/check-changeset.mjs",
    "scripts/guard-no-major-changeset.mjs",
    "scripts/run-guards.ts",
    "scripts/prebuild-workspace-packages.ts",
    "scripts/netlify-ignore-build.mjs",
  ]) {
    assert.equal(classifyChangedPaths([path]).full, true, path);
  }
});

test("resolves the root script tests a guard-scoped change must run", () => {
  const existing = new Set([
    "scripts/guard-a.test.ts",
    "scripts/guard-b.spec.mjs",
    "scripts/neon-transfer-alert.spec.ts",
  ]);
  assert.deepEqual(
    scriptTestsForPaths(
      [
        "scripts/guard-a.mjs",
        "scripts/guard-b.ts",
        "scripts/guard-c.mjs",
        "scripts/neon-transfer-alert.spec.ts",
        "scripts/deleted.test.ts",
        "packages/core/src/index.ts",
      ],
      (path) => existing.has(path),
    ),
    [
      "scripts/guard-a.test.ts",
      "scripts/guard-b.spec.mjs",
      "scripts/neon-transfer-alert.spec.ts",
    ],
  );
  assert.deepEqual(
    classifyChangedPaths(["scripts/new-tool.ts"]).scriptTests,
    [],
  );
});

test("still runs changed root script tests when the change set is full", () => {
  const scope = classifyChangedPaths([
    ".github/workflows/ci.yml",
    "scripts/package-release-workflow.test.ts",
    "scripts/guard-no-unbounded-table-reads.mjs",
  ]);
  assert.equal(scope.full, true);
  assert.equal(scope.checks.guards, true);
  assert.deepEqual(scope.scriptTests, [
    "scripts/guard-no-unbounded-table-reads.test.ts",
    "scripts/package-release-workflow.test.ts",
  ]);
});

test("runs the change-scope test when the selector or its test changes", () => {
  for (const path of [
    "scripts/ci-change-scope.ts",
    "scripts/ci-change-scope.test.ts",
  ]) {
    const scope = classifyChangedPaths([path]);

    assert.equal(scope.full, true, path);
    assert.deepEqual(scope.scriptTests, ["scripts/ci-change-scope.test.ts"]);
    if (path === "scripts/ci-change-scope.ts") {
      assert.equal(scope.checks.neon_query_budget, true);
      assert.deepEqual(scope.queryBudgetApps, [...QUERY_BUDGET_APPS]);
    }
  }
});

test("selects the changeset check for package, changeset, and checker changes", () => {
  assert.equal(
    classifyChangedPaths(["packages/core/src/index.ts"]).checks.changeset,
    true,
  );
  const changesetOnly = classifyChangedPaths([".changeset/new-feature.md"]);
  assert.equal(changesetOnly.docsOnly, true);
  assert.equal(changesetOnly.checks.lint, true);
  assert.equal(changesetOnly.checks.changeset, true);
  assert.equal(
    classifyChangedPaths(["packages/core/docs/content/actions.mdx"]).checks
      .changeset,
    true,
  );
  assert.equal(
    classifyChangedPaths(["scripts/guard-no-major-changeset.mjs"]).checks
      .changeset,
    true,
  );
  assert.equal(
    classifyChangedPaths(["templates/calendar/app/root.tsx"]).checks.changeset,
    false,
  );
  assert.equal(classifyChangedPaths(["docs/guide.md"]).checks.changeset, false);
});

test("includes nested template workspaces in selectors", () => {
  assert.deepEqual(
    workspaceFiltersForPaths(["templates/clips/desktop/src/main.ts"]),
    ["...{templates/clips/desktop}...", "!./community-templates/**"],
  );
});

test("keeps community template changes targeted to their workspace", () => {
  const scope = classifyChangedPaths([
    "community-templates/demo-clip-library/src/index.ts",
  ]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.typecheck, true);
  assert.equal(scope.checks.fast_tests, true);
  assert.equal(scope.checks.build, true);
  assert.deepEqual(scope.workspaceFilters.slice(0, 1), [
    "./community-templates/demo-clip-library",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters.slice(0, 1), [
    "./community-templates/demo-clip-library",
  ]);
  assert.ok(scope.workspaceFilters.includes("!./community-templates"));
  assert.ok(
    scope.workspaceFilters.includes("!./community-templates/account-tiering"),
  );
  assert.ok(
    !scope.workspaceFilters.includes(
      "!./community-templates/demo-clip-library",
    ),
  );
});

test("keeps mixed Core and community changes from selecting every community app", () => {
  const scope = classifyChangedPaths([
    "packages/core/src/index.ts",
    "community-templates/demo-clip-library/src/index.ts",
  ]);

  assert.equal(scope.full, false);
  assert.ok(scope.workspaceFilters.includes("...{packages/core}..."));
  assert.ok(
    scope.workspaceFilters.includes("./community-templates/demo-clip-library"),
  );
  assert.ok(scope.workspaceFilters.includes("!./community-templates"));
  assert.ok(
    scope.workspaceFilters.includes("!./community-templates/account-tiering"),
  );
  assert.ok(
    !scope.workspaceFilters.includes(
      "!./community-templates/demo-clip-library",
    ),
  );
});

test("selects the community root package when its manifest changes", () => {
  const scope = classifyChangedPaths(["community-templates/package.json"]);

  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters.slice(0, 1), [
    "./community-templates",
  ]);
  assert.ok(
    scope.workspaceFilters.includes("!./community-templates/demo-clip-library"),
  );
});

test("does not run code checks for a mixed docs-only package change", () => {
  const scope = classifyChangedPaths([
    "packages/core/CHANGELOG.md",
    "templates/chat/README.md",
  ]);

  assert.equal(scope.docsOnly, true);
  assert.equal(scope.full, false);
  assert.deepEqual(
    Object.entries(scope.checks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    ["lint", "changeset"],
  );
});
