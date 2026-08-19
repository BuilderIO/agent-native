import { describe, expect, it } from "vitest";

import {
  decidePullRequestGovernance,
  detectOwnerOwnedArea,
  hasCurrentPullRequestApproval,
  isDocsOnly,
} from "./pr-policy.js";

const cleanInternalBug = {
  author: "builder-engineer",
  repository: "BuilderIO/agent-native",
  changedFiles: ["packages/core/src/triage/fix.ts"],
  clearBug: true,
  productUxImplications: false,
  checksPassed: true,
  reviewFeedbackHandled: true,
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
      }),
    ).toMatchObject({
      autoApprove: true,
      autoMerge: false,
    });
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
      hasCurrentPullRequestApproval([
        {
          author: "reviewer",
          state: "approved",
          observedAt: "2026-08-19T10:00:00Z",
        },
      ]),
    ).toBe(true);
    expect(
      hasCurrentPullRequestApproval([
        {
          author: "reviewer",
          state: "approved",
          observedAt: "2026-08-19T10:00:00Z",
        },
        {
          author: "reviewer",
          state: "dismissed",
          observedAt: "2026-08-19T11:00:00Z",
        },
      ]),
    ).toBe(false);
  });
});
