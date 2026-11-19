import { describe, expect, it } from "vitest";

import { findDesignToolPaste } from "./index";

const clipboard = (values: Record<string, string>) => ({
  getData: (type: string) => values[type] ?? "",
});

const WONDER = `<!-- wonder-clipboard:${"A".repeat(40)} -->`;

describe("findDesignToolPaste", () => {
  it("claims an HTML copy, even when its data is damaged", () => {
    expect(
      findDesignToolPaste(
        clipboard({ "text/html": "<!-- wonder-clipboard:%%%% -->" }),
      ),
    ).toMatchObject({ tool: "wonder" });
  });

  it("claims a plain-text copy that carries the whole envelope", () => {
    expect(
      findDesignToolPaste(clipboard({ "text/plain": WONDER })),
    ).toMatchObject({ tool: "wonder" });
  });

  it("leaves ordinary plain text that mentions a marker alone", () => {
    expect(
      findDesignToolPaste(
        clipboard({
          "text/plain": "the wonder-clipboard: comment holds the data",
        }),
      ),
    ).toBeNull();
  });

  it("finds nothing in an ordinary paste", () => {
    expect(
      findDesignToolPaste(clipboard({ "text/plain": "hello" })),
    ).toBeNull();
    expect(findDesignToolPaste(null)).toBeNull();
  });
});
