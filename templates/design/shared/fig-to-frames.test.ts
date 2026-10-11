import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_FIG_LIMITS,
  SERVER_FIG_LIMITS,
} from "../server/lib/fig-file-limits.js";
import { renderHtmlTemplates } from "../server/lib/fig-file-to-html.js";
import {
  completeFigImport,
  convertDecodedFigToEditableHtml,
  renderFigImport,
} from "./fig-to-frames.js";

function frame(localID: number, name: string, x: number, imageHash?: string) {
  return {
    guid: { sessionID: 1, localID },
    parentIndex: { guid: { sessionID: 1, localID: 2 }, position: `${localID}` },
    type: "FRAME",
    name,
    size: { x: 320, y: 200 },
    transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: 40 },
    fillPaints: imageHash
      ? [{ type: "IMAGE", image: { hash: imageHash } }]
      : [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
  };
}

function decodedFig(frames: ReturnType<typeof frame>[], imageHashes: string[]) {
  return {
    format: "kiwi" as const,
    version: 124,
    document: {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page 1",
        },
        ...frames,
      ],
    },
    images: imageHashes.map((hash, index) => ({
      hash,
      ext: "png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, index]),
    })),
    thumbnail: null,
  };
}

const options = {
  originalName: "synthetic.fig",
  ownerEmail: "example@example.com",
  normalizeHtml: (content: string) => content,
};

describe("single-pass .fig render", () => {
  it.each([
    [
      "an absolute URL that needs escaping",
      "https://cdn.example.test/a?x=1&y='2'",
    ],
    ["a relative URL", "/api/uploads/image.png"],
  ])("matches a render with the real URL for %s", async (_label, url) => {
    const decoded = decodedFig([frame(3, "Card", 0, "image-a")], ["image-a"]);

    const result = await convertDecodedFigToEditableHtml(decoded, {
      ...options,
      uploader: vi.fn().mockResolvedValue({ url }),
    });

    const direct = renderHtmlTemplates(
      decodedFig([frame(3, "Card", 0, "image-a")], []).document,
      {
        imageMap: new Map([["image-a", url]]),
        missingImageUrl: "about:blank",
        trackUnresolvedImageRefs: true,
      },
    );
    expect(result.files[0]!.content).toBe(direct.frames[0]!.html);
    expect(result.files[0]!.content).not.toContain("fig-image.invalid");
  });

  it("rejects before uploading only a frame no URL could fit, then checks the real URLs", async () => {
    const decoded = decodedFig([frame(3, "Card", 0, "image-a")], ["image-a"]);
    const rendered = renderFigImport(decoded);
    const { html, htmlBytes } = rendered.frames[0]!;
    const { placeholder } = rendered.images[0]!;
    const urlFreeBytes =
      htmlBytes - (html.split(placeholder).length - 1) * placeholder.length;

    expect(() =>
      renderFigImport(decoded, { maxFrameHtmlBytes: urlFreeBytes - 1 }),
    ).toThrow(/too complex/);

    const maxFrameHtmlBytes = urlFreeBytes + 100;
    const cleanup = vi.fn().mockResolvedValue(true);
    await expect(
      completeFigImport(renderFigImport(decoded, { maxFrameHtmlBytes }), {
        ...options,
        maxFrameHtmlBytes,
        uploader: vi.fn().mockResolvedValue({
          url: `https://assets.example.com/${"a".repeat(1_500)}.png`,
          cleanup,
        }),
      }),
    ).rejects.toThrow(/too complex/);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("saves a frame whose real URLs fit though the longest allowed URL would not", async () => {
    const decoded = decodedFig([frame(3, "Card", 0, "image-a")], ["image-a"]);
    const uploader = vi
      .fn()
      .mockResolvedValue({ url: "https://assets.example.com/a.png" });
    const { content } = (
      await convertDecodedFigToEditableHtml(decoded, { ...options, uploader })
    ).files[0]!;

    const result = await convertDecodedFigToEditableHtml(decoded, {
      ...options,
      uploader,
      maxFrameHtmlBytes: new TextEncoder().encode(content).length,
    });

    expect(result.files[0]!.content).toBe(content);
  });

  it("counts the pages frames come from, since each has its own coordinates", () => {
    const decoded = decodedFig(
      [
        frame(3, "Card", 0),
        {
          ...frame(4, "Card", 0),
          parentIndex: { guid: { sessionID: 1, localID: 5 }, position: "4" },
        },
      ],
      [],
    );
    decoded.document.nodeChanges.push({
      guid: { sessionID: 1, localID: 5 },
      parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "b" },
      type: "CANVAS",
      name: "Page 2",
    });

    const rendered = renderFigImport(decoded);
    expect(rendered.pageCount).toBe(2);
    expect(rendered.frames.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(
      renderFigImport(decoded, { selection: new Set(["1:4"]) }).pageCount,
    ).toBe(1);
  });

  it("stores only the images a selection references", async () => {
    const decoded = decodedFig(
      [frame(3, "Card", 0, "image-a"), frame(4, "Banner", 400, "image-b")],
      ["image-a", "image-b", "unused"],
    );
    const uploader = vi.fn().mockResolvedValue({
      url: "https://assets.example.com/selected.png",
    });

    const rendered = renderFigImport(decoded, { selection: new Set(["1:3"]) });
    const result = await completeFigImport(rendered, { ...options, uploader });

    expect(rendered.images.map((image) => image.hash)).toEqual(["image-a"]);
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toContain(
      "url('https://assets.example.com/selected.png')",
    );
  });

  it("takes its frame budget from the limits profile", () => {
    const frames = Array.from(
      { length: SERVER_FIG_LIMITS.frames + 1 },
      (_, i) => frame(10 + i, `F${i}`, i * 400),
    );
    const decoded = decodedFig(frames, []);

    expect(() => renderFigImport(decoded)).toThrow(/too many top-level frames/);
    expect(
      renderFigImport(decoded, { limits: BROWSER_FIG_LIMITS }).frames,
    ).toHaveLength(frames.length);
  });

  it("yields to the event loop between slow frames instead of blocking", async () => {
    const order: string[] = [];
    const busy = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end);
    };
    const frames = ["A", "B", "C"].map((name) => ({
      html: `<div>${name}</div>`,
      htmlBytes: 12,
      filename: `${name}.html`,
      pageName: "Page",
      frameName: name,
    }));
    setTimeout(() => order.push("timer"), 0);

    await completeFigImport(
      {
        format: "kiwi",
        pageCount: 1,
        nodeCount: 3,
        imageCount: 0,
        approximatedNodeCount: 0,
        unresolvedImageRefCount: 0,
        frames,
        imagePlaceholderPrefix: "__img_",
        images: [],
      },
      {
        originalName: "slow.fig",
        ownerEmail: "",
        uploader: vi.fn(),
        normalizeHtml: (html) => {
          busy(25);
          order.push(html);
          return html;
        },
        limits: BROWSER_FIG_LIMITS,
      },
    );

    expect(order.indexOf("timer")).toBeGreaterThan(0);
    expect(order.indexOf("timer")).toBeLessThan(order.length - 1);
  });

  it("returns plain data a Worker can post", () => {
    const rendered = renderFigImport(
      decodedFig([frame(3, "Card", 0, "image-a")], ["image-a"]),
    );

    expect(structuredClone(rendered)).toEqual(rendered);
  });
});
