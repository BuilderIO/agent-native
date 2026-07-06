/**
 * Tests for insert-asset action.
 *
 * Security regression: a valid http(s) asset URL containing a single quote
 * must not be able to break out of the single-quoted CSS `url('...')` value
 * used by "background-fill" mode. Percent-encoding the quote (and backslash)
 * before HTML-escaping keeps the URL functionally identical while making a
 * breakout impossible, regardless of whether the surrounding HTML `style`
 * attribute is single- or double-quoted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const fileSelectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.innerJoin.mockReturnValue(fileSelectChain);

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);

  const db = {
    select: vi.fn(() => fileSelectChain),
    update: vi.fn(() => updateChain),
  };

  return {
    db,
    fileSelectChain,
    updateChain,
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn().mockResolvedValue(null),
}));

vi.mock("@agent-native/core/collab", () => ({
  hasCollabState: vi.fn().mockResolvedValue(false),
  getText: vi.fn(),
  applyText: vi.fn(),
  seedFromText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: { id: "designs.id" },
    designShares: "designShares",
  },
}));

import action from "./insert-asset.js";

// A URL containing a single quote — invalid to break out of `url('...')`,
// but syntactically a valid http(s) URL (quote in a path segment).
const MALICIOUS_URL =
  "https://evil.example.com/a'));</style><script>alert(1)</script><style x='.png";

function setFile(content: string) {
  mocks.fileSelectChain.where.mockResolvedValue([
    {
      id: "file-1",
      designId: "design-1",
      filename: "index.html",
      fileType: "html",
      content,
    },
  ]);
}

describe("insert-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue(undefined);
  });

  it("background-fill: escapes single quotes so the URL cannot break out of url('...')", async () => {
    setFile(
      '<html><body><section data-agent-native-node-id="hero"></section></body></html>',
    );

    await action.run({
      assetUrl: MALICIOUS_URL,
      mode: "background-fill",
      targetNodeId: "hero",
      designId: "design-1",
      fileId: "file-1",
    });

    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toBeDefined();
    // The raw single quote must never appear un-escaped inside the style value.
    expect(content).not.toContain("'));</style>");
    expect(content).not.toContain("<script>alert(1)</script>");
    expect(content).toContain("%27");
    expect(content).toMatch(/style="background-image: url\('[^']*'\)/);
  });

  it("background-fill: stays safe when the existing style attribute is single-quoted", async () => {
    setFile(
      "<html><body><section data-agent-native-node-id='hero' style='color: red;'></section></body></html>",
    );

    await action.run({
      assetUrl: MALICIOUS_URL,
      mode: "background-fill",
      targetNodeId: "hero",
      designId: "design-1",
      fileId: "file-1",
    });

    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).not.toContain("'));</style>");
    expect(content).not.toContain("<script>alert(1)</script>");
    expect(content).toContain("color: red");
  });

  it("figure mode: inserts a safe figure/section with the asset URL", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      assetUrl: "https://example.com/image.png",
      mode: "figure",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toContain('src="https://example.com/image.png"');
    expect(content).toContain("data-agent-native-asset");
  });

  it("replace-src mode: sets the src attribute on the targeted element", async () => {
    setFile(
      '<html><body><img data-agent-native-node-id="hero-img" src="old.png" /></body></html>',
    );

    const result = await action.run({
      assetUrl: "https://example.com/new.png",
      mode: "replace-src",
      targetNodeId: "hero-img",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toContain('src="https://example.com/new.png"');
  });
});
