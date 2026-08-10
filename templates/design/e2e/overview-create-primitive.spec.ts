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
<body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
</main></body></html>`;

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
    title: `Create primitive QA ${Date.now()}`,
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
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 1280, height: 900, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

/** Counts source-backed nodes inside the screen's live preview iframe. */
async function previewNodeCount(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const doc = frame?.contentDocument;
    if (!doc) return -1;
    return doc.querySelectorAll("[data-agent-native-node-id]").length;
  });
}

async function drawRectangle(page: Page) {
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const box = (await page.locator("[data-screen-card]").first().boundingBox())!;
  const x = Math.max(box.x, 0) + 60;
  const y = Math.max(box.y, 0) + 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 90, { steps: 10 });
  await page.mouse.up();
}

test("drawing a rectangle shows it immediately and leaves the screen unselected", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const before = await previewNodeCount(page);

    await drawRectangle(page);
    await page.waitForTimeout(2500);

    expect(pageErrors).toEqual([]);
    expect(await previewNodeCount(page)).toBeGreaterThan(before);
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("duplicating right after drawing copies the rectangle, not its screen", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const screensBefore = await page.locator("[data-screen-shell]").count();

    await drawRectangle(page);
    await page.waitForTimeout(2500);
    const nodesAfterDraw = await previewNodeCount(page);

    await page.keyboard.press("ControlOrMeta+d");
    await page.waitForTimeout(2500);

    expect(await previewNodeCount(page)).toBeGreaterThan(nodesAfterDraw);
    expect(await page.locator("[data-screen-shell]").count()).toBe(
      screensBefore,
    );
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
