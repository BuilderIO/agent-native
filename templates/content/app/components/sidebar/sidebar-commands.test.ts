import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import { sidebarMoveTargets, sidebarWriteCommandReason } from "./sidebar-commands";

function page(id: string, parentId: string | null = null, overrides: Partial<Document> = {}): Document {
  return { id, parentId, title: id, content: "", icon: null, position: 0, isFavorite: false, hideFromSearch: false, canEdit: true, visibility: "private", createdAt: "2026-09-09", updatedAt: "2026-09-09", ...overrides };
}

describe("sidebar write commands", () => {
  it("requires affirmative edit authority and explains unsupported source writes", () => {
    expect(sidebarWriteCommandReason(page("viewer", null, { canEdit: false }))).toBe("readOnly");
    expect(sidebarWriteCommandReason(page("unknown", null, { canEdit: undefined }))).toBe("readOnly");
    expect(sidebarWriteCommandReason(page("file", null, { source: { mode: "local-files" } }))).toBe("sourceUnsupported");
    expect(sidebarWriteCommandReason(page("notion", null, { notionPageId: "external" }))).toBe("sourceUnsupported");
  });

  it("excludes containment descendants regardless of list order, without treating references as children", () => {
    const source = page("source");
    const targets = sidebarMoveTargets([
      page("grandchild", "child"), page("other"), page("child", source.id), source,
      page("viewer", null, { canEdit: false }), page("org", null, { visibility: "org" }),
      page("reference", null, { content: "[source](/page/source)" }),
    ], source);
    expect(targets.map((target) => target.id)).toEqual(["other", "reference"]);
  });
});
