import { expect, test, type Page } from "@playwright/test";

import { appPath, gotoEditor, pickFrameMode } from "./helpers";

const HOME_HTML = `<!doctype html><html lang="en"><head><title>Home</title></head><body style="margin:0;min-height:600px"><main style="position:absolute;left:24px;top:32px;width:120px;height:60px;background:#3b82f6"></main></body></html>`;
const SECOND_HTML = `<!doctype html><html lang="en"><head><title>Screen 2</title></head><body style="margin:0;min-height:480px"><main style="position:absolute;left:24px;top:32px;width:120px;height:60px;background:#22c55e"></main></body></html>`;

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename: string; content?: string }>;
};

type Geometry = { x: number; y: number; width: number; height: number };

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = rect.top + 60; y < rect.bottom - 60; y += 40) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 40) {
        if (
          cards.some(
            (card) =>
              x >= card.left - 24 &&
              x <= card.right + 24 &&
              y >= card.top - 24 &&
              y <= card.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

test("a delayed Screen create preserves concurrent geometry edits", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const created = await action(page, "create-design", {
    title: `Screen create geometry map race ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string")
    throw new Error("create-design returned no id");

  let passed = false;
  let releaseCreate: (() => void) | undefined;
  let notifyCreateSeen: (() => void) | undefined;
  const createWasReleased = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const createRequestSeen = new Promise<void>((resolve) => {
    notifyCreateSeen = resolve;
  });
  let createdScreenId = "";
  let otherScreenId = "";

  try {
    await action(page, "create-file", {
      designId,
      filename: "index.html",
      content: HOME_HTML,
      fileType: "html",
    });
    const second = await action(page, "create-file", {
      designId,
      filename: "screen-2.html",
      content: SECOND_HTML,
      fileType: "html",
    });
    otherScreenId = second.id ?? second.data?.id;
    if (typeof otherScreenId !== "string") {
      throw new Error("second create-file returned no id");
    }
    const home = (await readDesign(page, designId)).files?.find(
      (file) => file.filename === "index.html",
    );
    if (!home) throw new Error("Home screen was not created");
    const initialGeometry: Record<string, Geometry> = {
      [home.id]: { x: 0, y: 0, width: 800, height: 600 },
      [otherScreenId]: { x: 1000, y: 0, width: 640, height: 480 },
    };
    await action(page, "update-design", {
      id: designId,
      dataOperations: Object.entries(initialGeometry).flatMap(
        ([fileId, geometry]) => [
          { op: "set", path: ["canvasFrames", fileId], value: geometry },
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: {
              width: geometry.width,
              height: geometry.height,
              heightPinned: true,
              heightMode: "fixed",
            },
          },
        ],
      ),
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await page.route("**/_agent-native/actions/create-file", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.designId !== designId) {
        await route.continue();
        return;
      }
      notifyCreateSeen?.();
      await createWasReleased;
      await route.continue();
    });

    await pickFrameMode(page, "Screen");
    const start = await emptyBoardPoint(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
    await page.mouse.up();
    await createRequestSeen;

    const screenTwoRow = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /Screen 2/ })
      .getByRole("button", { name: "Screen 2" });
    await screenTwoRow.click();
    const widthInput = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    await expect(widthInput).toHaveValue("640px");
    await widthInput.fill("720");
    await widthInput.press("Enter");
    await expect(widthInput).toHaveValue("720px");
    await expect
      .poll(async () => {
        const data = designData(await readDesign(page, designId));
        return [
          data.canvasFrames?.[otherScreenId]?.width,
          data.screenMetadata?.[otherScreenId]?.width,
        ];
      })
      .toEqual([720, 720]);

    const beforeRelease = designData(await readDesign(page, designId));
    expect(beforeRelease.canvasFrames?.[otherScreenId]?.width).toBe(720);
    expect(beforeRelease.screenMetadata?.[otherScreenId]?.width).toBe(720);
    releaseCreate?.();

    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const file = record.files?.find(
          (candidate) =>
            candidate.filename === "screen-3.html" &&
            ![home.id, otherScreenId].includes(candidate.id),
        );
        if (!file) return null;
        createdScreenId = file.id;
        const data = designData(record);
        const createdFrame = data.canvasFrames?.[createdScreenId];
        const createdMetadata = data.screenMetadata?.[createdScreenId];
        return {
          otherFrameWidth: data.canvasFrames?.[otherScreenId]?.width,
          otherMetadataWidth: data.screenMetadata?.[otherScreenId]?.width,
          createdFrame,
          createdMetadata,
        };
      })
      .toMatchObject({
        otherFrameWidth: 720,
        otherMetadataWidth: 720,
        createdFrame: {
          width: expect.any(Number),
          height: expect.any(Number),
        },
        createdMetadata: {
          width: expect.any(Number),
          height: expect.any(Number),
        },
      });

    const savedBeforeReload = designData(await readDesign(page, designId));
    const createdFrameBeforeReload =
      savedBeforeReload.canvasFrames[createdScreenId];
    expect(savedBeforeReload.canvasFrames[otherScreenId]?.width).toBe(720);
    expect(savedBeforeReload.screenMetadata[otherScreenId]?.width).toBe(720);
    expect(savedBeforeReload.screenMetadata[createdScreenId]).toMatchObject({
      width: createdFrameBeforeReload.width,
      height: createdFrameBeforeReload.height,
    });

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /Screen 2/ })
      .getByRole("button", { name: "Screen 2" })
      .click();
    const reloadedWidth = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    await expect(reloadedWidth).toHaveValue("720px");
    const afterReload = designData(await readDesign(page, designId));
    expect(afterReload.canvasFrames?.[otherScreenId]?.width).toBe(720);
    expect(afterReload.screenMetadata?.[otherScreenId]?.width).toBe(720);
    expect(afterReload.canvasFrames?.[createdScreenId]).toEqual(
      createdFrameBeforeReload,
    );
    passed = true;
  } finally {
    releaseCreate?.();
    if (passed) {
      await action(page, "delete-design", { id: designId }).catch(() => {});
    }
  }
});
