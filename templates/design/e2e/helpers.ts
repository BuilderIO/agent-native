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

const DESIGN_PREVIEW_IFRAME_SELECTOR = "iframe[data-design-preview-iframe]";
const E2E_BASE_URL = process.env.E2E_BASE_URL;
const E2E_BASE_PATH = (() => {
  if (!E2E_BASE_URL) return "";
  try {
    return new URL(E2E_BASE_URL).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
})();

export function appPath(path: string): string {
  const route = new URL(path, "http://agent-native.local");
  if (E2E_BASE_URL && E2E_BASE_PATH) {
    const url = new URL(E2E_BASE_URL);
    // dev-lazy strips the app mount (/design) before handing the request to the
    // app, so the editor's own /design/:id route intentionally becomes
    // /design/design/:id when E2E_BASE_URL points at the gateway mount.
    url.pathname = `${E2E_BASE_PATH}${route.pathname}`;
    url.search = route.search;
    url.hash = route.hash;
    return url.toString();
  }
  return `${route.pathname}${route.search}${route.hash}`;
}

export function designFrame(page: Page): FrameLocator {
  return page.locator(DESIGN_PREVIEW_IFRAME_SELECTOR).first().contentFrame();
}

/** Open the editor for a design and wait for the toolbar + iframe to be ready. */
export async function gotoEditor(page: Page, designId: string): Promise<void> {
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await waitForDesignBridgeReady(page);
}

async function waitForDesignBridgeReady(page: Page): Promise<void> {
  await expect(
    page.locator(DESIGN_PREVIEW_IFRAME_SELECTOR).first(),
  ).toBeVisible();
  await expect(
    designFrame(page).locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeVisible({ timeout: 10_000 });
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

export async function enterDirectMode(page: Page): Promise<void> {
  const fullView = page.getByRole("button", { name: "Full view", exact: true });
  const fullViewVisible = await fullView
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (fullViewVisible) {
    await fullView.first().click();
    await expect(fullView).toHaveCount(0);
  }
  await expect
    .poll(
      async () =>
        (
          await page
            .locator(DESIGN_PREVIEW_IFRAME_SELECTOR)
            .first()
            .boundingBox()
        )?.width ?? 0,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(600);
  await waitForDesignBridgeReady(page);
}

/** Start capturing bridge postMessages on the parent window. */
export async function installBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    if (!Array.isArray(win.__bridge)) win.__bridge = [];
    if (win.__bridgeInstalled) return;
    win.__bridgeInstalled = true;
    window.addEventListener("message", (e: MessageEvent) => {
      const t = (e.data as any)?.type;
      if (
        typeof t === "string" &&
        (/^(element-|visual-)/.test(t) || t === "text-content-change")
      ) {
        if (!Array.isArray(win.__bridge)) win.__bridge = [];
        win.__bridge.push(e.data);
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
      [...((window as any).__bridge ?? [])]
        .reverse()
        .find((m: any) => m.type === t) ?? null,
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
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const target = designFrame(page).getByText(text, { exact: false }).first();
  await target.waitFor({ state: "visible", timeout: 8_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for "${text}"`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let sel: any;
  try {
    sel = await waitForBridge(page, "element-select", 2_000);
  } catch {
    await page.evaluate(() => ((window as any).__bridge = []));
    await dispatchShieldClickByText(page, text);
    sel = await waitForBridge(page, "element-select");
  }
  const payload = sel?.payload ?? sel;
  expect(String(payload?.textContent ?? "")).toContain(text);
  return payload;
}

async function dispatchShieldClickByText(
  page: Page,
  text: string,
): Promise<void> {
  await designFrame(page)
    .locator("body")
    .evaluate((_, targetText) => {
      const normalizeText = (element: HTMLElement) =>
        (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          styles.display !== "none" &&
          styles.visibility !== "hidden"
        );
      };
      const shield = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="shield"]',
      );
      const leafCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "h1, h2, h3, h4, h5, h6, p, button, a, label, span, input, textarea",
        ),
      ).filter(isVisible);
      const nodeCandidates = Array.from(
        document.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
      ).filter(isVisible);
      const target =
        nodeCandidates.find(
          (element) => normalizeText(element) === targetText,
        ) ??
        leafCandidates.find(
          (element) => normalizeText(element) === targetText,
        ) ??
        nodeCandidates.find((element) =>
          normalizeText(element).includes(targetText),
        ) ??
        leafCandidates.find((element) =>
          normalizeText(element).includes(targetText),
        );
      if (!shield || !target) {
        throw new Error(`unable to dispatch selection for "${targetText}"`);
      }
      const rect = target.getBoundingClientRect();
      shield.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          detail: 1,
        }),
      );
    }, text);
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
