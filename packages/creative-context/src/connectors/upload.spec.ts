import { describe, expect, it, vi } from "vitest";

import { UploadContextConnector } from "./upload.js";

const handle = {
  id: "blob-1",
  provider: "fixture",
  opaque: true as const,
  encrypted: true,
  mimeType: "image/png",
};

function pngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
}

describe("upload context connector images", () => {
  it("normalizes standalone raster uploads as private media-only items", async () => {
    const connector = new UploadContextConnector();
    const config = {
      items: [
        {
          id: "hero",
          title: "Homepage hero",
          fileName: "hero.png",
          mimeType: "image/png",
          blobHandle: handle,
        },
      ],
    };
    const context = {
      appId: "assets",
      readPrivateBlob: async () => ({
        data: pngBytes(),
        handle,
        mimeType: "image/png",
      }),
    } as never;
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      context,
    );
    expect(inventory.items[0]).toMatchObject({ kind: "uploaded-image" });

    const fetched = await connector.fetch(
      {
        sourceId: "source-1",
        config,
        item: inventory.items[0]!,
      },
      context,
    );

    expect(fetched.items).toHaveLength(1);
    expect(fetched.items[0]).toMatchObject({
      externalId: "hero",
      kind: "uploaded-image",
      content: "",
      parseStatus: "parsed",
      metadata: { parser: "standalone-image" },
      media: [
        expect.objectContaining({
          kind: "image",
          mimeType: "image/png",
          accessMode: "private",
          captionStatus: "pending",
        }),
      ],
    });
    expect(fetched.items[0]?.media?.[0]?.storageKey).toMatch(
      /^creative-context-blob:v1:/,
    );
  });

  it("rejects active SVG uploads instead of indexing executable markup", async () => {
    const connector = new UploadContextConnector();
    const svgHandle = { ...handle, id: "blob-svg", mimeType: "image/svg+xml" };
    const config = {
      items: [
        {
          id: "unsafe-logo",
          title: "Unsafe logo",
          fileName: "logo.svg",
          mimeType: "image/svg+xml",
          blobHandle: svgHandle,
        },
      ],
    };
    const context = {
      appId: "assets",
      readPrivateBlob: async () => ({
        data: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        handle: svgHandle,
        mimeType: "image/svg+xml",
      }),
    } as never;
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      context,
    );

    await expect(
      connector.fetch(
        {
          sourceId: "source-1",
          config,
          item: inventory.items[0]!,
        },
        context,
      ),
    ).rejects.toThrow(/SVG contains active content/i);
  });

  it("sanitizes embedded Office images before private storage", async () => {
    const connector = new UploadContextConnector();
    const putPrivateBlob = vi.fn(async () => handle);
    const config = {
      items: [
        {
          id: "deck",
          title: "Launch deck",
          fileName: "launch.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          extractedText: "fixture",
        },
      ],
    };
    const context = {
      appId: "slides",
      putPrivateBlob,
      loadUpload: async () => ({
        text: "Launch",
        title: "Launch deck",
        parser: "structured-pptx" as const,
        parts: [
          {
            kind: "slide" as const,
            index: 0,
            title: "Launch",
            text: "Launch",
            images: [
              {
                name: "active.svg",
                mimeType: "image/svg+xml",
                data: new TextEncoder().encode(
                  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                ),
              },
            ],
          },
        ],
        metadata: {},
      }),
    } as never;
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      context,
    );

    await expect(
      connector.fetch(
        {
          sourceId: "source-1",
          config,
          item: inventory.items[0]!,
        },
        context,
      ),
    ).rejects.toThrow(/SVG contains active content/i);
    expect(putPrivateBlob).not.toHaveBeenCalled();
  });
});
