import { describe, expect, it } from "vitest";

import {
  decidePullRequestGovernance,
  detectOwnerOwnedArea,
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
  it("approves and merges a clean internal Factory bug fix", () => {
    expect(decidePullRequestGovernance(cleanInternalBug)).toMatchObject({
      ownerOwnedArea: null,
      autoApprove: true,
      autoMerge: true,
    });
  });

  it("leaves owner-managed app work manual even when every other gate passes", () => {
    for (const area of ["Clips", "Design", "Content"] as const) {
      expect(
        decidePullRequestGovernance({
          ...cleanInternalBug,
          repository: `BuilderIO/${area.toLowerCase()}`,
        }),
      ).toMatchObject({
        ownerOwnedArea: area.toLowerCase(),
        autoApprove: false,
        autoMerge: false,
      });
    }
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
});
