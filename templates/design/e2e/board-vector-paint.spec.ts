import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px"></main></body></html>`;

/**
 * A pen path committed on the BOARD, nested in a frame — the shape reported
 * broken. Board elements select through their own iframe surface, so a screen
 * fixture does not exercise the same selection path.
 */
const BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: transparent; }
  body { margin: 0; position: relative; overflow: visible; }
</style>
</head>
<body>
<div data-agent-native-node-id="frame-1" data-agent-native-layer-name="Frame" data-an-primitive="frame" style="position: absolute; left: 860px; top: 120px; width: 310px; height: 204px; background: rgb(255, 255, 255); overflow: hidden;"><svg data-agent-native-node-id="draft-pen-board-1" data-agent-native-layer-name="Vector" data-an-primitive="path" viewBox="60 60 200 140" preserveAspectRatio="none" style="position: absolute; left: 20px; top: 20px; width: 200px; height: 140px; overflow: visible; background-color: #782323; border-width: 1px; border-style: solid; border-color: #000000" data-an-pen-nodes="[1,[60,60,null,null,null,null],[260,60,null,null,null,null],[160,200,null,null,null,null]]"><path d="M 60 60 L 260 60 L 160 200 L 60 60 Z" fill="rgb(218 218 218)" stroke="none" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Board vector paint ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  const second = await action(request, "create-file", {
    designId,
    filename: "second.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const secondId = second.id ?? second.data?.id;
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardFileId = board.id ?? board.data?.id;
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", secondId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", secondId],
        value: { x: 1200, y: 0, width: 800, height: 600, z: 0 },
      },
      { op: "set", path: ["boardFileId"], value: boardFileId },
    ],
  });
  return { designId, boardFileId };
}

/** What the inspector reported, and where the paint actually landed. */
async function boardVectorPaint(page: Page) {
  return page.evaluate(() => {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      const svg = doc?.querySelector<SVGElement>(
        'svg[data-agent-native-node-id="draft-pen-board-1"]',
      );
      const path = svg?.querySelector("path");
      if (!svg || !path) continue;
      const wrapper = (svg as unknown as HTMLElement).style;
      const shape = getComputedStyle(path);
      return {
        shapeFill: shape.fill,
        shapeStroke: shape.stroke,
        shapeStrokeWidth: shape.strokeWidth,
        wrapperBackground: wrapper.backgroundColor || wrapper.background,
        wrapperBorderWidth: wrapper.borderWidth,
      };
    }
    return null;
  });
}

async function boardVectorStrokeGradient(page: Page) {
  return page.evaluate(() => {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      const svg = doc?.querySelector<SVGElement>(
        'svg[data-agent-native-node-id="draft-pen-board-1"]',
      );
      const path = svg?.querySelector("path");
      if (!svg || !path) continue;
      const stroke = path.style.stroke || path.getAttribute("stroke") || "";
      const gradientIds = Array.from(
        svg.querySelectorAll<SVGGradientElement>(
          "defs[data-an-vector-stroke-gradient] linearGradient, defs[data-an-vector-stroke-gradient] radialGradient",
        ),
      ).map((gradient) => gradient.id);
      return {
        gradientCount: svg.querySelectorAll(
          "defs[data-an-vector-stroke-gradient]",
        ).length,
        referencesGradient: gradientIds.some((id) => stroke.includes(id)),
      };
    }
    return null;
  });
}

