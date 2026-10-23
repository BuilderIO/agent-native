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
const PRE_AUTH_SESSION_REPLAY_E2E_SPEC =
  "templates/design/e2e/pre-auth-session-replay-smoke.spec.ts";

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
    "scripts/design-e2e-regression-pins.ts",
    "scripts/design-e2e-regression-pins.test.ts",
  ],
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
const DESIGN_CANVAS_IMPORT_GRAPH_ROOTS = [
  DESIGN_CANVAS_E2E_ROOT,
  "templates/design/app/pages",
  "templates/design/app/components/design",
  "templates/design/shared",
  "templates/design/actions",
  "templates/design/server",
] as const;
const DESIGN_BROAD_WORKFLOW_SHARDS = new Map([
  [
    "templates/design/e2e/ai-sidebar-reporter-path.spec.ts",
    "ai-sidebar-loopback",
  ],
  [
    "templates/design/e2e/interaction-responsive-music-app.spec.ts",
    "music-app-workflow",
  ],
  [
    "templates/design/e2e/home-system-selection.spec.ts",
    "home-system-selection",
  ],
  [
    "templates/design/e2e/interaction-landing-page-build.spec.ts",
    "landing-page-build",
  ],
  [
    "templates/design/e2e/autolayout-drag-drop-matrix.spec.ts",
    "autolayout-vertical-center-trailing",
  ],
]);
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
  "templates/design/playwright.config.ts",
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
  PRE_AUTH_SESSION_REPLAY_E2E_SPEC,
  "templates/design/playwright.config.ts",
  "templates/design/server/plugins/config.ts",
  "templates/slides/server/plugins/config.ts",
]);

const CONTENT_DB_CORE_FILES = new Set([
  "packages/core/src/application-state/store.ts",
  "packages/core/src/server/database-identity.ts",
  "packages/core/src/server/release-migrations.ts",
  "packages/core/src/server/release-schema.ts",
  "packages/core/src/server/request-context.ts",
  "packages/core/src/sharing/indexes.ts",
]);

const CONTENT_DB_CORE_PATH_PREFIXES = ["packages/core/src/db/"] as const;

// The convergence lane covers its harness, stored-form acceptance, nested widget
// storage isolation, and the build and Core runtime they exercise.
const CONTENT_CONVERGENCE_FILES = new Set([
  "templates/content/acceptance/known-loss.ts",
  "templates/content/acceptance/round-trip-corpus.ts",
  "templates/content/agent-native.config.ts",
  "templates/content/agent-native.json",
  "templates/content/package.json",
  "templates/content/react-router.config.ts",
  "templates/content/ssr-entry.ts",
  "templates/content/vite.config.ts",
  "templates/content/e2e/auth-files.ts",
  "templates/content/e2e/convergence-summary.ts",
  "templates/content/e2e/editor-input-lineage.ts",
  "templates/content/e2e/gate-arm.ts",
  "templates/content/e2e/global-setup.ts",
  "templates/content/e2e/global-teardown.ts",
  "templates/content/e2e/helpers.ts",
  "templates/content/e2e/live-body-gate.ts",
  "templates/content/e2e/playwright.config.ts",
  "templates/content/e2e/save-lineage.ts",
  "templates/content/e2e/server-identity.ts",
  "templates/content/e2e/two-tab-convergence.spec.ts",
  "templates/content/e2e/chatgpt-widget-body-paint.spec.ts",
]);

const CONTENT_CONVERGENCE_CORE_FILES = new Set([
  "packages/core/src/appearance/theme-family.ts",
  "packages/core/src/application-state/emitter.ts",
  "packages/core/src/client/application-state.ts",
  "packages/core/src/collab/client.ts",
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
]);

const CONTENT_CONVERGENCE_CORE_PATH_PREFIXES = [
  "packages/core/src/collab/",
] as const;

const SLIDES_TEXT_AUTHORING_FILES = new Set([
  "templates/slides/actions/create-deck.ts",
  "templates/slides/actions/delete-deck.ts",
  "templates/slides/actions/get-deck.ts",
  "templates/slides/actions/patch-deck.ts",
  "templates/slides/actions/save-deck.ts",
  "templates/slides/actions/update-slide.ts",
  "templates/slides/app/components/deck/SlideRenderer.tsx",
  "templates/slides/app/components/editor/BlockBubbleMenu.tsx",
  "templates/slides/app/components/editor/SlideContextToolbar.tsx",
  "templates/slides/app/components/editor/SlideEditor.tsx",
  "templates/slides/app/components/editor/SlideSlashCommandMenu.tsx",
  "templates/slides/app/components/editor/bullet-editing.ts",
  "templates/slides/app/components/editor/commit-active-edit.ts",
  "templates/slides/app/components/editor/editor-command-model.ts",
  "templates/slides/app/components/editor/inline-edit-session.ts",
  "templates/slides/app/components/editor/in-place-text-session.ts",
  "templates/slides/app/components/editor/list-editing.ts",
  "templates/slides/app/components/editor/rich-text-selection.ts",
  "templates/slides/app/components/editor/slide-escape-arbiter.ts",
  "templates/slides/app/components/editor/slide-object-interactions.ts",
  "templates/slides/app/components/editor/slide-pointer-target.ts",
  "templates/slides/app/components/editor/slide-text-targets.ts",
  "templates/slides/app/context/DeckContext.tsx",
  "templates/slides/app/pages/DeckEditor.tsx",
  "templates/slides/app/routes/deck.$id.tsx",
  "templates/slides/shared/client-compatibility.ts",
  "templates/slides/shared/deck-content.ts",
  "templates/slides/shared/deck-write.ts",
]);

const SLIDES_CARET_APP_FILES = new Set([
  "templates/slides/app/components/deck/SlideRenderer.tsx",
  "templates/slides/app/components/editor/SlideEditor.tsx",
  "templates/slides/app/components/editor/in-place-text-session.ts",
  "templates/slides/app/components/editor/rich-text-selection.ts",
  "templates/slides/app/components/editor/slide-pointer-target.ts",
  "templates/slides/app/components/editor/slide-text-targets.ts",
  "templates/slides/app/context/DeckContext.tsx",
  "templates/slides/app/pages/DeckEditor.tsx",
  "templates/slides/app/routes/deck.$id.tsx",
]);

const SLIDES_MOBILE_IMPORT_FILES = new Set([
  "templates/slides/app/components/editor/ImportDeckButton.tsx",
  "templates/slides/app/components/editor/use-prompt-import.ts",
  "templates/slides/app/hooks/use-slide-file-storage-status.ts",
  "templates/slides/app/pages/Index.tsx",
  "templates/slides/app/lib/prompt-file-uploads.ts",
  "templates/slides/shared/upload-types.ts",
  "packages/creative-context/src/eval/fixtures/launch-system-v1.pptx",
]);

const SLIDES_MOBILE_IMPORT_TOOLKIT_FILES = new Set([
  "packages/toolkit/src/ui/button.tsx",
  "packages/toolkit/src/ui/dropdown-menu.tsx",
  "packages/toolkit/src/ui/popover.tsx",
]);

const SLIDES_MOBILE_IMPORT_CORE_FILES = new Set([
  "packages/core/src/client/hooks/index.ts",
  "packages/core/src/client/use-action.ts",
]);

