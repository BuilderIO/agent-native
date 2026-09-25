import { expect, test } from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const FRAME_FIXTURE = `<!doctype html><html><body style="margin:0">
<div data-agent-native-node-id="fill-probe" data-agent-native-layer-name="Fill probe" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:180px;height:120px;background:#1a1d24"></div>
</body></html>`;

async function createDesign(page: import("@playwright/test").Page) {
  const createdResponse = await page.request.post(
    appPath("/_agent-native/actions/create-design"),
    {
      data: {
        title: `Fill Escape ${Date.now()}`,
        projectType: "prototype",
      },
    },
  );
  if (!createdResponse.ok()) throw new Error(await createdResponse.text());
  const created = await createdResponse.json();
  if (typeof created.id !== "string") throw new Error("Missing design id");
  const fileResponse = await page.request.post(
    appPath("/_agent-native/actions/create-file"),
    {
      data: {
        designId: created.id,
        filename: "index.html",
        content: FRAME_FIXTURE,
        fileType: "html",
      },
    },
  );
  if (!fileResponse.ok()) throw new Error(await fileResponse.text());
  return created.id as string;
}

test("Fill Hex Enter applies color and one Escape closes the picker", async ({
  page,
}) => {
  const designId = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const layers = page.getByRole("tree", { name: "Layers" });
    await layers
      .getByRole("button", { name: "Fill probe", exact: true })
      .click();
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Fill probe");

    const fill = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await fill.getByRole("button", { name: "Open color picker" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const solidTab = dialog.getByRole("button", {
      name: "Solid",
      exact: true,
    });
    await solidTab.hover();
    const solidTooltip = page
      .locator('[data-agent-native-tooltip="true"]')
      .filter({ hasText: "Solid" });
    await expect(solidTooltip).toBeVisible();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toBeVisible();

    await hex.fill("3B82F6");
    await hex.press("Enter");
    await page.keyboard.press("Escape");

    const target = designFrame(page).locator(
      '[data-agent-native-node-id="fill-probe"]',
    );
    await expect(target).toHaveCSS("background-color", "rgb(59, 130, 246)");
    await expect(dialog).toBeHidden();
    await expect(target).toHaveCSS("background-color", "rgb(59, 130, 246)");
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});