async function boardVectorFillGradient(page: Page) {
  return page.evaluate(async () => {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      const svg = doc?.querySelector<SVGSVGElement>(
        'svg[data-agent-native-node-id="draft-pen-board-1"]',
      );
      const path = svg?.querySelector<SVGPathElement>("path");
      if (!svg || !path) continue;
      const fill = path.style.fill || path.getAttribute("fill") || "";
      const stroke = path.style.stroke || path.getAttribute("stroke") || "";
      const gradientIds = Array.from(
        svg.querySelectorAll<SVGGradientElement>(
          "defs[data-an-vector-fill-gradient] linearGradient, defs[data-an-vector-fill-gradient] radialGradient",
        ),
      ).map((gradient) => gradient.id);
      const strokeGradientIds = Array.from(
        svg.querySelectorAll<SVGGradientElement>(
          "defs[data-an-vector-stroke-gradient] linearGradient, defs[data-an-vector-stroke-gradient] radialGradient",
        ),
      ).map((gradient) => gradient.id);
      const gradientTag =
        svg.querySelector(
          "defs[data-an-vector-fill-gradient] > linearGradient, defs[data-an-vector-fill-gradient] > radialGradient",
        )?.tagName ?? null;
      let serializedSvg = "";
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "200");
      clone.setAttribute("height", "140");
      serializedSvg = new XMLSerializer().serializeToString(clone);
      return {
        gradientCount: svg.querySelectorAll(
          "defs[data-an-vector-fill-gradient]",
        ).length,
        gradientTag,
        referencesGradient: gradientIds.some((id) => fill.includes(id)),
        fill,
        stroke,
        strokeGradientCount: svg.querySelectorAll(
          "defs[data-an-vector-stroke-gradient]",
        ).length,
        referencesStrokeGradient: strokeGradientIds.some((id) =>
          stroke.includes(id),
        ),
        serializedSvg,
      };
    }
    return null;
  });
}

async function persistedBoardVectorPaint(
  request: APIRequestContext,
  designId: string,
  boardFileId: string,
) {
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const html = design.files?.find(
    (file: { id?: string }) => file.id === boardFileId,
  )?.content;
  if (typeof html !== "string") throw new Error("board HTML was not returned");
  return html;
}

async function sourceVectorPaint(page: Page, html: string) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    const path = document.querySelector<SVGPathElement>(
      'svg[data-agent-native-node-id="draft-pen-board-1"] > path',
    );
    if (!path) return null;
    return {
      fill: path.style.fill || path.getAttribute("fill"),
      stroke: path.style.stroke || path.getAttribute("stroke"),
      strokeWidth: path.style.strokeWidth || path.getAttribute("stroke-width"),
    };
  }, html);
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

/**
 * Selects through the Layers panel, which is the same projection-backed
 * selection path a URL-restored board selection uses — a canvas click on the
 * board goes through the bridge instead and hides the defect.
 */
async function selectLayerRow(page: Page, name: string) {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(name);
  const button = layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click({ force: true });
  const row = button.locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(row).toHaveAttribute("aria-selected", "true");
}

function inspectorSection(page: Page, title: RegExp) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

