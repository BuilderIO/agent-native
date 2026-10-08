import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main data-agent-native-node-id="main" style="position:relative;width:640px;height:480px"><div data-agent-native-node-id="mouse-rectangle" data-agent-native-layer-name="Mouse rectangle" style="position:absolute;left:60px;top:60px;width:180px;height:120px;background:#fff"></div><div data-agent-native-node-id="keyboard-rectangle" data-agent-native-layer-name="Keyboard rectangle" style="position:absolute;left:300px;top:60px;width:180px;height:120px;background:#fff"></div></main></body></html>`;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function createDesign(page: Page) {
  const design = await action(page, "create-design", {
    title: `Stroke row add ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: HTML,
  });
  const screenId = file.id ?? file.data?.id;
  if (!screenId) throw new Error("create-file returned no id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
    ],
  });
  return { designId, screenId };
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function selectShape(page: Page, name: string) {
  const row = layerRow(page, name);
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

function strokeSection(page: Page) {
  return page
    .locator("[data-design-inspector-section]")
    .filter({
      has: page.getByRole("heading", { name: "Stroke", exact: true }),
    })
    .first();
}

async function strokeState(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.borderTopWidth,
        style: style.borderTopStyle,
        color: style.borderTopColor,
      };
    });
}

async function readSource(page: Page, designId: string, screenId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const html = design.files?.find(
    (file: { id?: string }) => file.id === screenId,
  )?.content;
  if (typeof html !== "string")
    throw new Error("screen source was not returned");
  return html;
}

async function expectSavedStroke(
  page: Page,
  designId: string,
  screenId: string,
) {
  await expect
    .poll(async () => readSource(page, designId, screenId), { timeout: 10_000 })
    .toMatch(/border-width:\s*1px/i);
  const source = await readSource(page, designId, screenId);
  expect(source).toMatch(/border-style:\s*solid/i);
  return source;
}

async function expectStroke(page: Page, screenId: string, nodeId: string) {
  await expect
    .poll(() => strokeState(page, screenId, nodeId))
    .toMatchObject({ width: "1px", style: "solid" });
  await expect
    .poll(() =>
      strokeSection(page)
        .locator("[data-design-inspector-section-content]")
        .isVisible(),
    )
    .toBe(true);
}

async function activateEmptyStrokeByKey(
  page: Page,
  screenId: string,
  name: string,
  key: "Enter" | "Space",
) {
  await selectShape(page, name);
  const button = strokeSection(page).locator("h3 button");
  await expect(button).toHaveAccessibleName("Add stroke");
  await button.focus();
  await page.keyboard.press(key);
  await expectStroke(
    page,
    screenId,
    name === "Mouse rectangle" ? "mouse-rectangle" : "keyboard-rectangle",
  );
}

test("clicking the empty Stroke heading adds and persists a stroke", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectShape(page, "Mouse rectangle");

    const section = strokeSection(page);
    await expect(section).toBeVisible();
    const headingButton = section.locator("h3 button");
    const plusButton = section
      .getByRole("button", {
        name: "Add stroke",
        exact: true,
      })
      .last();
    await expect(headingButton).toBeVisible();
    await expect(plusButton).toBeVisible();
    const headingBox = await headingButton.boundingBox();
    const plusBox = await plusButton.boundingBox();
    if (!headingBox || !plusBox)
      throw new Error("Stroke controls have no bounds");
    const clickPoint = {
      x: headingBox.x + Math.min(12, headingBox.width / 2),
      y: headingBox.y + headingBox.height / 2,
    };
    expect(
      clickPoint.x < plusBox.x || clickPoint.x > plusBox.x + plusBox.width,
    ).toBe(true);
    await headingButton.click({
      position: {
        x: clickPoint.x - headingBox.x,
        y: clickPoint.y - headingBox.y,
      },
    });

    await expectStroke(page, screenId, "mouse-rectangle");
    await expectSavedStroke(page, designId, screenId);

    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectShape(page, "Mouse rectangle");
    await expectStroke(page, screenId, "mouse-rectangle");
    await expectSavedStroke(page, designId, screenId);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("the empty Stroke heading activates with Enter", async ({ page }) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await activateEmptyStrokeByKey(page, screenId, "Mouse rectangle", "Enter");

    await expectSavedStroke(page, designId, screenId);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("the empty Stroke heading activates with Space", async ({ page }) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await activateEmptyStrokeByKey(
      page,
      screenId,
      "Keyboard rectangle",
      "Space",
    );

    await expectSavedStroke(page, designId, screenId);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
