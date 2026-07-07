import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppState: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
    to?: string;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}&to=${encodeURIComponent(args.to ?? "")}`,
}));

import action from "./generate-screens.js";

describe("generate-screens", () => {
  beforeEach(() => {
    mocks.writeAppState.mockReset();
    mocks.assertAccess.mockReset();
  });

  it("creates an overview generation session and returns placed targets", async () => {
    const result = await action.run({
      designId: "design_123",
      prompt: "Add onboarding and empty states",
      screens: [
        { title: "Onboarding", filename: "onboarding.html" },
        { title: "Empty State" },
      ],
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(
      1,
      "design-generation-session:design_123",
      expect.objectContaining({
        designId: "design_123",
        prompt: "Add onboarding and empty states",
        frames: expect.arrayContaining([
          expect.objectContaining({ status: "queued" }),
        ]),
      }),
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(2, "navigate", {
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      path: "/design/design_123?view=overview",
    });
    expect(result).toMatchObject({
      designId: "design_123",
      path: "/design/design_123?view=overview",
      targets: [
        {
          title: "Onboarding",
          filename: "onboarding.html",
          canvasFrame: expect.objectContaining({
            filename: "onboarding.html",
            x: 0,
            y: 0,
          }),
        },
        {
          title: "Empty State",
          filename: "empty-state.html",
          canvasFrame: expect.objectContaining({
            filename: "empty-state.html",
          }),
        },
      ],
    });
  });

  it("deep-links external hosts into overview mode", () => {
    expect(
      action.link?.({
        args: {},
        result: { designId: "design_123" },
      }),
    ).toEqual({
      url: "/_agent-native/open?app=design&view=editor&designId=design_123&to=%2Fdesign%2Fdesign_123%3Fview%3Doverview",
      label: "Open generation session",
      view: "editor",
    });
  });

  it("rejects variant screens without a base screen", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        prompt: "Explore checkout variations",
        screens: [{ title: "Variant A", role: "variant" }],
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        designId: "design_123",
        prompt: "Explore checkout variations",
        screens: [
          { title: "Checkout", role: "screen" },
          { title: "Variant A", role: "variant", variantOf: "Checkout" },
        ],
      }).success,
    ).toBe(true);
  });

  it("dedupes colliding target filenames", async () => {
    const result = await action.run({
      designId: "design_123",
      prompt: "Generate two variations of the same screen",
      screens: [
        { title: "Landing", filename: "landing.html" },
        { title: "Landing alt", filename: "landing.html" },
      ],
    });

    expect(result.targets.map((target) => target.filename)).toEqual([
      "landing.html",
      "landing-2.html",
    ]);
  });

  it("rejects variants anchored to another variant in the same request", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        prompt: "Explore checkout variations",
        screens: [
          { title: "Checkout", role: "screen" },
          { title: "Variant A", role: "variant", variantOf: "Checkout" },
          { title: "Variant B", role: "variant", variantOf: "Variant A" },
        ],
      }).success,
    ).toBe(false);
  });

  // B5-10: AI-generated desktop designs were being placed in mobile-width
  // screens because every screen got the same fixed region regardless of
  // content. deviceType (and explicit width/height) now flow end-to-end from
  // the requested screen into the returned canvasFrame.
  describe("device-aware canvas region sizing (B5-10)", () => {
    it("defaults an untyped screen to a desktop-sized region", async () => {
      const result = await action.run({
        designId: "design_123",
        prompt: "Build a dashboard",
        screens: [{ title: "Dashboard" }],
      });

      expect(result.targets[0]!.canvasFrame).toMatchObject({
        width: 1440,
        height: 1024,
      });
    });

    it("sizes a deviceType: 'mobile' screen to a phone-width region", async () => {
      const result = await action.run({
        designId: "design_123",
        prompt: "Build a mobile onboarding flow",
        screens: [{ title: "Onboarding", deviceType: "mobile" }],
      });

      expect(result.targets[0]!.canvasFrame).toMatchObject({
        width: 390,
        height: 844,
      });
    });

    it("sizes a deviceType: 'tablet' screen to a tablet-width region", async () => {
      const result = await action.run({
        designId: "design_123",
        prompt: "Build a tablet layout",
        screens: [{ title: "Tablet view", deviceType: "tablet" }],
      });

      expect(result.targets[0]!.canvasFrame).toMatchObject({
        width: 768,
        height: 1024,
      });
    });

    it("honors explicit width/height over deviceType", async () => {
      const result = await action.run({
        designId: "design_123",
        prompt: "Build a custom-width screen",
        screens: [
          { title: "Custom", deviceType: "mobile", width: 500, height: 900 },
        ],
      });

      expect(result.targets[0]!.canvasFrame).toMatchObject({
        width: 500,
        height: 900,
      });
    });

    it("sizes each screen in a mixed batch independently, not uniformly", async () => {
      const result = await action.run({
        designId: "design_123",
        prompt: "Build a responsive flow",
        screens: [
          { title: "Phone home", deviceType: "mobile" },
          { title: "Desktop dashboard", deviceType: "desktop" },
          { title: "Tablet detail", deviceType: "tablet" },
        ],
      });

      expect(result.targets[0]!.canvasFrame).toMatchObject({ width: 390 });
      expect(result.targets[1]!.canvasFrame).toMatchObject({ width: 1440 });
      expect(result.targets[2]!.canvasFrame).toMatchObject({ width: 768 });

      // Non-overlapping: each screen still gets a distinct x/y placement.
      const positions = result.targets.map((target) => ({
        x: target.canvasFrame!.x,
        y: target.canvasFrame!.y,
      }));
      const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
      expect(unique.size).toBe(3);
    });
  });
});
