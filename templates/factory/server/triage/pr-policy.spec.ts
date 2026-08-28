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
    expect(isUltraScaryChange(["nested/AGENTS.md"])).toBe(true);
    expect(isUltraScaryChange([".agents/skills/other/SKILL.md"])).toBe(true);
    expect(
      isUltraScaryChange(["templates/factory/server/triage/pr-policy.ts"]),
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

  it("applies the current app owner exceptions only to their scoped changes", () => {
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
      hasCurrentBlockingPullRequestReview([
        {
          author: "reviewer",
          state: "changes_requested",
          observedAt: "2026-08-19T10:00:00Z",
        },
        {
          author: "reviewer",
          state: "approved",
          observedAt: "2026-08-19T11:00:00Z",
        },
      ]),
    ).toBe(false);
    expect(
      hasCurrentBlockingPullRequestReview([
        {
          author: "reviewer",
          state: "changes_requested",
          observedAt: "2026-08-19T10:00:00Z",
        },
        {
          author: "reviewer",
          state: "commented",
          observedAt: "2026-08-19T11:00:00Z",
        },
      ]),
    ).toBe(true);
    expect(
      hasCurrentBlockingPullRequestReview([
        {
          author: "reviewer",
          state: "pending",
          observedAt: "2026-08-19T10:00:00Z",
        },
      ]),
    ).toBe(true);
  });
});
