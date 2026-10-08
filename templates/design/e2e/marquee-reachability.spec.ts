import { expect, test, type Locator, type Page } from "@playwright/test";

import { EDGE_HANDLE_HIT_INWARD_PX } from "../app/components/design/multi-screen/handle-hit-zones";
import { canvasZoom, expandAllLayers } from "./helpers";

const PAGE_H = 820;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Marquee reachability</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <div data-agent-native-node-id="wrapper" data-agent-native-layer-name="Wrapper"
         style="position:relative;width:100%;min-height:${PAGE_H}px;background:#fff">
      <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
           style="position:absolute;left:20px;top:120px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
           style="position:absolute;left:170px;top:120px;width:110px;height:80px;background:#22c55e"></div>
      <div data-agent-native-layer-name="Unnamed"
           style="position:absolute;left:20px;top:320px;width:200px;height:70px;background:#f59e0b"></div>
      <div data-agent-native-node-id="flat" data-agent-native-layer-name="Flat row"
           style="position:absolute;left:20px;top:440px;width:200px;height:0;overflow:visible">
        <span style="display:block;width:200px;height:24px;background:#a855f7"></span>
      </div>
    </div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "marquee reachability",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function selectedRows(page: Page): Locator {
  return layersTree(page).locator('[role="treeitem"][aria-selected="true"]');
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function openEditor(page: Page, designId: string): Promise<void> {
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

async function screenCard(page: Page) {
  const box = await page.locator("[data-screen-card]").first().boundingBox();
  if (!box) throw new Error("no screen card");
  return box;
}

function insideScreenX(card: { x: number }, preferred: number): number {
  return Math.max(card.x + EDGE_HANDLE_HIT_INWARD_PX + 2, preferred);
}

async function sweep(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 18 });
    await page.waitForTimeout(400);
    await page.mouse.up();
  } finally {
    await page.keyboard.up(modifier);
  }
  await page.waitForTimeout(2200);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
});

test.describe("modifier-held marquee reachability", () => {
  // oracle: none — checks modifier-held marquee reachability; native Figma behavior is unmeasured.
  test("from empty screen space rubber-bands its children", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const a = (await node(page, "box-a").boundingBox())!;
    const b = (await node(page, "box-b").boundingBox())!;
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, a.x - 10 * px), y: a.y - 20 * px },
      { x: b.x + b.width + 10 * px, y: b.y + b.height + 10 * px },
    );

    const names = await selectedRows(page).allTextContents();
    expect(
      names.join("|"),
      "a background drag inside a frame must rubber-band, not pick the frame up",
    ).toContain("Box A");
    expect(names.join("|")).toContain("Box B");
    expect(
      names.join("|"),
      "the container the band was drawn inside must not be swept in — its outline covers the whole screen and reads as 'everything is selected'",
    ).not.toContain("Wrapper");
  });

  // oracle: none — checks modifier-held marquee reachability; native Figma behavior is unmeasured.
  test("catches an element that has no id of its own", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const target = (await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('div[style*="background:#f59e0b"]')
      .first()
      .boundingBox())!;
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, target.x - 10 * px), y: target.y - 14 * px },
      {
        x: target.x + target.width + 10 * px,
        y: target.y + target.height + 14 * px,
      },
    );

    const swept = (await selectedRows(page).allTextContents()).join("|");
    expect(
      swept,
      "an id attribute is a persistence detail; a click selects this element, so a band must too",
    ).toContain("Unnamed");
    expect(swept, "the enclosing wrapper is not the target").not.toContain(
      "Wrapper",
    );
  });

  // oracle: none — checks modifier-held marquee reachability; native Figma behavior is unmeasured.
  test("catches a zero-height row", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const flat = (await node(page, "flat").boundingBox())!;
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, flat.x - 10 * px), y: flat.y - 18 * px },
      { x: flat.x + flat.width + 10 * px, y: flat.y + 30 * px },
    );

    expect(
      (await selectedRows(page).allTextContents()).join("|"),
      "a zero-area box is still a layer",
    ).toContain("Flat row");
  });
});
