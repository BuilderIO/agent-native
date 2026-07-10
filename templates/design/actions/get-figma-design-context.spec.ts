import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

import action from "./get-figma-design-context.js";

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

describe("get-figma-design-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when neither figmaUrl nor fileKey resolves to a valid key", async () => {
    await expect(
      action.run({ figmaUrl: "https://example.com/not-figma" } as any),
    ).rejects.toThrow(/Could not find a Figma file key/);
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a pages/frames overview when no nodeId is given", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        expect(path).toBe("/files/abcDEF12345");
        expect(query).toEqual({ depth: 3 });
        return jsonEnvelope({
          document: {
            children: [
              {
                id: "0:1",
                name: "Page 1",
                type: "CANVAS",
                children: [
                  {
                    id: "1:2",
                    name: "F3b Fixture Frame",
                    type: "FRAME",
                    children: [{ id: "1:3" }, { id: "1:4" }],
                  },
                ],
              },
            ],
          },
        });
      },
    );

    const result = await action.run({
      fileUrl: undefined,
      figmaUrl: "https://www.figma.com/design/abcDEF12345/App",
    } as any);

    expect(result.mode).toBe("overview");
    expect(result.fileKey).toBe("abcDEF12345");
    expect(result.pages).toEqual([
      {
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        frames: [
          {
            id: "1:2",
            name: "F3b Fixture Frame",
            type: "FRAME",
            childCount: 2,
          },
        ],
      },
    ]);
    expect(result.guidance).toMatch(/get_metadata/);
  });

  it("summarizes a node's fills, gradients, text, and layout, with a screenshot url", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          expect(query).toEqual({ ids: "1:2" });
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  id: "1:2",
                  name: "F3b Fixture Frame",
                  type: "FRAME",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
                  layoutMode: "VERTICAL",
                  itemSpacing: 16,
                  paddingLeft: 24,
                  paddingRight: 24,
                  paddingTop: 24,
                  paddingBottom: 24,
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                  children: [
                    {
                      id: "1:3",
                      name: "Fixture Heading",
                      type: "TEXT",
                      absoluteBoundingBox: {
                        x: 24,
                        y: 24,
                        width: 352,
                        height: 24,
                      },
                      characters: "Fixture Heading",
                      style: {
                        fontFamily: "Inter",
                        fontWeight: 700,
                        fontSize: 20,
                      },
                    },
                    {
                      id: "1:5",
                      name: "Gradient Card",
                      type: "RECTANGLE",
                      absoluteBoundingBox: {
                        x: 24,
                        y: 131,
                        width: 352,
                        height: 100,
                      },
                      cornerRadius: 16,
                      fills: [
                        {
                          type: "GRADIENT_LINEAR",
                          gradientHandlePositions: [
                            { x: 0, y: 0.5 },
                            { x: 1, y: 0.5 },
                            { x: 0, y: 0 },
                          ],
                          gradientStops: [
                            {
                              position: 0,
                              color: { r: 0.24, g: 0.51, b: 0.96, a: 1 },
                            },
                            {
                              position: 1,
                              color: { r: 0.93, g: 0.4, b: 0.69, a: 1 },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          expect(query).toEqual({
            ids: "1:2",
            format: "png",
            scale: 2,
            svg_include_id: undefined,
          });
          return jsonEnvelope({
            images: { "1:2": "https://figma-renders.example/1-2.png" },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      figmaUrl: "https://www.figma.com/design/abcDEF12345/App?node-id=1-2",
    } as any);

    expect(result.mode).toBe("node");
    expect(result.fileKey).toBe("abcDEF12345");
    expect(result.nodeId).toBe("1:2");
    expect(result.screenshotUrl).toBe("https://figma-renders.example/1-2.png");
    expect(result.summary.layout).toEqual({
      mode: "VERTICAL",
      primaryAxisAlignItems: undefined,
      counterAxisAlignItems: undefined,
      itemSpacing: 16,
      wrap: undefined,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      sizingHorizontal: undefined,
      sizingVertical: undefined,
    });
    expect(result.summary.fills).toEqual([{ type: "solid", color: "#ffffff" }]);

    const heading = result.summary.children?.[0];
    expect(heading?.text).toEqual({
      characters: "Fixture Heading",
      truncated: false,
      fontFamily: "Inter",
      fontWeight: 700,
      fontSize: 20,
      lineHeightPx: undefined,
      lineHeightPercent: undefined,
      letterSpacing: undefined,
      textAlignHorizontal: undefined,
      textCase: undefined,
      textDecoration: undefined,
    });

    const gradientCard = result.summary.children?.[1];
    expect(gradientCard?.cornerRadius).toBe(16);
    expect(gradientCard?.fills?.[0]?.type).toBe("linear-gradient");
    expect(gradientCard?.fills?.[0]?.angleDeg).toBe(90);
    expect(gradientCard?.fills?.[0]?.stops).toEqual([
      { position: 0, color: "#3d82f5" },
      { position: 1, color: "#ed66b0" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("skips the screenshot fetch when includeScreenshot is false", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: { id: "1:2", name: "Hero", type: "FRAME" },
              },
            },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      includeScreenshot: false,
    } as any);

    expect(result.screenshotUrl).toBeNull();
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
  });

  it("truncates when the node tree exceeds maxNodes", async () => {
    const manyChildren = Array.from({ length: 12 }, (_, i) => ({
      id: `1:${i + 10}`,
      name: `Child ${i}`,
      type: "RECTANGLE",
    }));
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  id: "1:2",
                  name: "Root",
                  type: "FRAME",
                  children: manyChildren,
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({ images: { "1:2": null } });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      maxNodes: 10,
    } as any);

    expect(result.truncated).toBe(true);
    expect(result.summary.truncatedChildren).toBe(true);
    expect(result.summary.childCount).toBe(3);
    expect(result.guidance).toMatch(/truncated by depth or node-count/);
  });
});
