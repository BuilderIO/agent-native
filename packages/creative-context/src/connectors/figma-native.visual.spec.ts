import { compareRasterImages } from "@agent-native/core/ingestion";
import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
  reassembleNativeCreativeArtifact,
  validateCompiledNativeHtml,
} from "../native-artifact-reassembly.js";
import type { ContextDetail } from "../types.js";
import { FigmaContextConnector } from "./figma.js";

describe("Figma native compiler visual fidelity", () => {
  it("keeps the source render and clone-ready native code within the pixel-diff gate", async () => {
    const frame = {
      id: "frame-visual",
      name: "Visual parity fixture",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 180 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [
        {
          id: "rect-visual",
          name: "Red card",
          type: "RECTANGLE",
          absoluteBoundingBox: { x: 60, y: 40, width: 200, height: 100 },
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        },
      ],
    };
    const providerApi = {
      executeRequest: vi.fn(async (input: Record<string, unknown>) =>
        String(input.path).endsWith("/nodes")
          ? { nodes: { "frame-visual": { document: frame } } }
          : {
              name: "Visual fixture",
              version: "visual-v1",
              document: {
                id: "document",
                type: "DOCUMENT",
                children: [{ id: "page", type: "CANVAS", children: [frame] }],
              },
            },
      ),
    };
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      providerApi: providerApi as never,
      resolveConnection: async () => "figma-connection",
    };
    const inventory = await connector.inventory(
      { sourceId: "source", config: { fileKeys: ["visual-file"] } },
      context,
    );
    const fetched = await connector.fetch(
      {
        sourceId: "source",
        config: {},
        item: inventory.items[0]!,
      },
      context,
    );
    const native = fetched.items.find(
      (item) => item.externalId === "visual-file:frame-visual",
    )!;
    const artifact = native.metadata.nativeArtifact as Parameters<
      typeof validateCompiledNativeHtml
    >[1];
    validateCompiledNativeHtml(native.content, artifact);

    const sourceRender =
      '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-width:100%;min-height:100%}</style></head><body><div style="position:relative;width:320px;height:180px;background:#fff"><div style="position:absolute;left:60px;top:40px;width:200px;height:100px;background:#f00"></div></div></body></html>';
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 180 },
        deviceScaleFactor: 1,
      });
      const render = async (html: string) => {
        await page.setContent(html);
        return page.screenshot({ type: "png" });
      };
      const source = await render(sourceRender);
      const cloneReady = await render(native.content);
      const difference = await compareRasterImages({
        source,
        rendered: cloneReady,
      });
      expect(difference.meanAbsoluteDifference).toBeLessThan(0.5);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("visually preserves hierarchical placement and z-order after reassembly", async () => {
    const background = {
      id: "visual-background",
      name: "Background",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 13_000, height: 180 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [],
    };
    const red = {
      id: "visual-red",
      name: "Red layer",
      type: "FRAME",
      absoluteBoundingBox: { x: 30, y: 25, width: 180, height: 110 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      children: [],
    };
    const blue = {
      id: "visual-blue",
      name: "Blue top layer",
      type: "FRAME",
      absoluteBoundingBox: { x: 110, y: 60, width: 160, height: 90 },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
      children: [],
    };
    const parent = {
      id: "visual-parent",
      name: "Hierarchical fixture",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 13_000, height: 180 },
      children: [background, red, blue],
    };
    const nodes = { parent, background, red, blue };
    const providerApi = {
      executeRequest: vi.fn(async (input: Record<string, unknown>) => {
        if (String(input.path).endsWith("/nodes")) {
          const id = String((input.query as { ids?: string }).ids);
          const node = Object.values(nodes).find((entry) => entry.id === id);
          return { nodes: { [id]: { document: node } } };
        }
        return {
          name: "Hierarchical visual fixture",
          version: "hierarchical-visual-v1",
          document: {
            id: "document",
            type: "DOCUMENT",
            children: [{ id: "page", type: "CANVAS", children: [parent] }],
          },
        };
      }),
    };
    const connector = new FigmaContextConnector();
    const context = {
      appId: "design",
      ownerEmail: "owner@example.com",
      providerApi: providerApi as never,
      resolveConnection: async () => "figma-connection",
    };
    const inventory = await connector.inventory(
      { sourceId: "source", config: { fileKeys: ["hierarchical-visual"] } },
      context,
    );
    const fetched = await connector.fetch(
      { sourceId: "source", config: {}, item: inventory.items[0]! },
      context,
    );
    const details = new Map<string, ContextDetail>();
    for (const [index, item] of fetched.items.entries()) {
      if (item.mimeType !== "text/html") continue;
      details.set(item.externalId, {
        item: {
          id: `item-${index}`,
          sourceId: "source",
          externalId: item.externalId,
          mimeType: item.mimeType,
          provenance: item.provenance,
        },
        version: {
          id: `version-${index}`,
          content: item.content,
          metadata: item.metadata,
          sourceVersion: item.sourceVersion,
        },
        edges: (item.edges ?? []).map((edge, edgeIndex) => ({
          id: `edge-${index}-${edgeIndex}`,
          fromItemId: `item-${index}`,
          fromItemVersionId: `version-${index}`,
          toItemId: null,
          toItemVersionId: null,
          toExternalId: edge.toExternalId ?? null,
          relation: edge.relation,
          metadata: edge.metadata ?? {},
        })),
        chunks: [],
        media: [],
      } as ContextDetail);
    }
    const root = details.get("hierarchical-visual:visual-parent")!;
    const reassembled = await reassembleNativeCreativeArtifact({
      root,
      app: "design",
      format: "design-html",
      resolveChild: async ({ externalId }) => details.get(externalId) ?? null,
    });
    const sourceRender =
      '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-width:100%;min-height:100%}</style></head><body><div style="position:relative;width:13000px;height:180px;background:#fff"><div style="position:absolute;left:30px;top:25px;width:180px;height:110px;background:#f00"></div><div style="position:absolute;left:110px;top:60px;width:160px;height:90px;background:#00f"></div></div></body></html>';
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 180 },
        deviceScaleFactor: 1,
      });
      const render = async (html: string) => {
        await page.setContent(html);
        return page.screenshot({ type: "png" });
      };
      const difference = await compareRasterImages({
        source: await render(sourceRender),
        rendered: await render(reassembled.html),
      });
      expect(difference.meanAbsoluteDifference).toBeLessThan(0.5);
    } finally {
      await browser.close();
    }
  }, 20_000);
});
