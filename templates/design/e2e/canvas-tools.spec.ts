import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoEditor, readSeedDesignId } from "./helpers";

let designId: string;

test.beforeAll(async () => {
  designId = await readSeedDesignId();
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
});

function toolButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function selectedLayerRow(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]').first();
}

function homeLayerRow(page: Page): Locator {
  return page
    .locator("[data-layer-node-id]")
    .filter({ hasText: "Home" })
    .first();
}

function screenShell(page: Page, name = "Home"): Locator {
  return page.locator("[data-frame-shell]").filter({ hasText: name }).first();
}

async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function createDraftPrimitive(
  page: Page,
  toolName: string,
  selectionLabel: string,
  drag: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
): Promise<void> {
  await toolButton(page, toolName).click();
  await dragBetween(page, drag.start, drag.end);
  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText(selectionLabel);
}

async function restoreHome(page: Page): Promise<void> {
  const allScreens = page.getByRole("button", {
    name: "All screens",
    exact: true,
  });
  if (await allScreens.isVisible()) {
    await allScreens.click();
  }
  await homeLayerRow(page).click();
  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText("Home");
}

function homeScreenCard(page: Page): Locator {
  return screenShell(page).locator("[data-screen-card]");
}

test("toolbar modes toggle the editor mode buttons", async ({ page }) => {
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(toolButton(page, "Annotate")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Interact").click();
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Annotate").click();
  await expect(toolButton(page, "Annotate")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Edit").click();
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("text and rectangle insertion keep the new primitive selected", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await createDraftPrimitive(page, "Text", "Text", {
    start: {
      x: cardBox.x + cardBox.width * 0.28,
      y: cardBox.y + cardBox.height * 0.28,
    },
    end: {
      x: cardBox.x + cardBox.width * 0.5,
      y: cardBox.y + cardBox.height * 0.36,
    },
  });
  await restoreHome(page);

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: cardBox.x + cardBox.width * 0.58,
      y: cardBox.y + cardBox.height * 0.56,
    },
    end: {
      x: cardBox.x + cardBox.width * 0.8,
      y: cardBox.y + cardBox.height * 0.78,
    },
  });
  await restoreHome(page);
});

test("frame insertion creates a new screen and can return to Home", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await toolButton(page, "Frame").click();
  await dragBetween(
    page,
    {
      x: cardBox.x + cardBox.width * 0.2,
      y: cardBox.y + cardBox.height * 0.2,
    },
    {
      x: cardBox.x + cardBox.width * 0.5,
      y: cardBox.y + cardBox.height * 0.48,
    },
  );

  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText("Screen 2");
  await restoreHome(page);
});

test("pen escape cancels the in-progress path and enter commits vector art", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await toolButton(page, "Pen").click();
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.3,
    cardBox.y + cardBox.height * 0.3,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");

  await page.mouse.click(
    cardBox.x + cardBox.width * 0.36,
    cardBox.y + cardBox.height * 0.42,
  );
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.58,
    cardBox.y + cardBox.height * 0.54,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await expect(selectedLayerRow(page)).toContainText("Vector");

  await restoreHome(page);
});

test("dragging the Home screen shell moves and resizes it", async ({
  page,
}) => {
  const shell = screenShell(page);
  const before = await shell.boundingBox();
  if (!before) throw new Error("no home screen shell box");

  await dragBetween(
    page,
    { x: before.x + before.width * 0.34, y: before.y + 12 },
    { x: before.x + before.width * 0.34 + 64, y: before.y + 12 + 28 },
  );

  const moved = await shell.boundingBox();
  if (!moved) throw new Error("no moved shell box");
  expect(moved.x).toBeGreaterThan(before.x + 20);
  expect(moved.y).toBeGreaterThan(before.y + 10);

  const resizeHandle = page.locator('[data-resize-handle="se"]').last();
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("no resize handle box");

  await dragBetween(
    page,
    {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    },
    {
      x: handleBox.x + handleBox.width / 2 + 48,
      y: handleBox.y + handleBox.height / 2 + 32,
    },
  );

  const resized = await shell.boundingBox();
  if (!resized) throw new Error("no resized shell box");
  expect(resized.width).toBeGreaterThan(moved.width + 20);
  expect(resized.height).toBeGreaterThan(moved.height + 12);

  await dragBetween(
    page,
    { x: resized.x + resized.width * 0.34, y: resized.y + 12 },
    { x: resized.x + resized.width * 0.34 - 64, y: resized.y + 12 - 28 },
  );
  const movedBack = await shell.boundingBox();
  if (!movedBack) throw new Error("no restored shell box");
  expect(Math.abs(movedBack.x - before.x)).toBeLessThan(6);
  expect(Math.abs(movedBack.y - before.y)).toBeLessThan(6);
});
