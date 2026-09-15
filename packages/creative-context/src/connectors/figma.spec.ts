import { describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() =>
  vi.fn(async (url: string) =>
    url.includes(".svg")
      ? new Response(
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>',
          { status: 200, headers: { "content-type": "image/svg+xml" } },
        )
      : new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
  ),
);

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch,
}));

const { FigmaContextConnector } = await import("./figma.js");
const { nativeFidelityReportFromEntries } = await import("./figma-native.js");

describe("Figma context connector", () => {
  it("compiles editable frames, privately rehosts only localized fallbacks, and records provenance", async () => {
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).startsWith("/images/")) {
        return {
          images: {
            "logo-1":
              "https://cdn.example.com/logo-fallback.png?token=secret-logo",
          },
        };
      }
      if (String(input.path).endsWith("/nodes")) {
        return {
          nodes: {
            "frame-1": { document: FRAME },
          },
        };
      }
      if (String(input.path).endsWith("/images")) {
        return {
          images: {
            "image-fill-1":
              "https://cdn.example.com/texture.png?token=secret-fill",
          },
        };
      }
      return {
        name: "Design system",
        version: "42",
        lastModified: "2026-07-01T00:00:00.000Z",
        editorType: "figma",
        role: "viewer",
        document: {
          id: "document",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "page-1",
              name: "Page",
              type: "CANVAS",
              children: [FRAME],
            },
          ],
        },
      };
    });
    const putPrivateBlob = vi.fn(async () => ({
      id: "private-render-1",
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType: "image/png",
    }));
    const connector = new FigmaContextConnector();
    const executionContext = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
      putPrivateBlob,
    };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config: { fileKeys: ["file-key"] } },
      executionContext,
    );
    const fetched = await connector.fetch(
      {
        sourceId: "source-1",
        config: { fileKeys: ["file-key"] },
        item: inventory.items[0],
      },
      executionContext,
    );

    expect(fetched.items[0]).toMatchObject({
      externalId: "file-key",
      kind: "figma-file",
      parseStatus: "parsed",
      sourceVersion: "42",
      metadata: {
        artifactCount: 1,
        childExternalIds: ["file-key:frame-1"],
      },
      edges: [
        {
          relation: "contains-native-artifact",
          toExternalId: "file-key:frame-1",
        },
      ],
    });
    const frame = fetched.items.find(
      (item) => item.externalId === "file-key:frame-1",
    );
    expect(frame).toMatchObject({
      externalId: "file-key:frame-1",
      kind: "figma-frame",
      sourceVersion: "42",
      mimeType: "text/html",
      metadata: {
        nativeArtifact: {
          app: "design",
          format: "design-html",
          fidelityReport: {
            imageFallback: { count: 1 },
          },
        },
      },
      media: [
        expect.objectContaining({
          kind: "image",
          accessMode: "private",
          provenanceUrl: "https://www.figma.com/design/file-key",
          captionStatus: "pending",
        }),
        expect.objectContaining({
          kind: "image",
          accessMode: "private",
          metadata: expect.objectContaining({ role: "image-fill" }),
        }),
      ],
      edges: expect.arrayContaining([
        { relation: "part-of-figma-file", toExternalId: "file-key" },
        {
          relation: "instance-of-component",
          toExternalId: "file-key:component-7",
        },
        expect.objectContaining({
          relation: "uses-figma-token",
          toExternalId: "file-key:style:style-type",
        }),
      ]),
    });
    expect(frame?.content).toContain("Build beautiful things");
    expect(frame?.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "code",
          text: expect.stringContaining("frame"),
          metadata: { role: "code-tokens", format: "design-html" },
        }),
      ]),
    );
    expect(frame?.content).toContain(
      "/_agent-native/creative-context/media?mediaId=",
    );
    expect(frame?.content).toContain("linear-gradient");
    expect(frame?.content).toContain("box-shadow");
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example.com/logo-fallback.png?token=secret-logo",
      expect.any(Object),
      { maxRedirects: 5 },
    );
    expect(JSON.stringify(fetched.items)).not.toContain("secret-logo");
    expect(JSON.stringify(fetched.items)).not.toContain("secret-fill");
    expect(putPrivateBlob).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.com" }),
    );
    expect(putPrivateBlob).toHaveBeenCalledTimes(2);
    expect(
      ssrfSafeFetch.mock.calls.filter(([url]) =>
        String(url).includes("texture.png"),
      ),
    ).toHaveLength(1);
  });

  it("falls back to per-page shallow inventory when the file depth-2 response is oversized", async () => {
    const frame = {
      id: "frame-1",
      name: "Recovered frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
      children: [],
    };
    const page = {
      id: "page-1",
      name: "Page 1",
      type: "CANVAS",
      children: [frame],
    };
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).endsWith("/nodes")) {
        const id = String((input.query as { ids?: string }).ids);
        const node = id === "page-1" ? page : frame;
        return { nodes: { [id]: { document: node } } };
      }
      if ((input.query as { depth?: number }).depth === 2) {
        throw new Error("response too large: maximum response limit");
      }
      return {
        name: "Large inventory file",
        version: "inventory-v1",
        document: {
          id: "document",
          type: "DOCUMENT",
          children: [{ id: "page-1", name: "Page 1", type: "CANVAS" }],
        },
      };
    });
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
    };
    const [item] = (
      await connector.inventory(
        { sourceId: "source-1", config: { fileKeys: ["large-file"] } },
        context,
      )
    ).items;

    const fetched = await connector.fetch(
      { sourceId: "source-1", config: {}, item: item! },
      context,
    );

    expect(
      fetched.items.find((entry) => entry.externalId === "large-file:frame-1"),
    ).toMatchObject({ kind: "figma-frame", mimeType: "text/html" });
    expect(fetched.warnings).toEqual([
      expect.stringContaining("pages were inventoried independently"),
    ]);
  });

  it("splits a huge artboard only at safe child boundaries and records reassembly geometry", async () => {
    const background = {
      id: "background",
      name: "Background",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 100, y: 200, width: 20_000, height: 4_000 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [],
    };
    const childOne = {
      id: "section-1",
      name: "Section one",
      type: "FRAME",
      absoluteBoundingBox: { x: 100, y: 200, width: 1200, height: 800 },
      relativeTransform: [
        [1, 0, 100],
        [0, 1, 200],
      ],
      children: [],
    };
    const childTwo = {
      id: "section-2",
      name: "Section two",
      type: "FRAME",
      absoluteBoundingBox: { x: 1400, y: 200, width: 1200, height: 800 },
      children: [],
    };
    const huge = {
      id: "huge-1",
      name: "Huge campaign board",
      type: "FRAME",
      absoluteBoundingBox: { x: 100, y: 200, width: 20_000, height: 4_000 },
      effects: [
        {
          type: "DROP_SHADOW",
          visible: true,
          radius: 8,
          offset: { x: 0, y: 4 },
          color: { r: 0, g: 0, b: 0, a: 0.2 },
        },
      ],
      children: [background, childOne, childTwo],
    };
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).endsWith("/nodes")) {
        const id = String((input.query as { ids?: string }).ids);
        const node =
          id === "huge-1"
            ? huge
            : id === "background"
              ? background
              : id === "section-1"
                ? childOne
                : childTwo;
        return { nodes: { [id]: { document: node } } };
      }
      return {
        name: "Huge file",
        version: "huge-v1",
        document: {
          id: "document",
          type: "DOCUMENT",
          children: [{ id: "page", type: "CANVAS", children: [huge] }],
        },
      };
    });
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
      putPrivateBlob: vi.fn(),
    };
    const [item] = (
      await connector.inventory(
        { sourceId: "source-1", config: { fileKeys: ["huge-file"] } },
        context,
      )
    ).items;
    const fetched = await connector.fetch(
      { sourceId: "source-1", config: {}, item: item! },
      context,
    );
    const parent = fetched.items.find(
      (entry) => entry.externalId === "huge-file:huge-1",
    );
    expect(parent).toMatchObject({
      kind: "figma-artboard-manifest",
      metadata: {
        nativeArtifact: {
          manifest: {
            kind: "hierarchical-artboard",
            children: [
              {
                externalId: "huge-file:background",
                bounds: { x: 0, y: 0, width: 20_000, height: 4_000 },
                zOrder: 0,
              },
              {
                externalId: "huge-file:section-1",
                bounds: { x: 0, y: 0, width: 1200, height: 800 },
                transform: [1, 0, 100, 0, 1, 200],
                zOrder: 1,
              },
              {
                externalId: "huge-file:section-2",
                bounds: { x: 1300, y: 0, width: 1200, height: 800 },
                zOrder: 2,
              },
            ],
          },
        },
      },
    });
    expect(parent?.content).toContain(
      'data-creative-context-child="huge-file:section-1"',
    );
    expect(
      providerRequest.mock.calls.filter(
        ([request]) =>
          String(request.path).endsWith("/nodes") &&
          (request.query as { ids?: string; depth?: number }).ids ===
            "huge-1" &&
          !(request.query as { depth?: number }).depth,
      ),
    ).toHaveLength(0);
  });

  it("recursively buckets an oversized hierarchical shell without flattening editable children", async () => {
    const children = Array.from({ length: 1_000 }, (_, index) => ({
      id: `section-${index}`,
      name: `Section ${index}`,
      type: "FRAME",
      absoluteBoundingBox: {
        x: index * 120,
        y: 0,
        width: 100,
        height: 100,
      },
      children: [],
    }));
    const wide = {
      id: "wide-1",
      name: "Wide campaign map",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 120_000, height: 1_000 },
      children,
    };
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).startsWith("/images/")) {
        return {
          images: {
            "wide-1": "https://cdn.example.com/wide-1.png",
          },
        };
      }
      if (String(input.path).endsWith("/nodes")) {
        const id = String((input.query as { ids?: string }).ids);
        const node =
          id === "wide-1" ? wide : children.find((child) => child.id === id);
        return { nodes: { [id]: { document: node } } };
      }
      return {
        name: "Wide file",
        version: "wide-v1",
        document: {
          id: "document",
          type: "DOCUMENT",
          children: [{ id: "page", type: "CANVAS", children: [wide] }],
        },
      };
    });
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
      putPrivateBlob: vi.fn(async () => ({
        id: "private-wide",
        provider: "fixture",
        opaque: true as const,
        encrypted: true,
        mimeType: "image/png",
      })),
    };
    const [item] = (
      await connector.inventory(
        { sourceId: "source-1", config: { fileKeys: ["wide-file"] } },
        context,
      )
    ).items;

    const fetched = await connector.fetch(
      { sourceId: "source-1", config: {}, item: item! },
      context,
    );
    const parent = fetched.items.find(
      (entry) => entry.externalId === "wide-file:wide-1",
    );

    expect(Buffer.byteLength(parent!.content, "utf8")).toBeLessThanOrEqual(
      128 * 1024,
    );
    expect(parent).toMatchObject({
      kind: "figma-artboard-manifest",
      metadata: {
        nativeArtifact: {
          manifest: { kind: "hierarchical-artboard" },
          fidelityReport: { imageFallback: { count: 0 } },
        },
      },
    });
    expect(
      (
        parent?.metadata.nativeArtifact as {
          manifest?: { children?: unknown[] };
        }
      ).manifest?.children,
    ).toHaveLength(Math.ceil(children.length / 64));
    expect(
      fetched.items
        .filter((entry) => entry.mimeType === "text/html")
        .every(
          (entry) => Buffer.byteLength(entry.content, "utf8") <= 128 * 1024,
        ),
    ).toBe(true);
    expect(
      fetched.items.filter((entry) =>
        entry.externalId.includes(":manifest-bucket:"),
      ),
    ).toHaveLength(Math.ceil(children.length / 64));
    expect(fetched.warnings).not.toEqual(
      expect.arrayContaining([expect.stringContaining("localized rendered")]),
    );
    expect(
      providerRequest.mock.calls.filter(
        ([request]) =>
          String(request.path).endsWith("/nodes") &&
          (request.query as { ids?: string; depth?: number }).ids ===
            "wide-1" &&
          !(request.query as { depth?: number }).depth,
      ),
    ).toHaveLength(0);
  });

  it("never splits masks or groups and localizes fallback for an indivisible oversized group", async () => {
    const maskFrame = {
      id: "mask-frame",
      name: "Masked composition",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 20_000, height: 3_000 },
      children: [
        {
          id: "mask-node",
          name: "Mask",
          type: "FRAME",
          isMask: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 },
          children: [],
        },
        {
          id: "masked-content",
          name: "Masked content",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 },
          children: [],
        },
      ],
    };
    const group = {
      id: "group-1",
      name: "Indivisible group",
      type: "GROUP",
      absoluteBoundingBox: { x: 0, y: 4_000, width: 20_000, height: 3_000 },
      children: [
        {
          id: "group-child-1",
          name: "First",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 4_000, width: 500, height: 500 },
          children: [],
        },
        {
          id: "group-child-2",
          name: "Second",
          type: "FRAME",
          absoluteBoundingBox: { x: 600, y: 4_000, width: 500, height: 500 },
          children: [],
        },
      ],
    };
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).startsWith("/images/")) {
        const ids = String((input.query as { ids?: string }).ids).split(",");
        return {
          images: Object.fromEntries(
            ids.map((id) => [id, `https://cdn.example.com/${id}.png`]),
          ),
        };
      }
      if (String(input.path).endsWith("/nodes")) {
        const query = input.query as { ids?: string; depth?: number };
        if (query.ids === "group-1" && !query.depth) {
          throw new Error("response too large: maximum response limit");
        }
        const node = query.ids === "group-1" ? group : maskFrame;
        return { nodes: { [query.ids!]: { document: node } } };
      }
      if (String(input.path).endsWith("/images")) return { images: {} };
      return {
        name: "Composition file",
        version: "composition-v1",
        document: {
          id: "document",
          type: "DOCUMENT",
          children: [
            { id: "page", type: "CANVAS", children: [maskFrame, group] },
          ],
        },
      };
    });
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
      putPrivateBlob: vi.fn(async () => ({
        id: "private",
        provider: "fixture",
        opaque: true as const,
        encrypted: true,
        mimeType: "image/png",
      })),
    };
    const [item] = (
      await connector.inventory(
        { sourceId: "source-1", config: { fileKeys: ["composition"] } },
        context,
      )
    ).items;
    const fetched = await connector.fetch(
      { sourceId: "source-1", config: {}, item: item! },
      context,
    );
    const masked = fetched.items.find(
      (entry) => entry.externalId === "composition:mask-frame",
    );
    const grouped = fetched.items.find(
      (entry) => entry.externalId === "composition:group-1",
    );
    expect(masked?.metadata.nativeArtifact).not.toHaveProperty("manifest");
    expect(grouped).toMatchObject({
      kind: "figma-frame",
      metadata: {
        nativeArtifact: {
          fidelityReport: { imageFallback: { count: 1 } },
        },
      },
    });
    expect(grouped?.metadata.nativeArtifact).not.toHaveProperty("manifest");
    expect(fetched.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("localized rendered fallback"),
      ]),
    );
  });

  it("keeps content-addressed asset routes stable across source versions", async () => {
    let sourceVersion = "asset-v1";
    let assetBytes = new Uint8Array([137, 80, 78, 71, 1]);
    ssrfSafeFetch.mockImplementation(
      async () =>
        new Response(assetBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const imageFrame = {
      id: "asset-frame",
      name: "Asset frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
      fills: [{ type: "IMAGE", imageRef: "stable-fill", scaleMode: "FILL" }],
      children: [],
    };
    const providerRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).endsWith("/nodes")) {
        return { nodes: { "asset-frame": { document: imageFrame } } };
      }
      if (String(input.path).endsWith("/images")) {
        return {
          images: { "stable-fill": "https://cdn.example.com/stable.png" },
        };
      }
      return {
        name: "Asset file",
        version: sourceVersion,
        document: {
          id: "document",
          type: "DOCUMENT",
          children: [{ id: "page", type: "CANVAS", children: [imageFrame] }],
        },
      };
    });
    const putPrivateBlob = vi.fn(
      async (input: { key?: string; mimeType?: string }) => ({
        id: input.key ?? "private-asset",
        provider: "fixture",
        opaque: true as const,
        encrypted: true,
        mimeType: input.mimeType,
      }),
    );
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      resolveConnection: async () => "figma-connection",
      providerApi: { executeRequest: providerRequest } as never,
      putPrivateBlob,
    };
    const connector = new FigmaContextConnector();
    const fetchVersion = async () => {
      const [item] = (
        await connector.inventory(
          { sourceId: "source-1", config: { fileKeys: ["asset-file"] } },
          context,
        )
      ).items;
      const fetched = await connector.fetch(
        { sourceId: "source-1", config: {}, item: item! },
        context,
      );
      return fetched.items.find(
        (entry) => entry.externalId === "asset-file:asset-frame",
      )!;
    };

    const first = await fetchVersion();
    sourceVersion = "asset-v2";
    const unchanged = await fetchVersion();
    assetBytes = new Uint8Array([137, 80, 78, 71, 2]);
    sourceVersion = "asset-v3";
    const changed = await fetchVersion();

    expect(unchanged.metadata.nativeArtifact).toMatchObject({
      assetRefs: first.metadata.nativeArtifact.assetRefs,
    });
    expect(changed.metadata.nativeArtifact.assetRefs).not.toEqual(
      first.metadata.nativeArtifact.assetRefs,
    );
    expect(putPrivateBlob.mock.calls[1]?.[0].key).toBe(
      putPrivateBlob.mock.calls[0]?.[0].key,
    );
    expect(putPrivateBlob.mock.calls[2]?.[0].key).not.toBe(
      putPrivateBlob.mock.calls[0]?.[0].key,
    );
  });
});

