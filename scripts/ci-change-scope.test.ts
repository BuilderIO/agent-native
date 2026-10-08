import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  runtimeSourceChangesInTestTitledPr,
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

test("rejects runtime changes hidden under a test-only PR title", () => {
  assert.deepEqual(
    runtimeSourceChangesInTestTitledPr("test: prove parity", [
      "templates/design/actions/generate-design.ts",
      "templates/design/app/pages/design-editor/editor-state.ts",
      "templates/design/server/plugins/core-routes.ts",
      "templates/design/shared/canvas-math.ts",
      "templates/design/.generated/bridge/editor-chrome.generated.ts",
      "packages/core/src/index.ts",
      "templates/design/ssr-entry.ts",
      "templates/design/agent-native.config.ts",
      "templates/design/agent-native.json",
      "templates/design/react-router.config.ts",
      "templates/design/vite.config.ts",
      "templates/design/public/logo.svg",
      "templates/design/app/pages/design-editor/editor-state.spec.ts",
      "templates/design/app/hooks/use-navigation-state.test.ts",
      "templates/design/scripts/visual-edit-runtime-proof.ts",
      "templates/slides/public/visual-edit-structure-proof.html",
    ]),
    [
      "templates/design/actions/generate-design.ts",
      "templates/design/app/pages/design-editor/editor-state.ts",
      "templates/design/server/plugins/core-routes.ts",
      "templates/design/shared/canvas-math.ts",
      "templates/design/.generated/bridge/editor-chrome.generated.ts",
      "packages/core/src/index.ts",
      "templates/design/ssr-entry.ts",
      "templates/design/agent-native.config.ts",
      "templates/design/agent-native.json",
      "templates/design/react-router.config.ts",
      "templates/design/vite.config.ts",
      "templates/design/public/logo.svg",
    ],
  );
  assert.deepEqual(
    runtimeSourceChangesInTestTitledPr("test(design)!: prove parity", [
      "templates/design/app/pages/design-editor/editor-state.ts",
    ]),
    ["templates/design/app/pages/design-editor/editor-state.ts"],
  );
  assert.deepEqual(
    runtimeSourceChangesInTestTitledPr("fix: correct editor state", [
      "templates/design/app/pages/design-editor/editor-state.ts",
    ]),
    [],
  );
});

test("passes the pull request title to the change-scope guard", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    workflow,
    /CI_PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/u,
  );
});

test("selects Slides caret CI for exact package roots and Creative Context", () => {
  const filtersFor = (path: string) =>
    JSON.stringify(workspaceFiltersForPaths([path]));
  const selectsRoot = (filters: string, root: string) =>
    filters.includes(`{${root}}`);

  assert.equal(
    selectsRoot(filtersFor("packages/core/src/index.ts"), "packages/core"),
    true,
  );
  assert.equal(
    selectsRoot(
      filtersFor("packages/core-corpus/src/index.ts"),
      "packages/core",
    ),
    false,
  );
  assert.equal(
    selectsRoot(
      filtersFor("packages/creative-context/src/index.ts"),
      "packages/creative-context",
    ),
    true,
  );
});

