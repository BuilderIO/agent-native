import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  QUERY_BUDGET_APPS,
  SLIDES_AUTHORING_SHARDS,
  SSR_BOOT_APPS,
  classifyChangedPaths,
  designCanvasE2eDiagnosticShardsFor,
  shardQueryBudgetApps,
  isDocsPath,
  isGuardScopedScriptPath,
  isInstructionPath,
  isWorkspacePath,
  normalizeChangedPath,
  runtimeSourceChangesInTestTitledPr,
  scriptTestsForPaths,
  slidesAuthoringMatrix,
  workspaceFiltersForPaths,
} from "./ci-change-scope.ts";
import {
  DESIGN_E2E_REGRESSION_PINS,
  DESIGN_E2E_REGRESSION_SHARDS,
} from "./design-e2e-regression-pins.ts";
import { resolveDesignE2ESpecs } from "./design-e2e-spec-selection.ts";

function fastTestsSummaryScript(): string {
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
  const runMarker = "        run: |\n";
  const runStart = fastTestsJob.indexOf(runMarker);
  assert.notEqual(runStart, -1, "missing Fast tests summary script");

  return fastTestsJob
    .slice(runStart + runMarker.length)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trimEnd();
}

function runFastTestsSummary(
  script: string,
  overrides: Record<string, string> = {},
) {
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "BuilderIO/agent-native",
      GITHUB_RUN_ID: "123",
      CHANGE_SCOPE_RESULT: "success",
      DOCS_ONLY: "false",
      CI_FULL: "false",
      FAST_TESTS: "true",
      HAS_TESTS: "true",
      DOCS_RESULT: "skipped",
      TEST_REST_RESULT: "skipped",
      TEST_TARGETED_RESULT: "success",
      DESIGN_CORE_REGRESSION: "false",
      DESIGN_CORE_RESULT: "skipped",
      DESIGN_BROAD_WORKFLOWS: "false",
      DESIGN_BROAD_RESULT: "skipped",
      PRE_AUTH_REPLAY_E2E: "false",
      PRE_AUTH_REPLAY_RESULT: "skipped",
      ...overrides,
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

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

test("treats prototypes as docs-only", () => {
  assert.equal(isDocsPath("prototypes/chat/source.html"), true);
  assert.equal(isDocsPath("prototypes/kit/build.ts"), true);
  const scope = classifyChangedPaths([
    "prototypes/slides/source.html",
    "prototypes/kit/ui.css",
  ]);
  assert.equal(scope.docsOnly, true);
  assert.equal(scope.full, false);
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
    runtimeSourceChangesInTestTitledPr(
      "test: verify URL-backed visual editing",
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
        "templates/design/app/pages/design-editor/editor-state.spec.ts",
        "templates/design/app/hooks/use-navigation-state.test.ts",
        "templates/design/scripts/visual-edit-runtime-proof.ts",
        "templates/slides/public/visual-edit-structure-proof.html",
      ],
    ),
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
    runtimeSourceChangesInTestTitledPr(
      "test(design)!: verify URL-backed visual editing",
      ["templates/design/app/pages/design-editor/editor-state.ts"],
    ),
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

test("runs CI for pull requests into any base branch", () => {
  const triggers = readFileSync(".github/workflows/ci.yml", "utf8").split(
    /^jobs:/mu,
  )[0];
  assert.match(triggers, /^ {2}pull_request:\s*$/mu);
  assert.doesNotMatch(triggers, /^\s*branches(?:-ignore)?:/mu);
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

test("selects each Slides browser lane from its relevant runtime paths", () => {
  const slides = classifyChangedPaths([
    "templates/slides/app/components/editor/SlideEditor.tsx",
  ]);
  assert.equal(slides.checks.slides_caret_e2e, true);
  assert.equal(slides.checks.slides_typing_chat_e2e, true);
  assert.equal(slides.checks.slides_mobile_import_e2e, false);
  assert.equal(slides.checks.slides_text_surface_e2e, true);
  assert.equal(slides.checks.slides_authoring_e2e, true);

  for (const path of [
    "packages/core/src/index.ts",
    "packages/core/src/agent/engine/run.ts",
    "packages/creative-context/src/index.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, false, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  const canvasInteractions = classifyChangedPaths([
    "packages/toolkit/src/canvas-interactions/drag.ts",
  ]);
  assert.equal(canvasInteractions.checks.slides_caret_e2e, true);
  assert.equal(canvasInteractions.checks.slides_typing_chat_e2e, false);
  assert.equal(canvasInteractions.checks.slides_authoring_e2e, false);

  for (const path of [
    "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
    "packages/toolkit/src/composer/PromptComposer.tsx",
    "packages/agentkit/src/client/index.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, true, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "templates/content/app/routes/index.tsx",
    "templates/chat/app/routes/index.tsx",
    "packages/core-corpus/src/index.ts",
    "templates/slides/app/components/editor/ExportMenu.tsx",
    "templates/slides/app/routes/settings.spec.tsx",
    "templates/slides/app/components/editor/SlideEditor.test.tsx",
    "templates/slides/scripts/edit-fidelity/run-options.test.ts",
    "templates/slides/scripts/edit-fidelity/README.md",
    "templates/slides/scripts/edit-fidelity/evidence/authoring-slash-menu.png",
    "templates/slides/actions/export-pptx.ts",
    "templates/slides/server/handlers/assets.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, false, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "templates/slides/app/pages/Index.tsx",
    "templates/slides/app/components/editor/ImportDeckButton.tsx",
    "templates/slides/app/components/editor/use-prompt-import.ts",
    "templates/slides/app/hooks/use-slide-file-storage-status.ts",
    "templates/slides/app/lib/prompt-file-uploads.ts",
    "templates/slides/shared/upload-types.ts",
    "packages/creative-context/src/eval/fixtures/launch-system-v1.pptx",
    "packages/toolkit/src/ui/button.tsx",
    "packages/toolkit/src/ui/dropdown-menu.tsx",
    "packages/toolkit/src/ui/popover.tsx",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, false, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, true, path);
    assert.equal(
      scope.checks.slides_text_surface_e2e,
      path.endsWith("Index.tsx") ||
        path.endsWith("/button.tsx") ||
        path.endsWith("/dropdown-menu.tsx") ||
        path.endsWith("/popover.tsx"),
      path,
    );
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "templates/slides/app/components/comments/SlideCommentsPanel.tsx",
    "templates/slides/app/components/comments/SlideCommentPins.tsx",
    "templates/slides/app/components/deck/DeckCard.tsx",
    "templates/slides/app/components/editor/EditorToolbar.tsx",
    "templates/slides/app/components/editor/SpeakerNotesPanel.tsx",
    "templates/slides/actions/add-slide-comment.ts",
    "templates/slides/actions/delete-slide-comment.ts",
    "templates/slides/actions/update-slide-comment.ts",
    "templates/slides/app/hooks/use-slide-comments.ts",
    "packages/toolkit/src/ui/avatar.tsx",
    "packages/toolkit/src/ui/button.tsx",
    "packages/toolkit/src/ui/dropdown-menu.tsx",
    "packages/toolkit/src/ui/input.tsx",
    "packages/toolkit/src/ui/popover.tsx",
    "packages/toolkit/src/ui/textarea.tsx",
    "packages/toolkit/src/ui/tooltip.tsx",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, false, path);
    assert.equal(
      scope.checks.slides_mobile_import_e2e,
      path.endsWith("/button.tsx") ||
        path.endsWith("/dropdown-menu.tsx") ||
        path.endsWith("/popover.tsx"),
      path,
    );
    assert.equal(scope.checks.slides_text_surface_e2e, true, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "packages/core/package.json",
    "packages/core/src/client/agent-chat.ts",
    "packages/core/src/client/agent-chat/index.ts",
    "packages/core/src/client/app-config.ts",
    "packages/core/src/client/api-path.ts",
    "packages/core/src/client/application-state.ts",
    "packages/core/src/client/agent-engine-readiness.ts",
    "packages/core/src/client/agent-sidebar-state.ts",
    "packages/core/src/client/browser-tab-id.ts",
    "packages/core/src/client/chat-view-transition.ts",
    "packages/core/src/client/chat/agentkit-agent-native.ts",
    "packages/core/src/client/chat/agentkit-protocol.ts",
    "packages/core/src/client/chat/assistant-chat-history-version.ts",
    "packages/core/src/client/chat/composer-draft.ts",
    "packages/core/src/client/chat/runtime.ts",
    "packages/core/src/client/dynamic-suggestions.ts",
    "packages/core/src/client/host/index.ts",
    "packages/core/src/client/onboarding/index.ts",
    "packages/core/src/client/use-active-agent-chat-run.ts",
    "packages/core/src/client/use-agent-chat-context.ts",
    "packages/core/src/client/use-agent-chat-running-threads.ts",
    "packages/core/src/client/use-agent-chat.ts",
    "packages/core/src/client/use-change-version.ts",
    "packages/core/src/client/use-chat-models.ts",
    "packages/core/src/client/use-chat-threads.ts",
    "packages/core/src/client/use-send-to-agent-chat.ts",
    "packages/core/src/client/use-session.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, true, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "packages/core/src/client/hooks/index.ts",
    "packages/core/src/client/use-action.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, true, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, true, path);
    assert.equal(scope.checks.slides_text_surface_e2e, true, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "packages/agentkit/package.json",
    "packages/toolkit/package.json",
    "packages/agentkit/src/client/client.ts",
    "packages/agentkit/src/client/index.ts",
    "packages/agentkit/src/client/state.ts",
    "packages/agentkit/src/index.ts",
    "packages/agentkit/src/protocol/index.ts",
    "packages/toolkit/src/app/agentkit/react/chat.tsx",
    "packages/toolkit/src/app/agentkit/react/components.tsx",
    "packages/toolkit/src/app/agentkit/react/composer-submission.ts",
    "packages/toolkit/src/app/agentkit/react/context.tsx",
    "packages/toolkit/src/app/agentkit/react/index.ts",
    "packages/toolkit/src/app/agentkit/react/root.tsx",
    "packages/toolkit/src/app/chat/AgentSidebar.tsx",
    "packages/toolkit/src/app/chat/AgentSidebarPanel.tsx",
    "packages/toolkit/src/app/chat/AgentPanel.tsx",
    "packages/toolkit/src/app/chat/MultiTabAssistantChat.tsx",
    "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
    "packages/toolkit/src/app/chat/agentkit-chat/root.tsx",
    "packages/toolkit/src/app/chat/agentkit-chat/history.tsx",
    "packages/toolkit/src/app/chat/agentkit-chat/index.ts",
    "packages/toolkit/src/app/chat/agentkit-chat/parity-renderers.tsx",
    "packages/toolkit/src/app/chat/chat/run-recovery.tsx",
    "packages/toolkit/src/app/chat/chat/agent-approval-card.tsx",
    "packages/toolkit/src/app/chat/chat/markdown-renderer.tsx",
    "packages/toolkit/src/app/chat/chat/surface-types.ts",
    "packages/toolkit/src/app/chat/chat/tool-call-display.tsx",
    "packages/toolkit/src/app/chat/chat/tool-integration.tsx",
    "packages/toolkit/src/app/chat/composer/assistant-ui-recovery.tsx",
    "packages/toolkit/src/composer/AgentComposerFrame.tsx",
    "packages/toolkit/src/composer/PromptComposer.tsx",
    "packages/toolkit/src/composer/TiptapComposer.tsx",
    "packages/toolkit/src/composer/attachment-accept.ts",
    "packages/toolkit/src/composer/context-items.ts",
    "packages/toolkit/src/composer/draft-key.ts",
    "packages/toolkit/src/composer/index.ts",
    "packages/toolkit/src/composer/pasted-text.ts",
    "packages/toolkit/src/composer/prompt-attachments.ts",
    "packages/toolkit/src/composer/runtime-adapters.tsx",
    "packages/toolkit/src/composer/types.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, true, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, false, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "packages/core/src/action.ts",
    "packages/core/src/client/chat/storage.ts",
    "packages/toolkit/src/app/chat/chat-first/surface-panel.tsx",
    "packages/toolkit/src/app/chat/agentkit-chat/connections.ts",
    "packages/toolkit/src/composer/useVoiceDictation.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.slides_typing_chat_e2e,
      false,
      `${path} is outside the Slides chat-typing path`,
    );
  }

  for (const path of [
    "packages/core/src/client/api-surface.ts",
    "packages/core/src/client/use-avatar.ts",
    "packages/core/src/collab/types.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_caret_e2e, false, path);
    assert.equal(scope.checks.slides_typing_chat_e2e, false, path);
    assert.equal(scope.checks.slides_mobile_import_e2e, false, path);
    assert.equal(scope.checks.slides_text_surface_e2e, true, path);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }

  for (const path of [
    "templates/slides/actions/add-slide.ts",
    "templates/slides/app/components/editor/SlidesComposerContext.tsx",
    "templates/slides/app/components/editor/SlidesComposerContextProvider.tsx",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
    assert.equal(
      scope.checks.slides_typing_chat_e2e,
      path.includes("SlidesComposerContext"),
      path,
    );
  }

  const corpus = classifyChangedPaths([
    "templates/slides/scripts/edit-fidelity/corpus/pptx-imported.json",
  ]);
  assert.equal(corpus.checks.slides_authoring_e2e, true);
  assert.equal(corpus.checks.slides_caret_e2e, false);
  assert.equal(corpus.checks.slides_typing_chat_e2e, false);
  assert.equal(corpus.checks.slides_mobile_import_e2e, false);
  assert.equal(corpus.checks.slides_text_surface_e2e, false);

  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  assert.equal(full.checks.slides_caret_e2e, true);
  assert.equal(full.checks.slides_typing_chat_e2e, true);
  assert.equal(full.checks.slides_mobile_import_e2e, true);
  assert.equal(full.checks.slides_text_surface_e2e, true);
  assert.equal(full.checks.slides_authoring_e2e, true);
});

test("does not select Slides authoring from unrelated Core runtime changes", () => {
  for (const path of [
    "packages/core/src/index.ts",
    "packages/core/src/action.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/sharing/access.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.slides_authoring_e2e, false, path);
  }
});

test("keeps the standalone Design browser workflow scoped to editor inputs", () => {
  const workflow = readFileSync(".github/workflows/design-e2e.yml", "utf8");

  assert.match(
    workflow,
    /templates\/design\/app\/components\/design\/design-canvas/u,
  );
  assert.match(workflow, /templates\/design\/app\/pages\/DesignEditor\.tsx/u);
  assert.doesNotMatch(workflow, /packages\/core\/\*\*/u);
  assert.doesNotMatch(workflow, /^\s+- "templates\/design\/app\/\*\*"$/mu);
});

test("keeps slow app lanes scoped on full CI tooling changes", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    "scripts/ci-change-scope.ts",
    "scripts/ci-change-scope.test.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.full, true, path);
    for (const check of [
      "content",
      "content_db",
      "content_convergence",
      "core_integration",
      "plan_e2e",
      "brain_evals",
      "trusted_acceptance",
      "scaffold",
      "builder_code_starter_scaffold",
      "deploy_paths",
      "ssr_boot",
      "agentkit_acceptance",
      "neon_query_budget",
      "neon_connection_budget",
      "design_canvas_core_regression",
      "design_canvas_broad_workflows",
      "pre_auth_session_replay_e2e",
      "slides_caret_e2e",
      "slides_typing_chat_e2e",
      "slides_mobile_import_e2e",
      "slides_text_surface_e2e",
      "slides_authoring_e2e",
      "slides_oracle",
    ] as const) {
      assert.equal(scope.checks[check], false, `${path}: ${check}`);
    }
  }

  const dependencyChange = classifyChangedPaths(["pnpm-lock.yaml"]);
  assert.equal(dependencyChange.checks.slides_authoring_e2e, true);
  assert.equal(dependencyChange.checks.deploy_paths, true);
  assert.equal(dependencyChange.checks.design_canvas_core_regression, true);

  assert.equal(
    classifyChangedPaths(["unknown-root-config.ts"]).checks
      .slides_authoring_e2e,
    true,
  );
  assert.equal(classifyChangedPaths([]).checks.slides_authoring_e2e, true);
});

test("the nightly run and the shard action cover every Slides authoring shard", () => {
  const nightly = readFileSync(
    ".github/workflows/slides-authoring-nightly.yml",
    "utf8",
  );
  const action = readFileSync(
    ".github/actions/slides-authoring-shard/action.yml",
    "utf8",
  );

  assert.match(nightly, /^\s+schedule:/mu);
  assert.doesNotMatch(nightly, /^\s+pull_request:/mu);
  const nightlyShards = /shard:\s*\[([^\]]+)\]/u
    .exec(nightly)?.[1]
    .split(",")
    .map((shard) => shard.trim())
    .filter(Boolean);
  assert.deepEqual(nightlyShards, [...SLIDES_AUTHORING_SHARDS]);
  for (const shard of SLIDES_AUTHORING_SHARDS) {
    assert.match(
      action,
      new RegExp(`inputs\\.shard == '${shard}'`, "u"),
      shard,
    );
  }
  // A step guarded by a shard the matrix never produces would never run.
  for (const [, shard] of action.matchAll(/inputs\.shard == '([^']+)'/gu)) {
    assert.ok(
      (SLIDES_AUTHORING_SHARDS as readonly string[]).includes(shard),
      `unknown shard ${shard}`,
    );
  }
  assert.match(nightly, /uses: \.\/\.github\/actions\/slides-authoring-shard/u);
  assert.doesNotMatch(
    readFileSync(".github/workflows/ci.yml", "utf8"),
    /slides-authoring-shard/u,
    "PRs must not run the authoring matrix; the nightly is its only run",
  );
});

test("every browser runs each slice of the authoring parity suite exactly once", () => {
  const action = readFileSync(
    ".github/actions/slides-authoring-shard/action.yml",
    "utf8",
  );
  const slices = new Map<string, string[]>();
  for (const [, slice, total, browser = "chromium"] of action.matchAll(
    /run\.ts --authoring(?: --authoring-shard (\d+)\/(\d+))?(?: --browser (\w+))?$/gmu,
  )) {
    // A run without --authoring-shard would repeat every slice.
    assert.ok(slice, "an unsharded --authoring run");
    slices.set(browser, [...(slices.get(browser) ?? []), `${slice}/${total}`]);
  }
  assert.deepEqual(Object.fromEntries(slices), {
    chromium: ["1/3", "2/3", "3/3"],
    webkit: ["1/3", "2/3", "3/3"],
  });
});

test("Slides authoring jobs run in the image keyed on its Dockerfile", () => {
  const nightly = readFileSync(
    ".github/workflows/slides-authoring-nightly.yml",
    "utf8",
  );
  assert.match(nightly, /uses: \.\/\.github\/actions\/slides-authoring-image/u);
  assert.match(
    nightly,
    /image: \$\{\{ needs\.slides-authoring-image\.outputs\.image \}\}/u,
  );
  // A job that can write the registry would let a run overwrite the image.
  assert.doesNotMatch(nightly, /packages: write/u);
  assert.match(nightly, /packages: read/u);

  const publisher = readFileSync(
    ".github/workflows/slides-authoring-image.yml",
    "utf8",
  );
  assert.match(publisher, /packages: write/u);
  assert.match(publisher, /publish: "true"/u);
  assert.match(publisher, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(publisher, /branches: \[main\]/u);
  assert.doesNotMatch(publisher, /^\s+pull_request(_target)?:/mu);

  // The nightly is the backstop for shared-package PRs, so its failures email.
  const notifier = readFileSync(
    ".github/workflows/email-workflow-failures.yml",
    "utf8",
  );
  const nightlyName = /^name: (.+)$/mu.exec(nightly)?.[1];
  assert.ok(nightlyName);
  assert.match(notifier, new RegExp(`^\\s+- ${nightlyName}$`, "mu"));
  assert.match(nightly, /cancel-in-progress: false/u);
  assert.match(
    readFileSync(".github/actions/slides-authoring-image/action.yml", "utf8"),
    /hashFiles\('docker\/ci-slides-authoring\/Dockerfile'\)/u,
  );

  // The browsers in the image are the ones the pinned Playwright expects.
  const imageVersion = /playwright:v(\d+\.\d+\.\d+)-/u.exec(
    readFileSync("docker/ci-slides-authoring/Dockerfile", "utf8"),
  )?.[1];
  const pinnedVersion = /^ {2}playwright: (\d+\.\d+\.\d+)$/mu.exec(
    readFileSync("pnpm-workspace.yaml", "utf8"),
  )?.[1];
  assert.ok(imageVersion, "no Playwright tag in the Dockerfile");
  assert.equal(imageVersion, pinnedVersion);

  // What the job executes: the image and the actions that run the shards.
  for (const path of [
    "docker/ci-slides-authoring/Dockerfile",
    ".github/actions/slides-authoring-image/action.yml",
    ".github/actions/slides-authoring-shard/action.yml",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.slides_authoring_e2e,
      true,
      path,
    );
  }
});

test("a selected Slides authoring run includes every job", () => {
  assert.deepEqual(
    slidesAuthoringMatrix().include.map((entry) => entry.shard),
    [...SLIDES_AUTHORING_SHARDS],
  );
});

test("retains Slides parity and corpus gates while keeping the full soak manual", () => {
  const ciWorkflow = readFileSync(
    ".github/actions/slides-authoring-shard/action.yml",
    "utf8",
  );
  const soakWorkflow = readFileSync(
    ".github/workflows/slides-authoring-fuzz-soak.yml",
    "utf8",
  );

  assert.match(
    ciWorkflow,
    /run: pnpm exec tsx scripts\/edit-fidelity\/run\.ts --authoring --authoring-shard 1\/3\n/u,
  );
  assert.match(
    ciWorkflow,
    /--authoring --authoring-shard 1\/3 --browser webkit/u,
  );
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
  assert.match(soakWorkflow, /browser:\s*\[chromium, webkit, firefox\]/u);
  assert.match(
    soakWorkflow,
    /seed:\s*\[\s*1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8,\s*9,\s*10,\s*11,\s*12,\s*13,\s*14,\s*15,\s*16,\s*17,\s*18,\s*19,\s*20,\s*\]/u,
  );
  assert.match(
    soakWorkflow,
    /--seed\s+\$\{\{ matrix\.seed \}\}[\s\S]*--seeds 1 --steps 500/u,
  );
});

test("fails closed for empty and unknown root change sets", () => {
  const empty = classifyChangedPaths([]);
  assert.equal(empty.docsOnly, false);
  assert.equal(empty.full, true);
  assert.equal(empty.checks.build, true);

  const unknown = classifyChangedPaths(["new-root-config.ts"]);
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
  const coreRequestPaths = [
    "packages/core/src/server/auth.ts",
    "packages/core/src/server/core-routes-plugin.ts",
    "packages/core/src/server/framework-request-context.ts",
    "packages/core/src/server/framework-request-handler.ts",
    "packages/core/src/server/poll.ts",
  ];
  const coreConfig = classifyChangedPaths([
    "packages/core/src/app-config/analytics.ts",
  ]);
  const coreTest = classifyChangedPaths([
    "packages/core/src/db/client.spec.ts",
  ]);
  const unrelatedCore = classifyChangedPaths([
    "packages/core/src/agent/engine/run.ts",
  ]);
  const creativeContext = classifyChangedPaths([
    "packages/creative-context/src/jobs/server-worker.ts",
  ]);
  const creativeContextTest = classifyChangedPaths([
    "packages/creative-context/src/jobs/server-worker.test.ts",
  ]);
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const templateCss = classifyChangedPaths(["templates/forms/app/global.css"]);
  const templateSvg = classifyChangedPaths([
    "templates/forms/app/components/logo.svg",
  ]);
  const templateTest = classifyChangedPaths([
    "templates/forms/actions/list-forms.spec.ts",
  ]);
  const templateDocs = classifyChangedPaths(["templates/forms/README.md"]);
  const templateDocsWithUnrelatedCore = classifyChangedPaths([
    "templates/forms/README.md",
    "packages/core/src/feature-flags/registry.ts",
  ]);
  const budgetScriptTest = classifyChangedPaths([
    "scripts/neon-query-budget.spec.ts",
  ]);
  const budgetScript = classifyChangedPaths(["scripts/neon-query-budget.ts"]);
  const docs = classifyChangedPaths(["docs/guide.md"]);

  assert.equal(core.checks.neon_query_budget, true);
  for (const path of coreRequestPaths) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.neon_query_budget, true, path);
    assert.deepEqual(scope.queryBudgetApps, [...QUERY_BUDGET_APPS], path);
  }
  assert.equal(coreConfig.checks.neon_query_budget, true);
  assert.equal(coreTest.checks.neon_query_budget, false);
  assert.equal(unrelatedCore.checks.neon_query_budget, false);
  assert.equal(creativeContext.checks.neon_query_budget, true);
  assert.equal(creativeContextTest.checks.neon_query_budget, false);
  assert.deepEqual(creativeContext.queryBudgetApps, [
    "analytics",
    "assets",
    "content",
    "design",
    "slides",
  ]);
  assert.equal(template.checks.neon_query_budget, true);
  assert.equal(templateCss.checks.neon_query_budget, false);
  assert.equal(templateSvg.checks.neon_query_budget, false);
  assert.equal(templateTest.checks.neon_query_budget, false);
  assert.equal(templateDocs.checks.neon_query_budget, false);
  assert.equal(templateDocsWithUnrelatedCore.checks.neon_query_budget, false);
  assert.equal(budgetScriptTest.checks.neon_query_budget, false);
  assert.equal(budgetScript.checks.neon_query_budget, true);
  assert.equal(docs.checks.neon_query_budget, false);
});

test("selects Content parity for the Core contracts its tests import", () => {
  for (const path of [
    "packages/core/src/action.ts",
    "packages/core/src/db/client.ts",
    "packages/core/src/eval/index.ts",
    "packages/core/src/private-blob/index.ts",
    "packages/core/src/server/request-context.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.content,
      true,
      `${path} must select Content parity`,
    );
  }

  for (const path of [
    "packages/core/src/agent/engine/run.ts",
    "packages/core/src/db/client.spec.ts",
    "packages/core/src/feature-flags/registry.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.content,
      false,
      `${path} must not select Content parity`,
    );
  }
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

test("measures every template for database runtime and budget changes, and Creative Context consumers", () => {
  const core = classifyChangedPaths([
    "packages/core/src/db/client.ts",
    "templates/forms/actions/list-forms.ts",
  ]);
  const unrelatedCore = classifyChangedPaths([
    "packages/core/src/agent/engine/run.ts",
    "templates/forms/actions/list-forms.ts",
  ]);
  const creativeContext = classifyChangedPaths([
    "packages/creative-context/src/jobs/server-worker.ts",
  ]);
  const budget = classifyChangedPaths(["scripts/neon-query-budgets.json"]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);

  assert.deepEqual(core.queryBudgetApps, [...QUERY_BUDGET_APPS]);
  assert.deepEqual(unrelatedCore.queryBudgetApps, ["forms"]);
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

test("runs the connection budget only for Core database changes", () => {
  const core = classifyChangedPaths(["packages/core/src/db/client.ts"]);
  const coreTest = classifyChangedPaths([
    "packages/core/src/db/client.spec.ts",
  ]);
  const unrelatedCore = classifyChangedPaths([
    "packages/core/src/agent/engine/run.ts",
  ]);
  const template = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  const tooling = classifyChangedPaths([
    "scripts/agent-friction-report.mjs",
    "AGENTS.md",
  ]);

  assert.equal(core.checks.neon_connection_budget, true);
  assert.equal(coreTest.checks.neon_connection_budget, false);
  assert.equal(unrelatedCore.checks.neon_connection_budget, false);
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
  const unrelatedCore = classifyChangedPaths([
    "packages/core/src/feature-flags/registry.ts",
  ]);
  const unrelatedCoreTemplate = classifyChangedPaths([
    "packages/core/src/templates/factory/.agents/skills/review-prs/SKILL.md",
  ]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);
  const tooling = classifyChangedPaths(["scripts/agent-friction-report.mjs"]);

  assert.equal(template.full, false);
  assert.equal(template.checks.scaffold, true);
  assert.equal(template.checks.builder_code_starter_scaffold, true);
  assert.equal(core.checks.scaffold, true);
  assert.equal(core.checks.builder_code_starter_scaffold, true);
  for (const path of [
    "packages/core/src/cli/setup-agents.ts",
    "packages/core/src/cli/skills.ts",
    "packages/core/src/cli/tar-command.ts",
    "packages/core/src/cli/template-layer.ts",
    "packages/core/src/cli/templates-meta.ts",
    "packages/core/src/cli/upgrade.ts",
    "packages/core/src/cli/workspace-skill-policy.ts",
    "packages/core/src/cli/workspace-yaml.ts",
    "packages/core/src/cli/workspacify.ts",
    "packages/core/src/agent/engine/ai-sdk-engine.ts",
    "packages/core/src/shared/workspace-app-id.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.scaffold, true, path);
    assert.equal(scope.scaffoldCli, true, path);
    assert.equal(scope.checks.builder_code_starter_scaffold, false, path);
  }
  assert.equal(unrelatedCore.checks.scaffold, false);
  assert.equal(unrelatedCore.checks.builder_code_starter_scaffold, false);
  assert.equal(unrelatedCoreTemplate.checks.scaffold, false);
  assert.equal(unrelatedCoreTemplate.scaffoldCli, false);
  assert.equal(unrelatedCoreTemplate.scaffoldWorkspace, false);
  assert.equal(
    unrelatedCoreTemplate.checks.builder_code_starter_scaffold,
    false,
  );
  const forms = classifyChangedPaths(["templates/forms/actions/list-forms.ts"]);

  assert.equal(chat.checks.scaffold, true);
  assert.equal(chat.checks.builder_code_starter_scaffold, true);
  const chatTest = classifyChangedPaths([
    "templates/chat/actions/hello.spec.ts",
  ]);
  assert.equal(chatTest.checks.scaffold, false);
  assert.equal(chatTest.checks.builder_code_starter_scaffold, false);
  assert.equal(chatTest.checks.agentkit_acceptance, false);
  assert.equal(chat.checks.scaffold, true);
  assert.equal(chat.scaffoldCli, true);
  assert.equal(chat.scaffoldWorkspace, true);
  assert.deepEqual(chat.scaffoldWorkspaceApps, []);
  const workspaceTemplate = classifyChangedPaths([
    "packages/core/src/templates/workspace-root/package.json",
  ]);
  assert.equal(workspaceTemplate.scaffoldWorkspace, true);
  assert.deepEqual(workspaceTemplate.scaffoldWorkspaceApps, [
    "calendar",
    "dispatch",
  ]);
  const headlessTemplate = classifyChangedPaths([
    "packages/core/src/templates/headless/AGENTS.md",
    "packages/core/src/templates/headless/package.json",
  ]);
  assert.equal(headlessTemplate.scaffoldCli, true);
  assert.deepEqual(
    classifyChangedPaths(["templates/calendar/app/components/EventCard.tsx"])
      .scaffoldWorkspaceApps,
    ["calendar"],
  );
  assert.deepEqual(
    classifyChangedPaths(["packages/dispatch/src/index.ts"])
      .scaffoldWorkspaceApps,
    ["dispatch"],
  );
  assert.deepEqual(
    classifyChangedPaths(["packages/scheduling/src/index.ts"])
      .scaffoldWorkspaceApps,
    ["calendar"],
  );
  assert.deepEqual(
    classifyChangedPaths(["packages/core/src/cli/create-workspace.ts"])
      .scaffoldWorkspaceApps,
    ["calendar", "dispatch"],
  );
  assert.equal(forms.checks.builder_code_starter_scaffold, false);
  assert.equal(full.checks.builder_code_starter_scaffold, true);
  assert.equal(tooling.full, true);
  assert.equal(tooling.checks.builder_code_starter_scaffold, false);

  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const scaffoldJobStart = workflow.indexOf("  scaffold-e2e:\n");
  const scaffoldJobEnd = workflow.indexOf(
    "\n  ssr-boot-smoke:",
    scaffoldJobStart,
  );
  const scaffoldJob = workflow.slice(scaffoldJobStart, scaffoldJobEnd);
  assert.match(scaffoldJob, /outputs\.scaffold_cli/u);
  assert.match(scaffoldJob, /outputs\.scaffold_workspace/u);
  assert.match(scaffoldJob, /outputs\.builder_code_starter_scaffold/u);
  assert.doesNotMatch(scaffoldJob, /outputs\.scaffold ==/u);
});

test("scopes trusted acceptance to production Content and Calendar inputs", () => {
  for (const path of [
    "templates/content/actions/update-document.ts",
    "templates/calendar/app/components/EventCard.tsx",
  ]) {
    assert.equal(classifyChangedPaths([path]).checks.trusted_acceptance, true);
  }

  assert.deepEqual(
    classifyChangedPaths(["templates/content/actions/update-document.ts"])
      .trustedAcceptanceApps,
    ["content"],
  );
  assert.deepEqual(
    classifyChangedPaths(["templates/calendar/app/components/EventCard.tsx"])
      .trustedAcceptanceApps,
    ["calendar"],
  );
  assert.deepEqual(
    classifyChangedPaths(["pnpm-lock.yaml"]).trustedAcceptanceApps,
    ["calendar", "content"],
  );

  for (const path of [
    "templates/content/app/routes/page.test.tsx",
    "templates/content/docs/authoring.md",
    "templates/calendar/app/components/EventCard.test.tsx",
    "templates/dispatch/actions/create-app.ts",
    "packages/dispatch/src/index.ts",
  ]) {
    assert.equal(classifyChangedPaths([path]).checks.trusted_acceptance, false);
  }
});

test("smokes only the changed SSR templates for a template-only change", () => {
  const scope = classifyChangedPaths([
    "templates/clips/app/routes/index.tsx",
    "templates/forms/actions/list-forms.ts",
  ]);
  const unsmoked = classifyChangedPaths([
    "templates/forms/actions/list-forms.ts",
  ]);
  const docs = classifyChangedPaths(["templates/clips/README.md"]);
  const e2e = classifyChangedPaths([
    "templates/content/e2e/chatgpt-widget-body-paint.spec.ts",
  ]);

  assert.equal(scope.full, false);
  assert.equal(scope.checks.ssr_boot, true);
  assert.deepEqual(scope.ssrBootApps, ["clips"]);
  assert.equal(unsmoked.checks.ssr_boot, false);
  assert.deepEqual(unsmoked.ssrBootApps, []);
  assert.equal(docs.checks.ssr_boot, false);
  assert.deepEqual(docs.ssrBootApps, []);
  assert.equal(e2e.checks.ssr_boot, false);
  assert.deepEqual(e2e.ssrBootApps, []);
});

test("smokes every SSR template when a shared package or CI changes", () => {
  const toolkit = classifyChangedPaths([
    "packages/toolkit/src/app/providers/AppProviders.tsx",
    "templates/plan/app/root.tsx",
  ]);
  const unrelatedToolkit = classifyChangedPaths([
    "packages/toolkit/src/canvas-interactions/drag.ts",
    "templates/plan/app/root.tsx",
  ]);
  const toolkitTest = classifyChangedPaths([
    "packages/toolkit/src/app/providers/AppProviders.spec.tsx",
  ]);
  const unrelatedCore = classifyChangedPaths([
    "packages/core/src/feature-flags/registry.ts",
  ]);
  const coreClientRuntime = classifyChangedPaths([
    "packages/core/src/client/agent-provider-catalog.ts",
  ]);
  const unrelatedCoreClient = classifyChangedPaths([
    "packages/core/src/client/use-active-agent-chat-run.ts",
  ]);
  const coreTest = classifyChangedPaths([
    "packages/core/src/server/request-context.spec.ts",
  ]);
  const otelTest = classifyChangedPaths(["packages/otel/src/index.test.ts"]);
  const otel = classifyChangedPaths(["packages/otel/src/index.ts"]);
  const ssrHarness = classifyChangedPaths(["scripts/ssr-boot-smoke.mjs"]);
  const full = classifyChangedPaths(["pnpm-lock.yaml"]);

  assert.deepEqual(toolkit.ssrBootApps, [...SSR_BOOT_APPS]);
  assert.deepEqual(unrelatedToolkit.ssrBootApps, ["plan"]);
  assert.equal(unrelatedToolkit.checks.ssr_boot, true);
  assert.equal(toolkitTest.checks.ssr_boot, false);
  assert.deepEqual(toolkitTest.ssrBootApps, []);
  assert.equal(unrelatedCore.checks.ssr_boot, false);
  assert.deepEqual(unrelatedCore.ssrBootApps, []);
  assert.equal(coreClientRuntime.checks.ssr_boot, true);
  assert.deepEqual(coreClientRuntime.ssrBootApps, [...SSR_BOOT_APPS]);
  assert.equal(unrelatedCoreClient.checks.ssr_boot, false);
  assert.deepEqual(unrelatedCoreClient.ssrBootApps, []);
  assert.equal(coreTest.checks.ssr_boot, false);
  assert.equal(otelTest.checks.ssr_boot, false);
  assert.equal(otel.checks.ssr_boot, true);
  assert.deepEqual(otel.ssrBootApps, [...SSR_BOOT_APPS]);
  assert.deepEqual(ssrHarness.ssrBootApps, [...SSR_BOOT_APPS]);
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

test("routes Design pin attestation inputs to core regression", () => {
  const attestationInputs = [
    {
      path: "templates/design/e2e/retry-failure-reporter.ts",
      full: false,
      broad: false,
    },
    {
      path: "scripts/design-e2e-regression-pin-identities.ts",
      full: true,
      broad: false,
    },
    {
      path: "scripts/guard-design-e2e-regression-pins.ts",
      full: false,
      broad: false,
    },
    {
      path: "scripts/design-e2e-regression-pins.ts",
      full: true,
      broad: false,
    },
  ];

  for (const { path, full, broad } of attestationInputs) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.design_canvas_core_regression, true, path);
    assert.equal(scope.full, full, path);
    assert.equal(scope.checks.design_canvas_broad_workflows, broad, path);
    assert.deepEqual(scope.designCanvasE2eSpecs, [], path);
    assert.deepEqual(scope.designCanvasE2eDiagnosticSpecs, [], path);
  }

  assert.deepEqual(
    classifyChangedPaths(["scripts/design-e2e-regression-pins.ts"]).scriptTests,
    ["scripts/design-e2e-regression-pins.test.ts"],
  );

  const selectorTest = classifyChangedPaths([
    "scripts/design-e2e-regression-pins.test.ts",
  ]);
  assert.equal(selectorTest.checks.design_canvas_core_regression, false);
  assert.equal(selectorTest.checks.design_canvas_broad_workflows, false);
  assert.equal(selectorTest.checks.guards, true);
  assert.deepEqual(selectorTest.scriptTests, [
    "scripts/design-e2e-regression-pins.test.ts",
  ]);

  const identityHelper = classifyChangedPaths([
    "scripts/design-e2e-regression-pin-identities.ts",
  ]);
  assert.deepEqual(identityHelper.scriptTests, [
    "scripts/design-e2e-regression-pin-identities.test.ts",
  ]);

  const config = classifyChangedPaths([
    "templates/design/playwright.config.ts",
  ]);
  assert.equal(config.checks.design_canvas_core_regression, true);
  assert.equal(config.checks.design_canvas_broad_workflows, true);
  assert.deepEqual(config.designCanvasBroadWorkflowShards, [
    "ai-sidebar-loopback",
    "music-app-workflow",
    "home-system-selection",
    "landing-page-build",
    "autolayout-vertical-center-trailing",
  ]);
  assert.deepEqual(config.designCanvasE2eSpecs, []);
  assert.deepEqual(config.designCanvasE2eDiagnosticSpecs, []);

  const unrelatedUnitTest = classifyChangedPaths([
    "templates/design/playwright-cleanup.test.ts",
  ]);
  assert.equal(unrelatedUnitTest.checks.design_canvas_core_regression, false);
  assert.equal(unrelatedUnitTest.checks.design_canvas_broad_workflows, false);
  assert.deepEqual(unrelatedUnitTest.designCanvasE2eSpecs, []);
  assert.deepEqual(unrelatedUnitTest.designCanvasE2eDiagnosticSpecs, []);
});

test("routes shared Design E2E support modules and keeps dedicated lanes", () => {
  for (const { path, core } of [
    { path: "templates/design/e2e/helpers.ts", core: true },
    { path: "templates/design/e2e/rails.ts", core: false },
    { path: "templates/design/e2e/interact-helpers.ts", core: false },
    { path: "templates/design/e2e/startup-child.ts", core: false },
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.design_canvas_core_regression, core, path);
    assert.equal(
      scope.checks.design_canvas_broad_workflows,
      scope.designCanvasBroadWorkflowShards.length > 0,
      path,
    );
    assert.ok(scope.designCanvasE2eSpecs.length > 0, path);
    assert.deepEqual(
      scope.designCanvasE2eDiagnosticSpecs,
      scope.designCanvasE2eSpecs,
      path,
    );
  }

  const pinReporter = classifyChangedPaths([
    "templates/design/e2e/retry-failure-reporter.ts",
  ]);
  assert.equal(pinReporter.checks.design_canvas_core_regression, true);
  assert.equal(pinReporter.checks.design_canvas_broad_workflows, false);

  const preAuthSmoke = classifyChangedPaths([
    "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
  ]);
  assert.equal(preAuthSmoke.checks.design_canvas_core_regression, false);
  assert.equal(preAuthSmoke.checks.design_canvas_broad_workflows, false);
  assert.equal(preAuthSmoke.checks.pre_auth_session_replay_e2e, true);
});

test("selects focused Design core regression for its runtime dependencies", () => {
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
    "templates/design/e2e/css-style-helpers.ts",
    "templates/design/e2e/z-order-behavior.spec.ts",
    "templates/design/e2e/corner-radius-handle-drag.spec.ts",
    "templates/design/e2e/responsive-overview-regressions.spec.ts",
    "templates/design/e2e/helpers.ts",
    "templates/design/e2e/drag-and-drop.shared.ts",
    "templates/design/e2e/drag-and-drop.reparenting-rules.spec.ts",
    "templates/design/e2e/drag-and-drop.auto-layout.spec.ts",
    "templates/design/e2e/cross-screen-auto-layout.spec.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.design_canvas_core_regression,
      true,
      path,
    );
  }

  for (const path of [
    "templates/design/e2e/overview-wheel-zoom.spec.ts",
    "templates/design/e2e/position-alignment.spec.ts",
    "templates/design/e2e/drag-and-drop.drag-feedback.spec.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.design_canvas_core_regression, false, path);
    assert.deepEqual(scope.designCanvasE2eSpecs, [path]);
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
    "packages/core/src/index.ts",
    "packages/toolkit/src/index.ts",
    "packages/creative-context/src/index.ts",
    "packages/core/src/file-upload/registry.ts",
    "packages/core/src/agent/production-agent.ts",
    "packages/toolkit/src/app/chat/chat/run-recovery.tsx",
    "packages/agentkit/src/protocol/agui.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.design_canvas_core_regression,
      false,
      path,
    );
  }

  for (const path of []) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.design_canvas_core_regression, false, path);
    assert.deepEqual(scope.designCanvasE2eSpecs, [path]);
  }

  const aiSidebar = classifyChangedPaths([
    "templates/design/e2e/ai-sidebar-reporter-path.spec.ts",
  ]);
  assert.equal(aiSidebar.checks.design_canvas_core_regression, false);
  assert.deepEqual(aiSidebar.designCanvasBroadWorkflowShards, [
    "ai-sidebar-loopback",
  ]);

  const directAndDependencySpecs = classifyChangedPaths([
    "templates/design/e2e/position-alignment.spec.ts",
    "templates/design/e2e/inspector-styles.spec.ts",
    "templates/design/e2e/fixture.test.tsx",
    "templates/design/app/components/design/EditPanel.tsx",
  ]);
  assert.ok(
    directAndDependencySpecs.designCanvasE2eSpecs.includes(
      "templates/design/e2e/fixture.test.tsx",
    ),
  );
  assert.ok(
    directAndDependencySpecs.designCanvasE2eSpecs.includes(
      "templates/design/e2e/inspector-styles.spec.ts",
    ),
  );
  assert.ok(
    directAndDependencySpecs.designCanvasE2eSpecs.includes(
      "templates/design/e2e/position-alignment.spec.ts",
    ),
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
  assert.equal(broadDesignScope.checks.design_canvas_core_regression, false);
  assert.equal(broadDesignScope.checks.design_canvas_broad_workflows, false);
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
      .design_canvas_core_regression,
    false,
  );
  assert.equal(
    classifyChangedPaths(["docs/guide.md"]).checks
      .design_canvas_core_regression,
    false,
  );
});

test("routes CSS style helper changes to its exact importing specs", () => {
  const helperPath = "templates/design/e2e/css-style-helpers.ts";
  const routedSpecs = [
    "templates/design/e2e/css-style-helpers.spec.ts",
    "templates/design/e2e/drag-and-drop.modifier-timing.spec.ts",
    "templates/design/e2e/interaction-card-structure.spec.ts",
    "templates/design/e2e/interaction-mobile-landing.spec.ts",
  ];
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-css-helper-importers-"),
  );
  const writeSource = (path: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, 'import "./css-style-helpers";\n');
  };

  const renamedSpec = "templates/design/e2e/renamed.spec.ts";
  try {
    const helper = join(fixtureRoot, helperPath);
    mkdirSync(dirname(helper), { recursive: true });
    writeFileSync(helper, "export const styles = true;\n");
    for (const spec of routedSpecs) writeSource(spec);

    const scope = classifyChangedPaths([helperPath], [], fixtureRoot);
    assert.equal(scope.checks.design_canvas_core_regression, true);
    assert.equal(scope.checks.design_canvas_broad_workflows, false);
    assert.deepEqual(scope.designCanvasBroadWorkflowShards, []);
    assert.deepEqual(scope.designCanvasE2eSpecs, routedSpecs);
    assert.deepEqual(scope.designCanvasE2eDiagnosticSpecs, routedSpecs);
    assert.equal(scope.designCanvasE2eSpecCount, routedSpecs.length);

    const withRename = classifyChangedPaths(
      [helperPath, renamedSpec],
      [renamedSpec],
      fixtureRoot,
    );
    assert.deepEqual(withRename.designCanvasE2eSpecs, [
      ...routedSpecs,
      renamedSpec,
    ]);
    assert.deepEqual(withRename.designCanvasE2eDiagnosticSpecs, routedSpecs);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("routes JavaScript helper changes to their exact importing specs", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-javascript-helpers-"),
  );
  const helpers = [
    ["shared-helper.js", "javascript-consumer.spec.ts"],
    ["shared-helper.jsx", "jsx-consumer.spec.ts"],
    ["shared-helper.mjs", "module-consumer.spec.ts"],
    ["shared-helper.cjs", "commonjs-consumer.spec.ts"],
  ] as const;
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };

  try {
    for (const [helper, spec] of helpers) {
      writeSource(`templates/design/e2e/${helper}`, "export {};");
      writeSource(`templates/design/e2e/${spec}`, `import "./${helper}";\n`);
    }

    const scope = classifyChangedPaths(
      helpers.map(([helper]) => `templates/design/e2e/${helper}`),
      [],
      fixtureRoot,
    );
    assert.deepEqual(
      scope.designCanvasE2eSpecs,
      helpers.map(([, spec]) => `templates/design/e2e/${spec}`).sort(),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("traces Design E2E helper imports and literal dynamic imports", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-import-graph-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  const helperPath = "templates/design/e2e/shared-helper.ts";
  const expectedSpecs = [
    "templates/design/e2e/dynamic-consumer.test.tsx",
    "templates/design/e2e/transitive-consumer.spec.ts",
  ];

  try {
    writeSource(helperPath, "export const helper = true;\n");
    writeSource(
      "templates/design/e2e/intermediate-helper.ts",
      'import "./shared-helper";\n',
    );
    writeSource(
      "templates/design/e2e/transitive-consumer.spec.ts",
      'import "./intermediate-helper";\n',
    );
    writeSource(
      "templates/design/e2e/dynamic-consumer.test.tsx",
      "void import(`./shared-helper`);\n",
    );
    writeSource(
      "templates/design/e2e/unrelated.test.tsx",
      "export const fixture = true;\n",
    );
    writeSource(
      "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
      'import "./shared-helper";\n',
    );

    const scope = classifyChangedPaths([helperPath], [], fixtureRoot);
    assert.deepEqual(scope.designCanvasE2eSpecs, expectedSpecs);
    assert.deepEqual(scope.designCanvasE2eDiagnosticSpecs, expectedSpecs);
    assert.equal(scope.checks.pre_auth_session_replay_e2e, true);
    assert.ok(
      !scope.designCanvasE2eSpecs.includes(
        "templates/design/e2e/unrelated.test.tsx",
      ),
    );
    assert.ok(
      !scope.designCanvasE2eSpecs.includes(
        "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("raw import matching keeps regex quotes from hiding helper consumers", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-regex-import-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  const helperPath = "templates/design/e2e/shared-helper.ts";
  const consumerPath = "templates/design/e2e/regex-quoted-consumer.spec.tsx";

  try {
    writeSource(helperPath, "export const helper = true;\n");
    writeSource(
      consumerPath,
      [
        'const pattern = /".*?/;',
        'import "./shared-helper";',
        'const view = <div>text "</div>;',
      ].join("\n"),
    );
    writeSource(
      "templates/design/e2e/unrelated.test.tsx",
      "export const fixture = true;\n",
    );

    assert.deepEqual(
      classifyChangedPaths([helperPath], [], fixtureRoot).designCanvasE2eSpecs,
      [consumerPath],
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("fails closed when JSX quotes make helper imports ambiguous", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-jsx-import-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  const helperPath = "templates/design/e2e/shared-helper.ts";
  const consumerPath = "templates/design/e2e/jsx-quoted-consumer.spec.tsx";
  const unrelatedPath = "templates/design/e2e/unrelated.test.tsx";

  try {
    writeSource(helperPath, "export const helper = true;\n");
    writeSource(
      consumerPath,
      [
        'const view = <div>quoted " text</div>;',
        'import "./shared-helper";',
      ].join("\n"),
    );
    writeSource(unrelatedPath, "export const fixture = true;\n");

    const scope = classifyChangedPaths([helperPath], [], fixtureRoot);
    assert.deepEqual(scope.designCanvasE2eSpecs, [consumerPath, unrelatedPath]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("falls back safely for removed or untraceable Design E2E helpers", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-removed-helper-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };

  try {
    writeSource(
      "templates/design/e2e/removed-helper-consumer.spec.ts",
      'import "./removed-helper";\n',
    );
    writeSource(
      "templates/design/e2e/unrelated.test.tsx",
      "export const fixture = true;\n",
    );
    writeSource(
      "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts",
      "export const dedicated = true;\n",
    );

    const deletedHelper = classifyChangedPaths(
      ["templates/design/e2e/removed-helper.ts"],
      [],
      fixtureRoot,
    );
    assert.deepEqual(deletedHelper.designCanvasE2eSpecs, [
      "templates/design/e2e/removed-helper-consumer.spec.ts",
    ]);

    writeSource(
      "templates/design/e2e/orphan-helper.ts",
      "export const orphan = true;\n",
    );
    const noKnownImporter = classifyChangedPaths(
      ["templates/design/e2e/orphan-helper.ts"],
      [],
      fixtureRoot,
    );
    assert.deepEqual(noKnownImporter.designCanvasE2eSpecs, [
      "templates/design/e2e/removed-helper-consumer.spec.ts",
      "templates/design/e2e/unrelated.test.tsx",
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("falls back to all eligible specs when a dynamic import is computed", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-computed-import-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };

  try {
    writeSource(
      "templates/design/e2e/computed-helper.ts",
      "export const helper = true;\n",
    );
    writeSource(
      "templates/design/e2e/static-consumer.spec.ts",
      'import "./computed-helper";\n',
    );
    writeSource(
      "templates/design/e2e/computed-import-consumer.spec.ts",
      "void import(resolveModulePath());\n",
    );
    writeSource(
      "templates/design/e2e/unrelated.test.tsx",
      "export const fixture = true;\n",
    );

    const scope = classifyChangedPaths(
      ["templates/design/e2e/computed-helper.ts"],
      [],
      fixtureRoot,
    );
    assert.deepEqual(scope.designCanvasE2eSpecs, [
      "templates/design/e2e/computed-import-consumer.spec.ts",
      "templates/design/e2e/static-consumer.spec.ts",
      "templates/design/e2e/unrelated.test.tsx",
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("falls back when a template expression hides a dynamic import", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-template-import-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };

  try {
    writeSource(
      "templates/design/e2e/template-helper.ts",
      "export const helper = true;\n",
    );
    writeSource(
      "templates/design/e2e/static-consumer.spec.ts",
      'import "./template-helper";\n',
    );
    writeSource(
      "templates/design/e2e/template-expression-consumer.spec.ts",
      "void `${import(resolveHelperPath())}`;\n",
    );
    writeSource(
      "templates/design/e2e/unrelated.test.tsx",
      "export const fixture = true;\n",
    );

    const scope = classifyChangedPaths(
      ["templates/design/e2e/template-helper.ts"],
      [],
      fixtureRoot,
    );
    assert.deepEqual(scope.designCanvasE2eSpecs, [
      "templates/design/e2e/static-consumer.spec.ts",
      "templates/design/e2e/template-expression-consumer.spec.ts",
      "templates/design/e2e/unrelated.test.tsx",
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("falls back when import and require arguments start with a literal", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-literal-prefix-import-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  const helperPath = "templates/design/e2e/computed-helper.ts";
  const consumers = [
    [
      "templates/design/e2e/computed-import-consumer.spec.ts",
      'void import("./computed-helper" + helperName);\n',
    ],
    [
      "templates/design/e2e/computed-require-consumer.spec.ts",
      'require("./computed-helper" + helperName);\n',
    ],
  ] as const;
  const expectedSpecs = [
    ...consumers.map(([path]) => path),
    "templates/design/e2e/static-consumer.spec.ts",
    "templates/design/e2e/unrelated.test.tsx",
  ].sort();

  try {
    writeSource(helperPath, "export const helper = true;\n");
    writeSource(
      "templates/design/e2e/static-consumer.spec.ts",
      'import "./computed-helper";\n',
    );
    writeSource("templates/design/e2e/unrelated.test.tsx", "export {};\n");

    for (const [consumerPath, source] of consumers) {
      for (const [path] of consumers) {
        writeSource(path, path === consumerPath ? source : "export {};\n");
      }
      const scope = classifyChangedPaths([helperPath], [], fixtureRoot);
      assert.deepEqual(scope.designCanvasE2eSpecs, expectedSpecs);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("falls back when apostrophes can hide imports in regex and JSX source", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-unterminated-token-"),
  );
  const writeSource = (path: string, source: string) => {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  };
  const helperPath = "templates/design/e2e/shared-helper.ts";
  const expectedSpecs = [
    "templates/design/e2e/jsx-consumer.spec.tsx",
    "templates/design/e2e/regex-consumer.spec.ts",
    "templates/design/e2e/static-consumer.spec.ts",
    "templates/design/e2e/unrelated.test.tsx",
  ];

  try {
    writeSource(helperPath, "export const helper = true;\n");
    writeSource(
      "templates/design/e2e/static-consumer.spec.ts",
      'import "./shared-helper";\n',
    );
    writeSource(
      "templates/design/e2e/regex-consumer.spec.ts",
      'const matcher = /\'/;\nimport "./shared-helper";\n',
    );
    writeSource(
      "templates/design/e2e/jsx-consumer.spec.tsx",
      'const view = <span>it\'s ready</span>;\nimport "./shared-helper";\n',
    );
    writeSource("templates/design/e2e/unrelated.test.tsx", "export {};\n");

    const scope = classifyChangedPaths([helperPath], [], fixtureRoot);
    assert.deepEqual(scope.designCanvasE2eSpecs, expectedSpecs);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("routes direct Design specs before source-graph discovery", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "ci-change-scope-design-cold-spec-"),
  );
  const specPath = "templates/design/e2e/virtual.spec.mts";

  try {
    const scope = classifyChangedPaths([specPath], [], fixtureRoot);
    assert.deepEqual(scope.designCanvasE2eSpecs, [specPath]);
    assert.deepEqual(scope.designCanvasE2eDiagnosticSpecs, [specPath]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Design core and broad selectors stay independently scoped", () => {
  const cases = [
    {
      name: "selected Design runtime",
      paths: ["templates/design/app/components/MultiScreenCanvas.tsx"],
      core: true,
      broad: false,
    },
    {
      name: "unrelated workspace",
      paths: ["templates/calendar/app/routes/index.tsx"],
      core: false,
      broad: false,
    },
    { name: "full run", paths: [], core: true, broad: true },
    {
      name: "CI tooling-only full run",
      paths: ["scripts/ci-change-scope.ts"],
      core: false,
      broad: false,
    },
  ];

  for (const { name, paths, core, broad } of cases) {
    const scope = classifyChangedPaths(paths);
    assert.equal(
      scope.checks.design_canvas_core_regression,
      core,
      `${name}: core`,
    );
    assert.equal(
      scope.checks.design_canvas_broad_workflows,
      broad,
      `${name}: broad`,
    );
  }

  const homeSelection = classifyChangedPaths([
    "templates/design/e2e/home-system-selection.spec.ts",
  ]);
  assert.deepEqual(homeSelection.designCanvasBroadWorkflowShards, [
    "home-system-selection",
  ]);
  assert.deepEqual(
    classifyChangedPaths([
      "templates/design/app/components/design/EditPanel.document-colors.test.tsx",
    ]).designCanvasBroadWorkflowShards,
    [],
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
  const musicAppWorkflow = step("Run long music-app workflow regression");
  const musicAppDiagnostics = step("Upload music-app workflow diagnostics");
  const broadRetryDiagnostics = step("Detect retried Design test failures");
  const broadWorkflowArtifacts = step("Upload Design E2E artifacts");
  const landingPageWorkflow = step(
    "Run landing-page build workflow regression",
  );
  const homeSystemSelection = step(
    "Run Home design-system selection regressions",
  );
  const verticalAutoLayoutWorkflow = step(
    "Run vertical auto-layout held-guide regression",
  );
  const changedSpecRegressions = step("Run changed Design E2E specs");
  const preAuthReplaySmoke = step("Run pre-auth session replay smoke");
  const designE2eWorkflow = readFileSync(
    ".github/workflows/design-e2e.yml",
    "utf8",
  );
  // source-read-ok: Playwright timeout contract is checked from the config source.
  const designPlaywrightConfig = readFileSync(
    "templates/design/playwright.config.ts",
    "utf8",
  );
  // source-read-ok: the Design setup budget is a source-level contract.
  const designGlobalSetup = readFileSync(
    "templates/design/e2e/global-setup.ts",
    "utf8",
  );
  const screenSelectionRegressions = step(
    "Run focused Screen selection history regressions",
  );
  assert.match(
    changedSpecRegressions,
    /^        timeout-minutes: 24$/m,
    "the changed-spec diagnostic step must fit inside its 30-minute job after setup",
  );
  assert.match(
    workflow,
    /^  pre-auth-session-replay-smoke:\n(?:.*\n){4}    timeout-minutes: 25$/m,
    "the pre-auth job must leave setup and artifact headroom",
  );
  assert.match(
    preAuthReplaySmoke,
    /^        timeout-minutes: 20$/m,
    "the pre-auth browser smoke must leave time for setup, webServer startup, and a full retry",
  );
  assert.match(
    designE2eWorkflow,
    /^    timeout-minutes: 90$/m,
    "the standalone Design job must cover the shard, loopback setup, and artifacts",
  );
  const designPullRequestTriggers =
    designE2eWorkflow.split(/^  schedule:/mu)[0];
  assert.match(
    designPullRequestTriggers,
    /templates\/design\/app\/components\/MultiScreenCanvas\.tsx/u,
  );
  for (const input of [
    "templates/design/e2e/helpers.ts",
    "templates/design/e2e/rails.ts",
    "templates/design/e2e/global-setup.ts",
    "templates/design/scripts/design-export-validation/corpus/**",
  ]) {
    assert.ok(
      designPullRequestTriggers.includes(input),
      `standalone Design workflow is missing a consumed input: ${input}`,
    );
  }
  assert.doesNotMatch(
    designPullRequestTriggers,
    /templates\/design\/e2e\/[^\n]*\.spec\.[jt]sx?/u,
    "direct Design E2E spec edits must use the focused changed-spec gate",
  );
  assert.doesNotMatch(
    designPullRequestTriggers,
    /templates\/design\/e2e\/\*\*/u,
    "unrelated Design E2E specs must not start the fixed expensive PR suites",
  );
  assert.doesNotMatch(
    designPullRequestTriggers,
    /templates\/design\/\*\*/u,
    "the standalone Design browser workflow must ignore unrelated docs, evals, and metadata",
  );
  assert.doesNotMatch(
    designPullRequestTriggers,
    /packages\/(?:core|toolkit|agentkit|creative-context|recap-cli)\//u,
    "the standalone Design browser workflow must not run for arbitrary shared-package changes",
  );
  assert.doesNotMatch(
    designPullRequestTriggers,
    /\.github\/workflows\/design-e2e\.yml/u,
    "editing the standalone Design workflow must not start its 90-minute browser job",
  );
  const runShardStep =
    designE2eWorkflow.match(
      /^      - name: Run shard\n([\s\S]*?)(?=^      - name:)/m,
    )?.[1] ?? "";
  const prRunIds = [
    ...runShardStep.matchAll(
      /E2E_RUN_ID="\$\{base_run_id\}-(?:exports|marquee)"/g,
    ),
  ];
  const globalSetupBudgetMs =
    Number(
      designGlobalSetup.match(
        /^const GLOBAL_SETUP_BUDGET_MS = (\d+) \* 60_000;$/m,
      )?.[1],
    ) * 60_000;
  const webServerTimeoutMs =
    Number(
      designPlaywrightConfig.match(/^        timeout: (\d+)_000,$/m)?.[1],
    ) * 1_000;
  const runShardTimeoutMinutes = Number(
    runShardStep.match(/^        timeout-minutes: (\d+)$/m)?.[1],
  );
  assert.equal(prRunIds.length, 2);
  assert.equal(
    runShardTimeoutMinutes * 60_000 -
      prRunIds.length * (globalSetupBudgetMs + webServerTimeoutMs),
    20 * 60_000,
    "the PR shard timeout must leave 20 minutes for tests after both setup and webServer budgets",
  );
  assert.match(
    designE2eWorkflow,
    /^      - name: Run chat attachment and sizing loopback E2E\n        if: \$\{\{ matrix\.shard == 1 && hashFiles\('templates\/design\/e2e\/ai-sidebar-reporter-path\.spec\.ts'\) != '' \}\}\n        working-directory: templates\/design\n        timeout-minutes: 21$/m,
    "the loopback attachment suite must budget global setup and webServer startup",
  );
  assert.match(
    designGlobalSetup,
    /^const HOME_WARMUP_BUDGET_MS = 3 \* 60_000;$/m,
    "Home warmup must reserve bounded time for Vite recovery",
  );
  assert.match(
    designGlobalSetup,
    /^const EDITOR_WARMUP_BUDGET_MS = 3 \* 60_000;$/m,
    "editor warmup must reserve bounded time for a cold compile",
  );
  assert.match(
    designGlobalSetup,
    /^const WARMUP_ATTEMPT_MS = 2 \* 60_000;$/m,
    "one warmup attempt must leave the rest of its budget for another",
  );
  assert.match(
    designGlobalSetup,
    /while \(Date\.now\(\) < deadline\) \{\s*try \{\s*await page\.goto\(url, \{\s*waitUntil: "domcontentloaded",\s*timeout: timeoutBefore\(deadline, WARMUP_ATTEMPT_MS\),\s*\}\);\s*await ready\.waitFor\(\{\s*state: "visible",\s*timeout: timeoutBefore\(deadline, WARMUP_ATTEMPT_MS\),\s*\}\);/,
    "a warmup attempt that a Vite reload or abort cuts short must navigate again until its deadline",
  );
  assert.deepEqual(
    [
      ...designGlobalSetup.matchAll(
        /await warmupFailure\(\s*warmupPage,\s*`\$\{baseURL\}\/(home|design\/\$\{designId\})`/g,
      ),
    ].map(([, route]) => route),
    ["home", "design/${designId}"],
    "Home and the editor must both warm through the retrying probe",
  );
  assert.match(
    changedSpecRegressions,
    /--shard="\$\{changed_shard\}\/\$\{\{ strategy\.job-total \}\}"/,
    "changed-spec diagnostics must shard across the whole sized matrix",
  );
  assert.ok(
    changedSpecRegressions.includes(
      "--grep-invert '(a drawn empty Frame refreshes its inspector after auto layout|sizing mode actions survive the selected layer route update)$|vertical center and trailing insertion keep held guides and exact reload geometry$'",
    ),
    "the long music-app and vertical auto-layout tests must run only in dedicated lanes",
  );
  assert.match(
    musicAppWorkflow,
    /^        if: \$\{\{ matrix\.shard == 'music-app-workflow' && contains\(fromJSON\(needs\.change-scope\.outputs\.design_canvas_e2e_specs\), 'templates\/design\/e2e\/interaction-responsive-music-app\.spec\.ts'\) \}\}$/m,
    "the long regression must use an exact changed-spec selector gate",
  );
  assert.match(
    musicAppWorkflow,
    /^        timeout-minutes: 29$/m,
    "the long music-app tests need setup, webServer, and test headroom",
  );
  assert.ok(
    musicAppWorkflow.includes(
      "DESIGN_CANVAS_E2E_SPECS: ${{ needs.change-scope.outputs.design_canvas_e2e_specs }}",
    ),
    "the long regression must use the shared changed-spec selector",
  );
  assert.ok(
    musicAppWorkflow.includes(
      "music_app_spec='e2e/interaction-responsive-music-app.spec.ts'",
    ) &&
      musicAppWorkflow.includes('if [[ ! -f "$music_app_spec" ]]; then') &&
      musicAppWorkflow.includes(
        'printf \'%s\\n\' "${existing_changed_specs[@]}" | grep -Fqx "$music_app_spec"',
      ),
    "the long regression must preflight that its selected spec still exists and resolved",
  );
  assert.ok(
    musicAppWorkflow.includes(
      "pnpm exec playwright test \"$music_app_spec\" \\\n            --grep '(a drawn empty Frame refreshes its inspector after auto layout|sizing mode actions survive the selected layer route update)$' \\\n            --workers=1 --retries=0 --trace on",
    ),
    "the dedicated shard must run only the long test once and retain a failure trace",
  );
  assert.match(
    musicAppDiagnostics,
    /^        if: \$\{\{ failure\(\) && matrix\.shard == 'music-app-workflow' \}\}$/m,
    "the dedicated shard must upload diagnostics when its long regression fails",
  );
  assert.ok(
    musicAppDiagnostics.includes(
      "templates/design/test-results/design-music-app-${{ github.run_id }}-${{ github.run_attempt }}/",
    ),
    "the failure artifact must retain the dedicated Playwright trace output",
  );
  assert.match(
    landingPageWorkflow,
    /^        if: \$\{\{ matrix\.shard == 'landing-page-build' && contains\(fromJSON\(needs\.change-scope\.outputs\.design_canvas_e2e_specs\), 'templates\/design\/e2e\/interaction-landing-page-build\.spec\.ts'\) \}\}$/m,
    "the landing-page workflow must use an exact changed-spec selector gate",
  );
  assert.match(
    landingPageWorkflow,
    /^        timeout-minutes: 29$/m,
    "the complete landing-page workflow needs setup, webServer, and test headroom",
  );
  assert.ok(
    landingPageWorkflow.includes(
      "DESIGN_CANVAS_E2E_SPECS: ${{ needs.change-scope.outputs.design_canvas_e2e_specs }}",
    ) &&
      landingPageWorkflow.includes('DESIGN_CANVAS_LANDING_PAGE_WORKFLOW: "1"'),
    "the landing-page workflow must resolve the same exact changed-path selector",
  );
  assert.ok(
    landingPageWorkflow.includes(
      "landing_page_spec='e2e/interaction-landing-page-build.spec.ts'",
    ) &&
      landingPageWorkflow.includes(
        'if [[ ! -f "$landing_page_spec" ]]; then',
      ) &&
      landingPageWorkflow.includes(
        'printf \'%s\\n\' "${existing_changed_specs[@]}" | grep -Fqx "$landing_page_spec"',
      ),
    "the landing-page lane must preflight that the selected full-file spec exists and resolves",
  );
  assert.ok(
    landingPageWorkflow.includes(
      'pnpm exec playwright test "$landing_page_spec" --workers=1 --retries=0 --trace on',
    ) && !landingPageWorkflow.includes("--grep"),
    "the dedicated lane must run the complete serial file once with traces",
  );
  assert.match(
    broadWorkflowArtifacts,
    /^        if: \$\{\{ always\(\) && matrix\.shard != 'music-app-workflow' && \(failure\(\) \|\| cancelled\(\) \|\| steps\.retry-artifacts\.outputs\.found == 'true'\) \}\}$/m,
    "the broad workflow artifacts must upload on failure, cancellation, or a retried test",
  );
  assert.ok(
    broadWorkflowArtifacts.includes(
      "templates/design/test-results/design-dnd-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}/**",
    ),
    "the landing-page matrix cell must retain its Design E2E traces and results",
  );
  assert.equal(
    homeSystemSelection.match(/^        if: (.+)$/m)?.[1],
    "matrix.shard == 'home-system-selection'",
  );
  assert.match(
    workflow,
    /^  design-canvas-broad-workflows:\n(?:.*\n){4}    timeout-minutes: \$\{\{ matrix\.shard == 'home-system-selection' && 40 \|\| \(matrix\.shard == 'music-app-workflow' \|\| matrix\.shard == 'landing-page-build'\) && 35 \|\| 30 \}\}$/m,
    "the Home workflow job must leave setup and artifact headroom after the long Playwright step",
  );
  assert.match(
    homeSystemSelection,
    /^        timeout-minutes: 28$/m,
    "Home system-selection coverage must fit global setup, webServer startup, three tests, and loopback startup",
  );
  assert.ok(
    homeSystemSelection.includes(
      "E2E_RUN_ID: design-dnd-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
    ),
    "the Home lane must use the broad Design run ID for retry detection and artifacts",
  );
  assert.ok(
    homeSystemSelection.includes('E2E_AI_SIDEBAR_LOOPBACK: "1"'),
    "the Home composer tests must opt in to the deterministic loopback provider",
  );
  assert.ok(
    homeSystemSelection.includes(
      "pnpm exec playwright test e2e/home-system-selection.spec.ts --project=home-system-selection --workers=1 --retries=0 --trace on",
    ),
    "the Home lane must run the dedicated Home project serially with traces",
  );
  assert.doesNotMatch(
    homeSystemSelection,
    /vertical auto-layout|autolayout-drag/,
    "Home selection must not carry the slow auto-layout regression",
  );
  assert.match(
    verticalAutoLayoutWorkflow,
    /^        if: \$\{\{ matrix\.shard == 'autolayout-vertical-center-trailing' && contains\(fromJSON\(needs\.change-scope\.outputs\.design_canvas_e2e_specs\), 'templates\/design\/e2e\/autolayout-drag-drop-matrix\.spec\.ts'\) \}\}$/m,
    "the vertical auto-layout test must run only when its exact changed spec is selected",
  );
  assert.match(
    verticalAutoLayoutWorkflow,
    /^        timeout-minutes: 23$/m,
    "the vertical auto-layout test needs setup, webServer, and test headroom",
  );
  assert.ok(
    verticalAutoLayoutWorkflow.includes(
      "vertical_test='vertical center and trailing insertion keep held guides and exact reload geometry'",
    ) &&
      verticalAutoLayoutWorkflow.includes(
        'if [[ ! -f "$vertical_spec" ]]; then',
      ) &&
      verticalAutoLayoutWorkflow.includes(
        'printf \'%s\\n\' "${existing_changed_specs[@]}" | grep -Fqx "$vertical_spec"',
      ) &&
      verticalAutoLayoutWorkflow.includes(
        'pnpm exec playwright test "$vertical_spec" --grep "$vertical_test$" --list --reporter=list',
      ) &&
      verticalAutoLayoutWorkflow.includes(
        'if [[ "$matching_tests" != "1" ]]; then',
      ) &&
      verticalAutoLayoutWorkflow.includes(
        'pnpm exec playwright test "$vertical_spec" --grep "$vertical_test$" --workers=1 --trace on',
      ),
    "the dedicated lane must fail closed on a missing or duplicate title and run only that test",
  );
  assert.ok(
    verticalAutoLayoutWorkflow.includes(
      "E2E_RUN_ID: design-dnd-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
    ),
    "the dedicated vertical auto-layout lane must keep its artifacts and database isolated",
  );
  assert.ok(
    broadRetryDiagnostics.includes(
      "test-results/$run_id/retry-failure.marker",
    ) &&
      broadWorkflowArtifacts.includes(
        "templates/design/test-results/design-dnd-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}/**",
      ),
    "the dedicated lane must use the standard matrix run ID for retry detection and artifacts",
  );
  assert.match(
    screenSelectionRegressions,
    /^        if: startsWith\(matrix\.shard, 'screen-history-'\)$/m,
    "Screen-selection regressions must run only on their dedicated shards",
  );
  assert.match(
    regressionCases,
    /^        if: \$\{\{ !startsWith\(matrix\.shard, 'screen-history-'\) \}\}$/m,
    "fixed Design regressions must not run on Screen-history shards",
  );
  assert.equal(
    aiSidebarLoopback.match(/^        if: (.+)$/m)?.[1],
    "matrix.shard == 'ai-sidebar-loopback'",
  );
  assert.match(
    aiSidebarLoopback,
    /^        timeout-minutes: 24$/m,
    "the loopback image suite needs setup, webServer, and test headroom",
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
  const screenHistoryCounts = screenHistoryShardSelectors.map(
    ({ selectors }) => selectors.length,
  );
  assert.ok(
    Math.max(...screenHistoryCounts) - Math.min(...screenHistoryCounts) <= 1,
    "Screen-history regressions must stay balanced across the three shards",
  );
  const screenHistoryCases = [
    "undo of a screen deletion selects the recreated screen under its new id",
    "deleting a selected child layer keeps its owning Screen",
    "selection changes are not undo steps, and Delete removes an additive Screen selection",
    "marquee-selecting child elements after a Screen pick deletes only the elements",
    "Undo after a canvas element click keeps the element selected for Delete",
    "failed Screen deletion keeps the explicit Screen target for retry",
    "a newer layer selection survives failed Screen deletion settlement",
    "Shift-picking a Screen extends the Delete selection in All screens",
    "Shift-marquee adds a hit Screen to the existing Delete selection",
    "a newer Screen pick survives failed Screen deletion settlement",
    "a newer sidebar Screen selection survives failed Screen deletion settlement",
    "Select All Screens survives failed Screen deletion settlement",
    "marquee selection persists and deletes Screens after a prior layer selection",
    "deleting two selected Screens is one undo step that restores both with their content, position and order",
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
  const coreJobStart = workflow.indexOf("  design-canvas-core-regression:\n");
  assert.notEqual(coreJobStart, -1);
  const broadJobStart = workflow.indexOf("  design-canvas-broad-workflows:\n");
  assert.notEqual(broadJobStart, -1);
  const diagnosticJobStart = workflow.indexOf(
    "  design-canvas-changed-spec-diagnostics:\n",
  );
  assert.notEqual(diagnosticJobStart, -1);
  const coreJob = workflow.slice(coreJobStart, broadJobStart);
  const broadJob = workflow.slice(broadJobStart, diagnosticJobStart);
  const designJob = coreJob;

  assert.ok(coreJob.includes("needs: change-scope"));
  assert.equal(
    coreJob.match(/^    if: (.+)$/m)?.[1],
    "needs.change-scope.outputs.design_canvas_core_regression == 'true'",
    "core regression must have its own exact selector",
  );
  assert.ok(broadJob.includes("needs: change-scope"));
  assert.equal(
    broadJob.match(/^    if: (.+)$/m)?.[1],
    "needs.change-scope.outputs.design_canvas_broad_workflows == 'true'",
    "broad workflows must have their own exact selector",
  );
  assert.doesNotMatch(
    coreJob,
    /design_canvas_e2e_specs/,
    "the core regression job must not depend on the changed-spec selector",
  );
  assert.doesNotMatch(
    broadJob,
    /design_canvas_e2e_specs_overflow/,
    "broad workflow selectors must not suppress selected tests",
  );
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
  const jobTimeout = Number(
    designJob.match(/^    timeout-minutes: (\d+)$/m)?.[1],
  );
  assert.match(
    broadJob,
    /^    timeout-minutes: \$\{\{ matrix\.shard == 'home-system-selection' && 40 \|\| \(matrix\.shard == 'music-app-workflow' \|\| matrix\.shard == 'landing-page-build'\) && 35 \|\| 30 \}\}$/m,
    "broad Design jobs must leave headroom outside the setup-aware test steps",
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
  assert.match(
    designJob,
    /^    timeout-minutes: 30$/m,
    "all Design core shards keep the exact thirty-minute cap",
  );
  const screenHistoryRunBudgetMinutes = 5;
  const screenHistorySetupBudgetMinutes = 11;
  const screenHistoryWebServerBudgetMinutes = 5;
  const designRegressionRunBudgetMinutes = 7;
  const designRegressionSetupBudgetMinutes = 11;
  const designRegressionWebServerBudgetMinutes = 5;
  assert.ok(
    Number.isInteger(jobTimeout) && jobTimeout === 30,
    `regular Design acceptance shards must keep the exact thirty-minute cap (got ${jobTimeout})`,
  );
  assert.ok(
    jobTimeout < 31,
    "Design acceptance must stay below thirty-one minutes",
  );
  assert.ok(
    Number.isInteger(diagnosticJobTimeout) && diagnosticJobTimeout === 30,
    `changed-spec diagnostics must have the exact thirty-minute cap (got ${diagnosticJobTimeout})`,
  );
  assert.ok(
    Number.isInteger(stepTimeout) &&
      stepTimeout === 23 &&
      stepTimeout >=
        designRegressionRunBudgetMinutes +
          designRegressionSetupBudgetMinutes +
          designRegressionWebServerBudgetMinutes &&
      jobTimeout >= stepTimeout + 7,
    `focused Design tests need seven minutes for Playwright, eleven minutes for global setup including seeding and warmups, five minutes for webServer startup, and seven minutes of job headroom (job ${jobTimeout}, step ${stepTimeout})`,
  );
  assert.ok(
    Number.isInteger(screenHistoryStepTimeout) &&
      screenHistoryStepTimeout === 21 &&
      screenHistoryStepTimeout >=
        screenHistoryRunBudgetMinutes +
          screenHistorySetupBudgetMinutes +
          screenHistoryWebServerBudgetMinutes &&
      jobTimeout >= screenHistoryStepTimeout + 9,
    `Screen-history tests need five minutes for the Playwright run, eleven minutes for global setup including seeding and warmups, five minutes for webServer startup, and nine minutes of job headroom (job ${jobTimeout}, step ${screenHistoryStepTimeout})`,
  );
  const changedSpecRunBudgetMinutes = 8;
  assert.ok(
    Number.isInteger(changedSpecStepTimeout) &&
      changedSpecStepTimeout === 24 &&
      changedSpecStepTimeout >=
        changedSpecRunBudgetMinutes +
          screenHistorySetupBudgetMinutes +
          screenHistoryWebServerBudgetMinutes &&
      diagnosticJobTimeout >= changedSpecStepTimeout + 6,
    `changed-spec diagnostics need eight minutes for Playwright, eleven minutes for global setup including seeding and warmups, five minutes for webServer startup, and six minutes of job headroom (job ${diagnosticJobTimeout}, step ${changedSpecStepTimeout})`,
  );
  const coreShardEntries = [
    ...coreJob.matchAll(
      /^\s{12}((?:(?:inspector|drag|position|screen-history)-[^,\s)]+)),?\s*$/gm,
    ),
  ].map(([, shard]) => shard);
  assert.deepEqual(coreShardEntries, [
    ...DESIGN_E2E_REGRESSION_SHARDS,
    "screen-history-1",
    "screen-history-2",
    "screen-history-3",
  ]);
  assert.match(
    broadJob,
    /shard: \$\{\{ fromJSON\(needs\.change-scope\.outputs\.design_canvas_broad_workflow_shards\) \}\}/u,
    "broad workflow matrix must use the selected shard list",
  );
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
    /required_pin_identities_json="\$\(node --experimental-strip-types \.\.\/\.\.\/scripts\/design-e2e-regression-pin-identities\.ts "\$\{\{ matrix\.shard \}\}"\)"/,
    "each required reporter outcome must carry its exact manifest title identity",
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
  assert.match(
    regressionCases,
    /E2E_REQUIRED_PIN_IDENTITIES="\$required_pin_identities_json"/,
    "the reporter must attest each resolved selector against its manifest title",
  );
  assert.match(
    regressionCases,
    /^          E2E_LOG_TEST_PROGRESS: "1"$/m,
    "focused Design tests must log per-case progress before a shard timeout",
  );
  assert.equal(
    DESIGN_E2E_REGRESSION_PINS.length,
    107,
    "the merged manifest must retain the 94 main-branch pins plus the PR's 13 additional pins",
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
  assert.ok(
    diagnosticJob.includes(
      "shard: ${{ fromJSON(needs.change-scope.outputs.design_canvas_e2e_diagnostic_shards) }}",
    ),
    "the changed-spec matrix must come from the sized shard list",
  );
  assert.match(
    diagnosticJob,
    /--shard="\$\{changed_shard\}\/\$\{\{ strategy\.job-total \}\}"/,
    "changed specs must be covered across every shard in the matrix",
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
  assert.match(
    regressionCases,
    /^          required_pin_identities_json="\$\(node --experimental-strip-types \.\.\/\.\.\/scripts\/design-e2e-regression-pin-identities\.ts "\$\{\{ matrix\.shard \}\}"\)"/m,
    "fixed behavior attestations must include the exact manifest title",
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
  assert.ok(workflow.includes("    name: Determine change scope\n"));
  assert.ok(workflow.includes("    name: Docs checks\n"));
  assert.ok(workflow.includes("    name: Fast tests ${{ matrix.lane }}\n"));
  assert.ok(
    workflow.includes("    name: Fast tests targeted ${{ matrix.lane }}\n"),
  );
  assert.ok(
    workflow.includes(
      "    name: Design core regression (${{ matrix.shard }})\n",
    ),
  );
  assert.ok(
    workflow.includes(
      "    name: Design broad workflows (${{ matrix.shard }})\n",
    ),
  );
  assert.ok(workflow.includes("    name: Pre-auth session replay smoke\n"));
  assert.ok(fastTestsJob.includes("    name: Fast tests\n"));
  assert.ok(fastTestsJob.includes("    if: always()\n"));
  const needsMatch = fastTestsJob.match(/    needs:\s*\[([\s\S]*?)\s*\]/);
  assert.ok(needsMatch, "Fast tests must gate every prerequisite");
  assert.deepEqual(
    needsMatch[1]
      .split(",")
      .map((job) => job.trim())
      .filter(Boolean),
    [
      "change-scope",
      "docs",
      "test-rest",
      "test-targeted",
      "design-canvas-core-regression",
      "design-canvas-broad-workflows",
      "pre-auth-session-replay-smoke",
    ],
  );
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_CORE_REGRESSION: ${{ needs.change-scope.outputs.design_canvas_core_regression }}",
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_CORE_RESULT: ${{ needs.design-canvas-core-regression.result }}",
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_BROAD_WORKFLOWS: ${{ needs.change-scope.outputs.design_canvas_broad_workflows }}",
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      "DESIGN_BROAD_RESULT: ${{ needs.design-canvas-broad-workflows.result }}",
    ),
  );
  assert.match(
    fastTestsJob,
    /if \[\[ "\$result" == "skipped" \]\]; then\s+record_failure "\$job" "was unexpectedly skipped/,
  );
  assert.match(
    fastTestsJob,
    /elif \[\[ "\$result" != "success" \]\]; then\s+record_failure "\$job" "did not succeed/,
  );
  assert.ok(fastTestsJob.includes('require_boolean "full-suite" "$CI_FULL"'));
  assert.ok(
    fastTestsJob.includes('require_boolean "Fast tests" "$FAST_TESTS"'),
  );
  assert.ok(fastTestsJob.includes('require_boolean "docs-only" "$DOCS_ONLY"'));
  assert.ok(fastTestsJob.includes('require_success "Determine change scope"'));
  assert.ok(fastTestsJob.includes('require_success "Docs checks"'));
  assert.ok(
    fastTestsJob.includes('require_success "Fast tests (test-rest matrix)"'),
  );
  assert.ok(
    fastTestsJob.includes(
      'require_success "Fast tests targeted (test-targeted matrix)"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'require_skipped "Design core regression (matrix jobs)" "$DESIGN_CORE_RESULT" "ran outside its selected paths"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'require_skipped "Design broad workflows (matrix jobs)" "$DESIGN_BROAD_RESULT" "ran outside its selected paths"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'require_success "Design core regression (matrix jobs)" "$DESIGN_CORE_RESULT"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'require_success "Design broad workflows (matrix jobs)" "$DESIGN_BROAD_RESULT"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'record_failure "Determine change scope" "Design core regression selection was missing or invalid ($DESIGN_CORE_REGRESSION)"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      'record_failure "Determine change scope" "Design broad workflows selection was missing or invalid ($DESIGN_BROAD_WORKFLOWS)"',
    ),
  );
  assert.ok(
    fastTestsJob.includes(
      "PRE_AUTH_REPLAY_RESULT: ${{ needs.pre-auth-session-replay-smoke.result }}",
    ),
  );
  assert.match(
    fastTestsJob,
    /if \[\[ "\$PRE_AUTH_REPLAY_E2E" == "true" \]\]; then\s+require_success "Pre-auth session replay smoke" "\$PRE_AUTH_REPLAY_RESULT"/,
  );
  assert.ok(
    fastTestsJob.includes(
      'require_skipped "Pre-auth session replay smoke" "$PRE_AUTH_REPLAY_RESULT" "ran outside its selected paths"',
    ),
  );
  assert.ok(fastTestsJob.includes("This job summarizes upstream tests"));
  assert.ok(
    fastTestsJob.includes(
      'actions_run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"',
    ),
  );
  assert.match(
    fastTestsJob,
    /for failure in "\$\{failures\[@\]\}"; do\s+echo "::error::\$failure\. Actions run: \$actions_run_url"/,
  );
});

test("fast-tests summary enforces selected and skipped prerequisite outcomes", () => {
  const script = fastTestsSummaryScript();
  const scenarios: Array<{
    name: string;
    overrides: Record<string, string>;
    status: number;
    outputIncludes?: string;
  }> = [
    {
      name: "selected targeted lanes pass",
      overrides: {},
      status: 0,
    },
    {
      name: "selected Design lanes pass",
      overrides: {
        DESIGN_CORE_REGRESSION: "true",
        DESIGN_CORE_RESULT: "success",
        DESIGN_BROAD_WORKFLOWS: "true",
        DESIGN_BROAD_RESULT: "success",
      },
      status: 0,
    },
    {
      name: "selected pre-auth lanes pass",
      overrides: {
        PRE_AUTH_REPLAY_E2E: "true",
        PRE_AUTH_REPLAY_RESULT: "success",
      },
      status: 0,
    },
    {
      name: "full-suite lanes pass",
      overrides: {
        CI_FULL: "true",
        TEST_REST_RESULT: "success",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 0,
    },
    {
      name: "docs-only changes pass when docs checks succeed",
      overrides: {
        DOCS_ONLY: "true",
        DOCS_RESULT: "success",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 0,
    },
    {
      name: "docs-only changes still require unselected Design lanes to skip",
      overrides: {
        DOCS_ONLY: "true",
        DOCS_RESULT: "success",
        DESIGN_CORE_RESULT: "success",
      },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "docs-only changes still require selected Design lanes to succeed",
      overrides: {
        DOCS_ONLY: "true",
        DOCS_RESULT: "success",
        DESIGN_CORE_REGRESSION: "true",
        DESIGN_CORE_RESULT: "failure",
      },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): did not succeed (expected success, received failure)",
    },
    {
      name: "non-docs changes require the docs job to skip",
      overrides: { DOCS_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Docs checks: ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "an unselected Design lane must skip",
      overrides: {},
      status: 0,
    },
    {
      name: "an unselected Design lane cannot run successfully",
      overrides: { DESIGN_CORE_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "a selected pre-auth lane must succeed",
      overrides: {
        PRE_AUTH_REPLAY_E2E: "true",
        PRE_AUTH_REPLAY_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Pre-auth session replay smoke: was unexpectedly skipped (expected success)",
    },
    {
      name: "an unselected pre-auth lane must skip",
      overrides: { PRE_AUTH_REPLAY_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Pre-auth session replay smoke: ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "an unselected Design lane cannot fail",
      overrides: { DESIGN_CORE_RESULT: "failure" },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): ran outside its selected paths (expected skipped, received failure)",
    },
    {
      name: "selected core regression cannot be skipped",
      overrides: {
        DESIGN_CORE_REGRESSION: "true",
        DESIGN_CORE_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): was unexpectedly skipped",
    },
    {
      name: "selected core regression cannot be cancelled",
      overrides: {
        DESIGN_CORE_REGRESSION: "true",
        DESIGN_CORE_RESULT: "cancelled",
      },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): did not succeed (expected success, received cancelled)",
    },
    {
      name: "selected core regression requires a result",
      overrides: {
        DESIGN_CORE_REGRESSION: "true",
        DESIGN_CORE_RESULT: "",
      },
      status: 1,
      outputIncludes:
        "Design core regression (matrix jobs): did not succeed (expected success, received )",
    },
    {
      name: "selected broad workflows cannot fail",
      overrides: {
        DESIGN_BROAD_WORKFLOWS: "true",
        DESIGN_BROAD_RESULT: "failure",
      },
      status: 1,
      outputIncludes:
        "Design broad workflows (matrix jobs): did not succeed (expected success, received failure)",
    },
    {
      name: "selected broad workflows cannot be skipped",
      overrides: {
        DESIGN_BROAD_WORKFLOWS: "true",
        DESIGN_BROAD_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Design broad workflows (matrix jobs): was unexpectedly skipped (expected success)",
    },
    {
      name: "selected broad workflows cannot be cancelled",
      overrides: {
        DESIGN_BROAD_WORKFLOWS: "true",
        DESIGN_BROAD_RESULT: "cancelled",
      },
      status: 1,
      outputIncludes:
        "Design broad workflows (matrix jobs): did not succeed (expected success, received cancelled)",
    },
    {
      name: "selected broad workflows require a result",
      overrides: {
        DESIGN_BROAD_WORKFLOWS: "true",
        DESIGN_BROAD_RESULT: "",
      },
      status: 1,
      outputIncludes:
        "Design broad workflows (matrix jobs): did not succeed (expected success, received )",
    },
    {
      name: "unselected broad workflows must skip",
      overrides: { DESIGN_BROAD_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Design broad workflows (matrix jobs): ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "unselected targeted lanes must skip",
      overrides: { FAST_TESTS: "false", TEST_TARGETED_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Fast tests targeted (test-targeted matrix): ran without a fast-test selection (expected skipped, received success)",
    },
    {
      name: "unselected full-suite lanes must skip in a targeted run",
      overrides: { TEST_REST_RESULT: "failure" },
      status: 1,
      outputIncludes:
        "Fast tests (test-rest matrix): ran outside its selected paths (expected skipped, received failure)",
    },
    {
      name: "unselected targeted lanes must skip in a full-suite run",
      overrides: {
        CI_FULL: "true",
        TEST_REST_RESULT: "success",
        TEST_TARGETED_RESULT: "failure",
      },
      status: 1,
      outputIncludes:
        "Fast tests targeted (test-targeted matrix): ran outside its selected paths (expected skipped, received failure)",
    },
    {
      name: "docs-only changes require the full-suite matrix to skip",
      overrides: {
        DOCS_ONLY: "true",
        DOCS_RESULT: "success",
        TEST_REST_RESULT: "failure",
        TEST_TARGETED_RESULT: "success",
      },
      status: 1,
      outputIncludes:
        "Fast tests (test-rest matrix): ran outside its selected paths (expected skipped, received failure)",
    },
    {
      name: "docs-only changes require the targeted matrix to skip",
      overrides: {
        DOCS_ONLY: "true",
        DOCS_RESULT: "success",
        TEST_REST_RESULT: "skipped",
        TEST_TARGETED_RESULT: "success",
      },
      status: 1,
      outputIncludes:
        "Fast tests targeted (test-targeted matrix): ran outside its selected paths (expected skipped, received success)",
    },
    {
      name: "full-suite lanes cannot be skipped",
      overrides: {
        CI_FULL: "true",
        TEST_REST_RESULT: "skipped",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Fast tests (test-rest matrix): was unexpectedly skipped (expected success)",
    },
    {
      name: "targeted lanes may skip when no workspace has tests",
      overrides: { HAS_TESTS: "false", TEST_TARGETED_RESULT: "skipped" },
      status: 0,
    },
    {
      name: "targeted lanes cannot run when no workspace has tests",
      overrides: { HAS_TESTS: "false", TEST_TARGETED_RESULT: "success" },
      status: 1,
      outputIncludes:
        "Fast tests targeted (test-targeted matrix): no affected workspace has a test script (expected skipped, received success)",
    },
    {
      name: "docs-only changes require docs checks",
      overrides: { DOCS_ONLY: "true", DOCS_RESULT: "failure" },
      status: 1,
      outputIncludes: "Docs checks: did not succeed",
    },
    {
      name: "a failed change-scope result is visible",
      overrides: { CHANGE_SCOPE_RESULT: "failure" },
      status: 1,
      outputIncludes: "Determine change scope: did not succeed",
    },
    {
      name: "a missing full-suite selector fails closed",
      overrides: {
        CI_FULL: "",
        FAST_TESTS: "false",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: full-suite selection was missing or invalid ()",
    },
    {
      name: "an invalid full-suite selector fails closed",
      overrides: {
        CI_FULL: "invalid",
        FAST_TESTS: "false",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: full-suite selection was missing or invalid (invalid)",
    },
    {
      name: "a missing targeted selector fails closed",
      overrides: {
        CI_FULL: "false",
        FAST_TESTS: "",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: Fast tests selection was missing or invalid ()",
    },
    {
      name: "an invalid targeted selector fails closed",
      overrides: {
        CI_FULL: "false",
        FAST_TESTS: "invalid",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: Fast tests selection was missing or invalid (invalid)",
    },
    {
      name: "a missing docs-only selector fails closed",
      overrides: {
        DOCS_ONLY: "",
        FAST_TESTS: "false",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: docs-only selection was missing or invalid ()",
    },
    {
      name: "an invalid docs-only selector fails closed",
      overrides: {
        DOCS_ONLY: "invalid",
        FAST_TESTS: "false",
        TEST_TARGETED_RESULT: "skipped",
      },
      status: 1,
      outputIncludes:
        "Determine change scope: docs-only selection was missing or invalid (invalid)",
    },
    {
      name: "an invalid pre-auth selection fails closed",
      overrides: { PRE_AUTH_REPLAY_E2E: "invalid" },
      status: 1,
      outputIncludes:
        "Determine change scope: pre-auth replay selection was missing or invalid (invalid)",
    },
    {
      name: "a missing Design selection fails closed",
      overrides: { DESIGN_CORE_REGRESSION: "" },
      status: 1,
      outputIncludes:
        "Determine change scope: Design core regression selection was missing or invalid ()",
    },
    {
      name: "an invalid Design selection fails closed",
      overrides: { DESIGN_CORE_REGRESSION: "invalid" },
      status: 1,
      outputIncludes:
        "Determine change scope: Design core regression selection was missing or invalid (invalid)",
    },
    {
      name: "a missing broad-workflow selection fails closed",
      overrides: { DESIGN_BROAD_WORKFLOWS: "" },
      status: 1,
      outputIncludes:
        "Determine change scope: Design broad workflows selection was missing or invalid ()",
    },
    {
      name: "an invalid broad-workflow selection fails closed",
      overrides: { DESIGN_BROAD_WORKFLOWS: "invalid" },
      status: 1,
      outputIncludes:
        "Determine change scope: Design broad workflows selection was missing or invalid (invalid)",
    },
  ];

  for (const scenario of scenarios) {
    const result = runFastTestsSummary(script, scenario.overrides);
    assert.equal(result.status, scenario.status, scenario.name);
    if (scenario.outputIncludes) {
      assert.ok(
        result.output.includes(scenario.outputIncludes),
        `${scenario.name}: expected output to include ${scenario.outputIncludes}`,
      );
    }
  }
});

test("fast-tests summary reports every prerequisite failure with the Actions URL", () => {
  const result = runFastTestsSummary(fastTestsSummaryScript(), {
    DESIGN_CORE_REGRESSION: "true",
    DESIGN_CORE_RESULT: "skipped",
    DESIGN_BROAD_WORKFLOWS: "true",
    DESIGN_BROAD_RESULT: "failure",
    PRE_AUTH_REPLAY_E2E: "true",
    PRE_AUTH_REPLAY_RESULT: "failure",
    DOCS_RESULT: "failure",
    TEST_TARGETED_RESULT: "failure",
    TEST_REST_RESULT: "failure",
  });

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /found 6 failing or unexpectedly skipped prerequisite\(s\)/,
  );
  for (const job of [
    "Design core regression (matrix jobs): was unexpectedly skipped",
    "Design broad workflows (matrix jobs): did not succeed",
    "Pre-auth session replay smoke: did not succeed",
    "Docs checks: ran outside its selected paths (expected skipped, received failure)",
    "Fast tests targeted (test-targeted matrix): did not succeed",
    "Fast tests (test-rest matrix): ran outside its selected paths (expected skipped, received failure)",
  ]) {
    assert.ok(result.output.includes(job), `missing failure for ${job}`);
  }
  assert.equal(
    result.output.match(
      /Actions run: https:\/\/github\.com\/BuilderIO\/agent-native\/actions\/runs\/123/g,
    )?.length,
    6,
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
  assert.equal(smokeOnly.checks.design_canvas_core_regression, false);
  assert.equal(smokeOnly.checks.pre_auth_session_replay_e2e, true);
});

test("a deleted Design E2E path runs only changed-spec diagnostics", () => {
  const scope = classifyChangedPaths(
    ["templates/design/e2e/removed-by-this-change.spec.ts"],
    [],
    process.cwd(),
    ["templates/design/e2e/removed-by-this-change.spec.ts"],
  );

  assert.equal(scope.checks.design_canvas_core_regression, false);
  assert.equal(scope.checks.design_canvas_broad_workflows, false);
  assert.deepEqual(scope.designCanvasBroadWorkflowShards, []);
  assert.deepEqual(scope.designCanvasE2eSpecs, [
    "templates/design/e2e/removed-by-this-change.spec.ts",
  ]);

  const fullRunWithDeletedShard = classifyChangedPaths(
    ["pnpm-lock.yaml"],
    [],
    process.cwd(),
    ["templates/design/e2e/home-system-selection.spec.ts"],
  );
  assert.equal(
    fullRunWithDeletedShard.checks.design_canvas_broad_workflows,
    true,
  );
  assert.deepEqual(fullRunWithDeletedShard.designCanvasBroadWorkflowShards, [
    "ai-sidebar-loopback",
    "music-app-workflow",
    "landing-page-build",
    "autolayout-vertical-center-trailing",
  ]);
});

test("a non-empty selector with only deleted specs resolves to a no-op", () => {
  const removed = "templates/design/e2e/removed-by-this-change.spec.ts";

  assert.deepEqual(
    resolveDesignE2ESpecs(JSON.stringify([removed]), { isFile: () => false }),
    {
      existingSpecs: [],
      removedSpecs: ["e2e/removed-by-this-change.spec.ts"],
      filteredSpecs: [],
    },
  );
});

test("filters loopback-only Home specs from default changed-spec selection", () => {
  const home = "templates/design/e2e/home-system-selection.spec.ts";
  const regular = "templates/design/e2e/interaction-selection.spec.ts";
  const selector = JSON.stringify([home, regular]);
  const resolve = (includeLoopbackOnlySpecs: boolean) =>
    resolveDesignE2ESpecs(selector, {
      isFile: () => true,
      readFile: () => "",
      includeLoopbackOnlySpecs,
    });

  assert.deepEqual(resolve(false), {
    existingSpecs: ["e2e/interaction-selection.spec.ts"],
    removedSpecs: [],
    filteredSpecs: ["e2e/home-system-selection.spec.ts"],
  });
  assert.deepEqual(resolve(true), {
    existingSpecs: [
      "e2e/home-system-selection.spec.ts",
      "e2e/interaction-selection.spec.ts",
    ],
    removedSpecs: [],
    filteredSpecs: [],
  });
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
      readFile: () => "",
    }),
    {
      existingSpecs: [
        "e2e/interaction-selection.spec.ts",
        "e2e/interaction-support.test.ts",
        "e2e/interaction-support.spec.tsx",
      ],
      removedSpecs: ["e2e/removed-by-this-change.spec.ts"],
      filteredSpecs: [],
    },
  );
});

test("routes the serial landing-page workflow from its exact changed spec path", () => {
  const landingPagePath =
    "templates/design/e2e/interaction-landing-page-build.spec.ts";
  const landingPageTitles = [
    "Shift+A wraps four selected nav links into a horizontal auto-layout frame inside Navbar without moving them",
    "Cmd+G groups two layers selected in the Layers panel and one Cmd+Z restores the ungrouped document",
    "Cmd+D on a screen creates an independent sibling screen: deleting a layer in the copy leaves the original untouched",
  ];
  const landingPageSource = landingPageTitles
    .map((title) => "test(" + JSON.stringify(title) + ", async () => {});")
    .join("\n");
  const changedPathScope = classifyChangedPaths([landingPagePath]);
  assert.deepEqual(changedPathScope.designCanvasE2eSpecs, [landingPagePath]);
  assert.equal(changedPathScope.checks.design_canvas_broad_workflows, true);

  const isLandingPageSpec = (specPath: string) =>
    specPath === "e2e/interaction-landing-page-build.spec.ts";
  const genericSelection = resolveDesignE2ESpecs(
    JSON.stringify([landingPagePath]),
    {
      isFile: isLandingPageSpec,
      readFile: () => landingPageSource,
      includeLandingPageWorkflowSpec: false,
    },
  );
  assert.deepEqual(genericSelection, {
    existingSpecs: [],
    removedSpecs: [],
    filteredSpecs: ["e2e/interaction-landing-page-build.spec.ts"],
  });
  assert.deepEqual(
    resolveDesignE2ESpecs(
      JSON.stringify([
        landingPagePath,
        "templates/design/e2e/interaction-selection.spec.ts",
      ]),
      {
        isFile: (specPath) =>
          specPath === "e2e/interaction-landing-page-build.spec.ts" ||
          specPath === "e2e/interaction-selection.spec.ts",
        readFile: (specPath) =>
          specPath === "e2e/interaction-landing-page-build.spec.ts"
            ? landingPageSource
            : "",
        includeLandingPageWorkflowSpec: false,
      },
    ),
    {
      existingSpecs: ["e2e/interaction-selection.spec.ts"],
      removedSpecs: [],
      filteredSpecs: ["e2e/interaction-landing-page-build.spec.ts"],
    },
    "filtering the serial suite must leave unrelated changed specs in the generic shards",
  );

  const dedicatedSelection = resolveDesignE2ESpecs(
    JSON.stringify([landingPagePath]),
    {
      isFile: isLandingPageSpec,
      readFile: () => landingPageSource,
      includeLandingPageWorkflowSpec: true,
    },
  );
  assert.deepEqual(dedicatedSelection, {
    existingSpecs: ["e2e/interaction-landing-page-build.spec.ts"],
    removedSpecs: [],
    filteredSpecs: [],
  });

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([landingPagePath]), {
        isFile: () => false,
      }),
    /selected landing-page workflow spec is missing/,
  );

  assert.throws(
    () =>
      resolveDesignE2ESpecs(
        JSON.stringify([
          "templates/design/e2e/interaction-landing-page-build-renamed.spec.ts",
        ]),
        { isFile: () => true, readFile: () => landingPageSource },
      ),
    /long landing-page workflow tests must remain in e2e\/interaction-landing-page-build\.spec\.ts/,
  );

  const incompleteSource = landingPageSource.replace(
    "test(" + JSON.stringify(landingPageTitles[2]) + ", async () => {});",
    "",
  );
  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([landingPagePath]), {
        isFile: isLandingPageSpec,
        readFile: () => incompleteSource,
        includeLandingPageWorkflowSpec: true,
      }),
    /long landing-page workflow tests are missing from e2e\/interaction-landing-page-build\.spec\.ts: Cmd\+D on a screen creates an independent sibling screen: deleting a layer in the copy leaves the original untouched/,
  );
});

test("routes the long music-app workflow from its exact changed spec path", () => {
  const musicAppPath =
    "templates/design/e2e/interaction-responsive-music-app.spec.ts";
  const musicAppScope = classifyChangedPaths([musicAppPath]);
  assert.deepEqual(musicAppScope.designCanvasE2eSpecs, [musicAppPath]);
  assert.equal(musicAppScope.checks.design_canvas_core_regression, false);
  assert.deepEqual(musicAppScope.designCanvasBroadWorkflowShards, [
    "music-app-workflow",
  ]);

  const selectedMusicApp = resolveDesignE2ESpecs(
    JSON.stringify([musicAppPath]),
    {
      isFile: (specPath) =>
        specPath === "e2e/interaction-responsive-music-app.spec.ts",
      readFile: () =>
        'test("a drawn empty Frame refreshes its inspector after auto layout", async () => {});\n' +
        'test("sizing mode actions survive the selected layer route update", async () => {});\n' +
        'test("keeps the short music-app regression", async () => {});',
    },
  );
  assert.deepEqual(selectedMusicApp, {
    existingSpecs: ["e2e/interaction-responsive-music-app.spec.ts"],
    removedSpecs: [],
    filteredSpecs: [],
  });

  const unrelatedSelection = resolveDesignE2ESpecs(
    JSON.stringify(["templates/design/e2e/interaction-selection.spec.ts"]),
    { isFile: () => true, readFile: () => "" },
  );
  assert.deepEqual(unrelatedSelection, {
    existingSpecs: ["e2e/interaction-selection.spec.ts"],
    removedSpecs: [],
    filteredSpecs: [],
  });
  assert.ok(
    !unrelatedSelection.existingSpecs.includes(
      "e2e/interaction-responsive-music-app.spec.ts",
    ),
    "an unrelated changed spec must not route the long music-app workflow",
  );

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([musicAppPath]), {
        isFile: () => false,
      }),
    /selected long music-app workflow spec is missing/,
    "a selected music-app spec must not disappear from both regression routes",
  );
});

test("fails closed if the long music-app title moves away from its routed spec", () => {
  const musicAppPath =
    "templates/design/e2e/interaction-responsive-music-app.spec.ts";
  const renamedPath =
    "templates/design/e2e/interaction-responsive-music-app-renamed.spec.ts";
  const sourceWithLongAndShortCases =
    'test("a drawn empty Frame refreshes its inspector after auto layout", async () => {});\n' +
    'test("sizing mode actions survive the selected layer route update", async () => {});\n' +
    'test("keeps the short music-app regression", async () => {});';

  assert.deepEqual(
    resolveDesignE2ESpecs(JSON.stringify([musicAppPath]), {
      isFile: () => true,
      readFile: () => sourceWithLongAndShortCases,
    }),
    {
      existingSpecs: ["e2e/interaction-responsive-music-app.spec.ts"],
      removedSpecs: [],
      filteredSpecs: [],
    },
    "the selector must keep the canonical spec selected so its short cases remain in changed-spec coverage",
  );

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([renamedPath]), {
        isFile: () => true,
        readFile: () => sourceWithLongAndShortCases,
      }),
    /long music-app workflow test must remain in e2e\/interaction-responsive-music-app\.spec\.ts/,
    "a renamed file retaining the globally excluded title must fail instead of silently skipping it",
  );

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([musicAppPath]), {
        isFile: () => true,
        readFile: () =>
          'test("keeps the short music-app regression", async () => {});',
      }),
    /long music-app workflow tests are missing from e2e\/interaction-responsive-music-app\.spec\.ts: a drawn empty Frame refreshes its inspector after auto layout, sizing mode actions survive the selected layer route update/,
    "the dedicated old-path route must fail when both long tests were removed from that file",
  );

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([musicAppPath]), {
        isFile: () => true,
        readFile: () =>
          'test("a drawn empty Frame refreshes its inspector after auto layout", async () => {});',
      }),
    /long music-app workflow tests are missing from e2e\/interaction-responsive-music-app\.spec\.ts: sizing mode actions survive the selected layer route update/,
    "the canonical route must fail if the sizing-mode test is missing",
  );
});

test("fails closed if the sizing-mode music-app test moves away from its routed spec", () => {
  const renamedPath =
    "templates/design/e2e/interaction-responsive-music-app-renamed.spec.ts";

  assert.throws(
    () =>
      resolveDesignE2ESpecs(JSON.stringify([renamedPath]), {
        isFile: () => true,
        readFile: () =>
          'test("sizing mode actions survive the selected layer route update", async () => {});',
      }),
    /long music-app workflow test must remain in e2e\/interaction-responsive-music-app\.spec\.ts/,
    "a renamed file containing the sizing-mode test must fail instead of silently skipping it",
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
    "templates/content/e2e/live-body-gate.ts",
    "templates/content/e2e/gate-arm.ts",
    "templates/content/e2e/auth-files.ts",
    "templates/content/e2e/save-lineage.ts",
    "templates/content/e2e/editor-input-lineage.ts",
    "templates/content/e2e/server-identity.ts",
    "templates/content/e2e/stored-form/editor-mounts-once.spec.ts",
    "templates/content/acceptance/known-loss.ts",
    "templates/content/actions/get-trashed-document.ts",
    "templates/content/actions/list-comments.ts",
    "templates/content/actions/list-document-history.ts",
    "templates/content/actions/list-document-versions.ts",
    "templates/content/actions/list-documents.ts",
    "templates/content/actions/permanently-delete-document.ts",
    "templates/content/actions/plan-content-trash-purge.ts",
    "templates/content/actions/restore-document-version.ts",
    "packages/core/src/appearance/theme-family.ts",
    "packages/core/src/application-state/emitter.ts",
    "packages/core/src/client/application-state.ts",
    "packages/core/src/collab/client.ts",
    "packages/core/src/collab/routes.ts",
    "packages/core/src/client/client-status-requests.ts",
    "packages/core/src/client/hooks/index.ts",
    "packages/core/src/client/theme.ts",
    "packages/core/src/client/use-db-sync.ts",
    "packages/core/src/client/use-session.ts",
    "packages/core/src/db/client.ts",
    "packages/core/src/db/ddl-guard.ts",
    "packages/core/src/db/migration-policy.ts",
    "packages/core/src/db/request-pool-context.ts",
    "packages/core/src/db/store-registry.ts",
    "packages/core/src/mcp/build-server.ts",
    "packages/core/src/mcp/index.ts",
    "packages/core/src/server/collab-plugin.ts",
    "packages/core/src/server/core-routes-plugin.ts",
    "packages/core/src/server/auth.ts",
    "packages/core/src/server/action-discovery.ts",
    "packages/core/src/server/embed-route.ts",
    "packages/core/src/server/embed-session.ts",
    "packages/core/src/server/http-route.ts",
    "packages/core/src/server/index.ts",
    "packages/core/src/server/poll-events.ts",
    "packages/core/src/server/poll.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/sharing/access.ts",
    "packages/core/src/sharing/index.ts",
    "packages/core/src/shared/embed-auth.ts",
    "packages/core/src/shared/mcp-embed-headers.ts",
    "packages/toolkit/src/editor/useCollabReconcile.ts",
    "packages/toolkit/src/collab-ui/lead-client.ts",
    "packages/toolkit/package.json",
    "templates/content/e2e/chatgpt-widget-body-paint.spec.ts",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.checks.content_convergence, true, path);
  }

  // Shared editor changes keep convergence coverage without starting the DB suite.
  const toolkit = classifyChangedPaths([
    "packages/toolkit/src/editor/RichMarkdownEditor.tsx",
  ]);
  assert.equal(toolkit.checks.content, false);
  assert.equal(toolkit.checks.content_db, false);
  assert.equal(toolkit.checks.content_convergence, true);

  const coreCollaboration = classifyChangedPaths([
    "packages/core/src/collab/client.ts",
  ]);
  assert.equal(coreCollaboration.checks.content_db, false);
  assert.equal(coreCollaboration.checks.content_convergence, true);

  for (const path of [
    "templates/content/app/components/editor/comment-anchors.spec.ts",
    "templates/content/shared/nfm.spec.ts",
    "templates/content/app/i18n/en-US.ts",
    "templates/content/app/i18n-data.ts",
    "templates/content/app/routes/settings.tsx",
    "templates/content/server/lib/slack-notifications.ts",
    "templates/content/e2e/sidebar-delete.spec.ts",
    "templates/content/evals/editing.eval.ts",
    "templates/content/docs/product/capabilities/content.author.document-editor.md",
    "templates/content/README.md",
    "packages/core/src/client/client-status-requests.spec.ts",
    "packages/core/src/collab/routes.payload.spec.ts",
    "packages/core/src/server/poll-events.spec.ts",
    "packages/core/src/client/use-db-sync.spec.ts",
    "packages/core/src/db/client.spec.ts",
    "packages/core/src/application-state/store.ts",
    "packages/core/src/onboarding/workspace-services.ts",
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

  const ciWorkflow = classifyChangedPaths([".github/workflows/ci.yml"]);
  assert.equal(ciWorkflow.full, true);
  assert.equal(ciWorkflow.checks.content_convergence, false);

  const dependencyChange = classifyChangedPaths(["pnpm-lock.yaml"]);
  assert.equal(dependencyChange.full, true);
  assert.equal(dependencyChange.checks.content_convergence, true);

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

test("scopes Content DB tests to Content and shared database runtime changes", () => {
  for (const path of [
    "templates/content/actions/update-document.ts",
    "templates/content/server/db/schema.ts",
    "templates/content/actions/update-document.db.test.ts",
    "templates/content/acceptance/one-stored-form.db.test.ts",
    "scripts/test-content-database-lock-pglite.mjs",
    "packages/core/src/application-state/store.ts",
    "packages/core/src/db/client.ts",
    "packages/core/src/db/migrations.ts",
    "packages/core/src/db/schema-snapshot.generated.ts",
    "packages/core/src/server/database-identity.ts",
    "packages/core/src/server/release-migrations.ts",
    "packages/core/src/server/release-schema.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/sharing/indexes.ts",
  ]) {
    assert.equal(classifyChangedPaths([path]).checks.content_db, true, path);
  }

  for (const path of [
    "templates/content/actions/connect-notion-status.ts",
    "templates/content/actions/list-documents.ts",
    "templates/content/app/routes/page.$id.tsx",
    "templates/content/app/routes/page.$id.test.tsx",
    "templates/content/actions/connect-notion-status.test.ts",
    "templates/content/actions/_database-row-mutation.widget-scope.spec.ts",
    "templates/content/e2e/two-tab-convergence.spec.ts",
    "templates/content/docs/product/capabilities/content.author.document-editor.md",
    "packages/core/src/db/client.spec.ts",
    "packages/core/src/server/request-context.spec.ts",
    "packages/core/src/onboarding/workspace-services.ts",
  ]) {
    assert.equal(classifyChangedPaths([path]).checks.content_db, false, path);
  }

  const pr7825Paths = [
    ".changeset/web-search-onboarding-label.md",
    "packages/core/src/onboarding/app-profile.spec.ts",
    "packages/core/src/onboarding/workspace-services.ts",
    ...[
      "ar-SA",
      "de-DE",
      "en-US",
      "es-ES",
      "fr-FR",
      "hi-IN",
      "ja-JP",
      "ko-KR",
      "pt-BR",
      "zh-CN",
      "zh-TW",
    ].map((locale) => `packages/toolkit/src/app/i18n/catalogs/${locale}.ts`),
    "templates/analytics/server/plugins/agent-chat.spec.ts",
  ];
  const pr7825 = classifyChangedPaths(pr7825Paths);
  assert.equal(pr7825.checks.content_db, false);
  assert.equal(pr7825.checks.content_convergence, false);

  const ciWorkflow = classifyChangedPaths([".github/workflows/ci.yml"]);
  assert.equal(ciWorkflow.full, true);
  assert.equal(ciWorkflow.checks.content_db, false);

  const dependencyChange = classifyChangedPaths(["pnpm-lock.yaml"]);
  assert.equal(dependencyChange.full, true);
  assert.equal(dependencyChange.checks.content_db, true);
});

test("runs shared coverage when core changes", () => {
  const scope = classifyChangedPaths([
    "packages/core/src/feature-flags/registry.ts",
  ]);

  assert.equal(scope.full, false);
  assert.deepEqual(scope.workspaceFilters, [
    "...{packages/core}...",
    "!./community-templates/**",
  ]);
  assert.deepEqual(scope.testWorkspaceFilters, [
    "...{packages/core}",
    "!./community-templates/**",
  ]);
  assert.equal(scope.checks.content, false);
  assert.equal(scope.checks.content_db, false);
  assert.equal(scope.checks.content_convergence, false);
  assert.equal(scope.checks.core_integration, false);
  assert.equal(scope.checks.plan_e2e, false);
  assert.equal(scope.checks.brain_evals, false);
  assert.equal(scope.checks.scaffold, false);
  assert.equal(scope.checks.ssr_boot, false);
  assert.equal(scope.checks.trusted_acceptance, false);
  assert.equal(scope.checks.builder_code_starter_scaffold, false);
  assert.equal(scope.checks.deploy_paths, false);
  assert.equal(scope.checks.agentkit_acceptance, false);
  assert.equal(scope.checks.neon_query_budget, false);
  assert.equal(scope.checks.slides_caret_e2e, false);
  assert.equal(scope.checks.slides_typing_chat_e2e, false);
  assert.equal(scope.checks.slides_authoring_e2e, false);
  assert.equal(scope.checks.slides_oracle, false);
});

test("selects Core integration E2E for its runtime dependencies and specs", () => {
  for (const path of [
    "packages/core/src/agent/engine/translate-ai-sdk.ts",
    "packages/core/src/db/client.ts",
    "packages/core/src/scripts/db/postgres-client.ts",
    "packages/core/src/server/core-routes-plugin.ts",
    "packages/core/src/server/action-routes.ts",
    "packages/core/src/server/embedded.ts",
    "packages/core/src/extensions/session-replay-iframe.ts",
    "packages/core/src/client/session-replay-iframe.e2e.spec.ts",
    "packages/core/src/server/embedded.integration.spec.ts",
    "templates/analytics/scripts/journey-capture-iframe-audit.ts",
    "templates/design/app/components/templates/TemplatePreview.tsx",
    "templates/design/shared/design-template-presets/social-story.ts",
    "packages/toolkit/src/app/extensions/AgentNativeExtensionFrame.tsx",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.core_integration,
      true,
      `${path} must select Core integration E2E`,
    );
  }

  for (const path of [
    "packages/core/src/feature-flags/registry.ts",
    "packages/core/src/localization/server.spec.ts",
    "packages/toolkit/src/index.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.core_integration,
      false,
      `${path} must not select Core integration E2E`,
    );
  }
});

test("selects Plan E2E only for its direct template and Core dependencies", () => {
  for (const path of [
    "templates/plan/actions/create-visual-recap.ts",
    "templates/plan/actions/create-visual-recap.e2e.spec.ts",
    "templates/plan/server/db/schema.ts",
    "templates/plan/server/lib/local-identity.ts",
    "packages/core/src/index.ts",
    "packages/core/src/action.ts",
    "packages/core/src/blocks/server.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/sharing/access.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.plan_e2e,
      true,
      `${path} must select Plan E2E`,
    );
  }

  for (const path of [
    "templates/plan/app/routes/index.tsx",
    "templates/plan/actions/create-visual-plan.ts",
    "packages/core/src/agent/engine/run.ts",
    "packages/core/src/server/request-context.spec.ts",
    "packages/core/src/feature-flags/registry.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.plan_e2e,
      false,
      `${path} must not select Plan E2E`,
    );
  }
});

test("selects Brain evals only for Core code in its runtime dependency surface", () => {
  for (const path of [
    "templates/brain/actions/run-demo-eval.ts",
    "templates/brain/actions/run-retrieval-eval.ts",
    "templates/brain/server/lib/demo.ts",
    "templates/brain/server/lib/search.ts",
    "packages/core/src/action.ts",
    "packages/core/src/db/client.ts",
    "packages/core/src/search/index.ts",
    "packages/core/src/search-utils/normalize.ts",
    "packages/core/src/server/agent-discovery.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/sharing/access.ts",
    "packages/core/src/workspace-connections/store.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.brain_evals,
      true,
      `${path} must select Brain evals`,
    );
  }

  for (const path of [
    "templates/brain/app/routes/index.tsx",
    "templates/brain/actions/list-workspace-records.ts",
    "packages/core/src/agent/engine/run.ts",
    "packages/core/src/server/request-context.spec.ts",
    "packages/core/src/feature-flags/registry.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.brain_evals,
      false,
      `${path} must not select Brain evals`,
    );
  }
});

test("selects standalone AgentKit acceptance only for its production surface", () => {
  for (const path of [
    "packages/agentkit/src/index.ts",
    "packages/agentkit/src/protocol/index.ts",
    "packages/agentkit/src/client/index.ts",
    "packages/agentkit/src/adapters/http.ts",
    "packages/agentkit/src/conformance/index.ts",
    "packages/toolkit/src/app/agentkit/react/components.tsx",
    "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
    "packages/core/src/client/chat/agentkit-protocol.ts",
    "packages/core/src/client/agent-chat/send.ts",
    "packages/core/src/agent/engine/run.ts",
    "packages/core/src/cli/create.ts",
    "packages/core/src/server/action-routes.ts",
    "packages/core/src/server/auth.ts",
    "packages/core/src/server/request-context.ts",
    "packages/core/src/templates/chat/app/routes/_index.tsx",
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
  assert.equal(
    classifyChangedPaths(["packages/core/src/server/request-context.spec.ts"])
      .checks.agentkit_acceptance,
    false,
  );
  assert.equal(
    classifyChangedPaths(["packages/core/src/feature-flags/registry.ts"]).checks
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

test("selects the deploy-path check for what a standalone Chat app installs", () => {
  for (const path of [
    "packages/core/src/server/auth.ts",
    "packages/toolkit/src/composer/PromptComposer.tsx",
    "packages/agentkit/src/index.ts",
    "packages/shared-app-config/templates.ts",
    "packages/otel/src/index.ts",
    "packages/core/src/cli/create.ts",
    "packages/core/src/server/action-routes.ts",
    "templates/chat/app/routes/_index.tsx",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.deploy_paths,
      true,
      `${path} must select the deploy-path check`,
    );
  }

  for (const path of [
    "templates/calendar/app/routes/index.tsx",
    "packages/dispatch/src/index.ts",
    "packages/core/src/feature-flags/registry.ts",
    "packages/recap-cli/src/index.ts",
    "packages/toolkit/src/canvas-interactions/drag.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.deploy_paths,
      false,
      `${path} cannot change a standalone Chat deploy`,
    );
  }
});

test("runs the deploy-path check for an edit to a guide it runs, even docs-only", () => {
  for (const path of [
    "packages/core/docs/content/node-js.mdx",
    "packages/core/docs/content/docker.mdx",
    "packages/core/docs/content/netlify.mdx",
    "packages/core/docs/content/vercel.mdx",
  ]) {
    const scope = classifyChangedPaths([path]);
    assert.equal(scope.docsOnly, true);
    assert.equal(
      scope.checks.deploy_paths,
      true,
      `${path} must select the deploy-path check`,
    );
  }

  for (const path of [
    "packages/core/docs/content/getting-started.mdx",
    "packages/core/docs/content/locales/de-DE/docker.mdx",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.deploy_paths,
      false,
      `${path} is not a guide the check runs`,
    );
  }
});

test("fails closed to the deploy-path check for unknown and empty scopes", () => {
  assert.equal(classifyChangedPaths([]).checks.deploy_paths, true);
  assert.equal(
    classifyChangedPaths(["unknown-root-config.ts"]).checks.deploy_paths,
    true,
  );
  assert.equal(
    classifyChangedPaths(["scripts/qa-deploy-paths.ts"]).checks.deploy_paths,
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

test("runs only lint for markdown-only instruction changes", () => {
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
    assert.deepEqual(scope.workspaceFilters, [], path);
    assert.deepEqual(scope.testWorkspaceFilters, [], path);
    assert.deepEqual(
      Object.entries(scope.checks)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      ["lint"],
      path,
    );
  }

  const syncedSkill = classifyChangedPaths([
    ".agents/skills/review-latest-feedback/SKILL.md",
    "templates/factory/.agents/skills/review-latest-feedback/SKILL.md",
    "packages/core/src/templates/factory/.agents/skills/review-latest-feedback/SKILL.md",
  ]);
  assert.equal(syncedSkill.full, false);
  assert.deepEqual(syncedSkill.testWorkspaceFilters, []);
  assert.equal(syncedSkill.checks.fast_tests, false);
  assert.equal(syncedSkill.checks.typecheck, false);
  assert.equal(syncedSkill.checks.build, false);
  assert.equal(syncedSkill.checks.lint, true);

  const withCode = classifyChangedPaths([
    ".agents/skills/qa/SKILL.md",
    "packages/core/src/cli/skills.ts",
  ]);
  assert.equal(withCode.checks.fast_tests, true);
  assert.equal(withCode.checks.typecheck, true);

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

test("selects deploy alert regression when the canary workflow changes", () => {
  const scope = classifyChangedPaths([".github/workflows/deploy-canary.yml"]);

  assert.deepEqual(scope.scriptTests, [
    "scripts/deploy-alerts-workflow.test.ts",
  ]);
});

test("selects the release workflow test when the publish workflow changes", () => {
  const scope = classifyChangedPaths([".github/workflows/auto-publish.yml"]);

  assert.deepEqual(scope.scriptTests, [
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
      assert.equal(scope.checks.neon_query_budget, false);
      assert.deepEqual(scope.queryBudgetApps, []);
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

test("runs the oracle ratchet only for changes that can alter test modes", () => {
  for (const paths of [
    ["templates/slides/oracle/ratchet.ts"],
    ["templates/slides/app/components/editor/SlideEditor.geometry.test.tsx"],
    ["templates/slides/vitest.config.ts"],
    ["packages/core/src/vitest-config.ts"],
  ]) {
    assert.equal(
      classifyChangedPaths(paths).checks.slides_oracle,
      true,
      paths.join(", "),
    );
  }
  for (const paths of [
    ["templates/slides/app/components/editor/slide-object-interactions.ts"],
    ["templates/slides/actions/update-slide.ts"],
  ]) {
    const scope = classifyChangedPaths(paths);
    assert.equal(scope.checks.slides_oracle, false, paths.join(", "));
    assert.equal(scope.checks.guards, true, paths.join(", "));
  }
});

test("runs the execution-lease model check for its model, script, and covered code", () => {
  for (const path of [
    "verification/execution-lease/ExecutionLease.tla",
    "verification/execution-lease/manifest.json",
    "scripts/verify-execution-lease.ts",
    "packages/core/src/agent/run-store.ts",
    "packages/core/src/agent/production-agent.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.verify_execution_lease,
      true,
      path,
    );
  }
  for (const path of [
    "packages/core/src/feature-flags/registry.ts",
    "packages/core/src/agent/run-store.test.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.verify_execution_lease,
      false,
      path,
    );
  }
  assert.equal(
    classifyChangedPaths([".github/workflows/ci.yml"]).checks
      .verify_execution_lease,
    true,
    "full run",
  );
});

test("mutation-tests Core source only, never specs, declarations, templates, or the CLI", () => {
  for (const path of [
    "packages/core/src/feature-flags/registry.ts",
    "packages/core/src/client/hooks/index.tsx",
  ]) {
    assert.equal(classifyChangedPaths([path]).checks.core_mutation, true, path);
  }
  for (const path of [
    "packages/core/src/feature-flags/registry.test.ts",
    "packages/core/src/client/hooks/index.spec.tsx",
    "packages/core/src/types.d.ts",
    "packages/core/src/templates/chat/actions/x.ts",
    "packages/core/src/cli/create.ts",
    "templates/chat/actions/x.ts",
  ]) {
    assert.equal(
      classifyChangedPaths([path]).checks.core_mutation,
      false,
      path,
    );
  }
  assert.equal(
    classifyChangedPaths(["packages/core/package.json"]).checks.core_mutation,
    false,
  );
  assert.equal(
    classifyChangedPaths([".github/workflows/ci.yml"]).checks.core_mutation,
    true,
    "full run",
  );
});

test(
  "pre-install scope tests pass without workspace dependencies",
  { skip: process.env.CI_CHANGE_SCOPE_COLD_FIXTURE === "1" },
  () => {
    const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "ci-change-scope-no-dependencies-"),
    );
    const copy = (path: string) => {
      const destination = join(fixtureRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(repositoryRoot, path), destination);
    };

    try {
      for (const path of [
        "package.json",
        "scripts/ci-change-scope.test.ts",
        "scripts/ci-change-scope-renames.test.ts",
        "scripts/ci-change-scope.ts",
        "scripts/lib/mutation-scope.ts",
        "verification/execution-lease/manifest.json",
        "scripts/ci-build-workspaces.test.ts",
        "scripts/ci-build-workspaces.ts",
        "scripts/design-e2e-regression-pin-identities.test.ts",
        "scripts/design-e2e-regression-pins.test.ts",
        "scripts/guard-no-unbounded-table-reads.test.ts",
        "scripts/deploy-alerts-workflow.test.ts",
        "scripts/package-release-workflow.test.ts",
        "scripts/qa-deploy-paths-lib.ts",
        "scripts/design-e2e-regression-pins.ts",
        "scripts/design-e2e-spec-selection.ts",
        ".github/workflows/ci.yml",
        ".github/workflows/slides-authoring-nightly.yml",
        ".github/workflows/slides-authoring-image.yml",
        ".github/workflows/email-workflow-failures.yml",
        ".github/actions/slides-authoring-shard/action.yml",
        ".github/actions/slides-authoring-image/action.yml",
        "docker/ci-slides-authoring/Dockerfile",
        "pnpm-workspace.yaml",

        ".github/workflows/design-e2e.yml",
        ".github/workflows/slides-authoring-fuzz-soak.yml",
        "templates/design/e2e/global-setup.ts",
        "templates/design/playwright.config.ts",
        "templates/design/e2e/css-style-helpers.ts",
        "templates/design/e2e/css-style-helpers.spec.ts",
        "templates/design/e2e/drag-and-drop.modifier-timing.spec.ts",
        "templates/design/e2e/interaction-card-structure.spec.ts",
        "templates/design/e2e/interaction-mobile-landing.spec.ts",
        "templates/design/e2e/interaction-selection-history-delete-screen.spec.ts",
        "community-templates/package.json",
        "templates/clips/desktop/package.json",
      ]) {
        copy(path);
      }
      for (const entry of readdirSync(
        join(repositoryRoot, "community-templates"),
        { withFileTypes: true },
      )) {
        if (
          entry.isDirectory() &&
          existsSync(
            join(
              repositoryRoot,
              "community-templates",
              entry.name,
              "package.json",
            ),
          )
        ) {
          copy(`community-templates/${entry.name}/package.json`);
        }
      }

      assert.equal(existsSync(join(fixtureRoot, "node_modules")), false);
      const childEnv = {
        ...process.env,
        CI_CHANGE_SCOPE_COLD_FIXTURE: "1",
        NODE_PATH: "",
      };
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--test",
          "scripts/ci-change-scope.test.ts",
          "scripts/ci-change-scope-renames.test.ts",
          "scripts/ci-build-workspaces.test.ts",
        ],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          env: childEnv,
        },
      );
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /pre-install scope tests pass without workspace dependencies/u,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test("sizes changed-spec diagnostic shards to the selected tests", () => {
  const root = mkdtempSync(join(tmpdir(), "design-diagnostic-shards-"));
  try {
    mkdirSync(join(root, "e2e"));
    const spec = (name: string, tests: number) => {
      writeFileSync(
        join(root, "e2e", name),
        Array.from(
          { length: tests },
          (_, i) => `test("t${i}", () => {});`,
        ).join("\n"),
      );
      return `e2e/${name}`;
    };
    assert.deepEqual(designCanvasE2eDiagnosticShardsFor([], root), []);
    assert.deepEqual(
      designCanvasE2eDiagnosticShardsFor([spec("small.spec.ts", 3)], root),
      ["changed-1"],
    );
    assert.deepEqual(
      designCanvasE2eDiagnosticShardsFor(["e2e/deleted.spec.ts"], root),
      ["changed-1"],
    );
    assert.equal(
      designCanvasE2eDiagnosticShardsFor([spec("medium.spec.ts", 40)], root)
        .length,
      4,
    );
    const all = designCanvasE2eDiagnosticShardsFor(
      [spec("all.spec.ts", 1038)],
      root,
    );
    assert.equal(all.length, 48);
    assert.equal(all.at(-1), "changed-48");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
