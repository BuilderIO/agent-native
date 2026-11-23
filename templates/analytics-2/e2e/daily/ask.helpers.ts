import type { Locator, Page } from "@playwright/test";

import { expect, type Daily } from "./fixtures";

/** The Home prompt card and its editor. */
export function heroArea(page: Page): Locator {
  return page.locator(
    '[data-agent-composer-slot="area"][data-agent-composer-variant="hero"]',
  );
}
export function heroEditor(page: Page): Locator {
  return page.locator(
    '[data-agent-composer-variant="hero"][data-agent-composer-slot="editor-input"]',
  );
}
/** The composer on a thread page (the only one there). */
export function threadEditor(page: Page): Locator {
  return page
    .locator(
      '[data-agent-composer-slot="editor-input"][contenteditable="true"]',
    )
    .last();
}
/** The placeholder the empty editor paints. */
export function placeholderOf(editor: Locator): Locator {
  return editor.locator("[data-placeholder]").first();
}

export const THREAD_URL = /\/thread\/[0-9a-f-]{36}$/;

export async function waitForSendReady(page: Page) {
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
}

/** Home with the prompt card settled (its model control has resolved the engine default). */
export async function openHomeReady(daily: Daily) {
  await daily.open("/home");
  await expect(heroArea(daily.page).getByText("Sonnet 5.5")).toBeVisible({
    timeout: 30_000,
  });
  await expect(heroEditor(daily.page)).toBeVisible();
}

/** Records, in the page, whether `text` was ever on screen from now on. */
export async function watchForText(page: Page, text: string) {
  await page.evaluate((needle) => {
    const w = window as unknown as { __seen?: Record<string, boolean> };
    const seen = (w.__seen ??= {});
    seen[needle] = false;
    const look = () => {
      if (document.body.innerText.includes(needle)) seen[needle] = true;
    };
    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    look();
  }, text);
  return async () =>
    page.evaluate(
      (needle) =>
        (window as unknown as { __seen: Record<string, boolean> }).__seen[
          needle
        ],
      text,
    );
}

/** Ask from Home and wait for the thread page. Returns the thread path. */
export async function askFromHome(
  daily: Daily,
  question: string,
): Promise<string> {
  await openHomeReady(daily);
  await heroEditor(daily.page).focus();
  await daily.type(question);
  await waitForSendReady(daily.page);
  await daily.press("Enter");
  await expect(daily.page).toHaveURL(THREAD_URL, { timeout: 20_000 });
  return new URL(daily.page.url()).pathname;
}

let chartThreadPath: string | null = null;

/** A thread whose answer is the scripted bar chart; asked once per worker. */
export async function chartThread(daily: Daily): Promise<string> {
  if (chartThreadPath) {
    await daily.open(chartThreadPath);
  } else {
    chartThreadPath = await askFromHome(daily, "[chart] revenue by month");
  }
  await expect(chartFigure(daily.page)).toBeVisible({ timeout: 30_000 });
  return chartThreadPath;
}

export const CHART_TITLE = "Revenue by month";

/** The inline chart the scripted answer renders. */
export function chartFigure(page: Page): Locator {
  return page.locator("svg").filter({ hasText: "Apr" }).first();
}
