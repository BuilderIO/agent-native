import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import { sidebarWriteCommandReason } from "./sidebar-commands";

function page(
  id: string,
  parentId: string | null = null,
  overrides: Partial<Document> = {},
): Document {
  return {
    id,
    parentId,
    title: id,
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    canEdit: true,
    visibility: "private",
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
    ...overrides,
  };
}

describe("sidebar write commands", () => {
  it("requires affirmative edit authority and explains unsupported source writes", () => {
    expect(
      sidebarWriteCommandReason(page("viewer", null, { canEdit: false })),
    ).toBe("readOnly");
    expect(
      sidebarWriteCommandReason(page("unknown", null, { canEdit: undefined })),
    ).toBe("readOnly");
    expect(
      sidebarWriteCommandReason(
        page("file", null, { source: { mode: "local-files" } }),
      ),
    ).toBe("sourceUnsupported");
    expect(
      sidebarWriteCommandReason(
        page("notion", null, { notionPageId: "external" }),
      ),
    ).toBe("sourceUnsupported");
  });
});
