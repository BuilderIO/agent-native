import { describe, expect, it } from "vitest";

import {
  decidePullRequestGovernance,
  detectOwnerOwnedArea,
  hasCurrentBlockingPullRequestReview,
  hasCurrentPullRequestApproval,
  hasActiveCredibleSafetyFinding,
  isDocsOnly,
  isUltraScaryChange,
} from "./pr-policy.js";

const cleanInternalBug = {
  author: "builder-engineer",
  authorId: 1,
  repository: "BuilderIO/agent-native",
  changedFiles: ["packages/core/src/triage/fix.ts"],
  clearBug: true,
  productUxImplications: false,
  checksPassed: true,
  reviewFeedbackHandled: true,
  blockingReviewStatesClean: true,
  safetyFindingsClean: true,
  openNonDraft: true,
  internalBuilderMember: true,
  factoryTriggered: true,
};

describe("pull-request governance", () => {
  it("approves but never merges a clean internal Factory bug fix", () => {
    expect(decidePullRequestGovernance(cleanInternalBug)).toMatchObject({
      ownerOwnedArea: null,
      ownerException: null,
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("keeps non-owner-managed app work manual", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        repository: "BuilderIO/content",
        changedFiles: ["templates/content/app/routes/index.tsx"],
      }),
    ).toMatchObject({
      ownerOwnedArea: "content",
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("allows a verified internal author through ordinary check and review uncertainty", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        reviewFeedbackHandled: false,
        blockingReviewStatesClean: true,
      }),
    ).toMatchObject({
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("never approves partial CI evidence even for a verified internal author", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksCoverage: "partial",
      }),
    ).toMatchObject({
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("applies the verified Liam exception across ordinary UX gates", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: ["templates/design/app/pages/DesignEditor.tsx"],
        clearBug: false,
        productUxImplications: true,
        checksPassed: false,
        reviewFeedbackHandled: false,
        blockingReviewStatesClean: true,
      }),
    ).toMatchObject({
      trustException: "liamdebeasi",
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("keeps the Liam exception behind membership and governance safety gates", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: ["templates/design/app/pages/DesignEditor.tsx"],
        clearBug: false,
        productUxImplications: true,
        internalBuilderMember: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: [".agents/skills/review-prs/SKILL.md"],
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        clearBug: false,
        productUxImplications: true,
        blockingReviewStatesClean: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        repository: "BuilderIO/other-repo",
        clearBug: false,
        productUxImplications: true,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        clearBug: false,
        productUxImplications: true,
        factoryTriggered: false,
      }).autoApprove,
    ).toBe(false);
    expect(isUltraScaryChange(["nested/AGENTS.md"])).toBe(true);
    expect(isUltraScaryChange([".agents/skills/other/SKILL.md"])).toBe(true);
    expect(isUltraScaryChange([".github/actions/checkout/action.yml"])).toBe(
      true,
    );
    expect(isUltraScaryChange(["package.json"])).toBe(true);
    expect(isUltraScaryChange(["pnpm-lock.yaml"])).toBe(true);
    expect(isUltraScaryChange(["turbo.json"])).toBe(true);
    expect(
      isUltraScaryChange(["templates/factory/server/triage/pr-policy.ts"]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/actions/govern-factory-pull-request.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/lib/require-workspace-member.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/lib/require-workspace-member.spec.ts",
      ]),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "No security issues found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "No security vulnerabilities were identified.",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "Authentication middleware does not enforce tenant isolation.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "Authentication is secure but this endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "This endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            author: "reviewer",
            state: "commented",
            body: "Nit: rename this variable.",
            observedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "This change enables XSS." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "approved", body: "No XSS or CSRF vulnerabilities found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "The SSRF vulnerability is not fixed." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "There is no authorization." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "This endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            author: "reviewer",
            state: "approved",
            body: "Resolved.",
            observedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "Authorization is not enforced on this endpoint.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "The previous authorization issue is resolved, but this endpoint has an SSRF vulnerability.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      isUltraScaryChange(["templates/factory/server/triage/github-client.ts"]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/triage/ai-services-git.ts",
        "templates/factory/server/triage/pr-monitor.ts",
        "templates/factory/actions/ingest-github-observation.ts",
        "templates/factory/actions/reconcile-triage-run.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/actions/approve-factory-item.ts",
        "templates/factory/actions/start-builder-for-item.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/plugins/agent-chat.ts",
        "templates/factory/server/triage/builder-executor.ts",
      ]),
    ).toBe(true);
  });

  it("keeps active safety findings blocking", () => {
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "This bypasses tenant isolation." }],
        [],
      ),
    ).toBe(true);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        safetyFindingsClean: false,
      }).autoApprove,
    ).toBe(false);
  });

  it("does not trust an owner username without verified membership", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "3mdistal",
        changedFiles: ["templates/content/app/routes/index.tsx"],
        clearBug: false,
        checksPassed: false,
        reviewFeedbackHandled: false,
        internalBuilderMember: false,
      }),
    ).toMatchObject({
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("applies the current owner exceptions within their configured scopes", () => {
    const cases = [
      {
        author: "3mdistal",
        changedFiles: [
          "templates/content/app/routes/index.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "alice-content",
        ownerOwnedArea: "content",
      },
      {
        author: "NKoech123",
        changedFiles: [
          "templates/slides/app/routes/index.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "nick-slides",
        ownerOwnedArea: null,
      },
      {
        author: "enzoames",
        changedFiles: ["templates/factory/actions/run.ts"],
        ownerException: "enzo-factory",
        ownerOwnedArea: null,
      },
      {
        author: "sidmohanty11",
        changedFiles: ["templates/design/app/routes/index.tsx"],
        ownerException: "sid-design",
        ownerOwnedArea: "design",
      },
      {
        author: "shomix",
        changedFiles: [
          "templates/design/app/pages/DesignEditor.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "shomix",
        ownerOwnedArea: "design",
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        decidePullRequestGovernance({
          ...cleanInternalBug,
          author: testCase.author,
          changedFiles: testCase.changedFiles,
          clearBug: false,
          productUxImplications: true,
          checksPassed: false,
          reviewFeedbackHandled: false,
        }),
      ).toMatchObject({
        ownerException: testCase.ownerException,
        ownerOwnedArea: testCase.ownerOwnedArea,
        autoApprove: true,
        autoMerge: false,
      });
    }
  });

  it("keeps the Shomix exception behind its identity, safety, and review gates", () => {
    const shomixPullRequest = {
      ...cleanInternalBug,
      author: "Shomix",
      changedFiles: ["templates/factory/server/triage/policy.ts"],
      clearBug: false,
      productUxImplications: true,
    };

    expect(decidePullRequestGovernance(shomixPullRequest)).toMatchObject({
      ownerException: "shomix",
      autoApprove: true,
      autoMerge: false,
    });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        repository: "BuilderIO/other-repo",
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        internalBuilderMember: false,
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        safetyFindingsClean: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        blockingReviewStatesClean: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [".agents/skills/review-prs/SKILL.md"],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [
          "templates/factory/actions/govern-factory-pull-request.ts",
        ],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [
          "templates/factory/server/lib/require-workspace-member.ts",
        ],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    for (const path of [
      "packages/core/src/client/mcp-apps/McpAppRenderer.tsx",
      "packages/core/src/mcp/embed-app.ts",
      "packages/core/src/mcp/mount-mcp.ts",
      "packages/core/src/mcp/build-server.ts",
      "packages/core/src/mcp/oauth-route.ts",
      "packages/core/src/mcp/oauth-token.ts",
      "packages/core/src/mcp-client/oauth-routes.ts",
      "packages/core/src/mcp-client/oauth-flow-cookie.ts",
      "packages/core/src/server/embed-session.ts",
      "packages/core/src/server/embed-route.ts",
      "packages/core/src/server/embedded.ts",
      "packages/core/src/client/embed-auth.ts",
      "packages/core/src/client/embed.ts",
      "packages/core/src/client/IframeEmbed.tsx",
      "packages/core/src/client/AgentNativeEmbedded.tsx",
      "packages/core/src/client/mcp-app-host.ts",
      "packages/core/src/shared/embed-auth.ts",
      "packages/core/src/shared/mcp-embed-headers.ts",
      "packages/core/src/client/blocks/library/sanitize-html.ts",
      "packages/core/src/authorization/check-action.ts",
      "packages/core/src/authorization/action-access-runtime.ts",
      "packages/core/src/org/membership.ts",
      "packages/core/src/org/workspace-app-access.ts",
      "packages/core/src/org/app-roles.ts",
      "packages/core/src/org/actions/offboard-member.ts",
      "packages/core/src/org/actions/set-app-member-roles.ts",
      "packages/core/src/org/actions/set-workspace-app-access.ts",
      "packages/core/src/sharing/access.ts",
      "packages/core/src/mcp/connect-route.ts",
      "packages/core/src/mcp/connect-store.ts",
      "packages/core/src/mcp/approval-store.ts",
      "packages/core/src/mcp/actions/service-token-access.ts",
      "packages/core/src/mcp/actions/create-org-service-token.ts",
      "packages/core/src/mcp/actions/revoke-org-service-token.ts",
      "packages/core/src/agent/tool-approval-store.ts",
      "packages/core/src/agent/actions/set-tool-approval-policy.ts",
      "packages/core/src/workspace-connections/actions/upsert-workspace-user-group.ts",
      "packages/core/src/db/schema.ts",
      "templates/factory/server/db/schema.ts",
      "packages/core/src/scripts/db/schema.ts",
      "packages/core/src/scripts/db/wipe-leaked-builder-keys.ts",
      "packages/core/src/server/csrf.ts",
      "packages/core/src/server/csrf.spec.ts",
      "packages/core/src/server/csrf-plugin-ordering.integration.spec.ts",
      "packages/core/src/server/cors-origins.ts",
      ".github/dependabot.yml",
      "packages/core/src/server/short-lived-token.ts",
      "packages/core/src/server/realtime-token.ts",
      "packages/core/src/integrations/internal-token.ts",
      "packages/core/src/org/context.ts",
      "packages/core/src/org/federation.ts",
      "packages/core/src/email-catalog/authorize.ts",
      "packages/core/src/guards/no-unscoped-queries.ts",
      "packages/core/src/mcp/server.ts",
      "packages/core/src/mcp-client/manager.ts",
      "packages/core/src/embedding/bridge.ts",
      "packages/core/src/client/ApiKeySettings.tsx",
      "packages/core/src/client/MCPClientManager.ts",
      "packages/core/src/server/CSRFPlugin.ts",
      "packages\\core\\src\\client\\ApiKeySettings.tsx",
      "packages/core/src/extensions/url-safety.ts",
      "packages/core/src/extensions/fetch-tool.ts",
      "packages/core/src/extensions/html-shell.ts",
      "packages/core/src/extensions/routes.ts",
      "packages/core/src/client/extensions/iframe-bridge.ts",
      "packages/core/src/client/extensions/AgentNativeExtensionFrame.tsx",
      "packages/core/src/client/extensions/InlineExtensionFrame.tsx",
      "packages/core/src/db-admin/routes.ts",
      "packages/core/src/db-admin/operations.ts",
      "packages/core/src/triggers/webhook.ts",
      "packages/core/src/triggers/webhook-store.ts",
      "packages/core/src/triggers/dispatcher.ts",
      "packages/core/src/triggers/dispatcher.spec.ts",
      "packages/core/src/triggers/condition-evaluator.ts",
      "packages/core/src/triggers/actions/manage-automation.ts",
      "packages/core/src/triggers/actions/manage-automation.spec.ts",
      "packages/core/src/jobs/frontmatter.ts",
      "packages/core/src/jobs/frontmatter.spec.ts",
      "packages/core/src/jobs/run-now.ts",
      "packages/core/src/jobs/run-now.spec.ts",
      "packages/core/src/jobs/background-automation-runner.ts",
      "packages/core/src/jobs/scheduler.ts",
      "packages/core/src/automations/service.ts",
      "packages/core/src/automations/service.spec.ts",
      "packages/core/src/notifications/store.ts",
      "packages/core/src/notifications/store.spec.ts",
      "packages/core/src/notifications/channels.ts",
      "packages/core/src/notifications/channels.spec.ts",
      "packages/core/src/notifications/actions.ts",
      "packages/core/src/server/collab-plugin.ts",
      "packages/core/src/server/collab-plugin.spec.ts",
      "packages/core/src/server/origin-allowlist.ts",
      "packages/core/src/server/prompts/framework-core-compact.ts",
      "packages/core/src/guards/no-unscoped-queries.spec.ts",
      "packages/core/src/server/prompts/framework-core.ts",
      "packages/core/src/server/prompts/shared-rules.ts",
      "packages/core/src/server/builder-browser.ts",
      "packages/core/src/server/core-routes-plugin.ts",
      "packages/core/src/server/core-routes-plugin.spec.ts",
      "packages/core/src/server/open-route.ts",
      "packages/core/src/server/open-route.spec.ts",
      "packages/core/src/server/agent-chat/browser-team-tools.ts",
      "packages/core/src/server/agent-chat/browser-team-tools.spec.ts",
      "packages/core/src/browser-context/index.ts",
      "packages/core/src/client/host-bridge.ts",
      "packages/core/src/client/frame.ts",
      "packages/core/src/client/builder-frame.ts",
      "packages/core/src/client/blocks/library/html.config.ts",
      "packages/core/src/client/blocks/library/html.tsx",
      "packages/core/src/client/blocks/library/diagram.tsx",
      "packages/core/src/client/blocks/library/wireframe.tsx",
      "packages/core/src/server/agent-chat-plugin.ts",
      "packages/core/src/server/builder-preview-relay.spec.ts",
      "packages/core/src/server/action-routes.ts",
      "packages/core/src/server/action-routes.spec.ts",
      "packages/core/src/server/hosted-harness-policy.ts",
      "packages/core/src/server/hosted-harness-policy.spec.ts",
      "packages/core/src/cli/workspace-skill-policy.ts",
      "packages/core/src/shared/password-policy.ts",
      "packages/core/src/shared/framework-route-prefix.spec.ts",
      "packages/core/src/triggers/routes.ts",
      "packages/core/src/collab/routes.ts",
      "packages/core/src/collab/struct-routes.ts",
      "packages/core/src/notifications/routes.ts",
      "templates/mail/app/lib/sanitize-html.ts",
      "templates/slides/app/lib/sanitize-slide-html.ts",
      "templates/design/shared/capture-sanitize.ts",
      "templates/design/shared/capture-sanitize.spec.ts",
      "templates/brain/server/lib/capture-sanitization.ts",
      "templates/brain/server/lib/capture-sanitization.test.ts",
      "templates/brain/actions/resanitize-captures.ts",
      "templates/brain/actions/resanitize-captures.spec.ts",
      "templates/plan/app/components/plan/wireframe/sanitize-html.spec.ts",
      "templates/calendar/app/lib/sanitize-description.ts",
      "templates/calendar/app/lib/sanitize-description.test.ts",
      "templates/content/scripts/migrate-production.ts",
      "templates/forms/actions/delete-form.ts",
      "templates/clips/actions/delete-recording-permanent.ts",
      "templates/calendar/amplify.yml",
      "packages/creative-context/src/server/safe-native-preview.ts",
      "packages/creative-context/src/connectors/rendered-page.ts",
      "packages/recap-cli/src/recap.ts",
    ]) {
      expect(isUltraScaryChange([path])).toBe(true);
      expect(
        decidePullRequestGovernance({
          ...shomixPullRequest,
          changedFiles: [path],
        }),
      ).toMatchObject({ ownerException: null, autoApprove: false });
    }
    for (const path of [
      "templates/forms/app/schemas/lead.ts",
      "packages/core/src/guards/no-raw-colors.ts",
      "templates/slides/app/components/editor/PromptDialog.tsx",
      "templates/tasks/app/components/shared/DeleteItemDialog.tsx",
    ]) {
      expect(isUltraScaryChange([path])).toBe(false);
      expect(
        decidePullRequestGovernance({
          ...shomixPullRequest,
          changedFiles: [path],
        }),
      ).toMatchObject({ ownerException: "shomix", autoApprove: true });
    }
  });

  it("requires complete check evidence while allowing the internal-member exception", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        checksCoverage: "complete",
      }).autoApprove,
    ).toBe(true);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        checksCoverage: "partial",
      }).autoApprove,
    ).toBe(false);
  });

  it("applies the verified docs-only exception", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "bwreid",
        changedFiles: ["docs/review.md", ".changeset/docs-review.md"],
        clearBug: false,
        productUxImplications: true,
        checksPassed: false,
        reviewFeedbackHandled: false,
      }),
    ).toMatchObject({
      ownerException: "docs-only",
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("does not treat source artifacts as docs-only MDX", () => {
    expect(isDocsOnly(["templates/plan/plan.mdx"])).toBe(false);
    expect(isDocsOnly(["templates/tasks/docs/features/f1-tasks.mdx"])).toBe(
      true,
    );
  });

  it("keeps ultra-scary paths manual despite a verified owner", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "3mdistal",
        changedFiles: [
          "templates/content/app/routes/index.tsx",
          "packages/core/src/auth/session.ts",
        ],
        clearBug: false,
        productUxImplications: false,
      }),
    ).toMatchObject({
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("does not treat a product or UX change as a clear-bug approval", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        productUxImplications: true,
      }).autoApprove,
    ).toBe(false);
  });

  it("recognizes app-labelled reports but not a generic Clips URL", () => {
    expect(detectOwnerOwnedArea(["Design Generation: broken export"])).toBe(
      "design",
    );
    expect(
      detectOwnerOwnedArea(["https://clips.agent-native.com/feedback"]),
    ).toBeNull();
    expect(detectOwnerOwnedArea(["apps/content/src/routes/index.tsx"])).toBe(
      "content",
    );
  });

  it("recognizes a current approval but not a later dismissal", () => {
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "commented",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "dismissed",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(false);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "old-head",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "new-head",
      ),
    ).toBe(false);
    expect(() =>
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toThrow("missing a commit SHA");
  });

  it("preserves active changes requests across comments", () => {
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(false);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "commented",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "pending",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "approved",
            commitSha: "old-head",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
  });
});
