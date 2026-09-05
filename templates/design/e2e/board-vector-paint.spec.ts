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
        wrapperBackground: wrapper.backgroundColor || wrapper.background,
        wrapperBorderWidth: wrapper.borderWidth,
      };
    }
    return null;
  });
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
  await page.waitForTimeout(1200);
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
    await page.waitForTimeout(3500);

    await selectLayerRow(page, "Vector");

    // The user's gesture: the section starts empty for a shape whose paint
    // lives on its SVG child, so "+" is what they press.
    const fillSection = inspectorSection(page, /^Fill$/i);
    await expect(fillSection).toBeVisible();
    await fillSection.locator('button[aria-label="Add fill"]').click();
    await expect
      .poll(async () => (await boardVectorPaint(page))?.wrapperBackground, {
        timeout: 15_000,
      })
      .toBe("");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await strokeSection.locator('button[aria-label="Add stroke"]').click();
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
