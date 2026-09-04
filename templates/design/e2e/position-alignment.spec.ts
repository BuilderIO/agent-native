import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { designFrame, enterDirectMode, gotoEditor } from "./helpers";

/** Board is sized in percentages: its authored box parses to 100px, so the
 *  alignment bounds must come from the live parent, not the inline style. */
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
        style="position:relative;width:100%;height:100%;background:#eeeeee"
      >
        <div
          data-agent-native-node-id="align-chip"
          data-agent-native-layer-name="Chip"
          style="position:absolute;left:300px;top:250px;width:120px;height:60px;background:#fca5a5"
        >Chip</div>
      </div>
    </div>
  </body>
</html>`;

const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 600;
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

async function chipOffset(page: Page) {
  return designFrame(page)
    .locator('[data-agent-native-layer-name="Chip"]')
    .evaluate((element) => {
      const child = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return {
        left: Math.round(child.left - parent.left),
        top: Math.round(child.top - parent.top),
      };
    });
}

async function expectChipOffset(
  page: Page,
  expected: { left: number; top: number },
) {
  await expect
    .poll(() => chipOffset(page), { timeout: 10_000 })
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
  await expectChipOffset(page, { left: 300, top: 250 });

  await alignButton(page, "Align right").click();
  await expectChipOffset(page, {
    left: FRAME_WIDTH - CHIP_WIDTH,
    top: 250,
  });

  await alignButton(page, "Align left").click();
  await expectChipOffset(page, { left: 0, top: 250 });

  await alignButton(page, "Align bottom").click();
  await expectChipOffset(page, { left: 0, top: FRAME_HEIGHT - CHIP_HEIGHT });

  await alignButton(page, "Align top").click();
  await expectChipOffset(page, { left: 0, top: 0 });
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