const SLIDES_TEXT_SURFACE_FILES = new Set([
  "templates/slides/actions/add-slide-comment.ts",
  "templates/slides/actions/delete-slide-comment.ts",
  "templates/slides/actions/update-slide-comment.ts",
  "templates/slides/actions/update-slide.ts",
  "templates/slides/app/components/comments/SlideCommentPins.tsx",
  "templates/slides/app/components/comments/SlideCommentsPanel.tsx",
  "templates/slides/app/components/deck/DeckCard.tsx",
  "templates/slides/app/components/editor/EditorToolbar.tsx",
  "templates/slides/app/components/editor/SlideEditor.tsx",
  "templates/slides/app/components/editor/SpeakerNotesPanel.tsx",
  "templates/slides/app/pages/DeckEditor.tsx",
  "templates/slides/app/pages/Index.tsx",
  "templates/slides/app/routes/deck.$id.tsx",
  "templates/slides/app/hooks/use-slide-comments.ts",
]);

const SLIDES_TEXT_SURFACE_TOOLKIT_FILES = new Set([
  "packages/toolkit/src/ui/avatar.tsx",
  "packages/toolkit/src/ui/button.tsx",
  "packages/toolkit/src/ui/dropdown-menu.tsx",
  "packages/toolkit/src/ui/input.tsx",
  "packages/toolkit/src/ui/popover.tsx",
  "packages/toolkit/src/ui/textarea.tsx",
  "packages/toolkit/src/ui/tooltip.tsx",
]);

const SLIDES_TEXT_SURFACE_CORE_FILES = new Set([
  "packages/core/src/client/api-surface.ts",
  "packages/core/src/client/hooks/index.ts",
  "packages/core/src/client/use-action.ts",
  "packages/core/src/client/use-avatar.ts",
  "packages/core/src/collab/types.ts",
]);

const SLIDES_TYPING_CHAT_FILES = new Set([
  "templates/slides/actions/create-deck.ts",
  "templates/slides/app/components/editor/SlideEditor.tsx",
  "templates/slides/app/components/editor/SlidesComposerContext.tsx",
  "templates/slides/app/components/editor/SlidesComposerContextProvider.tsx",
  "templates/slides/app/context/DeckContext.tsx",
  "templates/slides/app/pages/DeckEditor.tsx",
  "templates/slides/app/routes/deck.$id.tsx",
  "templates/slides/app/components/layout/Layout.tsx",
]);

const SLIDES_TYPING_CHAT_CORE_FILES = new Set([
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
  "packages/core/src/client/hooks/index.ts",
  "packages/core/src/client/onboarding/index.ts",
  "packages/core/src/client/use-active-agent-chat-run.ts",
  "packages/core/src/client/use-agent-chat-context.ts",
  "packages/core/src/client/use-agent-chat-running-threads.ts",
  "packages/core/src/client/use-agent-chat.ts",
  "packages/core/src/client/use-action.ts",
  "packages/core/src/client/use-change-version.ts",
  "packages/core/src/client/use-chat-models.ts",
  "packages/core/src/client/use-chat-threads.ts",
  "packages/core/src/client/use-send-to-agent-chat.ts",
  "packages/core/src/client/use-session.ts",
]);

const SLIDES_TYPING_CHAT_AGENTKIT_FILES = new Set([
  "packages/agentkit/package.json",
  "packages/agentkit/src/client/client.ts",
  "packages/agentkit/src/client/index.ts",
  "packages/agentkit/src/client/state.ts",
  "packages/agentkit/src/index.ts",
  "packages/agentkit/src/protocol/index.ts",
]);

const SLIDES_TYPING_CHAT_TOOLKIT_FILES = new Set([
  "packages/toolkit/package.json",
  "packages/toolkit/src/app/agentkit/react/chat.tsx",
  "packages/toolkit/src/app/agentkit/react/components.tsx",
  "packages/toolkit/src/app/agentkit/react/composer-submission.ts",
  "packages/toolkit/src/app/agentkit/react/context.tsx",
  "packages/toolkit/src/app/agentkit/react/index.ts",
  "packages/toolkit/src/app/agentkit/react/root.tsx",
  "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
  "packages/toolkit/src/app/chat/AgentPanel.tsx",
  "packages/toolkit/src/app/chat/AgentSidebar.tsx",
  "packages/toolkit/src/app/chat/AgentSidebarPanel.tsx",
  "packages/toolkit/src/app/chat/MultiTabAssistantChat.tsx",
  "packages/toolkit/src/app/chat/agent-sidebar-context.ts",
  "packages/toolkit/src/app/chat/agent-sidebar-events.ts",
  "packages/toolkit/src/app/chat/agent-sidebar-url-sync.tsx",
  "packages/toolkit/src/app/chat/agentkit-chat/history.tsx",
  "packages/toolkit/src/app/chat/agentkit-chat/index.ts",
  "packages/toolkit/src/app/chat/agentkit-chat/parity-renderers.tsx",
  "packages/toolkit/src/app/chat/agentkit-chat/root.tsx",
  "packages/toolkit/src/app/chat/chat/agent-approval-card.tsx",
  "packages/toolkit/src/app/chat/chat/markdown-renderer.tsx",
  "packages/toolkit/src/app/chat/chat/run-recovery.tsx",
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
]);

const CONTENT_DB_ACTION_RUNTIME_FILES = new Set([
  "templates/content/actions/_document-edit-mutation.ts",
  "templates/content/actions/_comment-write-pool.test-fixture.ts",
  "templates/content/actions/_blocks-field-identity.ts",
  "templates/content/actions/_content-database-mutation-lock.ts",
  "templates/content/actions/_content-favorites.ts",
  "templates/content/actions/_content-files.ts",
  "templates/content/actions/_database-membership-lock.ts",
  "templates/content/actions/_database-setup-mutation.ts",
  "templates/content/actions/_database-source-utils.ts",
  "templates/content/actions/_document-save-locks.ts",
  "templates/content/actions/_row-lock-order.ts",
  "templates/content/actions/_position-utils.ts",
  "templates/content/actions/bind-content-database-source-field.ts",
  "templates/content/actions/cancel-prepared-builder-source-update.ts",
  "templates/content/actions/export-document.ts",
  "templates/content/actions/get-trashed-document.ts",
  "templates/content/actions/import-content-source.ts",
  "templates/content/actions/import-content.ts",
  "templates/content/actions/list-content-databases.ts",
  "templates/content/actions/list-content-trash.ts",
  "templates/content/actions/migrate-content-database-rows.ts",
  "templates/content/actions/move-database-item.ts",
  "templates/content/actions/move-document.ts",
  "templates/content/actions/patch-database-items.ts",
  "templates/content/actions/react-to-comment.ts",
  "templates/content/actions/record-live-body-parity.ts",
  "templates/content/actions/resolve-content-landing.ts",
  "templates/content/actions/resolve-content-links.ts",
  "templates/content/actions/restore-document.ts",
  "templates/content/actions/stage-builder-source-bulk-update.ts",
  "templates/content/actions/submit-content-database-form.ts",
  "templates/content/actions/suggest-document-edit.ts",
  "templates/content/actions/undo-comment-ai-request.ts",
  "templates/content/actions/update-document.ts",
  "templates/content/actions/upsert-database-item-by-key.ts",
  "scripts/test-content-database-lock-pglite.mjs",
]);

