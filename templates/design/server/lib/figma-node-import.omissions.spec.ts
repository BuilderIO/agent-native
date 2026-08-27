import { beforeEach, describe, expect, it, vi } from "vitest";

// Figma's /images endpoint returns `null` for a node it will not render, and
// that layer is then dropped. Geoff imported a frame whose wordmark vanished
// this way and had no way to know: the miss was a server-side console.warn.
const images = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: vi.fn(async () => ({
    response: { ok: true, status: 200, json: { images: images.value } },
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
