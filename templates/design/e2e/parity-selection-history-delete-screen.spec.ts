import { expect, test, type Page, type Route } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  layerRow,
  newDesign,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
const DEEP_SELECT_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

const SECOND_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Second</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="second-target" data-agent-native-layer-name="Indigo Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#312e81"></div>
  </body>
</html>`;

const HOME_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="home-target" data-agent-native-layer-name="Blue Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#3b82f6"></div>
  </body>
</html>`;

const HOME_SCREEN_WITH_ANCHOR = HOME_SCREEN.replace(
  "</body>",
  `    <div data-agent-native-node-id="home-anchor" data-agent-native-layer-name="Anchor Box"
         style="position:absolute;left:600px;top:400px;width:80px;height:60px;background:#ef4444"></div>
  </body>`,
);

const THIRD_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Third</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="third-target" data-agent-native-layer-name="Green Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#166534"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

let baseURL = "";

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

async function newTwoScreenDesign(
  page: Page,
  homeContent = HOME_SCREEN,
): Promise<string> {
  const id = await newDesign(page, homeContent);
  await postAction(page, "create-file", {
    designId: id,
    filename: "second.html",
    content: SECOND_SCREEN,
    fileType: "html",
  });
  return id;
}

async function newThreeScreenDesign(
  page: Page,
  homeContent = HOME_SCREEN,
): Promise<string> {
  const id = await newTwoScreenDesign(page, homeContent);
  await postAction(page, "create-file", {
    designId: id,
    filename: "third.html",
    content: THIRD_SCREEN,
    fileType: "html",
  });
  return id;
}