const CONTENT_CONVERGENCE_ACTION_FILES = new Set([
  "templates/content/actions/add-comment.ts",
  "templates/content/actions/create-document.ts",
  "templates/content/actions/delete-document.ts",
  "templates/content/actions/edit-document.ts",
  "templates/content/actions/get-document.ts",
  "templates/content/actions/get-trashed-document.ts",
  "templates/content/actions/import-content.ts",
  "templates/content/actions/list-comments.ts",
  "templates/content/actions/list-document-history.ts",
  "templates/content/actions/list-document-versions.ts",
  "templates/content/actions/list-documents.ts",
  "templates/content/actions/move-document.ts",
  "templates/content/actions/permanently-delete-document.ts",
  "templates/content/actions/plan-content-trash-purge.ts",
  "templates/content/actions/pull-document.ts",
  "templates/content/actions/react-to-comment.ts",
  "templates/content/actions/restore-document.ts",
  "templates/content/actions/restore-document-version.ts",
  "templates/content/actions/suggest-document-edit.ts",
  "templates/content/actions/update-comment.ts",
  "templates/content/actions/update-document.ts",
  "templates/content/server/lib/chatgpt-directory-tools.ts",
]);

const CONTENT_CONVERGENCE_SHARED_FILES = new Set([
  "templates/content/shared/api.ts",
  "templates/content/shared/builder-mdx.ts",
  "templates/content/shared/content-source.ts",
  "templates/content/shared/labs.ts",
  "templates/content/shared/nfm-registry.ts",
  "templates/content/shared/nfm.ts",
  "templates/content/shared/suggestion-rebase.ts",
  "templates/content/shared/suggestion-text.ts",
]);

const CHECK_NAMES = [
  "lint",
  "typecheck",
  "fast_tests",
  "content",
  "content_db",
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
  "slides_caret_e2e",
  "slides_typing_chat_e2e",
  "slides_mobile_import_e2e",
  "slides_text_surface_e2e",
  "slides_authoring_e2e",
  "slides_oracle",
  "changeset",
] as const;

const SLOW_APP_CHECKS = [
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
] as const;

const QUERY_BUDGET_UNRELATED_SCRIPTS = new Set([
  "scripts/agent-friction-report.mjs",
  "scripts/ci-change-scope.test.ts",
]);

const CORE_BUILDER_CODE_SCAFFOLD_FILES = new Set([
  "packages/core/src/cli/create.ts",
  "packages/core/src/cli/create-workspace.ts",
  "packages/core/src/cli/create-tui.tsx",
  "packages/core/src/cli/index.ts",
]);

const CORE_BRAIN_EVAL_PATHS = [
  "packages/core/src/action.ts",
  "packages/core/src/action-",
  "packages/core/src/application-state/",
  "packages/core/src/cli/index.ts",
  "packages/core/src/db/",
  "packages/core/src/embeddings/",
  "packages/core/src/private-blob/",
  "packages/core/src/provider-api/",
  "packages/core/src/resources/",
  "packages/core/src/scripts/runner.ts",
  "packages/core/src/search/",
  "packages/core/src/search-utils/",
  "packages/core/src/server/agent-discovery.ts",
  "packages/core/src/server/index.ts",
  "packages/core/src/server/request-context.ts",
  "packages/core/src/settings/",
  "packages/core/src/sharing/",
  "packages/core/src/tracking/",
  "packages/core/src/workspace-connections/",
] as const;

const BRAIN_EVAL_RUNTIME_PATHS = [
  "templates/brain/actions/run-demo-eval.ts",
  "templates/brain/actions/run-retrieval-eval.ts",
  "templates/brain/actions/seed-demo-data.ts",
  "templates/brain/agent-native.config.ts",
  "templates/brain/agent-native.json",
  "templates/brain/package.json",
  "templates/brain/server/db/index.ts",
  "templates/brain/server/db/schema.ts",
  "templates/brain/server/lib/brain-health.ts",
  "templates/brain/server/lib/brain.ts",
  "templates/brain/server/lib/demo.ts",
  "templates/brain/server/lib/search.ts",
  "templates/brain/shared/types.ts",
  "templates/brain/vitest.config.ts",
] as const;

const PLAN_E2E_RUNTIME_PATHS = [
  "templates/plan/actions/create-visual-recap.ts",
  "templates/plan/actions/create-visual-recap.e2e.spec.ts",
  "templates/plan/actions/import-visual-plan-source.ts",
  "templates/plan/package.json",
  "templates/plan/server/db/index.ts",
  "templates/plan/server/db/schema.ts",
  "templates/plan/server/lib/local-identity.ts",
  "templates/plan/server/lib/plan-org-context.ts",
  "templates/plan/server/plan-mdx.ts",
  "templates/plan/server/plans.ts",
  "templates/plan/server/test-support/plans-test-schema.ts",
  "templates/plan/vitest.config.ts",
] as const;

const CORE_AGENTKIT_ACCEPTANCE_PATHS = [
  "packages/core/src/agent/",
  "packages/core/src/client/agent-chat/",
  "packages/core/src/client/auth/",
  "packages/core/src/client/chat/",
  "packages/core/src/server/action-routes.ts",
  "packages/core/src/server/agent-chat-plugin.ts",
  "packages/core/src/server/agent-chat/",
  "packages/core/src/server/app-base-path.ts",
  "packages/core/src/server/auth.ts",
  "packages/core/src/server/framework-request-handler.ts",
  "packages/core/src/server/index.ts",
  "packages/core/src/server/onboarding-html.ts",
  "packages/core/src/server/poll-events.ts",
  "packages/core/src/server/poll.ts",
  "packages/core/src/scripts/runner.ts",
  "packages/core/src/templates/",
  "packages/core/src/server/request-context.ts",
] as const;

const CORE_INTEGRATION_PATH_PREFIXES = [
  "packages/core/src/agent/",
  "packages/core/src/db/",
  "packages/core/src/scripts/db/",
] as const;

const CORE_INTEGRATION_RUNTIME_FILES = new Set([
  "packages/core/src/client/session-replay-iframe.e2e-host.tsx",
  "packages/core/src/extensions/session-replay-iframe.ts",
  "packages/core/src/secrets/crypto.ts",
  "packages/core/src/server/action-routes.ts",
  "packages/core/src/server/core-routes-plugin.ts",
  "packages/core/src/server/embedded.ts",
  "packages/core/src/server/framework-request-handler.ts",
  "packages/core/src/server/request-context.ts",
  "packages/core/src/session-replay-iframe-protocol.ts",
  "templates/analytics/scripts/journey-capture-iframe-audit.ts",
  "templates/design/app/components/templates/TemplatePreview.tsx",
  "templates/design/shared/design-template-presets/social-story.ts",
  "packages/toolkit/src/app/extensions/AgentNativeExtensionFrame.tsx",
]);

