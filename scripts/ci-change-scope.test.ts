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
import {
  DESIGN_E2E_REGRESSION_SHARDS,
  resolveDesignE2ERegressionPinsForShard,
} from "./design-e2e-regression-pins.ts";
import { resolveDesignE2ESpecs } from "./design-e2e-spec-selection.ts";

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

test("retains Slides parity and corpus gates while keeping the full soak manual", () => {
  const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const soakWorkflow = readFileSync(
    ".github/workflows/slides-authoring-fuzz-soak.yml",
    "utf8",
  );

  assert.match(
    ciWorkflow,
    /run: pnpm exec tsx scripts\/edit-fidelity\/run\.ts --authoring\n/u,
  );
  assert.match(ciWorkflow, /--authoring --browser webkit/u);
  assert.match(ciWorkflow, /--authoring-corpus/u);

  for (const browser of ["chromium", "webkit", "firefox"]) {
    assert.match(
      ciWorkflow,
      new RegExp(
        `--authoring-fuzz\\s+--seed 16 --steps 80 --browser ${browser}`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(ciWorkflow, /slides-authoring-fuzz-soak:/u);
  assert.match(soakWorkflow, /^name: Slides authoring fuzz soak$/mu);
  assert.match(soakWorkflow, /workflow_dispatch:/u);
  assert.doesNotMatch(soakWorkflow, /^\s+pull_request:/mu);
  assert.match(
    soakWorkflow,
    /--seed\s+\$\{\{ matrix\.seed_start \}\}[\s\S]*--seeds 5 --steps 500/u,
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

test("checks the Builder Code starter scaffold for core and Chat changes", () => {
  const template = classifyChangedPaths([
    "packages/core/src/templates/builder-code-starter/app/routes/_index.tsx",
  ]);
  const core = classifyChangedPaths(["packages/core/src/cli/create.ts"]);
  const chat = classifyChangedPaths(["templates/chat/app/routes/_index.tsx"]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  const tooling = classifyChangedPaths(["scripts/agent-friction-report.mjs"]);

  assert.equal(template.full, false);
  assert.equal(template.checks.scaffold, true);
  assert.equal(template.checks.builder_code_starter_scaffold, true);
  assert.equal(core.checks.builder_code_starter_scaffold, true);
  const forms = classifyChangedPaths(["templates/forms/actions/list-forms.ts"]);

  assert.equal(chat.checks.scaffold, true);
  assert.equal(chat.checks.builder_code_starter_scaffold, true);
  assert.equal(forms.checks.builder_code_starter_scaffold, false);
  assert.equal(full.checks.builder_code_starter_scaffold, true);
  assert.equal(tooling.full, true);
  assert.equal(tooling.checks.builder_code_starter_scaffold, true);
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
    "templates/design/e2e/global-setup.ts",
    "templates/design/e2e/global-teardown.ts",
    "templates/design/e2e/drag-out-of-screen-to-board.spec.ts",
    "templates/design/e2e/interaction-drag-reparent.spec.ts",
    "templates/design/e2e/interaction-vector-endpoints.spec.ts",
    "templates/design/e2e/interaction-report-interactions.spec.ts",
    "templates/design/e2e/interaction-oversized-nested.spec.ts",
    "templates/design/e2e/interaction-alt-drag-duplicate.spec.ts",
    "templates/design/e2e/interaction-selection.spec.ts",
    "templates/design/e2e/z-order-behavior.spec.ts",
    "templates/design/e2e/corner-radius-handle-drag.spec.ts",
    "templates/design/e2e/responsive-overview-regressions.spec.ts",
    "templates/design/e2e/helpers.ts",
    "templates/design/e2e/drag-and-drop.shared.ts",
    "templates/design/e2e/drag-and-drop.reparenting-rules.spec.ts",
    "templates/design/e2e/drag-and-drop.auto-layout.spec.ts",
    "templates/design/e2e/cross-screen-auto-layout.spec.ts",
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
    "templates/design/e2e/ai-sidebar-reporter-path.spec.ts",
    "packages/core/src/file-upload/registry.ts",
    "packages/core/src/agent/production-agent.ts",
    "packages/toolkit/src/app/chat/chat/run-recovery.tsx",
    "packages/agentkit/src/protocol/agui.ts",
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

  const fourDesignSpecs = [
    "templates/design/e2e/interaction-selection.spec.ts",
    "templates/design/e2e/interaction-drag-move.spec.ts",
    "templates/design/e2e/interaction-undo-redo.spec.ts",
    "templates/design/e2e/position-alignment.spec.ts",
  ];
  const boundedDesignScope = classifyChangedPaths(fourDesignSpecs);
  assert.equal(
    boundedDesignScope.designCanvasE2eSpecCount,
    fourDesignSpecs.length,
  );
  assert.equal(
    boundedDesignScope.designCanvasE2eSpecs.length,
    fourDesignSpecs.length,
  );

  const broadDesignScope = classifyChangedPaths([
    ...fourDesignSpecs,
    "templates/design/e2e/interaction-pan-zoom-mouse.spec.ts",
  ]);
  assert.equal(broadDesignScope.checks.design_canvas_interaction_e2e, true);
  assert.equal(broadDesignScope.designCanvasE2eSpecCount, 5);
  assert.deepEqual(
    broadDesignScope.designCanvasE2eSpecs,
    [
      ...fourDesignSpecs,
      "templates/design/e2e/interaction-pan-zoom-mouse.spec.ts",
    ].sort(),
  );

  const manyDesignSpecs = Array.from(
    { length: 79 },
    (_, index) => `templates/design/e2e/interaction-moved-${index}.spec.ts`,
  );
  const manyDesignScope = classifyChangedPaths(manyDesignSpecs);
  assert.equal(manyDesignScope.designCanvasE2eSpecCount, 79);
  assert.deepEqual(
    manyDesignScope.designCanvasE2eSpecs,
    [...manyDesignSpecs].sort(),
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
  const aiSidebarLoopback = step("Run AI sidebar loopback image regressions");
  const changedSpecRegressions = step("Run changed Design E2E specs");
  const screenSelectionRegressions = step(
    "Run focused Screen selection history regressions",
  );
  assert.match(
    changedSpecRegressions,
    /^        timeout-minutes: 7$/m,
    "the changed-spec diagnostic step must fit inside its 9-minute job after setup",
  );
  assert.match(
    changedSpecRegressions,
    /--shard="\$\{changed_shard\}\/48"/,
    "changed-spec diagnostics must retain full coverage across 48 shards",
  );
  assert.match(
    screenSelectionRegressions,
    /^        if: startsWith\(matrix\.shard, 'screen-history-'\)$/m,
    "Screen-selection regressions must run only on their dedicated shards",
  );
  assert.match(
    regressionCases,
    /^        if: \$\{\{ !startsWith\(matrix\.shard, 'screen-history-'\) && matrix\.shard != 'ai-sidebar-loopback' \}\}$/m,
    "fixed Design regressions must not run on Screen-history or AI sidebar shards",
  );
  assert.equal(
    aiSidebarLoopback.match(/^        if: (.+)$/m)?.[1],
    "matrix.shard == 'ai-sidebar-loopback'",
  );
  assert.match(
    aiSidebarLoopback,
    /^        timeout-minutes: 18$/m,
    "the loopback image suite needs a bounded 18-minute cap",
  );
  assert.ok(
    aiSidebarLoopback.includes('E2E_AI_SIDEBAR_LOOPBACK: "1"'),
    "the image suite must opt in to its deterministic loopback provider",
  );
  assert.ok(
    aiSidebarLoopback.includes(
      "pnpm exec playwright test e2e/ai-sidebar-reporter-path.spec.ts --workers=1 --retries=0",
    ),
    "the required shard must run the complete SHA-256 attachment suite serially without retries",
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
    "Shift-picking a Screen extends the Delete selection in All screens",
    "a newer Screen pick survives failed Screen deletion settlement",
    "a newer sidebar Screen selection survives failed Screen deletion settlement",
    "Select All Screens survives failed Screen deletion settlement",
    "marquee selection persists and deletes Screens after a prior layer selection",
    "deep-select marquee over a Screen deletes only the child",
    "Shift-marqueeing child layers preserves an explicit Screen elsewhere for Delete",
    "Shift-marquee reselecting an owner Screen makes Delete target the Screen",
  ];
  // source-read-ok: validates the case names used by fixed Playwright line selectors.
  const screenHistorySpec = readFileSync(
    "templates/design/e2e/interaction-selection-history-delete-screen.spec.ts",
    "utf8",
  );
  for (const title of screenHistoryCases) {
    assert.equal(
      screenHistorySpec.split(title).length - 1,
      1,
      `Screen-history case must exist exactly once: ${title}`,
    );
  }
  assert.deepEqual(
    screenHistoryShardSelectors.flatMap(({ selectors }) => selectors).sort(),
    [...screenHistoryCases].sort(),
    "Screen-history selectors must cover each intended case once",
  );
  assert.deepEqual(
    [...regressionCases.matchAll(/--workers=(\d+)/g)].map(([, count]) =>
      Number(count),
    ),
    [1],
  );
  assert.deepEqual(
    [...changedSpecRegressions.matchAll(/--workers=(\d+)/g)].map(([, count]) =>
      Number(count),
    ),
    [1],
  );
  const designJobStart = workflow.indexOf(
    "  design-canvas-interaction-acceptance:\n",
  );
  assert.notEqual(designJobStart, -1);
  const designJobEnd = workflow.indexOf(
    "\n  design-canvas-changed-spec-diagnostics:",
    designJobStart,
  );
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
  assert.equal(
    designJob.match(/^    if: (.+)$/m)?.[1],
    "needs.change-scope.outputs.design_canvas_interaction_e2e == 'true'",
    "matrix filtering must stay out of the job-level condition",
  );
  assert.doesNotMatch(
    designJob,
    /changed-\d+|design_canvas_e2e_specs/,
    "the required Design lane must only run the bounded regression and history shards",
  );
  const diagnosticJobStart = workflow.indexOf(
    "  design-canvas-changed-spec-diagnostics:\n",
  );
  assert.notEqual(diagnosticJobStart, -1);
  const diagnosticJobEnd = workflow.indexOf(
    "\n  pre-auth-session-replay-smoke:",
    diagnosticJobStart,
  );
  const diagnosticJob = workflow.slice(
    diagnosticJobStart,
    diagnosticJobEnd === -1 ? undefined : diagnosticJobEnd,
  );
  assert.ok(diagnosticJob.includes("needs: change-scope"));
  assert.ok(
    diagnosticJob.includes(
      "if: needs.change-scope.outputs.design_canvas_e2e_specs != '[]'",
    ),
    "changed-spec diagnostics should run when selectors are present",
  );
  assert.ok(
    diagnosticJob.includes("Run changed Design E2E specs"),
    "the changed spec suite must remain visible in CI diagnostics",
  );
  assert.doesNotMatch(
    workflow,
    /design_canvas_e2e_specs_overflow/,
    "workflow must not skip changed specs based on list size",
  );
  assert.match(
    designJob,
    /^\s+run: pnpm exec playwright install --only-shell chromium$/m,
    "Design shards must reuse the runner's browser libraries",
  );
  const jobTimeout = 9;
  assert.match(
    designJob,
    /^    timeout-minutes: \$\{\{ matrix\.shard == 'ai-sidebar-loopback' && 20 \|\| 9 \}\}$/m,
    "the longer AI sidebar shard timeout must not lengthen the other Design shards",
  );
  const stepTimeout = Number(
    regressionCases.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  const screenHistoryStepTimeout = Number(
    screenSelectionRegressions.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  const changedSpecStepTimeout = Number(
    changedSpecRegressions.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  const diagnosticJobTimeout = Number(
    diagnosticJob.match(/^    timeout-minutes: (\d+)$/m)?.[1],
  );
  assert.ok(
    Number.isInteger(jobTimeout) && jobTimeout === 9,
    `regular Design acceptance shards must keep the exact nine-minute cap (got ${jobTimeout})`,
  );
  assert.ok(jobTimeout < 10, "Design acceptance must stay below ten minutes");
  assert.ok(
    Number.isInteger(diagnosticJobTimeout) && diagnosticJobTimeout === 9,
    `changed-spec diagnostics must have the exact nine-minute cap (got ${diagnosticJobTimeout})`,
  );
  assert.ok(
    Number.isInteger(stepTimeout) &&
      stepTimeout === 4 &&
      jobTimeout >= stepTimeout + 5,
    `focused Design tests need the exact four-minute cap and five minutes for setup (job ${jobTimeout}, step ${stepTimeout})`,
  );
  assert.ok(
    Number.isInteger(screenHistoryStepTimeout) &&
      screenHistoryStepTimeout === 4 &&
      jobTimeout >= screenHistoryStepTimeout + 5,
    `Screen-history tests need the exact four-minute cap and five minutes for setup (job ${jobTimeout}, step ${screenHistoryStepTimeout})`,
  );
  assert.ok(
    Number.isInteger(changedSpecStepTimeout) &&
      changedSpecStepTimeout === 7 &&
      diagnosticJobTimeout >= changedSpecStepTimeout + 2,
    `changed-spec diagnostics need the exact seven-minute cap and two minutes for setup (job ${diagnosticJobTimeout}, step ${changedSpecStepTimeout})`,
  );
  const shardEntries = [
    ...designJob.matchAll(
      /^\s{12}((?:(?:inspector|drag|position|screen-history)-[^,\s)]+|ai-sidebar-loopback)),?\s*$/gm,
    ),
  ].map(([, shard]) => shard);
  assert.deepEqual(shardEntries, [
    ...DESIGN_E2E_REGRESSION_SHARDS,
    "screen-history-1",
    "screen-history-2",
    "screen-history-3",
    "ai-sidebar-loopback",
  ]);
  assert.doesNotMatch(
    regressionCases,
    /e2e\/[^\s:]+\.spec\.ts:\d+/,
    "fixed regression selectors must be resolved from titles, not stored line numbers",
  );
  assert.match(
    regressionCases,
    /node --experimental-strip-types \.\.\/\.\.\/scripts\/design-e2e-regression-pins\.ts "\$\{\{ matrix\.shard \}\}" > "\$focused_specs_file"/,
    "each fixed regression shard must resolve its current selectors from the title manifest",
  );
  assert.match(
    regressionCases,
    /mapfile -d '' -t focused_specs < "\$focused_specs_file"/,
    "the resolver output must become the Playwright selector list",
  );
  assert.match(
    regressionCases,
    /pnpm exec playwright test "\$\{focused_specs\[@\]\}" --workers=1/,
    "resolved fixed regression selectors must run serially",
  );
  assert.equal(
    DESIGN_E2E_REGRESSION_SHARDS.flatMap((shard) =>
      resolveDesignE2ERegressionPinsForShard(shard),
    ).length,
    46,
    "the title manifest must retain every fixed regression pin",
  );
});

test("keeps every changed Design E2E spec in visible diagnostic shards", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const diagnosticJobStart = workflow.indexOf(
    "  design-canvas-changed-spec-diagnostics:",
  );
  assert.notEqual(diagnosticJobStart, -1);
  const diagnosticJobEnd = workflow.indexOf(
    "\n  pre-auth-session-replay-smoke:",
    diagnosticJobStart,
  );
  const diagnosticJob = workflow.slice(
    diagnosticJobStart,
    diagnosticJobEnd === -1 ? undefined : diagnosticJobEnd,
  );
  const changedShardNumbers = [
    ...diagnosticJob.matchAll(/^\s{12}changed-(\d+),?\s*$/gm),
  ].map(([, shard]) => Number(shard));

  assert.deepEqual(
    changedShardNumbers,
    Array.from({ length: 48 }, (_, index) => index + 1),
    "all changed-spec shards must remain present and sequential",
  );
  assert.match(
    diagnosticJob,
    /--shard="\$\{changed_shard\}\/48"/,
    "changed specs must be fully covered across the same 48 shards",
  );
  const fastTestsStart = workflow.indexOf("  fast-tests:\n");
  assert.notEqual(fastTestsStart, -1);
  const fastTestsEnd = workflow.indexOf("\n  docs:", fastTestsStart);
  const fastTestsJob = workflow.slice(
    fastTestsStart,
    fastTestsEnd === -1 ? undefined : fastTestsEnd,
  );
  assert.doesNotMatch(
    fastTestsJob,
    /design-canvas-changed-spec-diagnostics/,
    "the broad diagnostic matrix must not extend the required Design lane",
  );
});

test("runs fixed Design regression pins even when their spec files changed", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const start = workflow.indexOf(
    "      - name: Run focused Design regression cases\n",
  );
  assert.notEqual(start, -1);
  const next = workflow.indexOf("\n      - name: ", start + 1);
  const regressionCases = workflow.slice(start, next === -1 ? undefined : next);

  assert.match(
    regressionCases,
    /^          node --experimental-strip-types \.\.\/\.\.\/scripts\/design-e2e-regression-pins\.ts "\$\{\{ matrix\.shard \}\}"/m,
    "fixed behavior pins must resolve in their dedicated shard regardless of changed files",
  );
  assert.doesNotMatch(
    regressionCases,
    /existing_changed_specs|DESIGN_CANVAS_E2E_SPECS|All fixed regression cases are included in the changed-spec shard/,
    "changed-spec selectors must not suppress fixed regression pins",
  );
});

test("fast-tests gates the selected browser checks on their actual job results", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
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
  const needsStart = fastTestsJob.indexOf("    needs:");
  const needsEnd = fastTestsJob.indexOf("    if:", needsStart);
  assert.ok(needsStart >= 0 && needsEnd > needsStart);
  const needs = fastTestsJob.slice(needsStart, needsEnd);
  assert.ok(needs.includes("design-canvas-interaction-acceptance"));
  assert.ok(needs.includes("pre-auth-session-replay-smoke"));
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_CANVAS_RESULT: ${{ needs.design-canvas-interaction-acceptance.result }}",
    ),
  );
  assert.match(
    fastTestsJob,
    /if \[ "\$DESIGN_CANVAS_E2E" = "true" \]; then\s+if \[ "\$DESIGN_CANVAS_RESULT" != "success" \]; then\s+echo "::error::Design canvas interaction acceptance did not succeed \(\$DESIGN_CANVAS_RESULT\)"\s+exit 1\s+fi/,
  );
  assert.ok(
    fastTestsJob.includes(
      "PRE_AUTH_REPLAY_RESULT: ${{ needs.pre-auth-session-replay-smoke.result }}",
    ),
  );
  assert.match(
    fastTestsJob,
    /if \[ "\$PRE_AUTH_REPLAY_E2E" = "true" \]; then\s+if \[ "\$PRE_AUTH_REPLAY_RESULT" != "success" \]; then\s+echo "::error::pre-auth session replay smoke did not succeed \(\$PRE_AUTH_REPLAY_RESULT\)"\s+exit 1\s+fi/,
  );
});

test("selects the pre-auth replay browser smoke for its runtime paths", () => {
  for (const path of [
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
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.pre_auth_session_replay_e2e,
      true,
      path,
    );
  }

  for (const path of [
    "docs/guide.md",
    "templates/design/app/components/Canvas.tsx",
    "templates/analytics/app/routes/sessions.tsx",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.pre_auth_session_replay_e2e,
      false,
      path,
    );
  }

  const smokeOnly = classifyChangedPaths([
    "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
  ]);
  assert.deepEqual(smokeOnly.designCanvasE2eSpecs, []);
  assert.equal(smokeOnly.checks.design_canvas_interaction_e2e, false);
  assert.equal(smokeOnly.checks.pre_auth_session_replay_e2e, true);
});

test("a deleted Design E2E path runs the focused interaction suite", () => {
  const scope = classifyChangedPaths([
    "templates/design/e2e/removed-by-this-change.spec.ts",
  ]);

  assert.equal(scope.checks.design_canvas_interaction_e2e, true);
});

test("a non-empty selector with only deleted specs resolves to a no-op", () => {
  const removed = "templates/design/e2e/removed-by-this-change.spec.ts";

  assert.deepEqual(
    resolveDesignE2ESpecs(JSON.stringify([removed]), { isFile: () => false }),
    {
      existingSpecs: [],
      removedSpecs: ["e2e/removed-by-this-change.spec.ts"],
    },
  );
});

test("keeps runnable specs while excluding deleted paths from the same selector", () => {
  const removed = "templates/design/e2e/removed-by-this-change.spec.ts";
  const existing = "templates/design/e2e/interaction-selection.spec.ts";
  const testFiles = [
    "templates/design/e2e/interaction-support.test.ts",
    "templates/design/e2e/interaction-support.spec.tsx",
  ];

  assert.deepEqual(
    resolveDesignE2ESpecs(JSON.stringify([removed, existing, ...testFiles]), {
      isFile: (specPath) =>
        [
          "e2e/interaction-selection.spec.ts",
          ...testFiles.map((testFile) =>
            testFile.slice("templates/design/".length),
          ),
        ].includes(specPath),
    }),
    {
      existingSpecs: [
        "e2e/interaction-selection.spec.ts",
        "e2e/interaction-support.test.ts",
        "e2e/interaction-support.spec.tsx",
      ],
      removedSpecs: ["e2e/removed-by-this-change.spec.ts"],
    },
  );
});

test("empty, malformed, and out-of-scope selectors fail closed", () => {
  assert.throws(
    () => resolveDesignE2ESpecs("[]"),
    /non-empty changed Design E2E spec selector/,
  );
  assert.throws(() => resolveDesignE2ESpecs("not-json"), /valid JSON/);
  assert.throws(
    () =>
      resolveDesignE2ESpecs(
        JSON.stringify(["templates/design/e2e/../../scripts/anything.ts"]),
      ),
    /Invalid changed Design E2E spec path/,
  );
  assert.throws(
    () =>
      resolveDesignE2ESpecs(
        JSON.stringify(["templates/design/e2e/kept.spec.ts"]),
        {
          isFile: () => {
            throw new Error("EACCES");
          },
        },
      ),
    /EACCES/,
    "the resolver must surface inspection errors instead of treating them as deleted files",
  );
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