async function fileIdByFilename(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  let filenames: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await page.request.get(
      `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
    );
    if (!response.ok()) throw new Error(await response.text());
    const result = await response.json();
    filenames = (result.files ?? []).flatMap((file: any) =>
      typeof file.filename === "string" ? [file.filename] : [],
    );
    const file = (result.files ?? []).find(
      (candidate: any) => candidate.filename === filename,
    );
    if (typeof file?.id === "string") return file.id;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `file ${filename} not found in design ${designId}; available: ${filenames.join(", ")}`,
  );
}

async function lastSelectedLayers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const trace = (window as any).__designTrace;
    if (!trace || typeof trace.entries !== "function") {
      throw new Error(
        "Design selection trace was not initialized; set __DESIGN_TRACE before app navigation",
      );
    }
    const entries = trace.entries();
    const selects = entries.filter(
      (entry: { area: string }) => entry.area === "select",
    );
    return (
      (selects[selects.length - 1]?.data as { layers?: string[] })?.layers ?? []
    );
  });
}

// oracle: none — this checks app undo-history mapping, not a Figma observation.
test("undo of a screen deletion remaps stale selection-history entries instead of restoring a dead screen id", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const id = await newTwoScreenDesign(page);
  await openEditor(page, id);

  const homeIdBeforeDelete = await fileIdByFilename(page, id, "index.html");
  const secondId = await fileIdByFilename(page, id, "second.html");

  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  await layerRow(page, "Second").click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 10_000 });
  const homeIdAfterUndo = await fileIdByFilename(page, id, "index.html");
  expect(
    homeIdAfterUndo,
    "sanity: undoing a screen deletion must recreate it under a NEW id",
  ).not.toBe(homeIdBeforeDelete);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeIdAfterUndo]);
  await expect(
    layerRow(page, "Home"),
    "the recreated Home screen's own layer row must show as selected",
  ).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(REDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await page.keyboard.press(REDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeIdAfterUndo]);
  await expect(layerRow(page, "Home")).toHaveAttribute("aria-selected", "true");

  expect(
    consoleErrors,
    `no console errors expected across the undo/redo walk; got: ${consoleErrors.join("; ")}`,
  ).toEqual([]);
});

// oracle: none — this checks app deletion behavior, not a Figma observation.
test("deleting a selected child layer keeps its owning Screen", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    await expect(blueBoxButton).toHaveCount(1);
    const blueBoxRow = blueBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    await blueBoxButton.click();
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Blue Box")).toHaveCount(0);
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);

    await page.keyboard.press(UNDO);
    await expect(layerRow(page, "Blue Box")).toHaveCount(1);
    await expect(layerRow(page, "Home")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks app selection history, not a Figma observation.
test("undo restores a child layer with its additive Screen selection", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const cards = page.locator("[data-screen-card]");
    await expect(cards).toHaveCount(3);

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    await expect(blueBoxButton).toHaveCount(1);
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    await blueBoxButton.click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    const secondId = await fileIdByFilename(page, id, "second.html");
    const secondFrameTitle = page.locator(
      `[data-frame-id="${secondId}"] [data-frame-title]`,
    );
    await expect(secondFrameTitle).toHaveText("Second");
    await secondFrameTitle.click({ modifiers: ["Shift"] });
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    const indigoBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Indigo Box" });
    await expect(indigoBoxButton).toHaveCount(1);
    const indigoBoxId =
      await indigoBoxButton.getAttribute("data-layer-node-id");
    expect(indigoBoxId).toBeTruthy();
    await indigoBoxButton.click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([indigoBoxId]);

    await page.keyboard.press(UNDO);
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Second")).toHaveCount(0, { timeout: 10_000 });
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks app selection and deletion behavior, not a Figma observation.
test("marquee-selecting child elements after a Screen pick deletes only the elements", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(page, HOME_SCREEN_WITH_ANCHOR);
  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    await layerRow(page, "Home").click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

    const anchor = page
      .locator(`iframe[data-screen-iframe-id="${homeId}"]`)
      .contentFrame()
      .locator('[data-agent-native-node-id="home-anchor"]');
    const anchorBox = await anchor.boundingBox();
    expect(anchorBox).not.toBeNull();
    await page.mouse.click(
      anchorBox!.x + anchorBox!.width / 2,
      anchorBox!.y + anchorBox!.height / 2,
    );
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator("[data-layer-row-button]")
        .filter({ hasText: "Anchor Box" })
        .locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-frame-drag-surface]")).toHaveCount(0);

    const screenIframe = page.locator(
      `iframe[data-screen-iframe-id="${homeId}"]`,
    );
    const iframeBox = await screenIframe.boundingBox();
    const target = screenIframe
      .contentFrame()
      .locator('[data-agent-native-node-id="home-target"]');
    const targetBox = await target.boundingBox();
    expect(iframeBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const margin = Math.min(5, Math.max(2, iframeBox!.width * 0.01));
    const from = {
      x: targetBox!.x + targetBox!.width + margin,
      y: targetBox!.y + targetBox!.height + margin,
    };
    const to = {
      x: targetBox!.x - margin,
      y: targetBox!.y - margin,
    };
    expect(from.x).toBeLessThan(iframeBox!.x + iframeBox!.width);
    expect(from.y).toBeLessThan(iframeBox!.y + iframeBox!.height);
    expect(to.x).toBeGreaterThan(iframeBox!.x);
    expect(to.y).toBeGreaterThan(iframeBox!.y);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxRow = blueBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toHaveLength(1);

    await page.keyboard.press("Delete");
    await expect(blueBoxButton).toHaveCount(0);
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this verifies Delete follows canvas marquee provenance, not a Figma observation.
test("Shift-marquee child selection after a Screen pick deletes only the child", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    await page
      .locator(`[data-frame-id="${homeId}"] [data-frame-title]`)
      .click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

    const frame = page.locator(`[data-frame-id="${homeId}"]`);
    const frameBox = await frame.boundingBox();
    const screenIframe = page.locator(
      `iframe[data-screen-iframe-id="${homeId}"]`,
    );
    const iframeBox = await screenIframe.boundingBox();
    const target = screenIframe
      .contentFrame()
      .locator('[data-agent-native-node-id="home-target"]');
    const targetBox = await target.boundingBox();
    expect(frameBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const from = {
      x: frameBox!.x - 32,
      y: targetBox!.y - 4,
    };
    const to = {
      x: targetBox!.x + targetBox!.width + 4,
      y: targetBox!.y + targetBox!.height + 4,
    };
    expect(from.x).toBeLessThan(frameBox!.x);
    expect(from.y).toBeGreaterThanOrEqual(iframeBox!.y);
    expect(to.x).toBeLessThan(iframeBox!.x + iframeBox!.width);

    await page.keyboard.down("Shift");
    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up("Shift");
    }

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    await expect(
      blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toContain(homeId);

    await page.keyboard.press("Delete");
    await expect(blueBoxButton).toHaveCount(0);
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks deep-select Delete provenance, not a Figma observation.
test("deep-select marquee over a Screen deletes only the child", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    await page
      .locator(`[data-frame-id="${homeId}"] [data-frame-title]`)
      .click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

    const frame = page.locator(`[data-frame-id="${homeId}"]`);
    const frameBox = await frame.boundingBox();
    const screenIframe = page.locator(
      `iframe[data-screen-iframe-id="${homeId}"]`,
    );
    const iframeBox = await screenIframe.boundingBox();
    expect(frameBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();

    const from = { x: frameBox!.x - 16, y: frameBox!.y - 16 };
    const to = {
      x: frameBox!.x + frameBox!.width + 16,
      y: frameBox!.y + frameBox!.height + 16,
    };
    expect(from.x).toBeGreaterThan(0);
    expect(from.y).toBeGreaterThan(0);
    expect(to.x).toBeLessThan(1600);
    expect(to.y).toBeLessThan(1000);
    expect(from.x).toBeLessThan(iframeBox!.x);
    expect(from.y).toBeLessThan(iframeBox!.y);
    expect(to.x).toBeGreaterThan(iframeBox!.x + iframeBox!.width);
    expect(to.y).toBeGreaterThan(iframeBox!.y + iframeBox!.height);

    await page.keyboard.down(DEEP_SELECT_MODIFIER);
    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up(DEEP_SELECT_MODIFIER);
    }

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    await expect(
      blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    await page.keyboard.press("Delete");
    await expect(blueBoxButton).toHaveCount(0);
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks explicit Screen intent while preserving child selection, not a Figma observation.
test("Shift-reselecting an owner Screen makes Delete target the Screen", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    await blueBoxButton.click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    const homeTitle = page.locator(
      `[data-frame-id="${homeId}"] [data-frame-title]`,
    );
    await homeTitle.click({ modifiers: ["Shift"] });
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);
    await page.waitForTimeout(550);
    await homeTitle.click({ modifiers: ["Shift"] });
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Home")).toHaveCount(0);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks app selection history and deletion behavior, not a Figma observation.
test("undoing a canvas element click restores its explicit Screen target for Delete", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    await layerRow(page, "Home").click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

    const target = page
      .locator(`iframe[data-screen-iframe-id="${homeId}"]`)
      .contentFrame()
      .locator('[data-agent-native-node-id="home-target"]');
    const targetBox = await target.boundingBox();
    expect(targetBox).not.toBeNull();
    await page.mouse.click(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
    );

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    await expect(blueBoxButton).toHaveCount(1);
    await expect(
      blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toHaveLength(1);

    await page.keyboard.press(UNDO);
    await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);
    await expect(layerRow(page, "Home")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Home")).toHaveCount(0, { timeout: 10_000 });
    await expect(layerRow(page, "Blue Box")).toHaveCount(0);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks retry behavior after an action failure, not Figma behavior.
test("failed Screen deletion keeps the explicit Screen target for retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(page);
  const deleteTargets: string[][] = [];
  const failFirstDelete = async (route: Route) => {
    const body = route.request().postDataJSON() as {
      id?: string;
      fileIds?: string[];
    };
    deleteTargets.push(body.fileIds ?? (body.id ? [body.id] : []));
    if (deleteTargets.length === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "intentional E2E route failure" }),
      });
      return;
    }
    await route.continue();
  };

  try {
    await openEditor(page, id);
    const secondId = await fileIdByFilename(page, id, "second.html");

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    const blueBoxRow = blueBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    await blueBoxButton.click();
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

    const secondFrameTitle = page.locator(
      `[data-frame-id="${secondId}"] [data-frame-title]`,
    );
    await expect(secondFrameTitle).toHaveText("Second");
    await secondFrameTitle.click({ modifiers: ["Shift"] });
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    await page.route("**/_agent-native/actions/delete-file", failFirstDelete);
    await page.keyboard.press("Delete");
    await expect.poll(() => deleteTargets.length).toBe(1);
    expect(deleteTargets[0]).toEqual([secondId]);
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Delete");
    await expect.poll(() => deleteTargets.length).toBe(2);
    expect(deleteTargets[1]).toEqual([secondId]);
    await expect(layerRow(page, "Second")).toHaveCount(0, { timeout: 10_000 });
    await expect(blueBoxButton).toHaveCount(1);
    await expect(layerRow(page, "Home")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks async selection settlement, not Figma behavior.
test("a newer layer selection survives failed Screen deletion settlement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(page);
  const deleteTargets: string[][] = [];
  let releaseFirstDelete: () => void = () => {};
  const firstDeleteGate = new Promise<void>((resolve) => {
    releaseFirstDelete = resolve;
  });
  let signalFirstDelete: () => void = () => {};
  const firstDeleteSeen = new Promise<void>((resolve) => {
    signalFirstDelete = resolve;
  });

  try {
    await openEditor(page, id);
    const secondId = await fileIdByFilename(page, id, "second.html");
    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    await blueBoxButton.click();
    await expect(
      blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");

    const greenBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Green Box" });
    const greenBoxId = await greenBoxButton.getAttribute("data-layer-node-id");
    expect(greenBoxId).toBeTruthy();
    const greenBoxRow = greenBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    await page.route("**/_agent-native/actions/delete-file", async (route) => {
      const body = route.request().postDataJSON() as {
        id?: string;
        fileIds?: string[];
      };
      deleteTargets.push(body.fileIds ?? (body.id ? [body.id] : []));
      if (deleteTargets.length === 1) {
        signalFirstDelete();
        await firstDeleteGate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "intentional E2E route failure" }),
        });
        return;
      }
      await route.continue();
    });

    const secondFrameTitle = page.locator(
      `[data-frame-id="${secondId}"] [data-frame-title]`,
    );
    await secondFrameTitle.click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await firstDeleteSeen;

    await greenBoxButton.click();
    await expect(greenBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([greenBoxId]);
    releaseFirstDelete();
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(greenBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([greenBoxId]);
    expect(deleteTargets).toEqual([[secondId]]);
  } finally {
    releaseFirstDelete();
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

// oracle: none — this checks app selection behavior, not a Figma observation.
test("marquee selection persists and deletes Screens after a prior layer selection", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);
    const cards = page.locator("[data-screen-card]");
    await expect(cards).toHaveCount(3);

    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    await expect(blueBoxButton).toHaveCount(1);
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    const blueBoxRow = blueBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    await blueBoxButton.click();
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

    const canvas = await page
      .locator("[data-multi-screen-canvas-surface]")
      .boundingBox();
    expect(canvas).not.toBeNull();
    const boxes = await Promise.all(
      [0, 1, 2].map((index) => cards.nth(index).boundingBox()),
    );
    const marqueeBoxes = boxes.slice(0, 2).filter((box) => box !== null);
    expect(marqueeBoxes).toHaveLength(2);
    const thirdBox = boxes[2];
    expect(thirdBox).not.toBeNull();
    const margin = 32;
    const left = Math.min(...marqueeBoxes.map((box) => box!.x)) - margin;
    const top = Math.min(...marqueeBoxes.map((box) => box!.y)) - margin;
    const right =
      Math.max(...marqueeBoxes.map((box) => box!.x + box!.width)) + margin;
    const bottom =
      Math.max(...marqueeBoxes.map((box) => box!.y + box!.height)) + margin;
    expect(left).toBeGreaterThanOrEqual(canvas!.x);
    expect(top).toBeGreaterThanOrEqual(canvas!.y);
    expect(right).toBeLessThanOrEqual(canvas!.x + canvas!.width);
    expect(bottom).toBeLessThanOrEqual(canvas!.y + canvas!.height);
    for (const box of marqueeBoxes) {
      expect(left).toBeLessThan(box!.x);
      expect(top).toBeLessThan(box!.y);
      expect(right).toBeGreaterThan(box!.x + box!.width);
      expect(bottom).toBeGreaterThan(box!.y + box!.height);
    }
    expect(bottom).toBeLessThan(thirdBox!.y + thirdBox!.height);

    const passiveScreenSelections = page.locator(
      "[data-passive-frame-selection-box]",
    );
    const groupScreenSelection = page.locator("[data-frame-selection-box]");

    const hitTargets = await page.evaluate(
      ({ left, top, right, bottom }) => {
        const describe = (x: number, y: number) => {
          const target = document.elementFromPoint(x, y);
          const element = target instanceof Element ? target : null;
          return {
            tag: element?.tagName ?? null,
            className: element?.getAttribute("class") ?? null,
            canvas: Boolean(
              element?.closest("[data-multi-screen-canvas-surface]"),
            ),
            frame:
              element
                ?.closest("[data-frame-shell]")
                ?.getAttribute("data-frame-id") ?? null,
            screenCard: Boolean(element?.closest("[data-screen-card]")),
            control:
              element?.closest("button,[role=button]")?.textContent?.trim() ??
              null,
          };
        };
        return {
          start: describe(right, bottom),
          end: describe(left, top),
        };
      },
      { left, top, right, bottom },
    );
    expect(hitTargets.start.canvas).toBe(true);
    expect(hitTargets.end.canvas).toBe(true);
    expect(hitTargets.start.frame).toBeNull();
    expect(hitTargets.end.frame).toBeNull();
    expect(hitTargets.start.control).toBeNull();
    expect(hitTargets.end.control).toBeNull();

    await page.mouse.move(right, bottom);
    await page.mouse.down();
    await page.mouse.move(left, top, { steps: 16 });
    await expect(passiveScreenSelections).toHaveCount(2);
    await expect(groupScreenSelection).toHaveCount(1);
    await page.mouse.up();

    await expect(passiveScreenSelections).toHaveCount(2);
    await expect(groupScreenSelection).toHaveCount(1);
    await expect(blueBoxRow).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Home")).toHaveCount(0);
    await expect(layerRow(page, "Second")).toHaveCount(0);
    await expect(layerRow(page, "Third")).toHaveCount(1);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await page.keyboard.press(UNDO);
    await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 10_000 });
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});

test("deletes multiple selected Screens as one undoable operation", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);

    await layerRow(page, "Home").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]'),
    ).toHaveCount(3);

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Home")).toHaveCount(0);
    await expect(layerRow(page, "Second")).toHaveCount(0);
    await expect(layerRow(page, "Third")).toHaveCount(1);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await page.keyboard.press(UNDO);
    await expect(layerRow(page, "Home")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);

    await page.keyboard.press(REDO);
    await expect(layerRow(page, "Home")).toHaveCount(0, { timeout: 10_000 });
    await expect(layerRow(page, "Second")).toHaveCount(0);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});
