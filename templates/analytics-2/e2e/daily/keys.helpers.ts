import { errors, expect, type Locator, type Page } from "@playwright/test";

import { required } from "../local/required";
import type { Daily } from "./fixtures";

export const MOD = "ControlOrMeta";

/** A reaction the reference shows within 400 ms; an absent shortcut must fail fast, not wait the default. */
export const FAST = { timeout: 400 };

export const searchDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Search your workspace" });
export const searchInput = (page: Page) =>
  searchDialog(page).getByRole("textbox", { name: "Search your workspace" });

/** The Home prompt (rich-text composer). */
export const homePrompt = (page: Page) =>
  page.locator('main [contenteditable="true"], main textarea').first();

/** Home with model setup settled and focus on a non-editable workspace control. */
export async function openHome(daily: Daily) {
  await daily.open("/home");
  await expect(
    daily.page.getByText("JUMP BACK IN", { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    daily.page
      .locator(
        '[data-agent-composer-slot="area"][data-agent-composer-variant="hero"]',
      )
      .getByText("Sonnet 5.5"),
  ).toBeVisible({ timeout: 30_000 });
  await daily.page.getByRole("button", { name: "Search", exact: true }).focus();
}

export async function blurToBody(page: Page) {
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
}

/** Notebook view of a project, rendered (cells or the empty state). */
export async function openProjectView(
  daily: Daily,
  id: string,
  cells: number,
  view: "" | "/app" = "",
) {
  await daily.open(`/project/${id}/latest${view}`);
  if (cells > 0)
    await expect(daily.page.locator("[data-notebook-cell]")).toHaveCount(
      cells,
      { timeout: 30_000 },
    );
  else
    await expect(
      daily.page.getByRole("button", { name: "Notebook", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
}

/** Wait for (and return) the next request to an app action, or false when none fires within the window. */
export function nextAction(page: Page, name: string, timeout = 2_000) {
  return page
    .waitForRequest((r) => r.url().includes(`/_agent-native/actions/${name}`), {
      timeout,
    })
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof errors.TimeoutError) return false;
      throw error;
    });
}

/** Project id from a `/project/<id>/...` URL. */
export function projectIdFromUrl(url: string): string | null {
  return /\/project\/([^/?#]+)/.exec(url)?.[1] ?? null;
}

export async function trashProject(daily: Daily, id: string | null) {
  if (id) await daily.cleanupProject(id);
}

type KeyRecord = { key: string; t: number; fb: number | null };

/**
 * Press a shortcut, assert the outcome the reference shows (fast), then require the first visible
 * change after the key's keydown to have landed within 400 ms. The outcome is asserted first so an
 * absent shortcut fails on what it should have done, not on a timing number.
 */
export async function pressFor(
  daily: Daily,
  key: string,
  outcome: () => Promise<unknown>,
) {
  daily.steps.push(`press ${key}`);
  await daily.page.keyboard.press(key);
  const index = await daily.page.evaluate(
    () =>
      (window as unknown as { __daily: { keys: KeyRecord[] } }).__daily.keys
        .length - 1,
  );
  await outcome();
  const fb = await daily.page.evaluate(
    (i) =>
      (window as unknown as { __daily: { keys: KeyRecord[] } }).__daily.keys[i]
        ?.fb ?? null,
    index,
  );
  expect(
    fb,
    `visible feedback for "${key}" (${daily.steps.join(" → ")})`,
  ).not.toBeNull();
  expect(
    required(fb),
    `visible feedback for "${key}" took ${Math.round(fb ?? 0)} ms`,
  ).toBeLessThanOrEqual(400);
}

export function focused(locator: Locator) {
  return expect(locator).toBeFocused(FAST);
}
