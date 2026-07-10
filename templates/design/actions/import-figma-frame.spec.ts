import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
  getRequestUserEmail: vi.fn(),
  assertAccess: vi.fn(),
  resolveImportDesignId: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/import-design-files.js", () => ({
  normalizeImportedHtmlDocument: vi.fn(
    (content: string, label: string) =>
      `<!doctype html><html><head><!-- ${label} --></head><body>${content}</body></html>`,
  ),
  resolveImportDesignId: mocks.resolveImportDesignId,
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import action from "./import-figma-frame.js";

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

function errorEnvelope(status: number, text: string) {
  return { response: { ok: false, status, statusText: "Error", text } };
}

const SIMPLE_FRAME = {
  document: {
    id: "1:2",
    name: "Hero",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [],
  },
};

describe("import-figma-frame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.resolveImportDesignId.mockImplementation(
      async (designId?: string) => designId ?? "design-1",
    );
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.ssrfSafeFetch.mockImplementation(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { "content-type": "image/png" },
        }),
    );
    mocks.uploadFile.mockResolvedValue({
      url: "https://assets.example.test/figma-import.png",
    });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "file-1", filename: "Hero.html" }],
      warnings: [],
      placedFrames: [],
      overview: true,
      urlPath: "/design/design-1",
    });
  });

  it("checks target access before any Figma fetch or durable upload", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("No access"));

    await expect(
      action.run({
        figmaUrl: "https://www.figma.com/design/abcDEF12345/App?node-id=1-2",
        designId: "private-design",
        asNewScreen: true,
      } as any),
    ).rejects.toThrow("No access");

    expect(mocks.resolveImportDesignId).toHaveBeenCalledWith("private-design");
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "private-design",
      "editor",
    );
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("imports a frame from a figmaUrl with an explicit node-id", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        expect(path).toBe("/files/abcDEF12345/nodes");
        expect(query).toEqual({ ids: "1:2" });
        return jsonEnvelope({ nodes: { "1:2": SIMPLE_FRAME } });
      },
    );

    const result = await action.run({
      figmaUrl: "https://www.figma.com/design/abcDEF12345/App?node-id=1-2",
      asNewScreen: true,
    } as any);

    expect(result.figma).toEqual({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      nodeName: "Hero",
    });
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.sourceType).toBe("figma-import");
    expect(saveArgs.files[0].filename).toBe("Hero.html");
    expect(saveArgs.files[0].content).toContain(
      "background-color: rgba(255, 255, 255, 1)",
    );
    expect(saveArgs.files[0].preferredFrame).toEqual({
      title: "Hero",
      width: 200,
      height: 100,
    });
    expect(result.fidelityReport.exactCount).toBeGreaterThan(0);
  });

  it("resolves /branch/:branchKey/ to the branch key for the nodes request", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/branchKey456/nodes") {
          return jsonEnvelope({ nodes: { "1:2": SIMPLE_FRAME } });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await action.run({
      figmaUrl:
        "https://www.figma.com/design/parentKey123/App/branch/branchKey456/App-Branch?node-id=1-2",
    } as any);

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/files/branchKey456/nodes" }),
    );
  });

  it("falls back to the first top-level frame when no node-id is given", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345" && query?.depth === 2) {
          return jsonEnvelope({
            document: {
              children: [
                {
                  id: "page-1",
                  children: [{ id: "9:9", name: "First Frame" }],
                },
              ],
            },
          });
        }
        if (path === "/files/abcDEF12345/nodes") {
          expect(query).toEqual({ ids: "9:9" });
          return jsonEnvelope({
            nodes: {
              "9:9": { document: { ...SIMPLE_FRAME.document, id: "9:9" } },
            },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({ fileKey: "abcDEF12345" } as any);
    expect(result.figma.nodeId).toBe("9:9");
  });

  it("throws a clear error when the requested node is not found", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async () =>
      jsonEnvelope({ nodes: {} }),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/not found/);
  });

  it("throws when the provider request fails", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async () =>
      errorEnvelope(401, "Invalid token"),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/Invalid token/);
  });

  it("rejects asNewScreen: false as not yet supported", async () => {
    await expect(
      action.run({
        fileKey: "abcDEF12345",
        nodeId: "1:2",
        asNewScreen: false,
      } as any),
    ).rejects.toThrow(/not supported yet/);
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("fetches PNG fallbacks for unsupported node types and reports them", async () => {
    const frameWithVector = {
      document: {
        id: "1:2",
        name: "Hero",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
        children: [
          {
            id: "1:3",
            name: "Icon",
            type: "VECTOR",
            absoluteBoundingBox: { x: 10, y: 10, width: 24, height: 24 },
          },
        ],
      },
    };
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": frameWithVector } });
        }
        if (path === "/images/abcDEF12345") {
          expect(query).toEqual({ ids: "1:3", format: "png", scale: 2 });
          return jsonEnvelope({
            images: { "1:3": "https://figma-renders.example.com/1-3.png" },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await action.run({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    } as any);
    expect(result.fidelityReport.imageFallbacks).toHaveLength(1);
    expect(result.fidelityReport.imageFallbacks[0].nodeId).toBe("1:3");
    const saveArgs = mocks.saveImportedDesignFiles.mock.calls[0]![0];
    expect(saveArgs.files[0].content).toContain(
      "https://assets.example.test/figma-import.png",
    );
    expect(saveArgs.files[0].content).not.toContain(
      "https://figma-renders.example.com/1-3.png",
    );
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://figma-renders.example.com/1-3.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3, httpsOnly: true },
    );
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Buffer),
        mimeType: "image/png",
        ownerEmail: "designer@example.com",
        recordAsset: false,
        stableUrl: true,
      }),
    );
  });

  it("fails instead of silently dropping a visible fallback layer when Figma returns a null render URL", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: [
                    {
                      id: "1:3",
                      name: "Complex mask",
                      type: "VECTOR",
                      absoluteBoundingBox: {
                        x: 0,
                        y: 0,
                        width: 24,
                        height: 24,
                      },
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({ images: { "1:3": null } });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/could not render.*required fallback layer/i);
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("mirrors expiring image-fill URLs before generated HTML is saved", async () => {
    const frameWithImageFill = {
      document: {
        ...SIMPLE_FRAME.document,
        children: [
          {
            id: "1:4",
            name: "Photo",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 60 },
            fills: [
              { type: "IMAGE", imageRef: "photo-ref", scaleMode: "FILL" },
            ],
          },
        ],
      },
    };
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": frameWithImageFill } });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({
            images: {
              "photo-ref": "https://figma-images.example.com/expiring.jpg",
            },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255]), {
        headers: { "content-type": "image/jpeg" },
      }),
    );
    mocks.uploadFile.mockResolvedValue({
      url: "https://assets.example.test/photo.jpg",
    });

    await action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any);

    const content =
      mocks.saveImportedDesignFiles.mock.calls[0]![0].files[0].content;
    expect(content).toContain("https://assets.example.test/photo.jpg");
    expect(content).not.toContain(
      "https://figma-images.example.com/expiring.jpg",
    );
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "figma-import-1.jpg",
        mimeType: "image/jpeg",
        ownerEmail: "designer@example.com",
      }),
    );
  });

  it("fails instead of silently omitting an unresolved image fill", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: [
                    {
                      id: "1:4",
                      type: "RECTANGLE",
                      absoluteBoundingBox: {
                        x: 0,
                        y: 0,
                        width: 80,
                        height: 60,
                      },
                      fills: [
                        {
                          type: "IMAGE",
                          imageRef: "missing-photo",
                          scaleMode: "FILL",
                        },
                      ],
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/did not return.*required image fill/i);
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("bounds parallel Figma image downloads while mirroring every unique URL", async () => {
    const imageRefs = Array.from({ length: 6 }, (_, index) => `photo-${index}`);
    const imageUrls = Object.fromEntries(
      imageRefs.map((ref) => [
        ref,
        `https://figma-images.example.com/${ref}.png`,
      ]),
    );
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: imageRefs.map((imageRef, index) => ({
                    id: `1:${index + 10}`,
                    type: "RECTANGLE",
                    absoluteBoundingBox: {
                      x: index * 20,
                      y: 0,
                      width: 20,
                      height: 20,
                    },
                    fills: [{ type: "IMAGE", imageRef, scaleMode: "FILL" }],
                  })),
                },
              },
            },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: imageUrls });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    mocks.ssrfSafeFetch.mockImplementation(async () => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDownloads -= 1;
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "content-type": "image/png" },
      });
    });

    await action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any);

    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(6);
    expect(maxActiveDownloads).toBe(4);
    expect(mocks.uploadFile).toHaveBeenCalledTimes(6);
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledTimes(1);
  });

  it("batches fallback render requests to safe node-id query sizes", async () => {
    const fallbackIds = Array.from(
      { length: 51 },
      (_, index) => `2:${index + 1}`,
    );
    const requestedBatches: string[][] = [];
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: fallbackIds.map((id, index) => ({
                    id,
                    type: "VECTOR",
                    absoluteBoundingBox: {
                      x: index,
                      y: 0,
                      width: 1,
                      height: 1,
                    },
                  })),
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          const ids = String(query.ids).split(",");
          requestedBatches.push(ids);
          return jsonEnvelope({
            images: Object.fromEntries(
              ids.map((id) => [id, `https://renders.example.test/${id}.png`]),
            ),
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any);

    expect(
      requestedBatches.map((ids) => ids.length).sort((a, b) => b - a),
    ).toEqual([50, 1]);
    expect(requestedBatches.flat()).toEqual(fallbackIds);
    expect(requestedBatches.every((ids) => ids.join(",").length <= 1_800)).toBe(
      true,
    );
  });

  it("splits fallback render requests when node ids would exceed the query-character budget", async () => {
    const fallbackIds = [`5:${"1".repeat(900)}`, `6:${"2".repeat(900)}`];
    const requestedQueries: string[] = [];
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path, query }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: fallbackIds.map((id, index) => ({
                    id,
                    type: "VECTOR",
                    absoluteBoundingBox: {
                      x: index,
                      y: 0,
                      width: 1,
                      height: 1,
                    },
                  })),
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          const ids = String(query.ids);
          requestedQueries.push(ids);
          return jsonEnvelope({
            images: {
              [ids]: `https://renders.example.test/${requestedQueries.length}.png`,
            },
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );

    await action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any);

    expect(requestedQueries).toEqual(fallbackIds);
    expect(requestedQueries.every((ids) => ids.length <= 1_800)).toBe(true);
  });

  it("rejects an import with more than 256 required image references before requesting render URLs", async () => {
    const fallbackIds = Array.from(
      { length: 257 },
      (_, index) => `3:${index + 1}`,
    );
    mocks.executeProviderApiRequest.mockResolvedValue(
      jsonEnvelope({
        nodes: {
          "1:2": {
            document: {
              ...SIMPLE_FRAME.document,
              children: fallbackIds.map((id, index) => ({
                id,
                type: "VECTOR",
                absoluteBoundingBox: {
                  x: index,
                  y: 0,
                  width: 1,
                  height: 1,
                },
              })),
            },
          },
        },
      }),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/too many images \(257; max 256\)/i);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("enforces a 64 MB aggregate image budget across otherwise-valid assets", async () => {
    const fallbackIds = Array.from(
      { length: 5 },
      (_, index) => `4:${index + 1}`,
    );
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: fallbackIds.map((id, index) => ({
                    id,
                    type: "VECTOR",
                    absoluteBoundingBox: {
                      x: index,
                      y: 0,
                      width: 1,
                      height: 1,
                    },
                  })),
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: Object.fromEntries(
              fallbackIds.map((id) => [
                id,
                `https://renders.example.test/${id}.png`,
              ]),
            ),
          });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    const imageBytes = new Uint8Array(13 * 1024 * 1024);
    imageBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    mocks.ssrfSafeFetch.mockImplementation(
      async () =>
        new Response(imageBytes, {
          headers: { "content-type": "image/png" },
        }),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/64 MB total import limit/i);
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it("fails closed when a Figma render URL is blocked by SSRF protection", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: [
                    {
                      id: "1:3",
                      type: "VECTOR",
                      absoluteBoundingBox: {
                        x: 0,
                        y: 0,
                        width: 24,
                        height: 24,
                      },
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://blocked.example.test/icon.png" },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    mocks.ssrfSafeFetch.mockRejectedValue(
      new Error("SSRF blocked: private address"),
    );

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(/securely fetch.*SSRF blocked/i);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "non-image MIME",
      response: () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
      expected: /unsupported image type/i,
    },
    {
      label: "oversized bytes",
      response: () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: {
            "content-length": String(15 * 1024 * 1024 + 1),
            "content-type": "image/png",
          },
        }),
      expected: /15 MB per-asset limit/i,
    },
    {
      label: "mismatched image bytes",
      response: () =>
        new Response("not really a png", {
          headers: { "content-type": "image/png" },
        }),
      expected: /did not match the advertised image type/i,
    },
  ])(
    "rejects $label before saving imported HTML",
    async ({ response, expected }) => {
      mocks.executeProviderApiRequest.mockImplementation(
        async ({ path }: any) => {
          if (path === "/files/abcDEF12345/nodes") {
            return jsonEnvelope({
              nodes: {
                "1:2": {
                  document: {
                    ...SIMPLE_FRAME.document,
                    children: [
                      {
                        id: "1:3",
                        type: "VECTOR",
                        absoluteBoundingBox: {
                          x: 0,
                          y: 0,
                          width: 24,
                          height: 24,
                        },
                      },
                    ],
                  },
                },
              },
            });
          }
          if (path === "/images/abcDEF12345") {
            return jsonEnvelope({
              images: { "1:3": "https://renders.example.test/icon.png" },
            });
          }
          if (path === "/files/abcDEF12345/images") {
            return jsonEnvelope({ images: {} });
          }
          throw new Error(`Unexpected path ${path}`);
        },
      );
      mocks.ssrfSafeFetch.mockResolvedValue(response());

      await expect(
        action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
      ).rejects.toThrow(expected);
      expect(mocks.uploadFile).not.toHaveBeenCalled();
      expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
    },
  );

  it("fails with setup guidance when durable file storage is unavailable", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({
            nodes: {
              "1:2": {
                document: {
                  ...SIMPLE_FRAME.document,
                  children: [
                    {
                      id: "1:3",
                      type: "VECTOR",
                      absoluteBoundingBox: {
                        x: 0,
                        y: 0,
                        width: 24,
                        height: 24,
                      },
                    },
                  ],
                },
              },
            },
          });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://renders.example.test/icon.png" },
          });
        }
        if (path === "/files/abcDEF12345/images") {
          return jsonEnvelope({ images: {} });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    );
    mocks.uploadFile.mockResolvedValue(null);

    await expect(
      action.run({ fileKey: "abcDEF12345", nodeId: "1:2" } as any),
    ).rejects.toThrow(
      /Connect Builder\.io.*configure S3.*No image bytes were stored in SQL/i,
    );
    expect(mocks.saveImportedDesignFiles).not.toHaveBeenCalled();
  });
});
