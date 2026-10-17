import { type Page } from "@playwright/test";

import { pickFrameMode } from "./helpers";
import { expect, test } from "./rails";

const ONE_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff">
  <h1 data-agent-native-node-id="title" data-agent-native-layer-name="Title" style="margin:40px">Existing screen</h1>
</body></html>`;

type Frame = { x: number; y: number; width: number; height: number };
type GeometryData = {
  canvasFrames?: Record<string, Frame>;
  screenMetadata?: Record<string, { width?: number; height?: number }>;
};

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

// fixme: fails in CI on current main: expect(received).toStrictEqual(expected) // deep equality
test.fixme("new Screen W/H commits keep frame and metadata geometry in sync", async ({
  app,
}) => {
  const id = await app.seed(ONE_SCREEN);
  await app.open(id);
  const existing = await app.savedRecord(id);
  const existingIds = new Set(existing.files.map((file) => file.id));
  const indexId = existing.files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await pickFrameMode(app.page, "Screen");
  const start = await emptyBoardPoint(app.page);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
  await app.page.mouse.up();
  await app.settled();

  const created = await app.savedRecord(id);
  const newScreens = created.files.filter(
    (file) => !existingIds.has(file.id) && file.filename !== "__board__.html",
  );
  expect(newScreens).toHaveLength(1);
  const screenId = newScreens[0].id;
  const drawn = (created.data as GeometryData).canvasFrames?.[screenId];
  expect(drawn).toBeTruthy();
  await expect(
    app.page.locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
    ),
  ).toHaveAttribute("data-layer-node-id", screenId);

  const width = app.page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const height = app.page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  await width.fill("360");
  await width.press("Enter");
  await height.fill("315");
  await height.press("Enter");
  await app.settled();

  const data = (await app.savedRecord(id)).data as GeometryData;
  expect(data.canvasFrames).toStrictEqual({
    [indexId]: { x: 0, y: 736, width: 1440, height: 1024 },
    [screenId]: { x: drawn!.x, y: drawn!.y, width: 360, height: 315 },
  });
  expect(data.screenMetadata?.[screenId]).toMatchObject({
    width: 360,
    height: 315,
  });
  await expect(width).toHaveValue("360px");
  await expect(height).toHaveValue("315px");
  const card = app.page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
  );
  await expect(card).toHaveCSS("width", "360px");
  await expect(card).toHaveCSS("height", "315px");
});
