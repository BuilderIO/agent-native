import { describe, expect, it, vi } from "vitest";

const readPrivateBlob = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: vi.fn(),
  readPrivateBlob,
}));

import {
  parseDesignVersionSnapshot,
  readDesignVersionSnapshot,
} from "./design-versions.js";

describe("parseDesignVersionSnapshot", () => {
  it("accepts buildDesignSnapshot files and preserves restore metadata", () => {
    const snapshot = parseDesignVersionSnapshot(
      JSON.stringify({
        designId: "design-1",
        designData: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
        designTitle: "Landing page",
        designDescription: null,
        projectType: "prototype",
        designSystemId: "system-1",
        files: [
          {
            id: "file-1",
            filename: "src/index.html",
            fileType: "html",
            content: "<main>Hello</main>",
            source: "collab",
          },
        ],
        chatContext: { threadId: "thread-1", turnId: "turn-1" },
      }),
      "design-1",
    );

    expect(snapshot).toMatchObject({
      designId: "design-1",
      designTitle: "Landing page",
      designSystemId: "system-1",
      chatContext: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(snapshot.files).toEqual([
      {
        id: "file-1",
        filename: "src/index.html",
        fileType: "html",
        content: "<main>Hello</main>",
      },
    ]);
  });

  it("rejects snapshots that can cross a design or map two files to one name", () => {
    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "other-design",
          files: [],
        }),
        "design-1",
      ),
    ).toThrow("different design");

    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "design-1",
          files: [
            { filename: "index.html", fileType: "html", content: "one" },
            { filename: "index.html", fileType: "html", content: "two" },
          ],
        }),
        "design-1",
      ),
    ).toThrow("duplicate file");
  });

  it("reads large snapshots through their private blob reference", async () => {
    const handle = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    readPrivateBlob.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          designId: "design-1",
          files: [
            {
              filename: "index.html",
              fileType: "html",
              content: "<main>Restored</main>",
            },
          ],
        }),
      ),
      handle,
    });

    await expect(
      readDesignVersionSnapshot(
        JSON.stringify({
          snapshotKind: "design-history-blob",
          designId: "design-1",
          blob: handle,
        }),
        "design-1",
      ),
    ).resolves.toMatchObject({
      designId: "design-1",
      files: [{ content: "<main>Restored</main>" }],
    });
    expect(readPrivateBlob).toHaveBeenCalledWith(handle);
  });
});
