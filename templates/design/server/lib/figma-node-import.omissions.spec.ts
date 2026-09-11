import { beforeEach, describe, expect, it, vi } from "vitest";

// Figma's /images endpoint returns `null` for a node it will not render, and
// that layer is then dropped. Geoff imported a frame whose wordmark vanished
// this way and had no way to know: the miss was a server-side console.warn.
const images = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
// Image FILLS come from a different endpoint than rendered nodes, and the two
// disagree about response shape: `/images/:key` returns `images` at the top
// level, while `/files/:key/images` nests the same map under `meta`. This mock
// used to return the flat shape for both, which is precisely the assumption
// the importer had — so neither the code nor the test could see that every
// image fill was being dropped. Keep them distinct.
const imageFills = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: vi.fn(async ({ path }: { path: string }) => ({
    response: {
      ok: true,
      status: 200,
      json: /^\/files\/[^/]+\/images$/.test(path)
        ? { meta: { images: imageFills.value } }
        : { images: images.value },
    },
  })),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: vi.fn(async () => ({ url: "https://files.example/x.png" })),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(async () => ({
    ok: true,
    headers: { get: () => "image/png" },
    // The mirror verifies the bytes match the advertised type before storing.
    arrayBuffer: async () =>
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
  })),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "dev@local.test",
}));

const { buildScreenFilesFromFigmaNodes } =
  await import("./figma-node-import.js");

// A LINE always needs a rendered PNG: a CSS div with an outline is not a
// Figma line.
const frame = {
  id: "1:1",
  name: "Frame",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
  children: [
    {
      id: "1:2",
      name: "Wordmark",
      type: "LINE",
      absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 0 },
    },
  ],
};

describe("a layer Figma refuses to render", () => {
  beforeEach(() => {
    images.value = {};
    imageFills.value = {};
  });

  it("tells the caller it was left out", async () => {
    images.value = { "1:2": null };
    const result = await buildScreenFilesFromFigmaNodes("FILEKEY", {
      "1:1": frame as never,
    });
    expect(result.omissionWarnings).toHaveLength(1);
    expect(result.omissionWarnings[0]).toMatch(
      /could not be rendered by Figma/,
    );
  });

  it("says nothing when every layer came back", async () => {
    images.value = { "1:2": "https://figma.example/rendered.png" };
    const result = await buildScreenFilesFromFigmaNodes("FILEKEY", {
      "1:1": frame as never,
    });
    expect(result.omissionWarnings).toEqual([]);
  });
});

// A RECTANGLE whose paint is an image fill — the shape Geoff's frame uses for
// its starfield and photo. Its pixels come from `/files/:key/images`, keyed by
// `imageRef`, not from a node render.
const imageFillFrame = {
  id: "2:1",
  name: "Frame",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
  children: [
    {
      id: "2:2",
      name: "Starfield",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "REF1" }],
    },
  ],
};

describe("an image fill", () => {
  beforeEach(() => {
    images.value = {};
    imageFills.value = {};
  });

  it("resolves from the endpoint's `meta.images` map", async () => {
    // Reported by a designer as "2 image fills could not be fetched from
    // Figma": the importer read a top-level `images` key that this endpoint
    // does not have, so EVERY image fill resolved to undefined and was blamed
    // on "deleted images or very large assets" — a cause the code never
    // checked. The fidelity harness read `meta.images` all along, which is why
    // no corpus number ever moved.
    imageFills.value = { REF1: "https://figma.example/fill.png" };
    const result = await buildScreenFilesFromFigmaNodes("FILEKEY", {
      "2:1": imageFillFrame as never,
    });
    expect(result.missingImageFillCount).toBe(0);
    expect(result.omissionWarnings).toEqual([]);
  });

  it("still reports a fill the endpoint genuinely does not know", async () => {
    imageFills.value = {};
    const result = await buildScreenFilesFromFigmaNodes("FILEKEY", {
      "2:1": imageFillFrame as never,
    });
    expect(result.missingImageFillCount).toBe(1);
    expect(result.omissionWarnings.join(" ")).toMatch(
      /could not be fetched from Figma/,
    );
  });
});
