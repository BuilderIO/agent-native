import { expect, test, type Locator, type Page } from "@playwright/test";

import { EDGE_HANDLE_HIT_INWARD_PX } from "../app/components/design/multi-screen/handle-hit-zones";
import { e2eBaseURL } from "./base-url";
import { canvasZoom, expandAllLayers, gotoEditor } from "./helpers";

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
      <div class="unnamed-target" data-agent-native-layer-name="Unnamed"
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
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("modifier-held marquee reachability", () => {
  test("from empty screen space rubber-bands its children", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await gotoEditor(page, id);
    await expandAllLayers(page);
    const a = (await node(page, "box-a").boundingBox())!;
    const b = (await node(page, "box-b").boundingBox())!;
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, a.x - 10 * px), y: a.y - 20 * px },
      { x: b.x + b.width + 10 * px, y: b.y + b.height + 10 * px },
    );

    const names = () => selectedRows(page).allTextContents();
    await expect
      .poll(async () => (await names()).sort())
      .toEqual(["Box A", "Box B"]);
  });

  test("catches an element whose runtime node id is missing", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await gotoEditor(page, id);
    await expandAllLayers(page);
    const target = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-layer-name="Unnamed"]');
    await target.evaluate((element) =>
      element.removeAttribute("data-agent-native-node-id"),
    );
    expect(
      await target.getAttribute("data-agent-native-node-id"),
      "the runtime element must exercise the missing-id bridge path",
    ).toBeNull();
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error("unnamed target has no rendered bounds");
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, bounds.x - 10 * px), y: bounds.y - 14 * px },
      {
        x: bounds.x + bounds.width + 10 * px,
        y: bounds.y + bounds.height + 14 * px,
      },
    );

    const swept = () =>
      selectedRows(page)
        .allTextContents()
        .then((names) => names.join("|"));
    await expect.poll(swept).toContain("Unnamed");
    await expect.poll(swept).toEqual("Unnamed");
  });

  test("catches a zero-height row", async ({ page }) => {
    const id = await newDesign(page);
    await gotoEditor(page, id);
    await expandAllLayers(page);
    const flat = (await node(page, "flat").boundingBox())!;
    const card = await screenCard(page);
    const px = await canvasZoom(page);
    await sweep(
      page,
      { x: insideScreenX(card, flat.x - 10 * px), y: flat.y - 18 * px },
      { x: flat.x + flat.width + 10 * px, y: flat.y + 30 * px },
    );

    const names = () =>
      selectedRows(page)
        .allTextContents()
        .then((rows) => rows.join("|"));
    await expect.poll(names).toContain("Flat row");
    expect(await names(), "a zero-area box is still a layer").toContain(
      "Flat row",
    );
  });
});
