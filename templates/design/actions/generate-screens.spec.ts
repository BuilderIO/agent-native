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
});