const CORE_INTEGRATION_TEST_FILES = new Set([
  "packages/core/src/agent/engine/translate-ai-sdk.integration.spec.ts",
  "packages/core/src/agent/run-loop-with-resume.integration.spec.ts",
  "packages/core/src/agent/run-store.fencing.postgres.integration.spec.ts",
  "packages/core/src/client/session-replay-iframe.e2e.spec.ts",
  "packages/core/src/scripts/db/migrate-encrypt-credentials.e2e.spec.ts",
  "packages/core/src/scripts/db/scope-isolation.e2e.spec.ts",
  "packages/core/src/server/csrf-plugin-ordering.integration.spec.ts",
  "packages/core/src/server/embedded.integration.spec.ts",
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

const GLOBAL_RUNTIME_INPUTS = new Set([
  ".github/actions/setup-pnpm/action.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

const CORE_DEPLOY_PATHS = [
  "packages/core/package.json",
  "packages/core/src/action.ts",
  "packages/core/src/action-",
  "packages/core/src/db/",
  "packages/core/src/server/action-routes.ts",
  "packages/core/src/server/auth.ts",
  "packages/core/src/server/core-routes-plugin.ts",
  "packages/core/src/server/framework-request-handler.ts",
  "packages/core/src/server/request-context.ts",
] as const;

const TOOLKIT_CHAT_RUNTIME_PATHS = [
  "packages/toolkit/src/app/auth/",
  "packages/toolkit/src/app/chat/agentkit-chat/",
  "packages/toolkit/src/app/chat/chat/",
  "packages/toolkit/src/app/chat/composer/",
  "packages/toolkit/src/app/chat/conversation/",
  "packages/toolkit/src/app/providers/",
  "packages/toolkit/src/composer/",
] as const;

const AGENTKIT_PACKAGE_RUNTIME_PATHS = [
  "packages/agentkit/src/adapters/",
  "packages/agentkit/src/client/",
  "packages/agentkit/src/conformance/",
  "packages/agentkit/src/protocol/",
  "packages/agentkit/src/chat-context.ts",
  "packages/agentkit/src/index.ts",
] as const;

const TOOLKIT_AGENTKIT_RUNTIME_PATHS = [
  "packages/toolkit/src/app/agentkit/",
  "packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx",
  "packages/toolkit/src/app/chat/agentkit-chat/",
  "packages/toolkit/src/app/chat/composer/",
  "packages/toolkit/src/composer/",
] as const;

const TOOLKIT_SSR_BOOT_RUNTIME_PATHS = [
  "packages/toolkit/src/app/agentkit/",
  "packages/toolkit/src/app/auth/",
  "packages/toolkit/src/app/blocks/",
  "packages/toolkit/src/app/chat/",
  "packages/toolkit/src/app/db-admin/",
  "packages/toolkit/src/app/dev-overlay/",
  "packages/toolkit/src/app/extensions/",
  "packages/toolkit/src/app/feedback/",
  "packages/toolkit/src/app/i18n/",
  "packages/toolkit/src/app/org/",
  "packages/toolkit/src/app/providers/",
  "packages/toolkit/src/app/review/",
  "packages/toolkit/src/app/settings/",
  "packages/toolkit/src/app/shared/",
  "packages/toolkit/src/app-shell/",
  "packages/toolkit/src/clipboard/",
  "packages/toolkit/src/collab-ui/",
  "packages/toolkit/src/composer/",
  "packages/toolkit/src/data-grid/",
  "packages/toolkit/src/design-system/",
  "packages/toolkit/src/editor/",
  "packages/toolkit/src/hooks/use-mobile.ts",
  "packages/toolkit/src/icons/",
  "packages/toolkit/src/sharing/",
  "packages/toolkit/src/ui/",
  "packages/toolkit/src/utils/",
] as const;

export type CheckSelection = Record<CheckName, boolean>;

export type ChangeScope = {
  changedPaths: string[];
  designCanvasE2eSpecs: string[];
  designCanvasE2eDiagnosticSpecs: string[];
  designCanvasE2eSpecCount: number;
  designCanvasBroadWorkflowShards: string[];
  docsOnly: boolean;
  full: boolean;
  nonDocsPaths: string[];
  checks: CheckSelection;
  workspaceFilters: string[];
  testWorkspaceFilters: string[];
  scriptTests: string[];
  queryBudgetApps: string[];
  queryBudgetShards: QueryBudgetShard[];
  scaffoldCli: boolean;
  scaffoldWorkspace: boolean;
  scaffoldWorkspaceApps: string[];
  ssrBootApps: string[];
  trustedAcceptanceApps: string[];
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

function isKnownFullPath(path: string): boolean {
  return (
    isWorkspacePath(path) ||
    isDocsPath(path) ||
    isInstructionPath(path) ||
    isGuardScopedScriptPath(path) ||
    isReadmePath(path) ||
    FULL_CHECK_FILES.has(path) ||
    path.startsWith(".github/") ||
    path.startsWith("scripts/")
  );
}

function hasUnknownFullPath(paths: readonly string[]): boolean {
  return (
    paths.length === 0 ||
    paths.some((path) => !isKnownFullPath(normalizeChangedPath(path))) ||
    (paths.some(isWorkspacePath) &&
      workspaceFiltersForPaths(paths).length === 0)
  );
}

function hasGlobalRuntimeInput(paths: readonly string[]): boolean {
  return paths.some((path) =>
    GLOBAL_RUNTIME_INPUTS.has(normalizeChangedPath(path)),
  );
}

function isDesignCanvasE2eSpecPath(path: string): boolean {
  return (
    path.startsWith("templates/design/e2e/") &&
    path !== PRE_AUTH_SESSION_REPLAY_E2E_SPEC &&
    /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function isEligibleDesignCanvasE2eSpecPath(
  path: string,
  includePreAuthSessionReplay: boolean,
): boolean {
  return (
    isDesignCanvasE2eSpecPath(path) ||
    (includePreAuthSessionReplay && path === PRE_AUTH_SESSION_REPLAY_E2E_SPEC)
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

function isDesignCanvasDependencyPath(path: string): boolean {
  return (
    DESIGN_CANVAS_IMPORT_GRAPH_ROOTS.some((root) =>
      path.startsWith(`${root}/`),
    ) &&
    DESIGN_CANVAS_E2E_SOURCE_RE.test(path) &&
    !DESIGN_CANVAS_PIN_ATTESTATION_FILES.has(path) &&
    !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
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
            uncertain = true;
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

  // Extra graph edges only over-select CI; the token scanner can mistake regex or JSX quotes for strings.
  const rawImportPatterns = [
    /\b(?:import|require)\s*\(\s*(["'`])((?:\.{1,2}\/)[^"'`\\$]*)\1/gu,
    /\bimport\s*(["'`])((?:\.{1,2}\/)[^"'`\\$]*)\1/gu,
    /\bfrom\s*(["'`])((?:\.{1,2}\/)[^"'`\\$]*)\1/gu,
  ];
  for (const pattern of rawImportPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[2]) specifiers.add(match[2]);
    }
  }

  return { specifiers: [...specifiers], uncertain };
}

function designCanvasE2eSourcePaths(repositoryRoot: string): string[] {
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

  for (const rootPath of DESIGN_CANVAS_IMPORT_GRAPH_ROOTS) {
    const root = join(repositoryRoot, rootPath);
    if (existsSync(root)) visit(root);
  }
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
      ...DESIGN_CANVAS_IMPORT_GRAPH_ROOTS,
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
  includePreAuthSessionReplay = false,
): string[] {
  const changedPaths = paths.map(normalizeChangedPath);
  const isTargetSpec = (path: string) =>
    isEligibleDesignCanvasE2eSpecPath(path, includePreAuthSessionReplay);
  const directSpecs = changedPaths.filter(isTargetSpec);
  const changedHelpers = changedPaths.filter(
    (path) =>
      isDesignCanvasE2eSupportPath(path) || isDesignCanvasDependencyPath(path),
  );
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
    let specs = sourcePaths.filter(isTargetSpec);
    if (specs.length === 0) {
      specs = designCanvasE2ePathsFromGit(repositoryRoot).filter(isTargetSpec);
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
      if (sourcePath.startsWith(`${DESIGN_CANVAS_E2E_ROOT}/`)) {
        uncertainDependency ||= modules.uncertain;
      }
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
        if (isTargetSpec(importer)) {
          consumers.add(importer);
        }
        pending.push(importer);
      }
    }

    if (consumers.size === 0 && isDesignCanvasE2eSupportPath(helperPath)) {
      for (const spec of allEligibleSpecs()) selectedSpecs.add(spec);
    } else if (consumers.size > 0) {
      for (const spec of consumers) selectedSpecs.add(spec);
    }
  }

  return [...selectedSpecs].sort();
}

function isDesignDndRuntimePath(path: string): boolean {
  if (
    DESIGN_CANVAS_E2E_FILES.has(path) ||
    DESIGN_CANVAS_CONFIG_FILES.has(path)
  ) {
    return true;
  }

  if (isSsrBootSourcePath(path)) {
    return (
      [
        "templates/design/app/components/design/design-canvas/",
        "templates/design/app/components/design/multi-screen/",
        "templates/design/app/pages/design-editor/",
      ].some((prefix) => path.startsWith(prefix)) ||
      [
        "templates/design/app/pages/DesignEditor.tsx",
        "templates/design/app/components/MultiScreenCanvas.tsx",
        "templates/design/actions/edit-design.ts",
        "templates/design/actions/update-file.ts",
        "templates/design/actions/update-design.ts",
        "templates/design/actions/update-screen-source.ts",
        "templates/design/server/handlers/design.ts",
        "templates/design/server/db/index.ts",
        "templates/design/server/db/schema.ts",
        "templates/design/shared/canvas-frames.ts",
        "templates/design/shared/canvas-math.ts",
        "templates/design/shared/code-layer.ts",
        "templates/design/shared/pen-path.ts",
        "templates/design/shared/responsive-frame-layout.ts",
        "templates/design/.generated/bridge/editor-chrome.generated.ts",
      ].includes(path)
    );
  }

  return false;
}

function isSlidesEditFidelityHarnessPath(path: string): boolean {
  if (!path.startsWith("templates/slides/scripts/edit-fidelity/")) {
    return false;
  }
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    /\.[cm]?[jt]sx?$/u.test(path) ||
    (path.startsWith("templates/slides/scripts/edit-fidelity/corpus/") &&
      path.endsWith(".json"))
  );
}

function isSlidesAuthoringPath(path: string): boolean {
  return (
    SLIDES_TEXT_AUTHORING_FILES.has(path) ||
    isSlidesEditFidelityHarnessPath(path) ||
    [
      "templates/slides/agent-native.config.ts",
      "templates/slides/agent-native.json",
      "templates/slides/package.json",
      "templates/slides/react-router.config.ts",
      "templates/slides/vite.config.ts",
    ].includes(path)
  );
}

function isSlidesEditFidelityHarnessCodePath(path: string): boolean {
  return isSlidesEditFidelityHarnessPath(path) && !path.includes("/corpus/");
}

function isSlidesCaretPath(path: string): boolean {
  if (SLIDES_CARET_APP_FILES.has(path)) return true;
  return isSlidesEditFidelityHarnessCodePath(path);
}

function isSlidesMobileImportPath(path: string): boolean {
  return (
    SLIDES_MOBILE_IMPORT_FILES.has(path) ||
    isSlidesMobileImportSharedRuntimePath(path) ||
    isSlidesEditFidelityHarnessCodePath(path)
  );
}

function isSlidesTextSurfacePath(path: string): boolean {
  return (
    SLIDES_TEXT_SURFACE_FILES.has(path) ||
    isSlidesTextSurfaceSharedRuntimePath(path) ||
    isSlidesEditFidelityHarnessCodePath(path)
  );
}

function isSlidesTypingChatPath(path: string): boolean {
  return (
    SLIDES_TYPING_CHAT_FILES.has(path) ||
    isSlidesEditFidelityHarnessCodePath(path)
  );
}

function isSlidesCaretSharedRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return ["packages/toolkit/src/canvas-interactions/"].some((prefix) =>
    path.startsWith(prefix),
  );
}

function isSlidesMobileImportSharedRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    SLIDES_MOBILE_IMPORT_TOOLKIT_FILES.has(path) ||
    SLIDES_MOBILE_IMPORT_CORE_FILES.has(path)
  );
}

function isSlidesTextSurfaceSharedRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    SLIDES_TEXT_SURFACE_TOOLKIT_FILES.has(path) ||
    SLIDES_TEXT_SURFACE_CORE_FILES.has(path)
  );
}

function isSlidesTypingChatSharedRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    SLIDES_TYPING_CHAT_CORE_FILES.has(path) ||
    SLIDES_TYPING_CHAT_AGENTKIT_FILES.has(path) ||
    SLIDES_TYPING_CHAT_TOOLKIT_FILES.has(path)
  );
}

function isCoreScaffoldRuntimePath(path: string): boolean {
  return (
    CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path) ||
    path.startsWith("packages/core/src/templates/") ||
    path === "packages/core/package.json"
  );
}

function isCorePlanE2eRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    path === "packages/core/package.json" ||
    path === "packages/core/src/index.ts" ||
    path === "packages/core/src/action.ts" ||
    path === "packages/core/src/blocks/server.ts" ||
    path === "packages/core/src/server/request-context.ts" ||
    path.startsWith("packages/core/src/sharing/")
  );
}

function isCoreBrainEvalRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  if (path === "packages/core/package.json") return true;
  return CORE_BRAIN_EVAL_PATHS.some((prefix) =>
    prefix.endsWith("/") || prefix.endsWith("-")
      ? path.startsWith(prefix)
      : path === prefix,
  );
}

function isBrainEvalRuntimePath(path: string): boolean {
  return BRAIN_EVAL_RUNTIME_PATHS.some((candidate) => candidate === path);
}

function isPlanE2eRuntimePath(path: string): boolean {
  return PLAN_E2E_RUNTIME_PATHS.some((candidate) => candidate === path);
}

function isCoreAgentkitAcceptanceRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    path === "packages/core/package.json" ||
    path === "packages/core/src/action.ts" ||
    path === "packages/core/src/cli/index.ts" ||
    path === "packages/core/src/client/use-action.ts" ||
    path === "packages/core/src/index.ts" ||
    CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path) ||
    CORE_AGENTKIT_ACCEPTANCE_PATHS.some((prefix) => path.startsWith(prefix))
  );
}

function isCoreContentParityRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    path === "packages/core/package.json" ||
    path === "packages/core/src/action.ts" ||
    path.startsWith("packages/core/src/action-") ||
    path.startsWith("packages/core/src/eval/") ||
    path.startsWith("packages/core/src/private-blob/") ||
    isContentDbCoreRuntimePath(path)
  );
}

function isCoreDeployRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path) ||
    CORE_DEPLOY_PATHS.some((prefix) =>
      prefix.endsWith("/") || prefix.endsWith("-")
        ? path.startsWith(prefix)
        : path === prefix,
    ) ||
    path.startsWith("packages/core/src/templates/")
  );
}

function isDeployPathsRuntimePath(path: string): boolean {
  return (
    isCoreDeployRuntimePath(path) ||
    isAgentKitPackageAcceptanceRuntimePath(path) ||
    isToolkitChatRuntimePath(path) ||
    path === "packages/agentkit/package.json" ||
    path === "packages/toolkit/package.json" ||
    path === "packages/otel/package.json" ||
    path.startsWith("packages/otel/src/") ||
    path.startsWith("packages/shared-app-config/") ||
    path.startsWith("templates/chat/") ||
    /^scripts\/qa-deploy-paths(?:\.ts|-lib\.ts|-cloud\.ts)$/u.test(path) ||
    isDeployGuidePath(path)
  );
}

function isToolkitChatRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return TOOLKIT_CHAT_RUNTIME_PATHS.some((prefix) => path.startsWith(prefix));
}

function isToolkitAgentKitAcceptanceRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    TOOLKIT_AGENTKIT_RUNTIME_PATHS.some((prefix) => path.startsWith(prefix)) ||
    path === "packages/toolkit/package.json"
  );
}

function isAgentKitPackageAcceptanceRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    path === "packages/agentkit/package.json" ||
    AGENTKIT_PACKAGE_RUNTIME_PATHS.some((prefix) =>
      prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix,
    )
  );
}

function isCoreIntegrationRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) {
    return CORE_INTEGRATION_TEST_FILES.has(path);
  }
  return (
    CORE_INTEGRATION_RUNTIME_FILES.has(path) ||
    CORE_INTEGRATION_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isContentConvergenceRuntimePath(path: string): boolean {
  if (CONTENT_CONVERGENCE_FILES.has(path)) {
    return true;
  }
  if (path.startsWith("templates/content/e2e/stored-form/")) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  if (
    CONTENT_CONVERGENCE_CORE_FILES.has(path) ||
    CONTENT_CONVERGENCE_CORE_PATH_PREFIXES.some((prefix) =>
      path.startsWith(prefix),
    )
  ) {
    return true;
  }

  // Most Toolkit changes are chat and shell UI that cannot lose page text.
  const toolkitEditorSource =
    ["packages/toolkit/src/editor/", "packages/toolkit/src/collab-ui/"].some(
      (prefix) => path.startsWith(prefix),
    ) || path === "packages/toolkit/package.json";
  const contentEditorSource =
    path === "templates/content/app/routes/page.$id.tsx" ||
    path === "templates/content/app/root.tsx" ||
    path === "templates/content/app/hooks/use-db-sync.ts" ||
    path.startsWith("templates/content/app/components/editor/");
  const contentDbRuntimeSource =
    path.startsWith("templates/content/server/db/") ||
    [
      "templates/content/server/plugins/auth.ts",
      "templates/content/server/plugins/db.ts",
      "templates/content/shared/content-editor-structural-schema.generated.json",
      "templates/content/shared/document-intent-merge.ts",
    ].includes(path) ||
    CONTENT_CONVERGENCE_ACTION_FILES.has(path) ||
    CONTENT_CONVERGENCE_SHARED_FILES.has(path);

  return toolkitEditorSource || contentEditorSource || contentDbRuntimeSource;
}

function isContentDbCoreRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    CONTENT_DB_CORE_FILES.has(path) ||
    CONTENT_DB_CORE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isContentDbRuntimePath(path: string): boolean {
  if (
    CONTENT_DB_ACTION_RUNTIME_FILES.has(path) ||
    path === "templates/content/vitest.config.ts" ||
    path === "templates/content/package.json" ||
    path === "templates/content/actions/_comment-write-pool.test-fixture.ts" ||
    path === "templates/content/server/plugins/db.ts" ||
    path === "templates/content/server/db/index.ts" ||
    path === "templates/content/server/db/schema.ts" ||
    [
      "templates/content/server/lib/document-history.ts",
      "templates/content/server/lib/private-icon-references.ts",
      "templates/content/server/lib/startup-maintenance.ts",
      "templates/content/server/lib/suggested-edits.ts",
    ].includes(path) ||
    (path.startsWith("templates/content/acceptance/") &&
      /(?:\.db\.test\.[cm]?[jt]sx?|\.(?:ts|tsx|json))$/u.test(path)) ||
    (path.startsWith("templates/content/actions/") &&
      /\.(?:db|postgres\.integration)\.test\.[cm]?[jt]sx?$/u.test(path))
  ) {
    return true;
  }
  return false;
}

function isTemplatePackageBuildRuntimePath(path: string, pkg: string): boolean {
  if (
    [
      `packages/${pkg}/package.json`,
      `packages/${pkg}/tsconfig.json`,
      `packages/${pkg}/tsup.config.ts`,
      `packages/${pkg}/vite.config.ts`,
    ].includes(path)
  ) {
    return true;
  }
  if (!path.startsWith(`packages/${pkg}/src/`)) return false;
  if (!/\.[cm]?[jt]sx?$/u.test(path)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return !/(?:^|\/)(?:__tests__|tests?|fixtures?|__fixtures__|e2e|docs)(?:\/|$)/u.test(
    path.slice(`packages/${pkg}/`.length),
  );
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
    paths.some(isCoreQueryBudgetRuntimePath) ||
    paths.some(isQueryBudgetRuntimePath)
  );
}

function isQueryBudgetRuntimePath(path: string): boolean {
  return (
    path === "scripts/neon-query-budget.ts" ||
    path === "scripts/neon-query-budgets.json"
  );
}

function isCoreQueryBudgetRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    isCoreDatabaseRuntimePath(path) ||
    path === "packages/core/src/action.ts" ||
    path.startsWith("packages/core/src/action-") ||
    path.startsWith("packages/core/src/server/action-")
  );
}

function isCoreDatabaseRuntimePath(path: string): boolean {
  return (
    path.startsWith("packages/core/src/db/") &&
    /\.[cm]?[jt]sx?$/u.test(path) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function changedQueryBudgetApps(paths: readonly string[]): string[] {
  return QUERY_BUDGET_APPS.filter((app) =>
    paths.some(
      (path) =>
        !/\.(?:css|svg)$/u.test(path) && isTemplateRuntimePath(path, app),
    ),
  );
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
  if (changedPaths.some(isCreativeContextQueryBudgetRuntimePath)) {
    for (const app of CREATIVE_CONTEXT_QUERY_BUDGET_APPS) {
      selectedApps.add(app);
    }
  }
  return QUERY_BUDGET_APPS.filter((app) => selectedApps.has(app));
}

function isCreativeContextQueryBudgetRuntimePath(path: string): boolean {
  return (
    path === "packages/creative-context/package.json" ||
    (path.startsWith("packages/creative-context/src/") &&
      isSsrBootSourcePath(path))
  );
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
  return (
    paths.some(isCoreSsrBootRuntimePath) ||
    paths.some(isToolkitSsrBootRuntimePath) ||
    paths.some(isSsrBootAuxiliaryPackageRuntimePath) ||
    paths.includes("scripts/ssr-boot-smoke.mjs")
  );
}

function isToolkitSsrBootRuntimePath(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  return (
    path === "packages/toolkit/package.json" ||
    (isSsrBootSourcePath(path) &&
      TOOLKIT_SSR_BOOT_RUNTIME_PATHS.some((prefix) => path.startsWith(prefix)))
  );
}

function isCoreSsrBootRuntimePath(path: string): boolean {
  if (!isSsrBootSourcePath(path)) return false;
  return [
    "packages/core/package.json",
    "packages/core/src/app-config/",
    "packages/core/src/db/",
    "packages/core/src/server/",
    "packages/core/src/vite/",
  ].some((prefix) => path === prefix || path.startsWith(prefix));
}

function isSsrBootAuxiliaryPackageRuntimePath(path: string): boolean {
  if (!isSsrBootSourcePath(path)) return false;
  return [
    "packages/otel/",
    "packages/recap-cli/",
    "packages/creative-context/",
  ].some(
    (prefix) =>
      path === `${prefix}package.json` || path.startsWith(`${prefix}src/`),
  );
}

function isSsrBootSourcePath(path: string): boolean {
  return (
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) &&
    /\.(?:[cm]?[jt]sx?|css|json|svg)$/u.test(path)
  );
}

function isSsrBootTemplateRuntimePath(path: string, app: string): boolean {
  return isTemplateRuntimePath(path, app);
}

function isTemplateRuntimePath(path: string, app: string): boolean {
  const root = `templates/${app}/`;
  if (!path.startsWith(root)) return false;
  const relativePath = path.slice(root.length);
  if (
    relativePath === "package.json" ||
    TEMPLATE_RUNTIME_ENTRYPOINTS.has(relativePath)
  ) {
    return true;
  }
  if (!isSsrBootSourcePath(path)) return false;
  if (
    /(?:^|\/)(?:__tests__|tests?|fixtures?|__fixtures__|__snapshots__|__mocks__|e2e|evals|docs)(?:\/|$)/u.test(
      relativePath,
    )
  ) {
    return false;
  }
  return ["app/", "actions/", "server/", "shared/", ".generated/bridge/"].some(
    (prefix) => relativePath.startsWith(prefix),
  );
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
    changedPaths.some((path) => isSsrBootTemplateRuntimePath(path, app)),
  );
}

function trustedAcceptanceAppsFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): string[] {
  if (!checks.trusted_acceptance) return [];
  const apps = ["calendar", "content"];
  if (full) return apps;
  return apps.filter((app) =>
    changedPaths.some((path) => isTemplateRuntimePath(path, app)),
  );
}

function designCanvasBroadWorkflowShardsFor(
  specs: readonly string[],
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): string[] {
  if (!checks.design_canvas_broad_workflows) return [];
  if (full) return [...DESIGN_BROAD_WORKFLOW_SHARDS.values()];
  if (
    changedPaths.some((path) =>
      DESIGN_CANVAS_CONFIG_FILES.has(normalizeChangedPath(path)),
    )
  ) {
    return [...DESIGN_BROAD_WORKFLOW_SHARDS.values()];
  }
  return [
    ...new Set(
      specs.flatMap((path) => {
        const shard = DESIGN_BROAD_WORKFLOW_SHARDS.get(path);
        return shard ? [shard] : [];
      }),
    ),
  ];
}

function scaffoldCliFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): boolean {
  if (!checks.scaffold) return false;
  if (full) return true;
  return (
    changedPaths.some((path) => CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path)) ||
    changedPaths.some((path) =>
      path.startsWith("packages/core/src/templates/headless/"),
    ) ||
    changedPaths.some((path) => isTemplateRuntimePath(path, "chat"))
  );
}

function scaffoldWorkspaceFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): boolean {
  if (!checks.scaffold) return false;
  if (full) return true;
  return (
    changedPaths.some((path) => CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path)) ||
    changedPaths.some((path) => path === "packages/core/package.json") ||
    changedPaths.some((path) =>
      [
        "packages/core/src/templates/workspace-root/",
        "packages/core/src/templates/workspace-core/",
      ].some((prefix) => path.startsWith(prefix)),
    ) ||
    changedPaths.some((path) => isTemplateRuntimePath(path, "chat")) ||
    changedPaths.some((path) => isTemplateRuntimePath(path, "calendar")) ||
    changedPaths.some((path) => isTemplateRuntimePath(path, "dispatch")) ||
    changedPaths.some((path) =>
      isTemplatePackageBuildRuntimePath(path, "dispatch"),
    ) ||
    changedPaths.some((path) =>
      isTemplatePackageBuildRuntimePath(path, "scheduling"),
    )
  );
}

function scaffoldWorkspaceAppsFor(
  changedPaths: readonly string[],
  full: boolean,
  checks: CheckSelection,
): string[] {
  if (!scaffoldWorkspaceFor(changedPaths, full, checks)) return [];
  if (
    full ||
    changedPaths.some((path) => CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path)) ||
    changedPaths.some((path) => path === "packages/core/package.json") ||
    changedPaths.some((path) =>
      [
        "packages/core/src/templates/workspace-root/",
        "packages/core/src/templates/workspace-core/",
      ].some((prefix) => path.startsWith(prefix)),
    )
  ) {
    return ["calendar", "dispatch"];
  }

  const apps: string[] = [];
  if (
    changedPaths.some((path) => isTemplateRuntimePath(path, "calendar")) ||
    changedPaths.some((path) =>
      isTemplatePackageBuildRuntimePath(path, "scheduling"),
    )
  ) {
    apps.push("calendar");
  }
  if (
    changedPaths.some((path) => isTemplateRuntimePath(path, "dispatch")) ||
    changedPaths.some((path) =>
      isTemplatePackageBuildRuntimePath(path, "dispatch"),
    )
  ) {
    apps.push("dispatch");
  }
  return apps;
}

