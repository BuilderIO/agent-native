import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  figma: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./get-design-snapshot.js", () => ({
  default: { run: mocks.snapshot },
}));
vi.mock("./get-figma-design-context.js", () => ({
  default: { run: mocks.figma },
}));
vi.mock("./list-designs.js", () => ({ default: { run: mocks.list } }));

import action from "./read-composer-source.js";

describe("read-composer-source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a bounded searchable metadata list", async () => {
    mocks.list.mockResolvedValue({
      designs: [{ id: "example-design", title: "Example" }],
      hasMore: true,
    });
    const result = await action.run({
      source: "design",
      operation: "list",
      page: 2,
      search: "Example",
    });
    expect(mocks.list).toHaveBeenCalledWith(
      { compact: "true", page: 2, pageSize: 30, search: "Example" },
      undefined,
    );
    expect(result).toEqual({
      items: [{ id: "example-design", title: "Example" }],
      hasMore: true,
    });
  });

  it("returns bounded layout context without inheriting a source design system", async () => {
    mocks.snapshot.mockResolvedValue({
      title: "Example",
      updatedAt: "2026-09-22",
      designSystem: { secret: "not-in-context" },
      files: [
        { id: "frame", filename: "index.html", content: "x".repeat(6000) },
      ],
    });
    const result = await action.run({
      source: "design",
      operation: "read",
      id: "example-design",
      page: 1,
    });
    expect(result).toHaveProperty(
      "context",
      expect.stringContaining("layout and visual language only"),
    );
    expect(JSON.stringify(result)).not.toContain("not-in-context");
    expect(JSON.stringify(result).length).toBeLessThan(4000);
  });

  it("does not turn access failures into ready references", async () => {
    mocks.snapshot.mockRejectedValue(new Error("Design not found"));
    await expect(
      action.run({
        source: "design",
        operation: "read",
        id: "missing",
        page: 1,
      }),
    ).rejects.toThrow("Design not found");
  });

  it("lists frames from the file instead of importing the node in a pasted selection URL", async () => {
    mocks.figma.mockResolvedValue({
      mode: "overview",
      pages: [
        {
          name: "Page",
          frames: [
            { id: "1:2", name: "Example frame", type: "FRAME" },
            { id: "1:3", name: "Label", type: "TEXT" },
          ],
        },
      ],
    });
    const result = await action.run({
      source: "figma",
      operation: "list",
      figmaUrl: "https://www.figma.com/design/exampleFile/Example?node-id=1-2",
      page: 1,
    });
    expect(mocks.figma.mock.calls[0][0]).not.toHaveProperty("nodeId");
    expect(result).toMatchObject({
      items: [{ id: "1:2", title: "Page / Example frame" }],
    });
  });

  it("keeps cross-app access disabled until explicitly enabled", async () => {
    await expect(
      action.run({ source: "slides", operation: "list", page: 1 }),
    ).rejects.toThrow("Cross-app reference sharing is not enabled");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
