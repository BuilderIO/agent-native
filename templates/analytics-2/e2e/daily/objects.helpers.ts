import type { Locator, Page } from "@playwright/test";

import { required } from "../local/required";
import { publishFixture } from "../publish-fixture";
import { expect, type Daily } from "./fixtures";

export async function openProject(
  daily: Daily,
  id: string,
  view: "" | "/app" = "",
) {
  await daily.open(`/project/${id}/latest${view}`);
  await expect(daily.page.locator(".nb-project-title")).toBeVisible({
    timeout: 30_000,
  });
}

export function headerTitle(page: Page): Locator {
  return page.locator(".nb-project-title, .nb-project-title-input").first();
}

/** The list row (Projects, Archive, Trash) whose title link contains `title`. */
export function listRow(page: Page, title: string): Locator {
  const more = page.getByRole("button", { name: "View more actions" });
  return page
    .locator("div,tr,li")
    .filter({ has: page.locator("a", { hasText: title }) })
    .filter({ has: more })
    .last();
}

export async function openListRowMenu(page: Page, title: string) {
  const row = listRow(page, title);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  await row.getByRole("button", { name: "View more actions" }).click();
}

export async function listPage(
  daily: Daily,
  path: "/home/all" | "/home/archive" | "/home/trash",
  title: string,
) {
  await daily.open(path);
  await expect(listRow(daily.page, title)).toBeVisible({ timeout: 30_000 });
}

/** Project options menu (header chevron). */
export async function openProjectMenu(daily: Daily) {
  await daily.page.getByRole("button", { name: "Project options" }).click();
  await expect(daily.menu()).toBeVisible();
}

export async function grantClipboard(daily: Daily) {
  await daily.context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: daily.server.base,
  });
}

export async function createCollection(
  daily: Daily,
  name: string,
): Promise<{ id: string; name: string }> {
  const result = await daily.action<{ collection: { id: string } }>(
    "create-collection",
    { name },
  );
  return { id: result.collection.id, name };
}

export async function publish(
  daily: Daily,
  projectId: string,
  versionName?: string,
) {
  return publishFixture(daily.action.bind(daily), projectId, versionName);
}

export const MOD = "ControlOrMeta";

/** A reaction the reference shows at once; an absent control must fail fast, not wait the default. */
export const FAST = { timeout: 400 };

export const searchDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Search your workspace" });
export const searchInput = (page: Page) =>
  searchDialog(page).getByRole("textbox", { name: "Search your workspace" });

/** Home, rendered, with focus on the page body. */
export async function openHome(daily: Daily) {
  await daily.open("/home");
  await expect(
    daily.page.getByText("JUMP BACK IN", { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await daily.page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
}

/** A thread with one answered question, started from the Home prompt; returns its id. */
export async function seedThread(
  daily: Daily,
  question = "How many orders are there?",
): Promise<string> {
  await openHome(daily);
  const prompt = daily.page
    .locator('main [contenteditable="true"], main textarea')
    .first();
  await prompt.click();
  await daily.page.keyboard.type(question);
  await daily.page.getByRole("button", { name: "Send message" }).click();
  await expect(daily.page).toHaveURL(/\/thread\/[^/]+$/, { timeout: 30_000 });
  await expect(
    daily.page.getByRole("button", { name: "Copy message" }).nth(1),
  ).toBeVisible({ timeout: 30_000 });
  return required(required(/\/thread\/([^/?#]+)/.exec(daily.page.url()))[1]);
}

/** Fresh project through the action, with the given cell kinds appended. */
export async function seedProject(
  daily: Daily,
  title: string,
  kinds: string[] = [],
): Promise<{ id: string; title: string }> {
  const { id } = await daily.createProject(title);
  for (const kind of kinds)
    await daily.action("add-project-cell", { projectId: id, kind });
  return { id, title };
}

export const projectUrl = (id: string, view: "" | "/app" = "") =>
  new RegExp(`/project/${id}/latest${view}$`);

export function searchResponse(daily: Daily, query: string) {
  return daily.page.waitForResponse((response) => {
    if (!response.url().includes("/_agent-native/actions/search-workspace"))
      return false;
    const url = new URL(response.url());
    const data = response.request().postDataJSON();
    return url.searchParams.get("text") === query || data?.text === query;
  });
}
