import { describe, expect, it } from "vitest";

import { formIdFromDrop } from "./FolderRow";

describe("formIdFromDrop", () => {
  it("takes the form id out of the link the browser puts on a dragged row", () => {
    expect(
      formIdFromDrop(
        "https://labs.agent-native.com/forms-2/forms/9cdfd3fc566f/edit",
      ),
    ).toBe("9cdfd3fc566f");
    expect(formIdFromDrop("/forms-2/forms/abc123/share")).toBe("abc123");
  });

  it("takes a bare id from a list that sets the payload itself", () => {
    expect(formIdFromDrop("9cdfd3fc566f")).toBe("9cdfd3fc566f");
  });

  it("refuses a payload that names no form", () => {
    expect(formIdFromDrop("")).toBeNull();
    expect(formIdFromDrop("  ")).toBeNull();
    expect(formIdFromDrop("https://example.test/somewhere")).toBeNull();
  });
});