test("a board pen shape's fill and stroke paint the shape, not the wrapper box", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=200`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await expect
      .poll(() => boardVectorPaint(page), { timeout: 40_000 })
      .not.toBeNull();

    await selectLayerRow(page, "Vector");

    // The row label and plus affordance both add a paint, like Figma's section.
    const fillSection = inspectorSection(page, /^Fill$/i);
    await expect(fillSection).toBeVisible();
    await fillSection.locator('button[aria-label="Add fill"]').click();
    await expect
      .poll(async () => (await boardVectorPaint(page))?.wrapperBackground, {
        timeout: 15_000,
      })
      .toBe("");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    const strokeAddButtons = strokeSection.getByRole("button", {
      name: "Add stroke",
    });
    await expect(strokeAddButtons).toHaveCount(2);
    const headingAddStroke = strokeAddButtons.first();
    const headingBounds = await headingAddStroke.boundingBox();
    if (!headingBounds) throw new Error("Stroke heading has no bounds");
    await page.mouse.click(
      headingBounds.x + headingBounds.width - 4,
      headingBounds.y + headingBounds.height / 2,
    );
    await expect
      .poll(async () => (await boardVectorPaint(page))?.wrapperBorderWidth, {
        timeout: 15_000,
      })
      .toBe("");

    const paint = (await boardVectorPaint(page))!;
    expect(paint.shapeFill).toBe("rgb(218, 218, 218)");
    expect(paint.shapeStroke).toBe("rgb(0, 0, 0)");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Shift+X swaps a board SVG fill and stroke as one undoable edit", async ({
  page,
  request,
}) => {
  const { designId, boardFileId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=200`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await expect
      .poll(() => boardVectorPaint(page), { timeout: 40_000 })
      .not.toBeNull();
    await selectLayerRow(page, "Vector");

    const before = await boardVectorPaint(page);
    expect(before?.shapeFill).toBe("rgb(218, 218, 218)");
    expect(before?.shapeStroke).toBe("none");

    await page.keyboard.press("Shift+x");
    await expect
      .poll(async () => {
        const paint = await boardVectorPaint(page);
        return paint && [paint.shapeFill, paint.shapeStroke];
      })
      .toEqual(["none", "rgb(218, 218, 218)"]);
    await expect
      .poll(async () => {
        const paint = await boardVectorPaint(page);
        return Number.parseFloat(paint?.shapeStrokeWidth ?? "0");
      })
      .toBeGreaterThan(0);

    const savedPaint = async () =>
      sourceVectorPaint(
        page,
        await persistedBoardVectorPaint(request, designId, boardFileId),
      );
    await expect
      .poll(async () => {
        const source = await savedPaint();
        return source && [source.fill, source.stroke];
      })
      .toEqual([
        "none",
        expect.stringMatching(/218\s+218\s+218|218,\s*218,\s*218/i),
      ]);
    const sourceAfterSwap = await savedPaint();
    expect(sourceAfterSwap?.fill).toBe("none");
    expect(sourceAfterSwap?.stroke).toMatch(
      /218\s+218\s+218|218,\s*218,\s*218/i,
    );

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Edit$/ }).hover();
    await expect(page.getByRole("menuitem", { name: /Undo/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(async () => {
        const source = await savedPaint();
        return source && [source.fill, source.stroke];
      })
      .toEqual([
        expect.stringMatching(/218\s+218\s+218|218,\s*218,\s*218/i),
        "none",
      ]);
    await expect
      .poll(async () => {
        const paint = await boardVectorPaint(page);
        return paint && [paint.shapeFill, paint.shapeStroke];
      })
      .toEqual(["rgb(218, 218, 218)", "none"]);
    const savedAfterUndo = await persistedBoardVectorPaint(
      request,
      designId,
      boardFileId,
    );
    const sourceAfterUndo = await sourceVectorPaint(page, savedAfterUndo);
    expect(sourceAfterUndo?.fill).toMatch(/218\s+218\s+218|218,\s*218,\s*218/i);
    expect(sourceAfterUndo?.stroke).toBe("none");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect
      .poll(async () => {
        const paint = await boardVectorPaint(page);
        return paint && [paint.shapeFill, paint.shapeStroke];
      })
      .toEqual(["none", "rgb(218, 218, 218)"]);
    await expect
      .poll(async () => {
        const source = await savedPaint();
        return source && [source.fill, source.stroke];
      })
      .toEqual([
        "none",
        expect.stringMatching(/218\s+218\s+218|218,\s*218,\s*218/i),
      ]);
    const savedAfterRedo = await persistedBoardVectorPaint(
      request,
      designId,
      boardFileId,
    );
    const sourceAfterRedo = await sourceVectorPaint(page, savedAfterRedo);
    expect(sourceAfterRedo?.fill).toBe("none");
    expect(sourceAfterRedo?.stroke).toMatch(
      /218\s+218\s+218|218,\s*218,\s*218/i,
    );
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("vector stroke gradient is visible, persisted, undoable, and reloadable", async ({
  page,
  request,
}, testInfo) => {
  const { designId, boardFileId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=200`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await expect
      .poll(() => boardVectorPaint(page), { timeout: 40_000 })
      .not.toBeNull();
    await selectLayerRow(page, "Vector");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await expect(strokeSection).toBeVisible();
    await strokeSection
      .getByRole("button", { name: "Add stroke" })
      .first()
      .click();
    const strokePicker = strokeSection.getByRole("button", {
      name: "Open color picker",
    });
    await strokePicker.click();
    const strokePopoverId = await strokePicker.getAttribute("aria-controls");
    expect(strokePopoverId).toBeTruthy();
    await page
      .locator(`[id="${strokePopoverId}"]`)
      .getByRole("button", { name: "Linear", exact: true })
      .click();

    await expect
      .poll(() => boardVectorStrokeGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    await expect
      .poll(async () => {
        const source = await persistedBoardVectorPaint(
          request,
          designId,
          boardFileId,
        );
        return source;
      })
      .toContain("data-an-vector-stroke-gradient");

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(() => boardVectorStrokeGradient(page))
      .toMatchObject({ gradientCount: 0, referencesGradient: false });
    await expect
      .poll(async () => {
        const source = await persistedBoardVectorPaint(
          request,
          designId,
          boardFileId,
        );
        return source;
      })
      .not.toContain("data-an-vector-stroke-gradient");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect
      .poll(() => boardVectorStrokeGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    await page.reload();
    await expect
      .poll(() => boardVectorStrokeGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    await selectLayerRow(page, "Vector");
    const reloadedStrokePicker = inspectorSection(page, /^Stroke$/i).getByRole(
      "button",
      { name: "Open color picker" },
    );
    await expect(reloadedStrokePicker).toContainText("Linear");
    await reloadedStrokePicker.click();
    const reloadedStrokePopoverId =
      await reloadedStrokePicker.getAttribute("aria-controls");
    expect(reloadedStrokePopoverId).toBeTruthy();
    await expect(
      page
        .locator(`[id="${reloadedStrokePopoverId}"]`)
        .getByRole("button", { name: "Linear", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const source = await persistedBoardVectorPaint(
          request,
          designId,
          boardFileId,
        );
        return source;
      })
      .toContain("data-an-vector-stroke-gradient");
    await page.screenshot({
      path: testInfo.outputPath("vector-stroke-gradient.png"),
    });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("vector fill gradient renders in the inspector, source, SVG and PNG exports", async ({
  page,
  request,
}, testInfo) => {
  const { designId, boardFileId } = await createDesign(request);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=200`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await expect
      .poll(() => boardVectorPaint(page), { timeout: 40_000 })
      .not.toBeNull();
    await selectLayerRow(page, "Vector");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await expect(strokeSection).toBeVisible();
    await strokeSection
      .getByRole("button", { name: "Add stroke" })
      .first()
      .click();
    const strokePicker = strokeSection.getByRole("button", {
      name: "Open color picker",
    });
    await strokePicker.click();
    const strokePopoverId = await strokePicker.getAttribute("aria-controls");
    expect(strokePopoverId).toBeTruthy();
    await page
      .locator(`[id="${strokePopoverId}"]`)
      .getByRole("button", { name: "Linear", exact: true })
      .click();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({
        strokeGradientCount: 1,
        referencesStrokeGradient: true,
      });
    await expect.poll(() => boardVectorFillGradient(page)).not.toBeNull();
    const initialStroke = (await boardVectorFillGradient(page))?.stroke;
    expect(initialStroke).toBeTruthy();
    expect(initialStroke).not.toBe("none");

    const fillSection = inspectorSection(page, /^Fill$/i);
    await expect(fillSection).toBeVisible();
    const fillPicker = fillSection.getByRole("button", {
      name: "Open color picker",
    });
    await fillPicker.click();
    const fillPopoverId = await fillPicker.getAttribute("aria-controls");
    expect(fillPopoverId).toBeTruthy();
    await page
      .locator(`[id="${fillPopoverId}"]`)
      .getByRole("button", { name: "Linear", exact: true })
      .click();
    const gradientDialog = page.getByRole("dialog");
    await expect(
      gradientDialog.getByRole("group", { name: "Gradient stops" }),
    ).toBeVisible();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "linearGradient" });

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 0, referencesGradient: false });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "linearGradient" });

    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    await expect(gradientDialog).toBeVisible();
    await gradientDialog
      .getByRole("button", { name: "Radial", exact: true })
      .click();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "radialGradient" });
    await expect
      .poll(() => persistedBoardVectorPaint(request, designId, boardFileId))
      .toContain("<radialGradient");
    await page.screenshot({
      path: testInfo.outputPath("vector-fill-radial-gradient-live.png"),
    });
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "linearGradient" });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "radialGradient" });

    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    await expect(gradientDialog).toBeVisible();
    await gradientDialog
      .getByRole("button", { name: "Linear", exact: true })
      .click();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, gradientTag: "linearGradient" });
    const hex = gradientDialog.getByRole("textbox", {
      name: "Hex",
      exact: true,
    });
    await gradientDialog
      .getByRole("button", { name: / at 0%$/ })
      .first()
      .click();
    await hex.fill("ff0000");
    await hex.press("Enter");
    await expect.poll(() => hex.inputValue()).toMatch(/ff0000/i);
    await gradientDialog
      .getByRole("button", { name: / at 100%$/ })
      .first()
      .click();
    await hex.fill("0000ff");
    await hex.press("Enter");
    await expect.poll(() => hex.inputValue()).toMatch(/0000ff/i);
    const opacity = gradientDialog.getByRole("spinbutton", {
      name: "Opacity",
      exact: true,
    });
    await opacity.fill("100");
    await opacity.press("Enter");
    await expect.poll(() => opacity.inputValue()).toBe("100");

    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({
        gradientCount: 1,
        referencesGradient: true,
      });
    const pixels = await boardVectorFillGradient(page);
    await testInfo.attach("vector-fill-gradient-raster-source.svg", {
      body: pixels?.serializedSvg ?? "missing svg",
      contentType: "image/svg+xml",
    });
    expect(pixels?.stroke).toBe(initialStroke);
    expect(pixels?.strokeGradientCount).toBe(1);
    expect(pixels?.referencesStrokeGradient).toBe(true);
    expect(pixels?.serializedSvg).toContain("data-an-vector-fill-gradient");
    await page.screenshot({
      path: testInfo.outputPath("vector-fill-gradient-live.png"),
    });

    const savedGradient = await expect
      .poll(() => persistedBoardVectorPaint(request, designId, boardFileId))
      .toContain("data-an-vector-fill-gradient");
    void savedGradient;
    const savedSource = await persistedBoardVectorPaint(
      request,
      designId,
      boardFileId,
    );
    expect(savedSource).toContain(
      "fill: url(#draft-pen-board-1-fill-gradient)",
    );
    expect(savedSource).toContain("data-an-vector-stroke-gradient");
    expect(
      savedSource.match(/<defs[^>]*data-an-vector-fill-gradient/g),
    ).toHaveLength(1);
    expect(savedSource).toContain('id="draft-pen-board-1-stroke-gradient"');
    expect(savedSource).toContain('id="draft-pen-board-1-fill-gradient"');

    await page.getByRole("button", { name: "More", exact: true }).click();
    const exportMenu = page.getByRole("menuitem", { name: "Export" });
    await expect(exportMenu).toBeVisible();
    await exportMenu.press("ArrowRight");
    await expect(
      page.getByRole("menuitem", { name: "Download for Figma (SVG)" }),
    ).toBeVisible();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Download for Figma (SVG)" }).click(),
    ]);
    const svgStream = await svgDownload.createReadStream();
    if (!svgStream) throw new Error("SVG export returned no data");
    const svgChunks: Buffer[] = [];
    for await (const chunk of svgStream) svgChunks.push(Buffer.from(chunk));
    const exportedSvg = Buffer.concat(svgChunks).toString("utf8");
    expect(exportedSvg).toContain("linearGradient");
    expect(exportedSvg).toContain("url(#draft-pen-board-1-fill-gradient)");

    const pngExportButton = inspectorSection(page, /^Export$/i).getByRole(
      "button",
      { name: "Export", exact: true },
    );
    await expect(pngExportButton).toBeEnabled();
    const [pngDownload] = await Promise.all([
      page.waitForEvent("download"),
      pngExportButton.click(),
    ]);
    const pngStream = await pngDownload.createReadStream();
    if (!pngStream) throw new Error("PNG export returned no data");
    const pngChunks: Buffer[] = [];
    for await (const chunk of pngStream) pngChunks.push(Buffer.from(chunk));
    const pngBase64 = Buffer.concat(pngChunks).toString("base64");
    const exportedPixels = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not read PNG export pixels");
      context.drawImage(image, 0, 0);
      const pixels = (x: number, y: number) => [
        ...context.getImageData(x, y, 1, 1).data,
      ];
      const imagePixels = context.getImageData(
        0,
        0,
        image.width,
        image.height,
      ).data;
      let redPixels = 0;
      let bluePixels = 0;
      for (let index = 0; index < imagePixels.length; index += 4) {
        const red = imagePixels[index]!;
        const green = imagePixels[index + 1]!;
        const blue = imagePixels[index + 2]!;
        if (red > 200 && green < 100 && blue < 100) redPixels += 1;
        if (blue > 160 && red < 100 && green < 120) bluePixels += 1;
      }
      return {
        width: image.width,
        height: image.height,
        left: pixels(20, 20),
        right: pixels(image.width - 20, 20),
        redPixels,
        bluePixels,
      };
    }, pngBase64);
    await pngDownload.saveAs(
      testInfo.outputPath("vector-fill-gradient-export.png"),
    );
    await testInfo.attach("vector-fill-gradient-export-pixels.json", {
      body: JSON.stringify(exportedPixels),
      contentType: "application/json",
    });
    expect(exportedPixels.width).toBeGreaterThan(0);
    expect(exportedPixels.height).toBeGreaterThan(0);
    expect(exportedPixels.redPixels).toBeGreaterThan(10);
    expect(exportedPixels.bluePixels).toBeGreaterThan(10);

    await page.reload();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    expect(
      await persistedBoardVectorPaint(request, designId, boardFileId),
    ).toContain("data-an-vector-fill-gradient");
    await testInfo.attach("vector-fill-gradient-browser-errors.json", {
      body: JSON.stringify({ pageErrors, consoleErrors, failedRequests }),
      contentType: "application/json",
    });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("converting a vector fill gradient to solid clears source metadata and round-trips through undo", async ({
  page,
  request,
}, testInfo) => {
  const { designId, boardFileId } = await createDesign(request);
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    ),
  );
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=200`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await expect
      .poll(() => boardVectorPaint(page), { timeout: 40_000 })
      .not.toBeNull();
    await selectLayerRow(page, "Vector");

    const fillSection = inspectorSection(page, /^Fill$/i);
    const gradientDialog = page.getByRole("dialog");
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    await expect(gradientDialog).toBeVisible();
    await gradientDialog
      .getByRole("button", { name: "Linear", exact: true })
      .click();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    await expect
      .poll(() => persistedBoardVectorPaint(request, designId, boardFileId))
      .toContain("data-an-vector-fill-gradient");
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count())
      .toBeGreaterThan(1);
    await page.screenshot({
      path: testInfo.outputPath("before-vector-gradient-solid.png"),
    });

    await expect(gradientDialog).toBeVisible();
    await gradientDialog
      .getByRole("button", { name: "Solid", exact: true })
      .click();
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 0, referencesGradient: false });
    await expect
      .poll(() => persistedBoardVectorPaint(request, designId, boardFileId))
      .not.toContain("data-an-vector-fill-gradient");
    const solidSource = await persistedBoardVectorPaint(
      request,
      designId,
      boardFileId,
    );
    const solidPaint = await sourceVectorPaint(page, solidSource);
    expect(solidPaint?.fill).toBeTruthy();
    expect(solidPaint?.fill).not.toMatch(/url\(/i);

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 1, referencesGradient: true });
    await expect
      .poll(() => persistedBoardVectorPaint(request, designId, boardFileId))
      .toContain("data-an-vector-fill-gradient");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect
      .poll(() => boardVectorFillGradient(page))
      .toMatchObject({ gradientCount: 0, referencesGradient: false });
    await expect
      .poll(async () => {
        const source = await persistedBoardVectorPaint(
          request,
          designId,
          boardFileId,
        );
        return (await sourceVectorPaint(page, source))?.fill;
      })
      .toBe(solidPaint?.fill);
    const redoneSource = await persistedBoardVectorPaint(
      request,
      designId,
      boardFileId,
    );
    const redonePaint = await sourceVectorPaint(page, redoneSource);
    expect(redonePaint?.fill).toBeTruthy();
    expect(redonePaint?.fill).not.toMatch(/url\(/i);
    expect(redoneSource).not.toContain("data-an-vector-fill-gradient");
  } finally {
    await testInfo.attach("vector-fill-solid-errors.json", {
      body: JSON.stringify({ pageErrors, failedRequests, url: page.url() }),
      contentType: "application/json",
    });
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
