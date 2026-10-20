import { type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, designFrame, pickFrameMode } from "./helpers";
import { expect, expectOnlyChanged, test } from "./rails";

const HOME_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Home</title></head><body style="margin:0;background:#fff"><main data-agent-native-node-id="main" style="padding:40px">Home</main></body></html>`;

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; content?: string }>;
};

type HmrSignal = { type: string; at: number };

function hmrSignals(page: Page) {
  return (page as Page & { hmrUpdates: HmrSignal[] }).hmrUpdates;
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readGeometry(page: Page, designId: string, screenId: string) {
  const record = await readDesign(page, designId);
  const data =
    typeof record.data === "string"
      ? JSON.parse(record.data || "{}")
      : ((record.data ?? {}) as Record<string, any>);
  return data.canvasFrames?.[screenId];
}

async function emptyCanvasPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    for (let y = bounds.top + 60; y < bounds.bottom - 60; y += 40) {
      for (let x = bounds.left + 60; x < bounds.right - 60; x += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("No empty Screen canvas point is visible");
  return point;
}

async function addConstraint(
  page: Page,
  axis: "W" | "H",
  kind: "min" | "max",
  value: number,
) {
  await page
    .getByRole("button", { name: `${axis} sizing mode — Fixed`, exact: true })
    .click();
  await page
    .getByRole("menuitem", {
      name: new RegExp(`Add ${kind} ${axis === "W" ? "width" : "height"}`),
    })
    .click();
  const label = `${kind === "min" ? "Min" : "Max"} ${axis === "W" ? "width" : "height"}`;
  const field = page.getByRole("textbox", { name: label, exact: true });
  await expect(field).toBeVisible();
  await field.fill(String(value));
  await field.press("Enter");
}

async function dragHandle(
  page: Page,
  designId: string,
  screenId: string,
  handleName: "e" | "w" | "s" | "n",
  cssDelta: number,
) {
  const geometry = await readGeometry(page, designId, screenId);
  if (!geometry) throw new Error(`Missing Screen geometry for ${screenId}`);
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  const card = shell.locator("[data-screen-card]");
  const cardBounds = await card.boundingBox();
  if (!cardBounds) throw new Error("Screen card is not visible for resize");
  const scale = cardBounds.width / geometry.width;
  const handle = page
    .locator("[data-frame-selection-box]")
    .locator(`[data-resize-handle="${handleName}"]`)
    .first();
  const handleBounds = await handle.boundingBox();
  if (!handleBounds) throw new Error(`Missing ${handleName} resize handle`);
  const x = handleBounds.x + handleBounds.width / 2;
  const y = handleBounds.y + handleBounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + (handleName === "e" || handleName === "w" ? cssDelta * scale : 0),
    y + (handleName === "n" || handleName === "s" ? cssDelta * scale : 0),
    { steps: 12 },
  );
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  const updates: HmrSignal[] = [];
  const targetHost = new URL(e2eBaseURL()).host;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(targetHost)) return;
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (["update", "full-reload"].includes(message.type)) {
          updates.push({ type: message.type, at: Date.now() });
        }
      } catch {
        // Vite heartbeat/control frames are not JSON updates.
      }
    });
  });
  (page as typeof page & { hmrUpdates: HmrSignal[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(hmrSignals(page), "No Vite HMR during the resize proof").toEqual([]);
});

test("Screen root min/max styles constrain inspector edits and frame resizing", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await app.seed(HOME_HTML);
  let screenId = "";
  await app.open(designId);
  await app.settled();
  const homeBefore = await app.savedNodes(designId);
  const before = await readDesign(page, designId);
  const beforeIds = new Set(before.files?.map((file) => file.id));
  await pickFrameMode(page, "Screen");
  const start = await emptyCanvasPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const created = record.files?.find((file) => !beforeIds.has(file.id));
      if (!created) return null;
      screenId = created.id;
      return created.id;
    })
    .not.toBeNull();

  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await shell.locator("[data-frame-title]").click();
  const width = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const height = page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  await width.fill("360");
  await width.press("Enter");
  await height.fill("315");
  await height.press("Enter");
  await expect
    .poll(async () => readGeometry(page, designId, screenId))
    .toMatchObject({ width: 360, height: 315 });

  await addConstraint(page, "W", "min", 200);
  await addConstraint(page, "W", "max", 400);
  await addConstraint(page, "H", "min", 240);
  await addConstraint(page, "H", "max", 320);
  const savedBodyBounds = async () => {
    const html =
      (await readDesign(page, designId)).files?.find(
        (file) => file.id === screenId,
      )?.content ?? "";
    return page.evaluate((source) => {
      const body = new DOMParser().parseFromString(source, "text/html").body;
      return {
        minWidth: body.style.minWidth,
        maxWidth: body.style.maxWidth,
        minHeight: body.style.minHeight,
        maxHeight: body.style.maxHeight,
      };
    }, html);
  };
  const bounds = {
    minWidth: "200px",
    maxWidth: "400px",
    minHeight: "240px",
    maxHeight: "320px",
  };
  await expect.poll(savedBodyBounds).toEqual(bounds);

  const iframeRootBounds = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => {
      const styles = window.getComputedStyle(body);
      return {
        minWidth: styles.minWidth,
        maxWidth: styles.maxWidth,
        minHeight: styles.minHeight,
        maxHeight: styles.maxHeight,
      };
    });
  expect(iframeRootBounds).toEqual(bounds);
  const sized = (await readGeometry(page, designId, screenId))!;
  for (const [label, value] of [
    ["Min width", "200px"],
    ["Max width", "400px"],
    ["Min height", "240px"],
    ["Max height", "320px"],
  ]) {
    await expect(
      page.getByRole("textbox", { name: label, exact: true }),
    ).toHaveValue(value);
  }
  const initialCardBounds = await shell
    .locator("[data-screen-card]")
    .boundingBox();
  if (!initialCardBounds) throw new Error("Screen card is not visible");
  const screenScale = initialCardBounds.width / 360;

  await dragHandle(page, designId, screenId, "e", 300);
  await expect
    .poll(async () => readGeometry(page, designId, screenId))
    .toMatchObject({ width: 400 });
  await dragHandle(page, designId, screenId, "w", 300);
  await expect
    .poll(async () => readGeometry(page, designId, screenId))
    .toMatchObject({ width: 200 });
  await dragHandle(page, designId, screenId, "s", 300);
  await expect
    .poll(async () => readGeometry(page, designId, screenId))
    .toMatchObject({ height: 320 });
  await dragHandle(page, designId, screenId, "n", 300);
  await expect
    .poll(async () => readGeometry(page, designId, screenId))
    .toMatchObject({ height: 240 });

  expect(
    await readGeometry(page, designId, screenId),
    "the w and n drags clamp from the right and bottom edges",
  ).toEqual(
    expect.objectContaining({
      x: sized.x + 200,
      y: sized.y + 80,
      width: 200,
      height: 240,
    }),
  );
  const rendered = await shell
    .locator("[data-screen-card]")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  expect(rendered.width / screenScale).toBeCloseTo(200, 0);
  expect(rendered.height / screenScale).toBeCloseTo(240, 0);
  expect(await savedBodyBounds()).toEqual(bounds);
  await app.settled();
  expectOnlyChanged(homeBefore, await app.savedNodes(designId), []);
});
