/**
 * hydrate-figma-paste-images.spec.ts
 *
 * Covers:
 *  - collectImageRefHashes: scan HTML for data-figma-image-ref hashes
 *  - hydrateImageRefsInHtml: replace url("about:blank") with real URLs in order
 *  - Action routing: no-refs early return, full resolution, partial resolution,
 *    no-figmaFileKey guard, Figma-returns-empty guard
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
  assertAccess: vi.fn(),
  accessFilter: vi.fn(() => "access-filter-sentinel"),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  resolveImageFillRefs: vi.fn(),
  mutateDesignData: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  accessFilter: mocks.accessFilter,
}));

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: mocks.agentEnterDocument,
  agentLeaveDocument: mocks.agentLeaveDocument,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));

vi.mock("../server/lib/figma-node-import.js", () => ({
  resolveImageFillRefs: mocks.resolveImageFillRefs,
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

// db query chain builder that always resolves to whatever rows array is set
let dbRows: unknown[] = [];
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(dbRows),
          }),
        }),
      }),
    }),
  }),
  schema: {
    designFiles: {
      id: "id",
      designId: "designId",
      filename: "filename",
      fileType: "fileType",
      content: "content",
    },
    designs: { id: "id", data: "data" },
    designShares: {},
  },
}));

import {
  collectImageRefHashes,
  hydrateImageRefsInHtml,
} from "./hydrate-figma-paste-images.js";
import action from "./hydrate-figma-paste-images.js";

// ---------------------------------------------------------------------------
// Pure HTML helpers
// ---------------------------------------------------------------------------

describe("collectImageRefHashes", () => {
  it("returns empty array for HTML with no data-figma-image-ref attrs", () => {
    const html = '<div style="color: red;"><span>hello</span></div>';
    expect(collectImageRefHashes(html)).toEqual([]);
  });

  it("collects hashes from a single element", () => {
    const html =
      '<div data-figma-image-ref="abc123" style="background-image: url(&quot;about:blank&quot;);">x</div>';
    expect(collectImageRefHashes(html)).toEqual(["abc123"]);
  });

  it("collects multiple hashes from a single element", () => {
    const html =
      '<div data-figma-image-ref="hash1 hash2" style="background-image: url(&quot;about:blank&quot;), url(&quot;about:blank&quot;);">x</div>';
    expect(collectImageRefHashes(html)).toEqual(["hash1", "hash2"]);
  });

  it("deduplicates the same hash across multiple elements", () => {
    const html = [
      '<div data-figma-image-ref="shared">',
      '<span data-figma-image-ref="shared unique">',
    ].join("");
    const hashes = collectImageRefHashes(html);
    expect(hashes).toEqual(["shared", "unique"]);
  });

  it("ignores closing tags and unrelated attributes", () => {
    const html =
      '</div><div data-other="abc123"><span data-figma-image-ref="realHash">x</span>';
    expect(collectImageRefHashes(html)).toEqual(["realHash"]);
  });
});

describe("hydrateImageRefsInHtml", () => {
  it("leaves HTML unchanged when no data-figma-image-ref attrs are present", () => {
    const html = '<div style="color: red;">text</div>';
    const {
      html: out,
      resolved,
      missing,
    } = hydrateImageRefsInHtml(html, new Map());
    expect(out).toBe(html);
    expect(resolved).toBe(0);
    expect(missing).toEqual([]);
  });

  it("replaces url placeholder with durable URL and removes the attr when fully resolved", () => {
    const html =
      '<div data-figma-image-ref="abc123" style="background-image: url(&quot;about:blank&quot;); width: 100px;">x</div>';
    const urls = new Map([["abc123", "https://cdn.example.com/img.png"]]);

    const { html: out, resolved, missing } = hydrateImageRefsInHtml(html, urls);

    expect(resolved).toBe(1);
    expect(missing).toEqual([]);
    expect(out).not.toContain("data-figma-image-ref");
    expect(out).toContain("url(&quot;https://cdn.example.com/img.png&quot;)");
    expect(out).not.toContain("about:blank");
  });

  it("replaces multiple url placeholders in order matching the hashes", () => {
    const html =
      '<div data-figma-image-ref="h1 h2" style="background-image: url(&quot;about:blank&quot;), url(&quot;about:blank&quot;);">x</div>';
    const urls = new Map([
      ["h1", "https://cdn.example.com/img1.png"],
      ["h2", "https://cdn.example.com/img2.png"],
    ]);

    const { html: out, resolved } = hydrateImageRefsInHtml(html, urls);

    expect(resolved).toBe(2);
    expect(out).toContain("url(&quot;https://cdn.example.com/img1.png&quot;)");
    expect(out).toContain("url(&quot;https://cdn.example.com/img2.png&quot;)");
    expect(out).not.toContain("data-figma-image-ref");
  });

  it("keeps placeholder and preserves attr for unresolved hashes", () => {
    const html =
      '<div data-figma-image-ref="abc123" style="background-image: url(&quot;about:blank&quot;);">x</div>';

    const {
      html: out,
      resolved,
      missing,
    } = hydrateImageRefsInHtml(html, new Map());

    expect(resolved).toBe(0);
    expect(missing).toEqual(["abc123"]);
    expect(out).toContain("data-figma-image-ref");
    expect(out).toContain("about:blank");
  });

  it("partially resolves: updates attr with remaining hashes for unresolved", () => {
    const html =
      '<div data-figma-image-ref="h1 h2" style="background-image: url(&quot;about:blank&quot;), url(&quot;about:blank&quot;);">x</div>';
    const urls = new Map([["h1", "https://cdn.example.com/img1.png"]]);

    const { html: out, resolved, missing } = hydrateImageRefsInHtml(html, urls);

    expect(resolved).toBe(1);
    expect(missing).toEqual(["h2"]);
    expect(out).toContain('data-figma-image-ref="h2"');
    expect(out).toContain("url(&quot;https://cdn.example.com/img1.png&quot;)");
    expect(out).toContain("url(&quot;about:blank&quot;)");
  });

  it("encodes & in durable URLs as &amp;", () => {
    const html =
      '<div data-figma-image-ref="abc" style="background-image: url(&quot;about:blank&quot;);">x</div>';
    const urls = new Map([["abc", "https://cdn.example.com/img?a=1&b=2"]]);

    const { html: out } = hydrateImageRefsInHtml(html, urls);
    expect(out).toContain(
      "url(&quot;https://cdn.example.com/img?a=1&amp;b=2&quot;)",
    );
  });
});

// ---------------------------------------------------------------------------
// Action integration (with mocks)
// ---------------------------------------------------------------------------

const FILE_KEY = "testFileKey123";

const SCREEN_METADATA_ROW = {
  id: "file-1",
  designId: "design-1",
  filename: "Screen.html",
  fileType: "html",
  content:
    '<div data-figma-image-ref="abc123" style="background-image: url(&quot;about:blank&quot;);">x</div>',
  designData: JSON.stringify({
    screenMetadata: {
      "file-1": {
        figmaFileKey: FILE_KEY,
        unresolvedImageRefs: ["abc123"],
      },
    },
  }),
};

describe("hydrate-figma-paste-images action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRows = [];
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "new-hash",
      changed: true,
      updatedAt: "2025-01-01T00:00:00Z",
    });
    mocks.mutateDesignData.mockImplementation(
      async ({ mutate, isApplied }: any) => {
        const data = mutate(
          {
            screenMetadata: {
              "file-1": {
                figmaFileKey: FILE_KEY,
                unresolvedImageRefs: ["abc123"],
              },
            },
          },
          { updatedAt: "" },
        );
        expect(isApplied(data)).toBe(true);
        return { data, updatedAt: "" };
      },
    );
  });

  it("returns early when no image ref attrs found in live content", async () => {
    dbRows = [{ ...SCREEN_METADATA_ROW, content: "<div>no refs here</div>" }];
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<div>no refs here</div>",
      versionHash: "v1",
    });

    const result = await action.run({ fileId: "file-1" });

    expect(result).toMatchObject({ resolved: 0, missing: 0, skipped: 0 });
    expect(mocks.resolveImageFillRefs).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("resolves all image refs and writes the updated HTML", async () => {
    dbRows = [SCREEN_METADATA_ROW];
    mocks.readLiveSourceFile.mockResolvedValue({
      content: SCREEN_METADATA_ROW.content,
      versionHash: "v1",
    });
    mocks.resolveImageFillRefs.mockResolvedValue(
      new Map([["abc123", "https://cdn.example.com/img.png"]]),
    );

    const result = await action.run({ fileId: "file-1" });

    expect(result).toMatchObject({ resolved: 1, missing: 0 });
    expect(mocks.resolveImageFillRefs).toHaveBeenCalledWith(FILE_KEY, [
      "abc123",
    ]);
    const writtenContent = mocks.writeInlineSourceFile.mock.calls[0]![0]
      .content as string;
    expect(writtenContent).toContain("https://cdn.example.com/img.png");
    expect(writtenContent).not.toContain("about:blank");
    expect(writtenContent).not.toContain("data-figma-image-ref");
    expect(mocks.mutateDesignData).toHaveBeenCalledTimes(1);
  });

  it("reports missing count and skips write when Figma returns no URLs", async () => {
    dbRows = [SCREEN_METADATA_ROW];
    mocks.readLiveSourceFile.mockResolvedValue({
      content: SCREEN_METADATA_ROW.content,
      versionHash: "v1",
    });
    mocks.resolveImageFillRefs.mockResolvedValue(new Map());

    const result = await action.run({ fileId: "file-1" });

    expect(result).toMatchObject({ resolved: 0, missing: 1 });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });

  it("throws when no figmaFileKey is in screenMetadata for the file", async () => {
    dbRows = [
      {
        ...SCREEN_METADATA_ROW,
        designData: JSON.stringify({
          screenMetadata: { "file-1": { title: "Screen" } },
        }),
      },
    ];

    await expect(action.run({ fileId: "file-1" })).rejects.toThrow(
      "No Figma file key found",
    );
    expect(mocks.resolveImageFillRefs).not.toHaveBeenCalled();
  });

  it("throws when file is not found", async () => {
    dbRows = [];

    await expect(action.run({ fileId: "missing-file" })).rejects.toThrow(
      "File not found",
    );
  });

  it("calls agentEnterDocument/agentLeaveDocument around the write", async () => {
    dbRows = [SCREEN_METADATA_ROW];
    mocks.readLiveSourceFile.mockResolvedValue({
      content: SCREEN_METADATA_ROW.content,
      versionHash: "v1",
    });
    mocks.resolveImageFillRefs.mockResolvedValue(
      new Map([["abc123", "https://cdn.example.com/img.png"]]),
    );

    await action.run({ fileId: "file-1" });

    expect(mocks.agentEnterDocument).toHaveBeenCalledWith("file-1");
    expect(mocks.agentLeaveDocument).toHaveBeenCalledWith("file-1");
  });
});
