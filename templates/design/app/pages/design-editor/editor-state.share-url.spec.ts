import { describe, expect, it } from "vitest";

import { getDesignEditorShareUrl } from "./editor-state";

describe("getDesignEditorShareUrl", () => {
  it("keeps the design surface as the default share target", () => {
    expect(
      getDesignEditorShareUrl(
        "design / one",
        "https://design.example",
        "/app/",
      ),
    ).toBe("https://design.example/app/design/design%20%2F%20one");
  });

  it("creates a Visual Edit live canvas URL under the configured base path", () => {
    expect(
      getDesignEditorShareUrl(
        "design / one",
        "https://design.example",
        "/app/",
        "visual-edit",
      ),
    ).toBe("https://design.example/app/visual-edit/design%20%2F%20one?share=1");
  });
});
