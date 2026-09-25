import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  peer: vi.fn(),
  list: vi.fn(),
  snapshot: vi.fn(),
  figma: vi.fn(),
}));
vi.mock("@agent-native/core/a2a", () => ({
  readPeerComposerSource: mocks.peer,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.user,
}));
vi.mock(
  "@agent-native/core/shared",
  () => import("../../../packages/core/src/shared/composer-source.js"),
);
vi.mock("./list-designs.js", () => ({ default: { run: mocks.list } }));
vi.mock("./get-design-snapshot.js", () => ({
  default: { run: mocks.snapshot },
}));
vi.mock("./get-figma-design-context.js", () => ({
  default: { run: mocks.figma },
}));

import action from "./read-composer-source.js";

const input = {
  source: "design",
  operation: "read",
  id: "design-example",
  page: 1,
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockReturnValue("member@example.com");
});

describe("Design composer references", () => {
  it("exposes only an authenticated read contract to peers", () => {
    expect(action).toMatchObject({
      readOnly: true,
      mcpTool: true,
      http: { method: "GET" },
      publicAgent: { expose: true, readOnly: true, requiresAuth: true },
    });
  });

  it("does not relay a peer back out to another app", async () => {
    await expect(
      action.run({ ...input, source: "slides" }, { caller: "a2a" }),
    ).rejects.toMatchObject({ errorCode: "composer_source_wrong_app" });
    expect(mocks.peer).not.toHaveBeenCalled();
  });

  it("requires identity before any source read", async () => {
    mocks.user.mockReturnValue(undefined);
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "unauthorized",
    });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.peer).not.toHaveBeenCalled();
  });

  it("lists compact scoped metadata with search and pagination", async () => {
    mocks.list.mockResolvedValue({
      designs: [{ id: "d1", title: "Example" }],
      hasMore: true,
    });
    expect(
      await action.run({
        ...input,
        operation: "list",
        search: "example",
        page: 2,
      }),
    ).toEqual({ items: [{ id: "d1", title: "Example" }], hasMore: true });
    expect(mocks.list).toHaveBeenCalledWith(
      {
        compact: "true",
        includePreview: "false",
        page: 2,
        pageSize: 30,
        search: "example",
      },
      undefined,
    );
  });

  it("uses the access-checked live snapshot and bounds excerpts", async () => {
    mocks.snapshot.mockResolvedValue({
      title: "Example",
      updatedAt: "2026-09-25",
      files: Array.from({ length: 5 }, (_, i) => ({
        id: `f${i}`,
        filename: `screen-${i}.html`,
        content: "x".repeat(5000),
      })),
    });
    const result = await action.run(input);
    expect(mocks.snapshot).toHaveBeenCalledWith(
      { designId: "design-example" },
      undefined,
    );
    expect("context" in result && result.context).toContain("3 of 5");
    expect("context" in result && result.context.length).toBeLessThan(20000);
    expect("context" in result && result.context).toContain('"partial":true');
  });

  it("propagates unreadable sources instead of synthesizing empty context", async () => {
    mocks.snapshot.mockRejectedValue(new Error("Design not found"));
    await expect(action.run(input)).rejects.toThrow("Design not found");
  });

  it("forwards Slides to the authenticated peer reader", async () => {
    mocks.peer.mockResolvedValue({
      id: "deck-example",
      title: "Deck",
      context: "Layout",
    });
    const args = { ...input, source: "slides", id: "deck-example" } as const;
    await action.run(args);
    expect(mocks.peer).toHaveBeenCalledWith(args, "design");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("browses Figma frames, not all file nodes, and paginates", async () => {
    mocks.figma.mockResolvedValue({
      mode: "overview",
      pages: [
        {
          name: "Page",
          frames: [
            { id: "text", name: "Text", type: "TEXT" },
            ...Array.from({ length: 52 }, (_, i) => ({
              id: `1:${i}`,
              name: `Frame ${i}`,
              type: "FRAME",
            })),
          ],
        },
      ],
    });
    const result = await action.run({
      source: "figma",
      operation: "list",
      figmaUrl: "https://www.figma.com/design/exampleFile/App?node-id=1-0",
      page: 2,
    });
    expect("items" in result && result.items).toHaveLength(2);
    expect("hasMore" in result && result.hasMore).toBe(false);
    expect(mocks.figma.mock.calls[0][0]).not.toHaveProperty("figmaUrl");
  });

  it("reads the selected frame without importing screens or systems", async () => {
    mocks.figma.mockResolvedValue({
      mode: "node",
      nodeId: "1:2",
      summary: { name: "Frame", children: [] },
      truncated: true,
      screenshotUrl: "https://example.com/preview.png",
    });
    const result = await action.run({
      source: "figma",
      operation: "read",
      figmaUrl: "https://www.figma.com/design/exampleFile/App",
      nodeId: "1:2",
      page: 1,
    });
    expect(result).toMatchObject({
      id: "1:2",
      title: "Frame",
      context: expect.stringContaining("partial"),
    });
    expect(mocks.figma).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "1:2",
        maxNodes: 60,
        includeScreenshot: true,
      }),
      undefined,
    );
  });

  it("requires a selected frame and a valid Figma URL", async () => {
    await expect(
      action.run({
        source: "figma",
        operation: "read",
        figmaUrl: "https://example.com",
        page: 1,
      }),
    ).rejects.toMatchObject({ errorCode: "figma_url_invalid" });
    mocks.figma.mockResolvedValue({ mode: "overview", pages: [] });
    await expect(
      action.run({
        source: "figma",
        operation: "read",
        figmaUrl: "https://www.figma.com/design/exampleFile/App",
        page: 1,
      }),
    ).rejects.toMatchObject({ errorCode: "composer_reference_required" });
  });
});
