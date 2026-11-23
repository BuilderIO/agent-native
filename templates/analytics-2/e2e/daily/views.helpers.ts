import type { Locator, Page, Route } from "@playwright/test";

import { expect, type Daily } from "./fixtures";

/** First paint of a route on the shared dev server can be slow under load; later reactions use the defaults. */
export const LOAD = { timeout: 45_000 };
/** A reaction the reference shows at once: an expected-fail must fail fast, not wait the default. */
export const FAST = { timeout: 400 };

export const sidebar = (page: Page) =>
  page.getByRole("complementary", { name: "Workspace" });
export const overlays = (page: Page) =>
  page.locator(
    "[role=dialog]:visible, [role=menu]:visible, [role=listbox]:visible",
  );

/** Open Home and wait until its recents card has rendered. */
export async function openHome(daily: Daily) {
  await daily.open("/home");
  await expect(
    daily.page.getByRole("tablist", { name: "Jump back in" }),
  ).toBeVisible(LOAD);
}

/** Open the settings shell and wait for its nav. */
export async function openSettings(daily: Daily, path = "/settings") {
  await daily.open(path);
  await expect(
    daily.page.getByText("Profile", { exact: true }).first(),
  ).toBeVisible(LOAD);
}

/** Open a project and wait for its header. */
export async function openProjectView(
  daily: Daily,
  id: string,
  view: "" | "/app" = "",
) {
  await daily.open(`/project/${id}/latest${view}`);
  await expect(
    daily.page.getByRole("navigation", { name: "Project views" }),
  ).toBeVisible(LOAD);
  await expect(daily.page.locator(".nb-project-title")).toBeVisible(LOAD);
}

/** No dialog, menu or listbox left on screen. */
export async function expectNoOverlay(page: Page) {
  await expect(overlays(page)).toHaveCount(0, FAST);
}

/**
 * A failed load the test provokes on purpose (a deep link to a missing object, a failed read):
 * the response and Chromium's console mirror of it ("Failed to load resource") are expected.
 * Every other console error still fails the step.
 */
export function expectFailedLoad(daily: Daily, url: RegExp) {
  daily.allowResponse.push(url);
}

/** Rewrite one action's JSON result for this page (a state the shared server cannot be put into safely). */
export async function patchAction(
  page: Page,
  name: string,
  patch: (body: Record<string, unknown>) => void,
) {
  await page.route(
    new RegExp(`/_agent-native/actions/${name}(\\?|$)`),
    async (route: Route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      patch(body);
      await route.fulfill({ response, json: body });
    },
  );
}

/** Make one action fail with a 500 for this page. */
export async function failAction(daily: Daily, name: string) {
  const url = new RegExp(`/_agent-native/actions/${name}(\\?|$)`);
  daily.allowResponse.push(url);
  await daily.page.route(url, (route) =>
    route.fulfill({ status: 500, json: { error: "daily: forced failure" } }),
  );
}

/** Names of the visible items of the open menu. */
export async function menuItems(menu: Locator): Promise<string[]> {
  return (await menu.getByRole("menuitem").allInnerTexts()).map((t) =>
    t.trim(),
  );
}

/** A thread created through the agent-chat surface, for deep-link tests. */
export async function createThread(daily: Daily): Promise<string> {
  const result = await daily.action<{ id: string }>("create-thread", {});
  expect(
    result.id,
    `create-thread returned ${JSON.stringify(result).slice(0, 300)}`,
  ).toBeTruthy();
  return result.id;
}
