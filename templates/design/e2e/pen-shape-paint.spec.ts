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
    title: `Pen shape paint ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
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
    ],
  });
  return designId;
}

/** The committed vector's paint, read from both the wrapper and the shape. */
async function vectorPaint(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    const svg = doc?.querySelector<SVGElement>("svg[data-an-primitive]");
    const path = svg?.querySelector("path");
    if (!svg || !path) return null;
    const svgStyle = (svg as unknown as HTMLElement).style;
    const shape = getComputedStyle(path);
    return {
      fillAttribute: path.getAttribute("fill"),
      strokeAttribute: path.getAttribute("stroke"),
      shapeFill: shape.fill,
      shapeStroke: shape.stroke,
      shapeStrokeWidth: shape.strokeWidth,
      wrapperBackground: svgStyle.background || svgStyle.backgroundColor,
      wrapperBorderWidth: svgStyle.borderWidth,
    };
  });
}

async function penClick(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

function inspectorSection(page: Page, title: RegExp) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

/** Draws a closed triangle with the pen tool and selects it with the move tool. */
async function drawClosedTriangle(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(async () => page.locator("[data-screen-shell]").count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  const card = (await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox())!;
  const a = { x: card.x + 60, y: card.y + 200 };

  await page.keyboard.press("p");
  await page.waitForTimeout(400);
  await penClick(page, a.x, a.y);
  await penClick(page, card.x + 180, card.y + 160);
  await penClick(page, card.x + 140, card.y + 260);
  // Clicking the first anchor again closes the path — Enter would leave it open.
  await penClick(page, a.x, a.y);
  await page.waitForTimeout(2500);

  return { centroid: { x: card.x + 127, y: card.y + 207 } };
}

test("a closed pen path commits filled and unstroked, like a drawn rectangle", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await drawClosedTriangle(page, designId);

    const paint = await vectorPaint(page);
    expect(paint).not.toBeNull();
    expect(paint!.fillAttribute).toBe("rgb(218 218 218)");
    expect(paint!.strokeAttribute).toBe("none");
    expect(paint!.shapeStroke).toBe("none");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("fill and stroke edits paint the pen shape, not its selection bounds", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    const { centroid } = await drawClosedTriangle(page, designId);

    await page.keyboard.press("v");
    await page.waitForTimeout(400);
    await page.mouse.click(centroid.x, centroid.y);
    await page.waitForTimeout(1200);

    const fillSection = inspectorSection(page, /^Fill$/i);
    await expect(fillSection).toBeVisible();
    await fillSection.locator('button[aria-label="Hide layer"]').click();
    await expect
      .poll(async () => (await vectorPaint(page))?.shapeFill)
      .toBe("rgba(218, 218, 218, 0)");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await strokeSection.locator('button[aria-label="Add stroke"]').click();
    await expect
      .poll(async () => (await vectorPaint(page))?.shapeStroke)
      .toBe("rgb(0, 0, 0)");

    // The wrapper is the geometry box; painting it would tint the whole
    // bounding rectangle instead of the triangle.
    const paint = (await vectorPaint(page))!;
    expect(paint.wrapperBackground).toBe("");
    expect(paint.wrapperBorderWidth).toBe("");
    expect(paint.shapeStrokeWidth).toBe("1px");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
