import { type Page } from "@playwright/test";

import { appPath, pickFrameMode } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const HOME_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Home</title></head><body style="margin:0;background:#fff"><main data-agent-native-node-id="main" style="padding:40px">Home</main></body></html>`;
const HOME_FRAME = { x: 0, y: 0, width: 1440, height: 1024 };

type Frame = { x: number; y: number; width: number; height: number };

async function designData(app: App, designId: string) {
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  const data =
    typeof record.data === "string"
      ? JSON.parse(record.data || "{}")
      : (record.data ?? {});
  return {
    files: record.files as { id: string; filename: string }[],
    canvasFrames: (data.canvasFrames ?? {}) as Record<string, Frame>,
    screenMetadata: (data.screenMetadata ?? {}) as Record<
      string,
      { width: number; height: number }
    >,
  };
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

test("a newly drawn Screen takes immediate W and H commits without moving or reverting", async ({
  app,
}) => {
  const id = await app.seed(HOME_HTML);
  const homeId = (await designData(app, id)).files[0]!.id;
  const seeded = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          { op: "set", path: ["canvasFrames", homeId], value: HOME_FRAME },
        ],
      },
    },
  );
  expect(seeded.ok()).toBe(true);
  await app.open(id);
  await app.settled();
  const page = app.page;
  const before = await app.savedNodes(id);

  await pickFrameMode(page, "Screen");
  const start = await emptyBoardPoint(page);
  // The Home screen's iframe origin is world 0,0, so it maps page px to world px.
  const origin = await app.pagePoint(0, 0);
  const pressed = {
    x: (start.x - origin.x) / origin.scale,
    y: (start.y - origin.y) / origin.scale,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
  await page.mouse.up();

  let screenId = "";
  await expect
    .poll(async () => {
      const { files, canvasFrames } = await designData(app, id);
      screenId =
        files.find(
          (file) => file.id !== homeId && file.filename !== "__board__.html",
        )?.id ?? "";
      return Boolean(screenId && canvasFrames[screenId]);
    }, "the drawn Screen is saved with a frame")
    .toBe(true);
  await app.settled();
  const drawn = (await designData(app, id)).canvasFrames[screenId]!;
  expect(Math.abs(drawn.x - pressed.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(drawn.y - pressed.y)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(drawn.width - 190 / origin.scale)).toBeLessThan(1);
  expect(Math.abs(drawn.height - 150 / origin.scale)).toBeLessThan(1);

  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();
  const width = page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ });
  const height = page.getByRole("textbox", { name: /^H(?: size in pixels)?$/ });
  await width.fill("1440");
  await width.press("Enter");
  await height.fill("1024");
  await height.press("Enter");

  await expect
    .poll(async () => {
      const { canvasFrames, screenMetadata } = await designData(app, id);
      return {
        frame: canvasFrames[screenId],
        metadata: {
          width: screenMetadata[screenId]?.width,
          height: screenMetadata[screenId]?.height,
        },
      };
    })
    .toEqual({
      frame: expect.objectContaining({
        x: drawn.x,
        y: drawn.y,
        width: 1440,
        height: 1024,
      }),
      metadata: { width: 1440, height: 1024 },
    });
  await app.settled();
  const after = await designData(app, id);
  expect(after.canvasFrames[homeId], "Home did not move").toEqual(
    expect.objectContaining(HOME_FRAME),
  );
  expectOnlyChanged(before, await app.savedNodes(id), []);
});
