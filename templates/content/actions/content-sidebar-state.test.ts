import { describe, expect, it } from "vitest";

import {
  CONTENT_SIDEBAR_STATE_VERSION,
  normalizeContentSidebarState,
} from "./_content-sidebar-state";

describe("normalizeContentSidebarState", () => {
  it("deduplicates persisted expansion ids", () => {
    expect(
      normalizeContentSidebarState({
        version: CONTENT_SIDEBAR_STATE_VERSION,
        expandedWorkspaceIds: ["personal", "personal"],
        expandedDocumentIds: ["parent", "parent", "child"],
      }),
    ).toEqual({
      version: CONTENT_SIDEBAR_STATE_VERSION,
      expandedWorkspaceIds: ["personal"],
      expandedDocumentIds: ["parent", "child"],
    });
  });

  it("distinguishes absent state from unreadable saved state", () => {
    expect(normalizeContentSidebarState(null)).toBeNull();
    expect(() => normalizeContentSidebarState({ version: 0 })).toThrow();
  });
});
