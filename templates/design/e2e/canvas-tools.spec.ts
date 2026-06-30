import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import { gotoEditor } from "./helpers";

let designId: string;
let baseURLForActions: string;

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test.beforeEach(async ({ page, request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
  const created = await postAction(request, "create-design", {
    title: "E2E Canvas Tools",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(`create-design did not return an id: ${created}`);
  }
  await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  await gotoEditor(page, designId);
});

test.use({ viewport: { width: 1440, height: 1000 } });

test.afterEach(async ({ request }) => {
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId }).catch(() => {});
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
  return page.locator("[data-screen-shell]").filter({ hasText: name }).first();
}

async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.waitForTimeout(250);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(300);
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
  await expect(toolButton(page, toolName)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(150);
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

async function screenCardLayoutSize(shell: Locator): Promise<{
  width: number;
  height: number;
}> {
  return shell.locator("[data-screen-card]").evaluate((element) => ({
    width: (element as HTMLElement).clientWidth,
    height: (element as HTMLElement).clientHeight,
  }));
}

async function screenIframeViewportSize(shell: Locator): Promise<{
  width: number;
  height: number;
}> {
  const iframe = shell.locator("iframe[data-design-preview-iframe]").first();
  await expect(iframe).toBeVisible();
  return iframe.evaluate((element) => ({
    width: (element as HTMLIFrameElement).clientWidth,
    height: (element as HTMLIFrameElement).clientHeight,
  }));
}

function expectCloseToFrameSize(
  viewport: { width: number; height: number },
  frame: { width: number; height: number },
) {
  // The frame card is measured as border-box while the preview iframe reports
  // content-box. The overview card has a 1px border on each side.
  expect(Math.abs(viewport.width - frame.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(viewport.height - frame.height)).toBeLessThanOrEqual(2);
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

test("text insertion keeps the new primitive selected", async ({ page }) => {
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
});

test("rectangle insertion keeps the new primitive selected", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

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
  await expect(toolButton(page, "Frame")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(150);
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
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);
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

test("dragging the Home screen shell moves it", async ({ page }) => {
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
  const movedViewport = await screenIframeViewportSize(shell);
  expectCloseToFrameSize(movedViewport, await screenCardLayoutSize(shell));

  await dragBetween(
    page,
    { x: moved.x + moved.width * 0.34, y: moved.y + 12 },
    { x: moved.x + moved.width * 0.34 - 64, y: moved.y + 12 - 28 },
  );
  const movedBack = await shell.boundingBox();
  if (!movedBack) throw new Error("no restored shell box");
  expect(Math.abs(movedBack.x - before.x)).toBeLessThan(6);
  expect(Math.abs(movedBack.y - before.y)).toBeLessThan(6);
});

test("Escape cancels an in-progress overview screen drag", async ({ page }) => {
  const shell = screenShell(page);
  const before = await shell.boundingBox();
  if (!before) throw new Error("no home screen shell box");

  const start = {
    x: before.x + before.width * 0.34,
    y: before.y + 12,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 72, start.y + 36, { steps: 8 });

  const during = await shell.boundingBox();
  if (!during) throw new Error("no dragging shell box");
  expect(during.x).toBeGreaterThan(before.x + 20);
  expect(during.y).toBeGreaterThan(before.y + 10);

  await page.keyboard.press("Escape");
  await page.mouse.move(start.x + 144, start.y + 72, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const after = await shell.boundingBox();
  if (!after) throw new Error("no cancelled shell box");
  expect(Math.abs(after.x - before.x)).toBeLessThan(6);
  expect(Math.abs(after.y - before.y)).toBeLessThan(6);
});
