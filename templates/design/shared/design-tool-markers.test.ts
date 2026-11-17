import { describe, expect, it } from "vitest";

import {
  designToolClipboardContent,
  findCompleteDesignToolMarker,
  findDesignToolMarker,
  hasFigmaClipboardMarkers,
} from "./design-tool-markers";

describe("hasFigmaClipboardMarkers on a large page", () => {
  it("rejects a page that mentions (figma) without a closing marker", () => {
    const page = "<p>see (figma) docs (figma)</p>".repeat(150_000);
    expect(hasFigmaClipboardMarkers(page)).toBe(false);
  });

  it("finds a marker pair after a lot of unrelated markup", () => {
    const page = `${"<p>(figma)</p>".repeat(150_000)}<!--(figma)AAAA(/figma)-->`;
    expect(hasFigmaClipboardMarkers(page)).toBe(true);
  });

  it("accepts a mixed figmeta/figma pair and an attribute-only marker", () => {
    expect(hasFigmaClipboardMarkers("(figmeta)x(/figma)")).toBe(true);
    expect(
      hasFigmaClipboardMarkers("<span data-buffer='<!--(figma)AAAA'></span>"),
    ).toBe(true);
    expect(hasFigmaClipboardMarkers('<span data-buffer="plain"></span>')).toBe(
      false,
    );
  });
});

describe("findDesignToolMarker", () => {
  it("names the app whose marker is present", () => {
    expect(findDesignToolMarker("<!--(figma)A(/figma)-->")).toBe("figma");
    expect(findDesignToolMarker("<!--<paper-paste-start data-embed=")).toBe(
      "paper",
    );
    expect(findDesignToolMarker("<!-- wonder-clipboard:AAAA -->")).toBe(
      "wonder",
    );
    expect(findDesignToolMarker("<p>plain</p>")).toBeNull();
  });

  it("treats a marker with unreadable data as that app's, not as unrelated", () => {
    expect(findDesignToolMarker("<!-- wonder-clipboard:%%%% -->")).toBe(
      "wonder",
    );
  });
});

describe("designToolClipboardContent", () => {
  const clipboard = (values: Record<string, string>) => ({
    getData: (type: string) => values[type] ?? "",
  });

  it("returns the first flavor that carries a copy, HTML before text", () => {
    expect(
      designToolClipboardContent(
        clipboard({ "text/html": "<!-- wonder-clipboard:AAAA -->" }),
      ),
    ).toBe("<!-- wonder-clipboard:AAAA -->");
    expect(
      designToolClipboardContent(
        clipboard({ "text/plain": "<!--(figma)AAAA(/figma)-->" }),
      ),
    ).toBe("<!--(figma)AAAA(/figma)-->");
  });

  it("returns nothing for an ordinary paste", () => {
    expect(designToolClipboardContent(clipboard({ "text/plain": "hi" }))).toBe(
      "",
    );
    expect(designToolClipboardContent(null)).toBe("");
  });
});

describe("plain-text detection is stricter than HTML detection", () => {
  const clipboard = (values: Record<string, string>) => ({
    getData: (type: string) => values[type] ?? "",
  });

  it("does not claim ordinary text that only mentions a marker", () => {
    for (const text of [
      "remember to read the wonder-clipboard: docs",
      "<paper-paste-start is the tag that wraps the data",
      "wonder-clipboard:short",
    ]) {
      expect(findCompleteDesignToolMarker(text)).toBeNull();
      expect(
        designToolClipboardContent(clipboard({ "text/plain": text })),
      ).toBe("");
    }
  });

  it("claims a plain-text copy that carries the whole envelope", () => {
    const wonder = `<!-- wonder-clipboard:${"A".repeat(40)} -->`;
    const paper = `<!--<paper-paste-start data-embed="{}"></paper-paste-start>-->`;
    expect(findCompleteDesignToolMarker(wonder)).toBe("wonder");
    expect(findCompleteDesignToolMarker(paper)).toBe("paper");
    expect(
      designToolClipboardContent(clipboard({ "text/plain": wonder })),
    ).toBe(wonder);
  });

  it("still lets the HTML flavor report a damaged copy", () => {
    expect(findDesignToolMarker("<!-- wonder-clipboard:%%%% -->")).toBe(
      "wonder",
    );
    expect(
      designToolClipboardContent(
        clipboard({ "text/html": "<!-- wonder-clipboard:%%%% -->" }),
      ),
    ).toBe("<!-- wonder-clipboard:%%%% -->");
  });
});
