import { describe, expect, it } from "vitest";

import {
  isFigmaBranchUrl,
  parseFigmaFileKey,
  parseFigmaNodeId,
  parseFigmaUrl,
} from "./figma-url";

describe("parseFigmaFileKey", () => {
  it("accepts a raw Figma file key", () => {
    expect(parseFigmaFileKey("abcDEF_12345")).toBe("abcDEF_12345");
  });

  it("extracts design, file, and proto URL keys", () => {
    expect(
      parseFigmaFileKey("https://www.figma.com/design/abcDEF12345/App"),
    ).toBe("abcDEF12345");
    expect(
      parseFigmaFileKey("https://www.figma.com/file/xyz98765432/System"),
    ).toBe("xyz98765432");
    expect(
      parseFigmaFileKey("https://www.figma.com/proto/protoKey123/Flow"),
    ).toBe("protoKey123");
  });

  it("resolves /branch/:branchKey/ to the branch key, not the parent file key", () => {
    expect(
      parseFigmaFileKey(
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch",
      ),
    ).toBe("branchKey456");
  });

  it("resolves a branch URL with a node-id query param to the branch key", () => {
    expect(
      parseFigmaFileKey(
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch?node-id=1-2",
      ),
    ).toBe("branchKey456");
  });

  it("returns null for invalid input", () => {
    expect(parseFigmaFileKey("https://example.com/nope")).toBeNull();
    expect(
      parseFigmaFileKey(
        "https://example.com/design/abcDEF12345/Not-Really-Figma",
      ),
    ).toBeNull();
    expect(
      parseFigmaFileKey(
        "https://figma.com.evil.example/design/abcDEF12345/Lookalike",
      ),
    ).toBeNull();
    expect(parseFigmaFileKey("")).toBeNull();
    expect(parseFigmaFileKey(undefined)).toBeNull();
  });
});

describe("isFigmaBranchUrl", () => {
  it("detects branch URLs", () => {
    expect(
      isFigmaBranchUrl(
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch",
      ),
    ).toBe(true);
  });

  it("returns false for non-branch URLs and raw keys", () => {
    expect(
      isFigmaBranchUrl("https://www.figma.com/design/abcDEF12345/App"),
    ).toBe(false);
    expect(isFigmaBranchUrl("abcDEF12345")).toBe(false);
    expect(isFigmaBranchUrl(undefined)).toBe(false);
  });
});

describe("parseFigmaNodeId", () => {
  it("passes through an already-normalized colon node id", () => {
    expect(parseFigmaNodeId("1:2")).toBe("1:2");
  });

  it("converts dash form to colon form", () => {
    expect(parseFigmaNodeId("1-2")).toBe("1:2");
  });

  it("extracts and converts node-id from a query param", () => {
    expect(
      parseFigmaNodeId(
        "https://www.figma.com/design/abcDEF12345/App?node-id=12-345",
      ),
    ).toBe("12:345");
  });

  it("handles an already-encoded node-id query param", () => {
    expect(
      parseFigmaNodeId(
        "https://www.figma.com/design/abcDEF12345/App?node-id=12%3A345",
      ),
    ).toBe("12:345");
  });

  it("converts grouped instance-swap ids (semicolon separated)", () => {
    expect(parseFigmaNodeId("12-345;678-901")).toBe("12:345;678:901");
  });

  it("preserves a leading instance-override marker", () => {
    expect(parseFigmaNodeId("I12-345;678-901")).toBe("I12:345;678:901");
  });

  it("returns null when no node-id is present", () => {
    expect(
      parseFigmaNodeId("https://www.figma.com/design/abcDEF12345/App"),
    ).toBeNull();
    expect(parseFigmaNodeId("")).toBeNull();
    expect(
      parseFigmaNodeId(
        "https://example.com/design/abcDEF12345/App?node-id=12-34",
      ),
    ).toBeNull();
    expect(parseFigmaNodeId(undefined)).toBeNull();
  });
});

describe("parseFigmaUrl", () => {
  it("parses fileKey, nodeId, and isBranch together", () => {
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch?node-id=1-2",
      ),
    ).toEqual({ fileKey: "branchKey456", nodeId: "1:2", isBranch: true });
  });

  it("parses a plain design URL without a branch", () => {
    expect(
      parseFigmaUrl(
        "https://www.figma.com/design/abcDEF12345/App?node-id=10-20",
      ),
    ).toEqual({ fileKey: "abcDEF12345", nodeId: "10:20", isBranch: false });
  });
});
