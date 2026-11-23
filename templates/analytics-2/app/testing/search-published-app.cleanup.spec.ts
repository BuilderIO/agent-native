import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchUiAction: vi.fn(),
}));
vi.mock("@playwright/test", () => ({
  expect: () => ({
    toBe: vi.fn(),
    toBeVisible: vi.fn(),
    toHaveAttribute: vi.fn(),
  }),
}));
vi.mock("../../e2e/publish-project.js", () => ({ publishProject: vi.fn() }));
vi.mock("../../e2e/ui-capability.js", () => ({
  fetchUiAction: mocks.fetchUiAction,
}));

import { checkPublishedAppSearch } from "../../e2e/search-published-app.js";

it("report A2-LOCAL-PUBLISHED-POPUP-LEAK-1121: cleans up the fixture in the same tab without opening a popup when the click fails", async () => {
  const order: string[] = [];
  mocks.fetchUiAction.mockImplementation(async () => {
    order.push("delete");
    return { ok: (): boolean => true };
  });
  let clickFailed = false;
  const locator = {
    getByRole: () => locator,
    filter: () => locator,
    fill: vi.fn(),
    click: vi.fn(async () => {
      clickFailed = true;
      throw new Error("click failed");
    }),
  };
  const page = {
    request: {
      post: vi.fn(async (url: string) => {
        if (url.endsWith("create-project"))
          return {
            ok: (): boolean => true,
            json: async () => ({ id: "fixture" }),
          };
        order.push("trash");
        return { ok: (): boolean => true };
      }),
      get: vi.fn(async () => {
        order.push("readback");
        return { status: () => 404 };
      }),
    },
    goto: vi.fn(async () => {
      if (clickFailed) order.push("home");
    }),
    on: vi.fn(),
    off: vi.fn(),
    waitForEvent: vi.fn(),
    getByRole: (_role: string, options: { name?: string }) =>
      options.name === "Search" ? { click: vi.fn() } : locator,
  };
  await expect(
    checkPublishedAppSearch(page as unknown as Page, "http://localhost"),
  ).rejects.toThrow("click failed");
  expect(page.on).not.toHaveBeenCalled();
  expect(page.waitForEvent).not.toHaveBeenCalled();
  expect(order).toEqual(["home", "trash", "delete", "readback"]);
});