function buildChecks(
  changedPaths: readonly string[],
  full: boolean,
  repositoryRoot = process.cwd(),
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
    if (
      !hasUnknownFullPath(changedPaths) &&
      !hasGlobalRuntimeInput(changedPaths)
    ) {
      const scopedChecks = buildChecks(changedPaths, false, repositoryRoot);
      for (const name of SLOW_APP_CHECKS) {
        checks[name] = scopedChecks[name];
      }
    }
    return checks;
  }

  const workspaceChanged = changedPaths.some(isWorkspacePath);
  const instructionsChanged = changedPaths.some(isInstructionPath);
  const guardScriptsChanged = changedPaths.some(isGuardScopedScriptPath);
  const readmeChanged = changedPaths.some(isReadmePath);
  const chatRuntimeChanged = changedPaths.some((path) =>
    isTemplateRuntimePath(path, "chat"),
  );
  const schedulingChanged = hasPath(changedPaths, "packages/scheduling/");
  const schedulingRuntimeChanged = changedPaths.some((path) =>
    isTemplatePackageBuildRuntimePath(path, "scheduling"),
  );
  const dispatchPackageRuntimeChanged = changedPaths.some((path) =>
    isTemplatePackageBuildRuntimePath(path, "dispatch"),
  );
  const contentChanged = hasPath(changedPaths, "templates/content/");
  const contentRuntimeChanged = changedPaths.some((path) =>
    isTemplateRuntimePath(path, "content"),
  );
  const calendarRuntimeChanged = changedPaths.some((path) =>
    isTemplateRuntimePath(path, "calendar"),
  );
  const dispatchTemplateRuntimeChanged = changedPaths.some((path) =>
    isTemplateRuntimePath(path, "dispatch"),
  );
  const templateChanged = hasPath(changedPaths, "templates/");
  const planChanged = hasPath(changedPaths, "templates/plan/");
  const clipsChanged = hasPath(changedPaths, "templates/clips/");
  const assetsChanged = hasPath(changedPaths, "templates/assets/");
  const neonQueryBudgetChanged =
    measuresEveryQueryBudgetApp(changedPaths) ||
    changedPaths.some(isCreativeContextQueryBudgetRuntimePath) ||
    changedQueryBudgetApps(changedPaths).length > 0;
  const slidesCaretE2eChanged =
    changedPaths.some(isSlidesCaretPath) ||
    changedPaths.some(isSlidesCaretSharedRuntimePath);
  const slidesTypingChatE2eChanged =
    changedPaths.some(isSlidesTypingChatPath) ||
    changedPaths.some(isSlidesTypingChatSharedRuntimePath);
  const designCanvasInteractionE2eChanged = changedPaths.some(
    isDesignDndRuntimePath,
  );
  const designCanvasPinAttestationChanged = changedPaths.some((path) =>
    DESIGN_CANVAS_PIN_ATTESTATION_FILES.has(path),
  );
  const preAuthSessionReplayE2eChanged = changedPaths.some((path) =>
    PRE_AUTH_SESSION_REPLAY_E2E_FILES.has(path),
  );
  const slidesMobileImportE2eChanged = changedPaths.some(
    isSlidesMobileImportPath,
  );
  const slidesTextSurfaceE2eChanged = changedPaths.some(
    isSlidesTextSurfacePath,
  );
  const contentConvergenceChanged = changedPaths.some(
    isContentConvergenceRuntimePath,
  );
  const contentDbCoreChanged = changedPaths.some(isContentDbCoreRuntimePath);
  const contentDbChanged =
    contentDbCoreChanged || changedPaths.some(isContentDbRuntimePath);

  return {
    lint: workspaceChanged || instructionsChanged || guardScriptsChanged,
    typecheck: workspaceChanged,
    fast_tests: workspaceChanged || instructionsChanged,
    content:
      contentChanged ||
      schedulingChanged ||
      changedPaths.some(isCoreContentParityRuntimePath),
    content_db: contentDbChanged,
    content_convergence: contentConvergenceChanged,
    core_integration: changedPaths.some(isCoreIntegrationRuntimePath),
    plan_e2e:
      changedPaths.some(isPlanE2eRuntimePath) ||
      changedPaths.some(isCorePlanE2eRuntimePath),
    brain_evals:
      changedPaths.some(isBrainEvalRuntimePath) ||
      changedPaths.some(isCoreBrainEvalRuntimePath),
    build: workspaceChanged || instructionsChanged,
    trusted_acceptance: contentRuntimeChanged || calendarRuntimeChanged,
    scaffold:
      changedPaths.some(isCoreScaffoldRuntimePath) ||
      chatRuntimeChanged ||
      calendarRuntimeChanged ||
      dispatchTemplateRuntimeChanged ||
      schedulingRuntimeChanged ||
      dispatchPackageRuntimeChanged,
    // The bundled Builder Code starter is a layer in core over templates/chat.
    builder_code_starter_scaffold:
      changedPaths.some((path) => CORE_BUILDER_CODE_SCAFFOLD_FILES.has(path)) ||
      hasPath(
        changedPaths,
        "packages/core/src/templates/builder-code-starter/",
      ) ||
      chatRuntimeChanged,
    deploy_paths: changedPaths.some(isDeployPathsRuntimePath),
    ssr_boot:
      ssrBootSharedPackageChanged(changedPaths) ||
      SSR_BOOT_APPS.some((app) =>
        changedPaths.some((path) => isSsrBootTemplateRuntimePath(path, app)),
      ),
    guards:
      workspaceChanged ||
      instructionsChanged ||
      guardScriptsChanged ||
      readmeChanged,
    qa_static: templateChanged,
    agentkit_acceptance:
      changedPaths.some(isCoreAgentkitAcceptanceRuntimePath) ||
      changedPaths.some(isToolkitAgentKitAcceptanceRuntimePath) ||
      changedPaths.some(isAgentKitPackageAcceptanceRuntimePath) ||
      hasPath(changedPaths, "packages/shared-app-config/") ||
      changedPaths.some(
        (path) =>
          path === ".github/actions/standalone-chat-acceptance/action.yml",
      ) ||
      changedPaths.some((path) =>
        [
          "scripts/qa-agentkit-packages.ts",
          "scripts/qa-sign-in-matrix-smoke.ts",
          "scripts/qa-standalone-chat-dev-smoke.ts",
        ].includes(path),
      ) ||
      chatRuntimeChanged,
    neon_query_budget: neonQueryBudgetChanged,
    // The probe imports only core's database client, so templates cannot
    // move it.
    neon_connection_budget: changedPaths.some(isCoreDatabaseRuntimePath),
    design_canvas_core_regression:
      designCanvasInteractionE2eChanged || designCanvasPinAttestationChanged,
    design_canvas_broad_workflows: designCanvasInteractionE2eChanged,
    pre_auth_session_replay_e2e: preAuthSessionReplayE2eChanged,
    slides_caret_e2e: slidesCaretE2eChanged,
    slides_typing_chat_e2e: slidesTypingChatE2eChanged,
    slides_mobile_import_e2e: slidesMobileImportE2eChanged,
    slides_text_surface_e2e: slidesTextSurfaceE2eChanged,
    slides_authoring_e2e: changedPaths.some(isSlidesAuthoringPath),
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
  const allDesignCanvasE2eSpecs = designCanvasE2eSpecsForPaths(
    changedPaths,
    repositoryRoot,
    true,
  );
  const preAuthSessionReplayE2eChanged = allDesignCanvasE2eSpecs.includes(
    PRE_AUTH_SESSION_REPLAY_E2E_SPEC,
  );
  const designCanvasE2eSpecs = allDesignCanvasE2eSpecs.filter(
    (path) => path !== PRE_AUTH_SESSION_REPLAY_E2E_SPEC,
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
    : buildChecks(changedPaths, full, repositoryRoot);
  if (preAuthSessionReplayE2eChanged) {
    checks.pre_auth_session_replay_e2e = true;
  }
  if (
    designCanvasE2eSpecs.some((path) => DESIGN_BROAD_WORKFLOW_SHARDS.has(path))
  ) {
    checks.design_canvas_broad_workflows = true;
  }
  const designCanvasBroadWorkflowShards = designCanvasBroadWorkflowShardsFor(
    designCanvasE2eSpecs,
    changedPaths,
    full,
    checks,
  );
  checks.design_canvas_broad_workflows =
    designCanvasBroadWorkflowShards.length > 0;
  const queryBudgetApps = queryBudgetAppsFor(changedPaths, full, checks);
  const changedDesignDiagnosticSpecs = designCanvasE2eSpecs.filter(
    (path) => !sameDirectoryPureDesignSpecRenameSet.has(path),
  );

  return {
    changedPaths,
    designCanvasE2eSpecs,
    designCanvasE2eDiagnosticSpecs: changedDesignDiagnosticSpecs,
    designCanvasE2eSpecCount: designCanvasE2eSpecs.length,
    designCanvasBroadWorkflowShards,
    docsOnly,
    full,
    nonDocsPaths,
    checks,
    workspaceFilters,
    testWorkspaceFilters,
    scriptTests: scriptTestsForPaths(changedPaths),
    queryBudgetApps,
    queryBudgetShards: shardQueryBudgetApps(queryBudgetApps),
    scaffoldCli: scaffoldCliFor(changedPaths, full, checks),
    scaffoldWorkspace: scaffoldWorkspaceFor(changedPaths, full, checks),
    scaffoldWorkspaceApps: scaffoldWorkspaceAppsFor(changedPaths, full, checks),
    ssrBootApps: ssrBootAppsFor(changedPaths, full, checks),
    trustedAcceptanceApps: trustedAcceptanceAppsFor(changedPaths, full, checks),
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
      `design_canvas_broad_workflow_shards=${JSON.stringify(scope.designCanvasBroadWorkflowShards)}`,
      `workspace_filters=${JSON.stringify(scope.workspaceFilters)}`,
      `script_tests=${JSON.stringify(scope.scriptTests)}`,
      `query_budget_matrix=${JSON.stringify({ include: scope.queryBudgetShards })}`,
      `scaffold_cli=${scope.scaffoldCli ? "true" : "false"}`,
      `scaffold_workspace=${scope.scaffoldWorkspace ? "true" : "false"}`,
      `scaffold_workspace_apps=${JSON.stringify(scope.scaffoldWorkspaceApps)}`,
      `ssr_boot_apps=${JSON.stringify(scope.ssrBootApps)}`,
      `trusted_acceptance_apps=${JSON.stringify(scope.trustedAcceptanceApps)}`,
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
