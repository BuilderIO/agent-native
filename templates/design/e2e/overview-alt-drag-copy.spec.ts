import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;
const SCREEN_HTML = `<!doctype html>
<html><body style="margin:0;min-height:900px">
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

async function createDesign(request: APIRequestContext, fileCount: number) {
  const created = await action(request, "create-design", {
    title: `Alt-drag copy QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content: SCREEN_HTML,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, index) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: index * 1600, y: 0, width: 1280, height: 900, z: index },
      },
    ]),
  });
  return { designId, fileIds };
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible();
  await page.waitForTimeout(1500);
}

/** Frames are taller than the window, so the drag surface's own centre is
 *  routinely off-screen and a mouse gesture there lands on <html>. */
async function visibleCentre(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const view = page.viewportSize()!;
  return {
    x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
    y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
  };
}

async function altDrag(page: Page, from: Locator, dx: number, dy: number) {
  const start = await visibleCentre(page, from);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await expect(page.locator("[data-duplicate-preview-ghost]")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

async function frameOffsets(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll<HTMLElement>("[data-frame-id]")).map(
        (node) => [
          node.getAttribute("data-frame-id")!,
          {
            left: Number.parseFloat(node.style.left),
            top: Number.parseFloat(node.style.top),
          },
        ],
      ),
    ),
  );
}

test("alt-dragging a selected frame drops a copy and leaves the original in place", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request, 1);
  try {
    await openOverview(page, designId, 1);
    // Only the label row selects the frame itself; the card body drills in.
    await page.locator("[data-frame-label]").first().click();
    const dragSurface = page.locator("[data-frame-drag-surface]");
    await expect(dragSurface).toBeVisible();

    const before = await frameOffsets(page);
    await altDrag(page, dragSurface, 220, 140);

    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    const after = await frameOffsets(page);
    expect(after[fileIds[0]!]).toEqual(before[fileIds[0]!]);
    const copyId = Object.keys(after).find((id) => id !== fileIds[0])!;
    expect(after[copyId]!.left).toBeGreaterThan(before[fileIds[0]!]!.left);
    expect(after[copyId]!.top).toBeGreaterThan(before[fileIds[0]!]!.top);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("alt-dragging a multi-frame selection copies every frame and keeps their spacing", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request, 2);
  try {
    await openOverview(page, designId, 2);
    await page.locator("[data-frame-label]").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    const dragSurface = page.locator("[data-frame-drag-surface]");
    await expect(dragSurface).toBeVisible();

    const before = await frameOffsets(page);
    await altDrag(page, dragSurface, 0, 200);

    await expect(page.locator("[data-screen-shell]")).toHaveCount(4, {
      timeout: 30_000,
    });
    const after = await frameOffsets(page);
    for (const sourceId of fileIds) {
      expect(after[sourceId]).toEqual(before[sourceId]);
    }
    const copyLefts = Object.keys(after)
      .filter((id) => !fileIds.includes(id))
      .map((id) => after[id]!.left)
      .sort((a, b) => a - b);
    const sourceLefts = fileIds
      .map((id) => before[id]!.left)
      .sort((a, b) => a - b);
    expect(copyLefts).toHaveLength(2);
    expect(copyLefts[1]! - copyLefts[0]!).toBeCloseTo(
      sourceLefts[1]! - sourceLefts[0]!,
      0,
    );
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