test("selects Slides caret and authoring E2E for their dependency closure", () => {
  for (const path of [
    "templates/slides/app/components/editor/Editor.tsx",
    "packages/core/src/index.ts",
    "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
    "packages/creative-context/src/index.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_chat_e2e, true, path);
    assert.equal(scope.checks.slides_authoring_e2e, true, path);
  }

  const agentkit = classifyChangedPaths([
    "packages/agentkit/src/client/index.ts",
  ]);
  assert.equal(agentkit.checks.slides_chat_e2e, true);
  assert.equal(agentkit.checks.slides_authoring_e2e, false);

  for (const path of [
    "templates/content/app/routes/index.tsx",
    "templates/chat/app/routes/index.tsx",
    "packages/core-corpus/src/index.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_chat_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  assert.equal(full.checks.slides_chat_e2e, true);
  assert.equal(full.checks.slides_authoring_e2e, true);
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
    "CONTRIBUTING.md",
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

test("runs the guards for a README-only change set", () => {
  for (const paths of [
    ["README.md"],
    ["packages/core/README.md", ".changeset/readme-link-tags.md"],
    ["templates/chat/README.md", "packages/core/CHANGELOG.md"],
  ]) {
    const scope = classifyChangedPaths(paths);

    assert.equal(scope.docsOnly, true, paths.join(", "));
    assert.equal(scope.full, false, paths.join(", "));
    assert.equal(scope.checks.guards, true, paths.join(", "));
    assert.equal(scope.checks.lint, true, paths.join(", "));
    assert.equal(scope.checks.typecheck, false, paths.join(", "));
    assert.equal(scope.checks.build, false, paths.join(", "));
    assert.equal(scope.checks.fast_tests, false, paths.join(", "));
  }

  assert.equal(
    classifyChangedPaths(["docs/guide.md", "CHANGELOG.md"]).checks.guards,
    false,
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
  const creativeContext = classifyChangedPaths([
    "packages/creative-context/src/jobs/server-worker.ts",
  ]);
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const docs = classifyChangedPaths(["docs/guide.md"]);

  assert.equal(core.checks.neon_query_budget, true);
  assert.equal(creativeContext.checks.neon_query_budget, true);
  assert.deepEqual(creativeContext.queryBudgetApps, [
    "analytics",
    "assets",
    "content",
    "design",
    "slides",
  ]);
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
  const otel = classifyChangedPaths(["packages/otel/src/index.ts"]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);

  assert.deepEqual(toolkit.ssrBootApps, [...SSR_BOOT_APPS]);
  assert.equal(otel.checks.ssr_boot, true);
  assert.deepEqual(otel.ssrBootApps, [...SSR_BOOT_APPS]);
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

test("selects focused Design canvas interaction acceptance for its runtime dependencies", () => {
  for (const path of [
    "templates/design/app/components/MultiScreenCanvas.tsx",
    "templates/design/shared/canvas-math.ts",
    "templates/design/shared/pen-path.ts",
    "templates/design/shared/responsive-frame-layout.ts",
    "templates/design/.generated/bridge/editor-chrome.generated.ts",
    "templates/design/actions/update-file.ts",
    "templates/design/server/handlers/design.ts",
    "templates/design/agent-native.config.ts",
    "templates/design/agent-native.json",
    "templates/design/package.json",
    "templates/design/react-router.config.ts",
    "templates/design/vite.config.ts",
    "templates/design/playwright.config.ts",
    "templates/design/e2e/base-url.ts",
    "templates/design/e2e/chrome-geometry.reference.ts",
    "templates/design/e2e/global-setup.ts",
    "templates/design/e2e/global-teardown.ts",
    "templates/design/e2e/drag-out-of-screen-to-board.spec.ts",
    "templates/design/e2e/parity-drag-reparent.spec.ts",
    "templates/design/e2e/parity-vector-endpoints.spec.ts",
    "templates/design/e2e/parity-report-interactions.spec.ts",
    "templates/design/e2e/parity-oversized-nested.spec.ts",
    "templates/design/e2e/parity-alt-drag-duplicate.spec.ts",
    "templates/design/e2e/parity-selection.spec.ts",
    "templates/design/e2e/z-order-parity.spec.ts",
    "templates/design/e2e/corner-radius-handle-drag.spec.ts",
    "templates/design/e2e/responsive-overview-regressions.spec.ts",
    "templates/design/e2e/helpers.ts",
    "templates/design/e2e/drag-and-drop.shared.ts",
    "templates/design/e2e/drag-and-drop.reparenting-rules.spec.ts",
    "templates/design/e2e/drag-and-drop.auto-layout-parity.spec.ts",
    "templates/design/e2e/cross-screen-auto-layout-parity.spec.ts",
    "packages/core/src/index.ts",
    "packages/toolkit/src/index.ts",
    "packages/creative-context/src/index.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.design_canvas_interaction_e2e,
      true,
      path,
    );
  }

  for (const path of [
    "templates/slides/app/components/Canvas.tsx",
    "templates/calendar/app/routes/index.tsx",
    "packages/dispatch/src/index.ts",
    "docs/guide.md",
    "templates/design/README.md",
    "templates/design/app/i18n/en-US.ts",
    "templates/design/app/i18n/index.ts",
    "templates/design/app/i18n-keyboard-shortcuts.ts",
    "templates/design/app/assets/icon.ts",
    "templates/design/public/favicon.svg",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.design_canvas_interaction_e2e,
      false,
      path,
    );
  }

  for (const path of [
    "templates/design/e2e/overview-wheel-zoom.spec.ts",
    "templates/design/e2e/position-alignment.spec.ts",
    "templates/design/e2e/drag-and-drop.drag-feedback.spec.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.design_canvas_interaction_e2e, true, path);
  }

  assert.deepEqual(
    classifyChangedPaths([
      "templates/design/e2e/position-alignment.spec.ts",
      "templates/design/e2e/inspector-styles.spec.ts",
      "templates/design/e2e/fixture.test.tsx",
      "templates/design/app/components/design/EditPanel.tsx",
    ]).designCanvasE2eSpecs,
    [
      "templates/design/e2e/fixture.test.tsx",
      "templates/design/e2e/inspector-styles.spec.ts",
      "templates/design/e2e/position-alignment.spec.ts",
    ],
  );

  assert.equal(
    classifyChangedPaths([".github/workflows/ci.yml"]).checks
      .design_canvas_interaction_e2e,
    true,
  );
  assert.equal(
    classifyChangedPaths(["docs/guide.md"]).checks
      .design_canvas_interaction_e2e,
    false,
  );
});

test("the Design interaction gate runs the bounded regression acceptance cases", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  const step = (name: string) => {
    const marker = `      - name: ${name}\n`;
    const start = workflow.indexOf(marker);
    assert.notEqual(start, -1, `missing workflow step: ${name}`);
    const next = workflow.indexOf("\n      - name: ", start + marker.length);
    return workflow.slice(start, next === -1 ? undefined : next);
  };
  const regressionCases = step("Run focused Design regression cases");
  const screenSelectionRegressions = step(
    "Run focused Screen selection history regressions",
  );
  assert.match(
    screenSelectionRegressions,
    /^        if: startsWith\(matrix\.shard, 'screen-history-'\)$/m,
    "Screen-selection regressions must run only on their dedicated shards",
  );
  assert.match(
    regressionCases,
    /^        if: \$\{\{ !startsWith\(matrix\.shard, 'screen-history-'\) \}\}$/m,
    "the focused regression selectors must not run on the Screen-history shard",
  );
  assert.ok(
    screenSelectionRegressions.includes(
      "E2E_RUN_ID: design-selection-history-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
    ),
    "each Screen-history shard needs isolated application state",
  );
  const screenHistoryShardSelectors = [
    ...screenSelectionRegressions.matchAll(
      /\s+(screen-history-\d)\)\s+grep='([^']+)'/g,
    ),
  ].map(([, shard, selectors]) => ({ shard, selectors: selectors.split("|") }));
  assert.deepEqual(
    screenHistoryShardSelectors.map(({ shard }) => shard),
    ["screen-history-1", "screen-history-2", "screen-history-3"],
    "Screen-history regressions must stay split across three shards",
  );
  assert.deepEqual(
    screenHistoryShardSelectors.map(({ selectors }) => selectors.length),
    [5, 5, 5],
    "Screen-history regressions must stay balanced across the three shards",
  );
  const screenHistoryCases = [
    "undo of a screen deletion remaps stale selection-history entries instead of restoring a dead screen id",
    "deleting a selected child layer keeps its owning Screen",
    "undo restores a child layer with its additive Screen selection",
    "marquee-selecting child elements after a Screen pick deletes only the elements",
    "undoing a canvas element click restores its explicit Screen target for Delete",
    "failed Screen deletion keeps the explicit Screen target for retry",
    "a newer layer selection survives failed Screen deletion settlement",
    "Shift-marquee adds a hit Screen to the existing Delete selection",
    "a newer Screen pick survives failed Screen deletion settlement",
    "a newer sidebar Screen selection survives failed Screen deletion settlement",
    "Select All Screens survives failed Screen deletion settlement",
    "marquee selection persists and deletes Screens after a prior layer selection",
    "deep-select marquee over a Screen deletes only the child",
    "Shift-marqueeing child layers preserves an explicit Screen elsewhere for Delete",
    "Shift-marquee reselecting an owner Screen makes Delete target the Screen",
  ];
  const screenHistorySpec = readFileSync(
    "templates/design/e2e/parity-selection-history-delete-screen.spec.ts",
    "utf8",
  );
  for (const title of screenHistoryCases) {
    assert.equal(
      screenHistorySpec.split(title).length - 1,
      1,
      `Screen-history case must exist exactly once in its source spec: ${title}`,
    );
  }
  const selectedScreenHistoryCases = screenHistoryShardSelectors.flatMap(
    ({ selectors }) => selectors,
  );
  assert.deepEqual(
    [...selectedScreenHistoryCases].sort(),
    [...screenHistoryCases].sort(),
    "Screen-history test selectors must cover every intended case once",
  );
  assert.deepEqual(
    [...regressionCases.matchAll(/--workers=(\d+)/g)].map(([, count]) =>
      Number(count),
    ),
    [1, 1],
  );
  const designJobStart = workflow.indexOf(
    "  design-canvas-interaction-acceptance:\n",
  );
  assert.notEqual(designJobStart, -1);
  const designJobEnd = workflow.indexOf("\n  fast-tests:", designJobStart);
  const designJob = workflow.slice(
    designJobStart,
    designJobEnd === -1 ? undefined : designJobEnd,
  );
  assert.ok(designJob.includes("needs: change-scope"));
  assert.ok(
    designJob.includes(
      "if: needs.change-scope.outputs.design_canvas_interaction_e2e == 'true'",
    ),
  );
  assert.match(
    designJob,
    /^\s+run: pnpm exec playwright install --only-shell chromium$/m,
    "Design shards must reuse the runner's browser libraries instead of reinstalling OS dependencies",
  );
  const jobTimeout = Number(
    designJob.match(/^    timeout-minutes: (\d+)$/m)?.[1],
  );
  const stepTimeout = Number(
    regressionCases.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  const screenHistoryStepTimeout = Number(
    screenSelectionRegressions.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  assert.ok(
    Number.isInteger(jobTimeout) && jobTimeout > 0 && jobTimeout < 10,
    `Design acceptance job must stop before ten minutes (got ${jobTimeout})`,
  );
  assert.ok(
    Number.isInteger(stepTimeout) &&
      stepTimeout <= 5 &&
      jobTimeout >= stepTimeout + 4,
    `focused Design tests need a five-minute cap and four minutes for setup (job ${jobTimeout}, step ${stepTimeout})`,
  );
  assert.ok(
    Number.isInteger(screenHistoryStepTimeout) &&
      screenHistoryStepTimeout <= 4 &&
      jobTimeout >= screenHistoryStepTimeout + 5,
    `Screen-history tests need a four-minute cap and five minutes for setup (job ${jobTimeout}, step ${screenHistoryStepTimeout})`,
  );
  assert.match(
    designJob,
    /shard:\s*\[\s*inspector-1,\s*inspector-2,\s*inspector-3,\s*inspector-4,\s*drag-1,\s*drag-2,\s*position-1,\s*position-2,\s*position-3,\s*changed-1,\s*changed-2,\s*changed-3,\s*changed-4,\s*changed-5,\s*changed-6,\s*screen-history-1,\s*screen-history-2,\s*screen-history-3,?\s*\]/,
  );
  const fixedLocations = (start: number, end: number) =>
    [
      ...regressionCases.slice(start, end).matchAll(/e2e\/[^ \n]+(?::\d+)?/g),
    ].map(([location]) => location);
  const shardStart = (name: string) =>
    regressionCases.indexOf(`            ${name})`);
  const inspectorOneStart = shardStart("inspector-1");
  const inspectorTwoStart = shardStart("inspector-2");
  const inspectorThreeStart = shardStart("inspector-3");
  const inspectorFourStart = shardStart("inspector-4");
  const dragOneStart = shardStart("drag-1");
  assert.ok(
    inspectorOneStart >= 0 &&
      inspectorTwoStart > inspectorOneStart &&
      inspectorThreeStart > inspectorTwoStart &&
      inspectorFourStart > inspectorThreeStart &&
      dragOneStart > inspectorFourStart,
  );
  assert.deepEqual(fixedLocations(inspectorOneStart, inspectorTwoStart), [
    "e2e/canvas-invariants.spec.ts:508",
    "e2e/canvas-invariants.spec.ts:1286",
    "e2e/inspector-styles.spec.ts:176",
    "e2e/inspector-styles.spec.ts:238",
    "e2e/inspector-styles.spec.ts:314",
  ]);
  assert.deepEqual(fixedLocations(inspectorTwoStart, inspectorThreeStart), [
    "e2e/canvas-invariants.spec.ts:383",
    "e2e/canvas-invariants.spec.ts:538",
    "e2e/inspector-styles.spec.ts:452",
    "e2e/inspector-styles.spec.ts:610",
    "e2e/inspector-styles.spec.ts:737",
  ]);
  assert.deepEqual(fixedLocations(inspectorFourStart, dragOneStart), [
    "e2e/canvas-invariants.spec.ts:553",
    "e2e/inspector-styles.spec.ts:541",
    "e2e/inspector-styles.spec.ts:667",
    "e2e/inspector-styles.spec.ts:798",
    "e2e/inspector-styles.spec.ts:426",
  ]);
  assert.deepEqual(fixedLocations(inspectorThreeStart, inspectorFourStart), [
    "e2e/canvas-invariants.spec.ts:1170",
    "e2e/canvas-invariants.spec.ts:1320",
    "e2e/inspector-styles.spec.ts:833",
    "e2e/inspector-styles.spec.ts:880",
    "e2e/inspector-styles.spec.ts:999",
  ]);
  const positionOneStart = shardStart("position-1");
  const positionTwoStart = shardStart("position-2");
  const positionThreeStart = shardStart("position-3");
  const fallbackStart = shardStart("*");
  assert.ok(
    positionOneStart >= 0 &&
      positionTwoStart > positionOneStart &&
      positionThreeStart > positionTwoStart &&
      fallbackStart > positionThreeStart,
  );
  assert.deepEqual(fixedLocations(positionOneStart, positionTwoStart), [
    "e2e/pasted-svg-image-inspector.spec.ts:656",
    "e2e/pasted-svg-image-inspector.spec.ts:693",
    "e2e/position-alignment.spec.ts:312",
    "e2e/position-alignment.spec.ts:431",
    "e2e/position-alignment.spec.ts:509",
  ]);
  assert.deepEqual(fixedLocations(positionTwoStart, positionThreeStart), [
    "e2e/position-alignment.spec.ts:292",
    "e2e/position-alignment.spec.ts:570",
    "e2e/position-alignment.spec.ts:615",
    "e2e/position-alignment.spec.ts:661",
  ]);
  assert.deepEqual(fixedLocations(positionThreeStart, fallbackStart), [
    "e2e/position-alignment.spec.ts:361",
    "e2e/position-alignment.spec.ts:708",
    "e2e/position-alignment.spec.ts:740",
    "e2e/position-alignment.spec.ts:780",
  ]);
  assert.ok(
    regressionCases.includes(
      "E2E_RUN_ID: design-dnd-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
    ),
  );
  assert.ok(
    regressionCases.includes(
      "DESIGN_CANVAS_E2E_SPECS: ${{ needs.change-scope.outputs.design_canvas_e2e_specs }}",
    ),
  );
  assert.ok(
    regressionCases.includes(
      'pnpm exec playwright test "${existing_changed_specs[@]}" --workers=1 --fully-parallel --shard="${changed_shard}/6"',
    ),
  );
  assert.ok(
    regressionCases.includes(
      "mapfile -d '' -t changed_specs < \"$changed_specs_file\"",
    ),
  );
  assert.ok(regressionCases.includes('if [[ -f "$spec" ]]; then'));
  const fastTestsJobStart = workflow.indexOf("  fast-tests:\n");
  assert.notEqual(fastTestsJobStart, -1, "missing fast-tests workflow job");
  const nextJobHeader = workflow
    .slice(fastTestsJobStart + 1)
    .match(/\n  [a-z][a-z0-9_-]*:\n/);
  const nextJobIndex = nextJobHeader?.index;
  const fastTestsJobEnd =
    nextJobIndex === undefined
      ? undefined
      : fastTestsJobStart + 1 + nextJobIndex;
  const fastTestsJob = workflow.slice(fastTestsJobStart, fastTestsJobEnd);
  assert.doesNotMatch(
    fastTestsJob,
    /\n  [a-z][a-z0-9_-]*:\n/,
    "fast-tests assertions must stop before the next top-level job",
  );
  const needsStart = fastTestsJob.indexOf("    needs:");
  const needsEnd = fastTestsJob.indexOf("    if:", needsStart);
  assert.ok(
    fastTestsJob
      .slice(needsStart, needsEnd)
      .includes("design-canvas-interaction-acceptance"),
  );
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_CANVAS_RESULT: ${{ needs.design-canvas-interaction-acceptance.result }}",
    ),
  );
  assert.ok(
    fastTestsJob.includes('if [ "$DESIGN_CANVAS_E2E" = "true" ]; then'),
  );
  assert.ok(
    fastTestsJob.includes('if [ "$DESIGN_CANVAS_RESULT" != "success" ]; then'),
  );
  assert.match(
    fastTestsJob,
    /if \[ "\$DESIGN_CANVAS_E2E" = "true" \]; then\s+if \[ "\$DESIGN_CANVAS_RESULT" != "success" \]; then\s+echo "::error::Design canvas interaction acceptance did not succeed \(\$DESIGN_CANVAS_RESULT\)"\s+exit 1\s+fi/,
  );
  const selectedTests = [
    [
      "e2e/canvas-invariants.spec.ts",
      383,
      "X/Y match the element's real position, not 0,0",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      538,
      "setting X moves the element by exactly that amount",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      553,
      "setting Y moves the element by exactly that amount",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      508,
      "a child of an auto-layout parent still reports real geometry",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      1286,
      "deleting a layer removes it from the document",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      1170,
      "Escape on a rect drawn inside a frame clears, and never lands on the screen",
    ],
    [
      "e2e/canvas-invariants.spec.ts",
      1320,
      "basic authoring raises no uncaught page errors",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      176,
      "text fills hide and restore without losing the original color",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      238,
      "selection hide and Appearance visibility stay in sync with opacity",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      314,
      "text gradient apply and removal survive reselection; box gradient editor persists",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      426,
      "style layer row actions stay visible and toggle visibility state",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      452,
      "typography edits update size and spacing inputs",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      541,
      "search selects Lato Medium and keeps custom font names offline",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      610,
      "numeric scrub handles use terse tooltips and drag from compact labels",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      667,
      "numeric input applies Figma math and starts an Option scrub drag",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      737,
      "appearance controls use droplet blend menu and inline independent corners",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      798,
      "export rows add, remove, and reset when selection changes",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      833,
      "resizing a selected element emits a visual-style-change payload",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      880,
      "pointercancel restores a scrubbed value without adding a history step",
    ],
    [
      "e2e/inspector-styles.spec.ts",
      999,
      "can capture a screenshot of inspector coverage via CDP",
    ],
    [
      "e2e/drag-and-drop.drag-feedback.spec.ts",
      24,
      "snap guides appear when an edge aligns with a sibling",
    ],
    [
      "e2e/drag-and-drop.moving-by-drag.spec.ts",
      42,
      "dropping over a sibling keeps the moved position after reload",
    ],
    [
      "e2e/drag-and-drop.moving-by-drag.spec.ts",
      105,
      "Alt+drag leaves the original and creates a copy",
    ],
    [
      "e2e/parity-selection.spec.ts",
      313,
      "board regression: an overlapping Frame drop into another board Frame persists after reload",
    ],
    [
      "e2e/parity-selection.spec.ts",
      451,
      "board regression: overlapping board Frames keep the pointer drop without cancel or revert",
    ],
    [
      "e2e/parity-selection.spec.ts",
      572,
      "selected nested frame drag from its grandchild tracks the pointer and persists",
    ],
    [
      "e2e/corner-radius-handle-drag.spec.ts",
      202,
      "canvas corner-radius handle follows the drag and persists the radius",
    ],
    [
      "e2e/pasted-svg-image-inspector.spec.ts",
      656,
      "clipboard SVG File paste in the parent editor stays editable after reload",
    ],
    [
      "e2e/pasted-svg-image-inspector.spec.ts",
      693,
      "rejected SVG HTML is consumed instead of inserted as native markup",
    ],
    [
      "e2e/position-alignment.spec.ts",
      292,
      "Left and Right alignment controls move to their named edges",
    ],
    [
      "e2e/position-alignment.spec.ts",
      312,
      "Top and Bottom alignment controls move to their named edges",
    ],
    [
      "e2e/position-alignment.spec.ts",
      361,
      "Auto Layout matrix centers both axes and persists after reload",
    ],
    [
      "e2e/position-alignment.spec.ts",
      431,
      "canvas and Layers selection show parent-relative position after iframe scroll",
    ],
    [
      "e2e/position-alignment.spec.ts",
      509,
      "fixed Position stays viewport-relative after iframe scroll and reload",
    ],
    [
      "e2e/position-alignment.spec.ts",
      570,
      "Position stays Frame-relative through Groups and resets at nested Frames",
    ],
    [
      "e2e/position-alignment.spec.ts",
      615,
      "Position edits use the CSS containing block through static wrappers and borders",
    ],
    [
      "e2e/position-alignment.spec.ts",
      661,
      "Position stays Frame-relative through a positioned plain wrapper",
    ],
    [
      "e2e/position-alignment.spec.ts",
      708,
      "unframed absolute positions use the initial containing block through static wrappers",
    ],
    [
      "e2e/position-alignment.spec.ts",
      740,
      "Position edits invert own and static-containing-block transforms and persist",
    ],
    [
      "e2e/position-alignment.spec.ts",
      780,
      "Align uses a Group's bounds while Position stays Frame-relative",
    ],
  ] as const;
  for (const [file, line, title] of selectedTests) {
    const location = `${file}:${line}`;
    assert.ok(regressionCases.includes(location), location);
    const sourceLine = readFileSync(`templates/design/${file}`, "utf8").split(
      "\n",
    )[line - 1];
    assert.ok(sourceLine?.includes(`test(\"${title}\"`), location);
  }
});

test("a deleted Design E2E path runs the focused interaction suite", () => {
  const scope = classifyChangedPaths([
    "templates/design/e2e/removed-by-this-change.spec.ts",
  ]);

  assert.equal(scope.checks.design_canvas_interaction_e2e, true);
});

test("selects the Content two-tab convergence lane for its runtime dependencies", () => {
  for (const path of [
    "templates/content/app/components/editor/PageDraftRecovery.tsx",
    "templates/content/app/hooks/use-db-sync.ts",
    "templates/content/app/routes/page.$id.tsx",
    "templates/content/app/root.tsx",
    "templates/content/actions/update-document.ts",
    "templates/content/server/db/schema.ts",
    "templates/content/server/plugins/auth.ts",
    "templates/content/shared/document-intent-merge.ts",
    "templates/content/shared/content-editor-structural-schema.generated.json",
    "templates/content/agent-native.config.ts",
    "templates/content/package.json",
    "templates/content/vite.config.ts",
    "templates/content/e2e/two-tab-convergence.spec.ts",
    "templates/content/e2e/helpers.ts",
    "templates/content/e2e/convergence-summary.ts",
    "templates/content/e2e/global-setup.ts",
    "templates/content/e2e/playwright.config.ts",
    "packages/core/src/collab/client.ts",
    "packages/core/src/client/use-session.ts",
    "packages/toolkit/src/editor/useCollabReconcile.ts",
    "packages/toolkit/src/collab-ui/lead-client.ts",
    "packages/toolkit/package.json",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.content_convergence, true, path);
  }

  // A toolkit-only change starts Content DB tests through this check alone.
  const toolkit = classifyChangedPaths([
    "packages/toolkit/src/editor/RichMarkdownEditor.tsx",
  ]);
  assert.equal(toolkit.checks.content, false);
  assert.equal(toolkit.checks.content_convergence, true);

  for (const path of [
    "templates/content/app/components/editor/comment-anchors.spec.ts",
    "templates/content/shared/nfm.spec.ts",
    "templates/content/app/i18n/en-US.ts",
    "templates/content/app/i18n-data.ts",
    "templates/content/e2e/sidebar-delete.spec.ts",
    "templates/content/evals/editing.eval.ts",
    "templates/content/docs/product/capabilities/content.author.document-editor.md",
    "templates/content/README.md",
    "templates/design/app/components/MultiScreenCanvas.tsx",
    "packages/toolkit/src/composer/PromptComposer.tsx",
    "packages/toolkit/src/editor/useCollabReconcile.spec.ts",
    "packages/creative-context/src/index.ts",
    "packages/scheduling/src/index.ts",
    "packages/dispatch/src/index.ts",
    "docs/guide.md",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.content_convergence,
      false,
      path,
    );
  }

  for (const path of [".github/workflows/ci.yml", "pnpm-lock.yaml"]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.full, true, path);
    assert.equal(scope.checks.content_convergence, true, path);
  }

  for (const path of [
    "scripts/guard-e2e-harness.mjs",
    "AGENTS.md",
    ".agents/skills/qa/SKILL.md",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.content_convergence,
      false,
      path,
    );
  }
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
    ["lint", "guards", "changeset"],
  );
});
