import { expect, test, type Page } from "@playwright/test";

/**
 * One editor boot (the dev server's module graph, the design fetch and the first canvas paint) takes
 * ~12-16 s on CI runners, longer than the default expect timeout, and every reload pays it again.
 */
export const EDITOR_BOOT_TIMEOUT = 45_000;

const EDITOR_PATH = /\/(?:design|visual-edit)\/[^/]+\/?$/;
// The editor root renders on every surface, and only once the design has loaded.
const EDITOR_ROOT = "[data-design-editor]";

const returnedUntil = new WeakMap<Page, number>();

export function isEditorUrl(url: string): boolean {
  return EDITOR_PATH.test(new URL(url).pathname);
}

/**
 * Waits until the editor has left its loading skeleton, then gives the running test back the time
 * since `startedAt`, so a test's own timeout measures its own work and not how many boots it needed.
 */
export async function waitForEditorBoot(
  page: Page,
  startedAt = Date.now(),
): Promise<void> {
  await expect(
    page.locator(EDITOR_ROOT),
    `the Design editor at ${page.url()} did not boot`,
  ).toBeVisible({ timeout: EDITOR_BOOT_TIMEOUT });
  const now = Date.now();
  // A helper that navigates through the rails' wrapped navigation waits again; give that time back once.
  const from = Math.max(startedAt, returnedUntil.get(page) ?? 0);
  returnedUntil.set(page, now);
  const testInfo = test.info();
  // A timeout of 0 means the run disabled timeouts; adding to it would enable one.
  if (testInfo.timeout > 0) testInfo.setTimeout(testInfo.timeout + now - from);
}
