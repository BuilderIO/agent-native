import { describe, expect, it, vi } from "vitest";

const createCoreRoutesPlugin = vi.hoisted(() =>
  vi.fn((options: unknown) => options),
);

vi.mock("@agent-native/core/server", () => ({ createCoreRoutesPlugin }));

describe("Mail core routes", () => {
  it("sends an open link for a thread to that thread, not the inbox list", async () => {
    const { default: options } = (await import("./core-routes.js")) as {
      default: {
        resolveOpenPath?: (input: {
          app?: string;
          view?: string;
          params: Record<string, string>;
        }) => string | null | undefined;
      };
    };

    expect(
      options.resolveOpenPath?.({
        app: "mail",
        view: "inbox",
        params: { threadId: "1a1167f0aa08b90a" },
      }),
    ).toBe("/inbox/1a1167f0aa08b90a");
  });
});
