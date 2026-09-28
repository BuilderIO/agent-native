import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

type DesignRecord = {
  data?: string | Record<string, unknown>;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function dataOf(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : (record.data ?? {});
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
  if (!point) throw new Error("no empty board point found");
  return point;
}

async function renderedWorldScale(page: Page) {
  return page
    .locator("[data-multi-screen-canvas-world]")
    .evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      const matrix =
        transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(transform);
      return { transform, scaleX: matrix.a, scaleY: matrix.d };
    });
}

test("new Screen geometry accepts immediate width and height commits", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen geometry rapid diagnostic ${Date.now()}`,
  );
  await gotoEditor(page, designId);
  const before = await readDesign(page, designId);
  const existingFiles = new Set(before.files?.map((file) => file.id));
  await pickFrameMode(page, "Screen");
  const start = await emptyBoardPoint(page);
  const drawScale = await renderedWorldScale(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
  await page.mouse.up();

  let screenId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const file = record.files?.find(
        (candidate) => !existingFiles.has(candidate.id),
      );
      if (!file || file.filename === "__board__.html") return null;
      screenId = file.id;
      return file.id;
    })
    .not.toBeNull();
  const createdRecord = await readDesign(page, designId);
  await test.info().attach("rapid-screen-identities", {
    body: JSON.stringify(
      {
        designId,
        screenId,
        drawScale,
        geometryAtFileCreation: dataOf(createdRecord).canvasFrames?.[screenId],
        metadataAtFileCreation:
          dataOf(createdRecord).screenMetadata?.[screenId],
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();
  const writes: Array<{ at: number; url: string; body: string | null }> = [];
  page.on("request", (request) => {
    if (request.url().includes("/_agent-native/actions/update-design")) {
      writes.push({
        at: Date.now(),
        url: request.url(),
        body: request.postData(),
      });
    }
  });
  const width = page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ });
  const height = page.getByRole("textbox", { name: /^H(?: size in pixels)?$/ });
  const drawnWidth = Number.parseFloat(await width.inputValue());
  const drawnHeight = Number.parseFloat(await height.inputValue());
  expect(Math.abs(drawnWidth - 190 / drawScale.scaleX)).toBeLessThan(1);
  expect(Math.abs(drawnHeight - 150 / drawScale.scaleY)).toBeLessThan(1);
  await width.fill("1440");
  await width.press("Enter");
  await height.fill("1024");
  await height.press("Enter");
  const afterBurstRecord = await readDesign(page, designId);
  const afterBurstData = dataOf(afterBurstRecord);
  const afterBurst = {
    designId,
    screenId,
    widthInput: await width.inputValue(),
    heightInput: await height.inputValue(),
    canvasFrame: afterBurstData.canvasFrames?.[screenId],
    metadata: afterBurstData.screenMetadata?.[screenId],
  };
  console.log("screen-geometry-after-immediate-WH", { ...afterBurst, writes });
  await test.info().attach("rapid-screen-after-width-height", {
    body: JSON.stringify({ ...afterBurst, writes }, null, 2),
    contentType: "application/json",
  });
  await expect
    .poll(async () => {
      const data = dataOf(await readDesign(page, designId));
      const frame = data.canvasFrames?.[screenId];
      const metadata = data.screenMetadata?.[screenId];
      return [frame?.width, frame?.height, metadata?.width, metadata?.height];
    })
    .toEqual([1440, 1024, 1440, 1024]);
});
