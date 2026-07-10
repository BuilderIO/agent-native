import { describe, expect, it } from "vitest";

import { buildFigmaLinkChatPrompt, extractFigmaLink } from "./figma-url";

describe("extractFigmaLink", () => {
  it("detects a Figma frame link inside ordinary composer text", () => {
    expect(
      extractFigmaLink(
        "Can you import https://www.figma.com/design/AbC_123/Checkout?node-id=12%3A34 please?",
      ),
    ).toEqual({
      url: "https://www.figma.com/design/AbC_123/Checkout?node-id=12%3A34",
      fileKey: "AbC_123",
      nodeId: "12:34",
      kind: "frame",
    });
  });

  it("detects supported file, prototype, and board links without node ids", () => {
    for (const path of ["file", "proto", "board"]) {
      expect(
        extractFigmaLink(`https://figma.com/${path}/FileKey123/Example`),
      ).toMatchObject({ fileKey: "FileKey123", nodeId: null, kind: "file" });
    }
  });

  it("rejects lookalike hosts, community links, and malformed file keys", () => {
    expect(
      extractFigmaLink("https://www.figma.com.evil.test/design/key/name"),
    ).toBeNull();
    expect(
      extractFigmaLink("https://www.figma.com/community/file/123/name"),
    ).toBeNull();
    expect(
      extractFigmaLink("https://www.figma.com/design/not%20a%20key/name"),
    ).toBeNull();
  });
});

describe("buildFigmaLinkChatPrompt", () => {
  it("routes a node link toward exact frame import with hidden design context", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey/Name?node-id=1-2",
    )!;
    expect(buildFigmaLinkChatPrompt("import", link, "design-1")).toEqual({
      message:
        "Import this Figma frame into the current Design and report any fidelity differences: https://www.figma.com/design/FileKey/Name?node-id=1-2",
      context: "Current Design id: design-1",
    });
  });

  it("asks the agent to choose a frame for a whole-file link", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey/Name",
    )!;
    expect(buildFigmaLinkChatPrompt("import", link).message).toContain(
      "list its top-level frames",
    );
  });

  it("describes the honest SVG export fidelity boundary", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey/Name",
    )!;
    const prompt = buildFigmaLinkChatPrompt("export-svg", link).message;
    expect(prompt).toContain("Figma-compatible SVG");
    expect(prompt).toContain("auto-layout");
    expect(prompt).toContain("will not stay live");
  });
});
