import { designScreenCaptureSchema } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCaptureDesign: vi.fn(),
  loadCaptureScreens: vi.fn(),
  loadStatusScreens: vi.fn(),
  renderScreenPng: vi.fn(),
  openCommentCount: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("../server/lib/screen-capture.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/screen-capture.js")>();
  return {
    ...actual,
    loadCaptureDesign: mocks.loadCaptureDesign,
    loadCaptureScreens: mocks.loadCaptureScreens,
    loadStatusScreens: mocks.loadStatusScreens,
    renderScreenPng: mocks.renderScreenPng,
    openCommentCount: mocks.openCommentCount,
    captureLinks: (designId: string, screenId: string) => ({
      designUrl: `https://design.example.test/design/${designId}`,
      screenUrl: `https://design.example.test/design/${designId}?screen=${screenId}`,
    }),
  };
});

import captureDesignScreen from "./capture-design-screen";
import getDesignScreenStatus from "./get-design-screen-status";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const a2a = { caller: "a2a" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCaptureDesign.mockResolvedValue({
    id: "d1",
    title: "Checkout",
    visibility: "org",
    data: { screenMetadata: { s1: { width: 390 } } },
  });
  mocks.loadCaptureScreens.mockResolvedValue(
    new Map([["s1", { id: "s1", filename: "Cart.html", content: "<main/>" }]]),
  );
  mocks.loadStatusScreens.mockResolvedValue(
    new Map([["s1", { id: "s1", filename: "Cart.html", content: "<main/>" }]]),
  );
  mocks.renderScreenPng.mockResolvedValue(png(780, 1688));
  mocks.openCommentCount.mockResolvedValue(3);
});

describe("capture-design-screen", () => {
  it("hands another app the screen's picture and what it keeps with it", async () => {
    const result = await captureDesignScreen.run(
      { designId: "d1", screenId: "s1" },
      a2a,
    );
    expect(designScreenCaptureSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      design: { id: "d1", title: "Checkout", visibility: "org" },
      screen: {
        id: "s1",
        name: "Cart",
        width: 390,
        url: "https://design.example.test/design/d1?screen=s1",
      },
      openComments: 3,
      image: { mimeType: "image/png", width: 780, height: 1688 },
    });
    expect(Buffer.from(result.image.data, "base64")).toEqual(png(780, 1688));
    expect(mocks.renderScreenPng).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      390,
      undefined,
    );
  });

  it("renders at the width asked for", async () => {
    await captureDesignScreen.run(
      { designId: "d1", screenId: "s1", width: 1440 },
      a2a,
    );
    expect(mocks.renderScreenPng).toHaveBeenCalledWith(
      expect.anything(),
      1440,
      undefined,
    );
  });

  it("says who can open the design once the picture is taken, not before", async () => {
    mocks.loadCaptureDesign.mockResolvedValueOnce({
      id: "d1",
      title: "Checkout",
      visibility: "public",
      data: {},
    });
    const result = await captureDesignScreen.run(
      { designId: "d1", screenId: "s1" },
      a2a,
    );
    expect(mocks.loadCaptureDesign).toHaveBeenCalledTimes(2);
    expect(result.design.visibility).toBe("org");
    expect(mocks.track).toHaveBeenCalledWith(
      "design_screen_captured",
      expect.objectContaining({ design_visibility: "org" }),
      a2a,
    );
  });

  it("answers only other apps", async () => {
    for (const caller of ["tool", "mcp", "frontend", "http"]) {
      await expect(
        captureDesignScreen.run({ designId: "d1", screenId: "s1" }, {
          caller,
        } as never),
      ).rejects.toMatchObject({ errorCode: "design_screen_capture_app_only" });
    }
    expect(mocks.loadCaptureDesign).not.toHaveBeenCalled();
  });

  it("refuses a screen that isn't in the design", async () => {
    mocks.loadCaptureScreens.mockResolvedValue(new Map());
    await expect(
      captureDesignScreen.run({ designId: "d1", screenId: "gone" }, a2a),
    ).rejects.toMatchObject({ errorCode: "design_screen_not_found" });
    expect(mocks.renderScreenPng).not.toHaveBeenCalled();
  });

  it("is a read-only action other apps can call", () => {
    expect(captureDesignScreen.readOnly).toBe(true);
    expect(captureDesignScreen.agentTool).toBe(false);
    expect(captureDesignScreen.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
    expect(captureDesignScreen.maxResultChars).toBeGreaterThan(
      Math.ceil((8 * 1024 * 1024) / 3) * 4,
    );
  });
});

describe("get-design-screen-status", () => {
  it("reports each screen's fingerprint and open comments", async () => {
    const result = await getDesignScreenStatus.run(
      { designId: "d1", screenIds: ["s1", "gone", "s1"] },
      a2a,
    );
    expect(result.design).toEqual({
      id: "d1",
      title: "Checkout",
      visibility: "org",
    });
    expect(result.screens).toEqual([
      {
        id: "s1",
        fingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        openComments: 3,
      },
      { id: "gone", fingerprint: null, openComments: 0 },
    ]);
  });

  it("leaves out a screen whose source can't be read, and reports the rest", async () => {
    mocks.loadStatusScreens.mockResolvedValue(
      new Map([
        ["s1", { id: "s1", filename: "Cart.html", content: "<main/>" }],
        ["s2", null],
      ]),
    );
    const result = await getDesignScreenStatus.run(
      { designId: "d1", screenIds: ["s1", "s2", "gone"] },
      a2a,
    );
    expect(result.screens.map((screen) => screen.id)).toEqual(["s1", "gone"]);
  });

  it("answers only other apps", async () => {
    for (const caller of ["tool", "mcp", "frontend", "http"]) {
      await expect(
        getDesignScreenStatus.run({ designId: "d1", screenIds: ["s1"] }, {
          caller,
        } as never),
      ).rejects.toMatchObject({ errorCode: "design_screen_capture_app_only" });
    }
    expect(mocks.loadCaptureDesign).not.toHaveBeenCalled();
  });
});
