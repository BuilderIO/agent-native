import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
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
    await page.locator("[data-frame-label]").first().click();
    const dragSurface = page.locator("[data-frame-drag-surface]");
    await expect(dragSurface).toBeVisible();

    const before = await frameOffsets(page);
    await altDrag(page, dragSurface, 220, 140);

    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    const copyId = Object.keys(await frameOffsets(page)).find(
      (id) => id !== fileIds[0],
    );
    if (!copyId) throw new Error("Alt-drag did not create a duplicate frame");
    await expect
      .poll(
        async () => {
          const offset = (await frameOffsets(page))[copyId!];
          return Boolean(
            offset &&
            offset.left > before[fileIds[0]!]!.left &&
            offset.top > before[fileIds[0]!]!.top,
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const after = await frameOffsets(page);
    expect(after[fileIds[0]!]).toEqual(before[fileIds[0]!]);
    expect(after[copyId]!.left).toBeGreaterThan(before[fileIds[0]!]!.left);
    expect(after[copyId]!.top).toBeGreaterThan(before[fileIds[0]!]!.top);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("alt-dragging a frame over an occupied screen keeps the copy above it", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request, 2);
  const occupiedId = fileIds[1]!;
  try {
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", occupiedId],
          value: { x: 1600, y: 0, width: 1280, height: 900, z: 90 },
        },
      ],
    });
    await openOverview(page, designId, 2);
    await page.locator("[data-frame-label]").first().click();

    const source = page.locator("[data-frame-drag-surface]").first();
    const occupied = page.locator("[data-frame-label]").nth(1);
    const start = await visibleCentre(page, source);
    const drop = await visibleCentre(page, occupied);
    await altDrag(page, source, drop.x - start.x, drop.y - start.y);

    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 30_000,
    });
    let frames: Record<
      string,
      { x: number; y: number; width: number; height: number; z: number }
    > = {};
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `${BASE_URL}/_agent-native/actions/get-design`,
            { params: { id: designId, includeFileContent: "false" } },
          );
          if (!response.ok()) {
            throw new Error(`get-design: ${response.status()}`);
          }
          const design = await response.json();
          const data =
            typeof design.data === "string"
              ? JSON.parse(design.data)
              : design.data;
          if (!data || typeof data !== "object" || !data.canvasFrames) {
            throw new Error("get-design returned no canvas frame geometry");
          }
          frames = data.canvasFrames;
          return Object.keys(frames).length;
        },
        { timeout: 30_000 },
      )
      .toBe(3);

    const copyId = Object.keys(frames).find((id) => !fileIds.includes(id));
    if (!copyId) throw new Error("Alt-drag did not create a duplicate frame");
    const copy = frames[copyId]!;
    const existing = frames[occupiedId]!;
    const overlaps =
      copy.x < existing.x + existing.width &&
      copy.x + copy.width > existing.x &&
      copy.y < existing.y + existing.height &&
      copy.y + copy.height > existing.y;
    expect(overlaps).toBe(true);
    expect(copy.z).toBeGreaterThan(existing.z);
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

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 20_000,
    });

    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    await page.keyboard.press(redoShortcut);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(4, {
      timeout: 20_000,
    });
    const selectedCopyRows = page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]')
      .filter({ hasText: "copy" });
    await expect(selectedCopyRows).toHaveCount(2, { timeout: 20_000 });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