describe("Figma native fidelity reports", () => {
  it("counts every fidelity entry while bounding only the detailed reasons", () => {
    const approximated = Array.from({ length: 1_001 }, (_, index) => ({
      nodeId: `approx-${index}`,
      nodeName: `Approximation ${index}`,
      nodeType: "FRAME",
      level: "approximated" as const,
      notes: ["Approximation detail"],
    }));
    const imageFallback = Array.from({ length: 1_002 }, (_, index) => ({
      nodeId: `fallback-${index}`,
      nodeName: `Fallback ${index}`,
      nodeType: "VECTOR",
      level: "image-fallback" as const,
      notes: ["Rendered fallback detail"],
    }));

    const report = nativeFidelityReportFromEntries([
      {
        nodeId: "exact-1",
        nodeName: "Exact",
        nodeType: "RECTANGLE",
        level: "exact",
        notes: [],
      },
      ...approximated,
      ...imageFallback,
    ]);

    expect(report.exact.count).toBe(1);
    expect(report.approximated).toMatchObject({ count: 1_001 });
    expect(report.approximated.reasons).toHaveLength(1_000);
    expect(report.imageFallback).toMatchObject({ count: 1_002 });
    expect(report.imageFallback.reasons).toHaveLength(1_000);
  });
});

const FRAME = {
  id: "frame-1",
  name: "Hero",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
  layoutMode: "VERTICAL",
  itemSpacing: 16,
  styles: { fill: "style-root" },
  fills: [
    {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    },
  ],
  effects: [
    {
      type: "DROP_SHADOW",
      visible: true,
      radius: 12,
      offset: { x: 0, y: 6 },
      color: { r: 0, g: 0, b: 0, a: 0.25 },
    },
  ],
  children: [
    {
      id: "logo-1",
      name: "Primary Logo",
      type: "VECTOR",
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
    },
    {
      id: "text-1",
      name: "Headline",
      type: "TEXT",
      absoluteBoundingBox: { x: 0, y: 60, width: 800, height: 80 },
      characters: "Build beautiful things",
      componentId: "component-7",
      styles: { text: "style-type" },
      style: { fontFamily: "Inter", fontSize: 48, fontWeight: 700 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    },
    {
      id: "image-1",
      name: "Texture one",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 180, width: 300, height: 200 },
      fills: [{ type: "IMAGE", imageRef: "image-fill-1", scaleMode: "FILL" }],
    },
    {
      id: "image-2",
      name: "Texture two",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 320, y: 180, width: 300, height: 200 },
      fills: [{ type: "IMAGE", imageRef: "image-fill-1", scaleMode: "FILL" }],
    },
  ],
};
