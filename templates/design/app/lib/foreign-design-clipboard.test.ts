// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  ForeignDesignClipboardError,
  prepareForeignDesignClipboard,
  sanitizeForeignDesignHtml,
} from "./foreign-design-clipboard";

describe("foreign Design clipboard preparation", () => {
  it("keeps visible HTML, stylesheet rules and image URLs while removing executable behavior", () => {
    const html = sanitizeForeignDesignHtml(
      `<!doctype html><html><head><style>.card{color:rgb(1,2,3)}</style><link rel="stylesheet" href="https://fonts.example.test/font.css"></head><body x-data="{value:1}"><main class="card" x-init="bad()" @click="bad()" onclick="bad()"><img src="https://images.example.test/photo.png"><span x-text="value">Materialized text</span><script>bad()</script><template>Unrendered template</template></main></body></html>`,
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelector("main")?.textContent).toBe("Materialized text");
    expect(parsed.querySelector("style")?.textContent).toBe(
      ".card{color:rgb(1,2,3)}",
    );
    expect(parsed.querySelector("link")?.getAttribute("href")).toBe(
      "https://fonts.example.test/font.css",
    );
    expect(parsed.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example.test/photo.png",
    );
    expect(parsed.querySelectorAll("script,template,iframe")).toHaveLength(0);
    expect(
      Array.from(parsed.querySelectorAll("*")).flatMap((node) =>
        Array.from(node.attributes).map((attribute) => attribute.name),
      ),
    ).not.toEqual(
      expect.arrayContaining([
        "x-data",
        "x-init",
        "x-text",
        "@click",
        "onclick",
      ]),
    );
  });

  it.each([
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=bad()>">',
    "<svg><g/onload=bad()//<p>",
    '<a href="java&#x09;script:bad()">Safe text</a>',
    '<img src="https://images.example.test/photo.png" onerror="bad()"><div data-x-init="bad()">Text</div>',
  ])("removes active markup across parser repair: %s", (source) => {
    const html = sanitizeForeignDesignHtml(source);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const node of Array.from(parsed.querySelectorAll("*"))) {
      for (const attribute of Array.from(node.attributes)) {
        expect(attribute.name).not.toMatch(/^(?:on|x-|data-x-|@|:)/i);
        expect(attribute.value.replace(/[\u0000-\u0020]/g, "")).not.toMatch(
          /^javascript:/i,
        );
      }
    }
  });

  it("refuses incomplete snapshots and embedded media rather than treating them as success", () => {
    expect(() =>
      sanitizeForeignDesignHtml(
        '<html data-agent-native-export-resource-failures="image-unavailable"><body>Image</body></html>',
      ),
    ).toThrow(ForeignDesignClipboardError);
    expect(() =>
      sanitizeForeignDesignHtml('<img src="data:image/png;base64,ZmFrZQ==">'),
    ).toThrow(ForeignDesignClipboardError);
  });

  it("refuses CSS-escaped embedded media instead of storing it in document content", () => {
    expect(() =>
      sanitizeForeignDesignHtml(
        '<style>.x{background:url(\\64 ata:image/png;base64,ZmFrZQ==)}</style><div class="x">Image</div>',
      ),
    ).toThrow(ForeignDesignClipboardError);
  });

  it("detaches foreign file provenance while preserving layer geometry and style snapshots", async () => {
    const snapshot = {
      version: 1 as const,
      nodes: [{ path: [], styles: { color: "rgb(1,2,3)" } }],
    };
    const result = await prepareForeignDesignClipboard({
      version: 1,
      entries: [
        {
          html: '<div data-agent-native-node-id="root">Content</div>',
          sourceFileId: "destination-file",
          sourceParentNodeId: "destination-parent",
          sourceCanvasRect: { x: 1, y: 2, width: 100, height: 50 },
          portableStyleSnapshot: snapshot,
        },
      ],
    });
    expect(result.entries[0]?.sourceFileId).not.toBe("destination-file");
    expect(result.entries[0]?.sourceParentNodeId).toBeUndefined();
    expect(result.entries[0]?.sourceCanvasRect).toEqual({
      x: 1,
      y: 2,
      width: 100,
      height: 50,
    });
    expect(result.entries[0]?.portableStyleSnapshot).toEqual(snapshot);
    expect(result.entries[0]?.html).toContain("Content");
  });
  it("keeps foreign sibling provenance grouped without matching a destination file", async () => {
    const result = await prepareForeignDesignClipboard({
      version: 1,
      entries: [
        { html: "<div>First</div>", sourceFileId: "same-file" },
        { html: "<div>Second</div>", sourceFileId: "same-file" },
        { html: "<div>Other</div>", sourceFileId: "other-file" },
      ],
    });
    expect(result.entries[0]?.sourceFileId).toBe(
      result.entries[1]?.sourceFileId,
    );
    expect(result.entries[0]?.sourceFileId).not.toBe(
      result.entries[2]?.sourceFileId,
    );
    expect(result.entries[0]?.sourceFileId).not.toBe("same-file");
  });

  it("applies the media URL boundary to managed responsive styles too", async () => {
    await expect(
      prepareForeignDesignClipboard({
        version: 1,
        entries: [
          {
            html: "<div>Card</div>",
            sourceFileId: "file",
            managedStyleSnapshot: {
              version: 1,
              breakpoints: [
                {
                  maxWidthPx: 800,
                  nodeId: "root",
                  property: "background-image",
                  value: "url(data:image/png;base64,ZmFrZQ==)",
                },
              ],
              interactionStates: [],
            },
          },
        ],
      }),
    ).rejects.toThrow(ForeignDesignClipboardError);
  });
});
