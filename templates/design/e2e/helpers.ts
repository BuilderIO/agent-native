import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, type FrameLocator } from "@playwright/test";

/**
 * Helpers for driving the Design visual editor in real Chrome.
 *
 * Hard-won facts for this editor:
 *  - The design renders inside an iframe, so tests should use a frame locator
 *    (`page.frameLocator('iframe')`) instead of parent-page CSS selectors.
 *  - A pointer-capturing shield `<div data-agent-native-edit-overlay="shield">`
 *    sits on top inside the iframe, so clicks need `{ force: true }`.
 *  - Selection/edits are reported to the parent via postMessage
 *    (`element-select`, `element-hover`, `visual-style-change`,
 *    `visual-structure-change`). Assert on those + the parent inspector DOM.
 *  - `page.screenshot()` HANGS (the page never idles). Use `cdpScreenshot()`.
 */

export async function readSeedDesignId(): Promise<string> {
  const seedPath = path.join(import.meta.dirname, ".auth", "seed.json");
  const raw = await readFile(seedPath, "utf8");
  const { designId } = JSON.parse(raw) as { designId: string };
  if (!designId) throw new Error("no seeded designId - global-setup failed");
  return designId;
}

export function designFrame(page: Page): FrameLocator {
  return page.frameLocator("iframe");
}

/** Open the editor for a design and wait for the toolbar + iframe to be ready. */
export async function gotoEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("iframe").first()).toBeVisible();
  // Wait for the iframe bridge to stamp at least one selectable node.
  await expect
    .poll(
      async () =>
        designFrame(page)
          .locator("[data-agent-native-node-id], h1, h2, p, button")
          .count(),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

/** Start capturing bridge postMessages on the parent window. */
export async function installBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__bridge = [];
    window.addEventListener("message", (e: MessageEvent) => {
      const t = (e.data as any)?.type;
      if (typeof t === "string" && /^(element-|visual-)/.test(t)) {
        (window as any).__bridge.push(e.data);
      }
    });
  });
}

export async function bridgeMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__bridge ?? []);
}

/** Wait until a bridge message of `type` arrives, returning its payload. */
export async function waitForBridge(
  page: Page,
  type: string,
  timeout = 8_000,
): Promise<any> {
  const handle = await page.waitForFunction(
    (t) =>
      ((window as any).__bridge ?? []).find((m: any) => m.type === t) ?? null,
    type,
    { timeout },
  );
  return handle.jsonValue();
}

/**
 * Click an element inside the design iframe by its visible text and return the
 * resulting `element-select` payload. Uses force:true to punch through the
 * shield overlay (which is what actually drives selection).
 */
export async function selectByText(page: Page, text: string): Promise<any> {
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  await designFrame(page)
    .getByText(text, { exact: false })
    .first()
    .click({ force: true, timeout: 8_000 });
  const sel = await waitForBridge(page, "element-select");
  return sel?.payload ?? sel;
}

/** Number of inputs in the right-hand inspector (proxy for "inspector populated"). */
export async function inspectorInputCount(page: Page): Promise<number> {
  return page.locator("input").count();
}

/**
 * Drag an element inside the iframe by `(dx, dy)` parent-page pixels using real
 * pointer events (the canvas bridge handles mousedown/mousemove/mouseup).
 * Selects it first so the move/reorder interaction is armed.
 */
export async function dragCanvasByText(
  page: Page,
  text: string,
  dx: number,
  dy: number,
): Promise<string[]> {
  await selectByText(page, text);
  await page.evaluate(() => ((window as any).__bridge = []));
  const box = await designFrame(page)
    .getByText(text, { exact: false })
    .first()
    .boundingBox();
  if (!box) throw new Error(`no bounding box for "${text}"`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const msgs = await bridgeMessages(page);
  return [...new Set(msgs.map((m) => m.type))];
}

/** Screenshot via CDP; bypasses Playwright's stability wait, which never settles. */
export async function cdpScreenshot(
  page: Page,
  filePath: string,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, Buffer.from(data, "base64"));
}
