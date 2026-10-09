import { describe, expect, it } from "vitest";

import { buildFigmaLinkChatPrompt, extractFigmaLink } from "./figma-url";

const prompts = {
  importFrame: "Import frame into current Design: {{url}}",
  importFile: "Open file and list frames: {{url}}",
  inspectFrame: "Inspect frame: {{url}}",
  inspectFile: "Inspect file: {{url}}",
  exportSvg: "Export the current Design screen as SVG.",
};

describe("extractFigmaLink", () => {
  it("detects a Figma frame link inside ordinary composer text", () => {
    expect(
      extractFigmaLink(
        "Can you import https://www.figma.com/design/AbC_1234/Checkout?node-id=12%3A34 please?",
      ),
    ).toEqual({
      url: "https://www.figma.com/design/AbC_1234/Checkout?node-id=12%3A34",
      fileKey: "AbC_1234",
      nodeId: "12:34",
      kind: "frame",
    });
  });

  it("detects supported file and prototype links without node ids", () => {
    for (const path of ["file", "proto"]) {
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
  it("routes a node link toward exact frame import without internal context markup", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey1/Name?node-id=1-2",
    )!;
    expect(buildFigmaLinkChatPrompt("import", link, prompts)).toEqual({
      message: prompts.importFrame,
    });
  });

  it("asks the agent to choose a frame for a whole-file link", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey1/Name",
    )!;
    expect(buildFigmaLinkChatPrompt("import", link, prompts).message).toBe(
      prompts.importFile,
    );
  });

  it("selects a translated inspection prompt for the link kind", () => {
    const frame = extractFigmaLink(
      "https://www.figma.com/design/FileKey1/Name?node-id=1-2",
    )!;
    const file = extractFigmaLink(
      "https://www.figma.com/design/FileKey1/Name",
    )!;

    expect(buildFigmaLinkChatPrompt("inspect", frame, prompts).message).toBe(
      prompts.inspectFrame,
    );
    expect(buildFigmaLinkChatPrompt("inspect", file, prompts).message).toBe(
      prompts.inspectFile,
    );
  });

  it("describes what the SVG export turns into static content", () => {
    const link = extractFigmaLink(
      "https://www.figma.com/design/FileKey1/Name",
    )!;
    const prompt = buildFigmaLinkChatPrompt(
      "export-svg",
      link,
      prompts,
    ).message;
    expect(prompt).toBe(prompts.exportSvg);
  });
});
