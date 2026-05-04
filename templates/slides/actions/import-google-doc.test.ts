import { describe, expect, it } from "vitest";
import {
  extractGoogleDocId,
  extractGoogleDocUrls,
  normalizeGoogleDocText,
} from "../shared/google-docs";

describe("import-google-doc helpers", () => {
  it("extracts document IDs from standard Google Docs URLs", () => {
    expect(
      extractGoogleDocId(
        "https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?pli=1&tab=t.0",
      ),
    ).toBe("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk");
  });

  it("accepts raw document IDs", () => {
    expect(
      extractGoogleDocId("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk"),
    ).toBe("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk");
  });

  it("rejects non-Google URLs", () => {
    expect(
      extractGoogleDocId("https://example.com/document/d/not-a-doc"),
    ).toBeNull();
  });

  it("extracts Google Docs URLs from pasted prose", () => {
    expect(
      extractGoogleDocUrls(
        "Please use https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?tab=t.0.",
      ),
    ).toEqual([
      "https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?tab=t.0",
    ]);
  });

  it("normalizes exported document text", () => {
    expect(normalizeGoogleDocText("A\r\nB\t \n\n\u0000C\n")).toBe("A\nB\n\nC");
  });
});
