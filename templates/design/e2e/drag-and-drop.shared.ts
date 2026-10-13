import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designFrame, expandAllLayers } from "./helpers";

export const PAGE_W = 1440;
export const PAGE_H = 900;
export const MOD = process.platform === "darwin" ? "Meta" : "Control";
export const ALT = "Alt";

export const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>DnD</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="frame-a" data-agent-native-layer-name="Container"
         style="position:absolute;left:20px;top:60px;width:280px;height:160px;background:#1f2937"></div>
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
         style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
         style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="position:absolute;left:20px;top:600px;width:280px;display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="chip-1" data-agent-native-layer-name="Chip 1"
           style="width:80px;height:50px;background:#a855f7"></div>
      <div data-agent-native-node-id="chip-2" data-agent-native-layer-name="Chip 2"
           style="width:80px;height:50px;background:#ec4899"></div>
      <div data-agent-native-node-id="chip-3" data-agent-native-layer-name="Chip 3"
           style="width:80px;height:50px;background:#f59e0b"></div>
    </div>
  </body>
</html>`;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

let baseURL = "";

export function setBaseURL(testInfo: TestInfo): void {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
}

export async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

export async function newDesign(
  page: Page,
  content = FIXTURE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "drag and drop",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  try {
    await postAction(page, "create-file", {
      designId: id,
      filename: "index.html",
      content,
      fileType: "html",
    });
  } catch (error) {
    await postAction(page, "delete-design", { id });
    throw error;
  }
  return id;
}

export async function indexHtml(page: Page, designId: string): Promise<string> {
  const result = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  return (
    (result.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

export function styleOf(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

export function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
}

export async function geom(page: Page, designId: string, id: string) {
  const s = styleOf(await indexHtml(page, designId), id);
  return {
    left: styleNum(s, "left"),
    top: styleNum(s, "top"),
    width: styleNum(s, "width"),
    height: styleNum(s, "height"),
    style: s,
  };
}

export function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

export function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

export function layerRow(page: Page, name: string): Locator {
  return layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

export function node(page: Page, id: string): Locator {
  return (
    page
      // A live board surface is mounted ahead of screen iframes during a
      // cross-screen drag. Keep this helper bound to authored screen content;
      // board documents intentionally omit data-screen-iframe-id.
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame()
      .locator(`[data-agent-native-node-id="${id}"]`)
  );
}

export async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await toolbar(page)
    .locator('button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  await expandAllLayers(page);
  await page.waitForTimeout(500);
}

export async function scale(page: Page): Promise<number> {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
  const inner = await page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => document.documentElement.clientWidth);
  return card.width / inner;
}

export async function chromeBounds(page: Page, screenId?: string) {
  return designFrame(page, screenId)
    .locator("body")
    .evaluate(() => {
      const el = document.querySelector(
        '[data-agent-native-edit-overlay="selection"]',
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    });
}

export async function activeOverlays(
  page: Page,
  screenId?: string,
): Promise<string[]> {
  return designFrame(page, screenId)
    .locator("body")
    .evaluate(() =>
      Array.from(document.querySelectorAll("[data-agent-native-edit-overlay]"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        })
        .map((el) => el.getAttribute("data-agent-native-edit-overlay") ?? ""),
    );
}

export async function selectViaTree(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click();
  await expect
    .poll(() => chromeBounds(page), { timeout: 15_000 })
    .not.toBeNull();
}

export async function dragBy(
  page: Page,
  from: Box,
  dxPage: number,
  dyPage: number,
  options?: { modifier?: string; cancel?: boolean; settle?: boolean },
): Promise<void> {
  const s = await scale(page);
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  if (options?.modifier) await page.keyboard.down(options.modifier);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dxPage * s, cy + dyPage * s, { steps: 16 });
  await page.waitForTimeout(350);
  if (options?.cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  if (options?.modifier) await page.keyboard.up(options.modifier);
  if (options?.settle !== false) {
    await page.waitForTimeout(2000); // e2e-harness-ignore negative assertions need a real settle
  }
}
