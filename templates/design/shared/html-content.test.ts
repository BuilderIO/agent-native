import { describe, expect, it } from "vitest";

import {
  isProbablyHtmlDocumentContent,
  shouldUseLiveFileContent,
} from "./html-content";

describe("html content guards", () => {
  it("accepts ordinary HTML documents", () => {
    expect(
      isProbablyHtmlDocumentContent(
        "<!DOCTYPE html><html><body><main>Design</main></body></html>",
      ),
    ).toBe(true);
  });

  it("rejects orphaned attribute fragments before an HTML document", () => {
    expect(
      shouldUseLiveFileContent({
        fileType: "html",
        liveContent:
          ' data-agent-native-node-id="an-1"<!DOCTYPE html><html></html>',
        storedContent: "<!DOCTYPE html><html></html>",
      }),
    ).toBe(false);
  });

  it("does not police non-html files", () => {
    expect(
      shouldUseLiveFileContent({
        fileType: "css",
        liveContent: "body { color: red; }",
        storedContent: "body { color: blue; }",
      }),
    ).toBe(true);
  });
});
