import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { designFrame, enterDirectMode, gotoEditor } from "./helpers";

/** Board is percentage-sized with a border and padding: its authored box
 *  parses to 100px and its border box overshoots the padding box that
 *  `left`/`top` actually resolve against. Both must be measured, not parsed. */
const ALIGN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Alignment fixture</title></head>
  <body style="margin:0;font-family:Arial,sans-serif">
    <div
      data-agent-native-node-id="align-canvas"
      data-agent-native-layer-name="Canvas"
      style="width:800px;height:600px"
    >
      <div
        data-agent-native-node-id="align-frame"
        data-agent-native-layer-name="Board"
        style="position:relative;box-sizing:border-box;width:100%;height:100%;border:10px solid #999999;padding:20px;background:#eeeeee"
      >
        <div
          data-agent-native-node-id="align-chip"
          data-agent-native-layer-name="Chip"
          style="position:absolute;left:300px;top:250px;width:120px;height:60px;background:#fca5a5"
        >Chip</div>
        <div
          data-agent-native-node-id="align-percent-chip"
          data-agent-native-layer-name="Percent"
          style="position:absolute;left:50%;top:100px;width:120px;height:60px;background:#93c5fd"
        >Percent</div>
      </div>
    </div>
  </body>
</html>`;

// Board is 800x600 border-box with a 10px border, so the padding box that
// `left`/`top` resolve against is 780x580.
const BOUNDS_WIDTH = 780;
const BOUNDS_HEIGHT = 580;
const CHIP_WIDTH = 120;
const CHIP_HEIGHT = 60;

const ALIGN_LABELS = [
  "Align left",
  "Align horizontal centers",
  "Align right",
  "Align top",
  "Align vertical centers",
  "Align bottom",
] as const;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

/** The persisted design-selection state can restore responsive preview, which
 *  unmounts the inspector the alignment row lives in. */
async function openEditPanel(page: Page, designId: string) {
  await gotoEditor(page, designId);
  await leaveResponsivePreview(page);
  await enterDirectMode(page);
  await leaveResponsivePreview(page);
}

async function leaveResponsivePreview(page: Page) {
  const exitPreview = page
    .getByRole("button", { name: "Exit responsive preview" })
    .first();
  if (await exitPreview.isVisible().catch(() => false)) {
    await exitPreview.click();
    await expect(exitPreview).toBeHidden();
  }
}

function alignButton(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true }).first();
}

/** Selects through the Layers tree: a canvas click on a nested node lands on
 *  the screen row first, which is a different selection shape. */
async function selectLayer(page: Page, layerName: string) {
  const tree = page.getByRole("tree", { name: "Layers" });
  const row = tree
    .getByRole("button", { name: layerName, exact: true })
    .first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await row.isVisible().catch(() => false)) break;
    const expander = tree.getByRole("button", { name: "Expand layer" }).first();
    if (!(await expander.isVisible().catch(() => false))) break;
    await expander.click();
    await page.waitForTimeout(250);
  }
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    tree.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText(layerName);
}

/** Offset from the parent's padding box — the space `left`/`top` write into. */
async function layerOffset(page: Page, layerName: string) {
  return designFrame(page)
    .locator(`[data-agent-native-layer-name="${layerName}"]`)
    .evaluate((element) => {
      const parent = element.parentElement!;
      const child = element.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return {
        left: Math.round(child.left - parentRect.left - parent.clientLeft),
        top: Math.round(child.top - parentRect.top - parent.clientTop),
      };
    });
}

async function expectOffset(
  page: Page,
  layerName: string,
  expected: { left: number; top: number },
) {
  await expect
    .poll(() => layerOffset(page, layerName), { timeout: 10_000 })
    .toEqual(expected);
}

async function seedDesign(request: APIRequestContext) {
  const created = await postAction(request, "create-design", {
    title: `Alignment ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: ALIGN_HTML,
    fileType: "html",
  });
  return designId;
}

test("each alignment button moves the object to the edge it names", async ({
  page,
  request,
}) => {
  const designId = await seedDesign(request);
  await openEditPanel(page, designId);
  await selectLayer(page, "Chip");
  await expectOffset(page, "Chip", { left: 300, top: 250 });

  await alignButton(page, "Align right").click();
  await expectOffset(page, "Chip", {
    left: BOUNDS_WIDTH - CHIP_WIDTH,
    top: 250,
  });

  await alignButton(page, "Align left").click();
  await expectOffset(page, "Chip", { left: 0, top: 250 });

  await alignButton(page, "Align bottom").click();
  await expectOffset(page, "Chip", {
    left: 0,
    top: BOUNDS_HEIGHT - CHIP_HEIGHT,
  });

  await alignButton(page, "Align top").click();
  await expectOffset(page, "Chip", { left: 0, top: 0 });
});

test("aligning one axis leaves a percentage offset on the other axis put", async ({
  page,
  request,
}) => {
  const designId = await seedDesign(request);
  await openEditPanel(page, designId);
  await selectLayer(page, "Percent");
  const half = BOUNDS_WIDTH / 2;
  await expectOffset(page, "Percent", { left: half, top: 100 });

  await alignButton(page, "Align top").click();
  await expectOffset(page, "Percent", { left: half, top: 0 });
});

test("a lone top-level frame has nothing to align against", async ({
  page,
  request,
}) => {
  const designId = await seedDesign(request);
  await openEditPanel(page, designId);
  await selectLayer(page, "Canvas");

  for (const label of ALIGN_LABELS) {
    await expect(alignButton(page, label)).toBeDisabled();
  }
});
