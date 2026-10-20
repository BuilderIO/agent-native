import { type Page } from "@playwright/test";

import { appPath, designFrame, pickFrameMode } from "./helpers";
import { expect, test, type App } from "./rails";

const HOME_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Home</title></head>
<body style="margin:0;min-height:900px;background:#fff"></body></html>`;

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename: string }>;
};

async function readDesign(app: App, designId: string) {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  const record = (await response.json()) as DesignRecord;
  const data = (
    typeof record.data === "string"
      ? JSON.parse(record.data || "{}")
      : (record.data ?? {})
  ) as {
    canvasFrames?: Record<string, { width: number; height: number }>;
    screenMetadata?: Record<string, { width: number; height: number }>;
  };
  return { files: record.files ?? [], data };
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
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Computed layout of a saved inline style, so shorthand and longhand writes compare equal. */
async function layoutOf(page: Page, style: string | undefined) {
  return page.evaluate((css) => {
    const probe = document.createElement("div");
    probe.setAttribute("style", css);
    const s = probe.style;
    return {
      display: s.display,
      flexDirection: s.flexDirection,
      gap: s.rowGap,
      padding: [
        s.paddingTop,
        s.paddingRight,
        s.paddingBottom,
        s.paddingLeft,
      ].join(" "),
      position: s.position,
      height: s.height,
      alignSelf: s.alignSelf,
    };
  }, style ?? "");
}

async function enter(input: ReturnType<Page["getByRole"]>, value: string) {
  await input.fill(value);
  await input.press("Enter");
}

test("a Screen-root card: a 360x315 Screen with vertical auto layout holds a drawn rectangle as a full-width flow child", async ({
  app,
}) => {
  const page = app.page;
  const designId = await app.seed(HOME_HTML);
  await app.open(designId);
  await app.settled();
  const before = await readDesign(app, designId);

  await pickFrameMode(page, "Screen");
  const from = await emptyBoardPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 190, from.y + 150, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readDesign(app, designId)).files.length)
    .toBe(before.files.length + 1);
  const screen = (await readDesign(app, designId)).files.find(
    (file) => !before.files.some((existing) => existing.id === file.id),
  )!;

  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screen.id}"]`,
  );
  await shell.locator("[data-frame-title]").click();
  await enter(
    page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ }),
    "360",
  );
  await enter(
    page.getByRole("textbox", { name: /^H(?: size in pixels)?$/ }),
    "315",
  );
  await expect
    .poll(async () => {
      const { data } = await readDesign(app, designId);
      return [
        data.canvasFrames?.[screen.id],
        data.screenMetadata?.[screen.id],
      ].map((g) => [g?.width, g?.height]);
    })
    .toEqual([
      [360, 315],
      [360, 315],
    ]);

  await page.keyboard.press("Shift+a");
  const layout = page
    .getByRole("heading", { name: "Auto layout", exact: true })
    .locator("xpath=ancestor::section");
  await layout.getByRole("button", { name: "Vertical", exact: true }).click();
  await enter(layout.getByRole("textbox", { name: "Gap", exact: true }), "12");
  await enter(
    layout.getByRole("textbox", { name: "Left / Right", exact: true }),
    "12",
  );
  await enter(
    layout.getByRole("textbox", { name: "Top / Bottom", exact: true }),
    "12",
  );
  const savedBody = async () =>
    [...(await app.savedNodes(designId, screen.filename)).values()].find(
      (node) => node.tag === "body",
    );
  await expect
    .poll(
      async () =>
        (await layoutOf(page, (await savedBody())?.attrs.style)).padding,
    )
    .toBe("12px 12px 12px 12px");
  expect(await layoutOf(page, (await savedBody())?.attrs.style)).toMatchObject({
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  });

  const card = (await shell.locator("[data-screen-card]").boundingBox())!;
  const scale = card.width / 360;
  const bodyBox = (await designFrame(page, screen.id)
    .locator("body")
    .boundingBox())!;
  await page.keyboard.press("r");
  await page.mouse.move(bodyBox.x + 20 * scale, bodyBox.y + 20 * scale);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + 84 * scale, bodyBox.y + 62 * scale, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const nodes = await app.savedNodes(designId, screen.filename);
      return [...nodes.values()].filter(
        (node) => node.attrs["data-agent-native-layer-name"] === "Rectangle",
      ).length;
    })
    .toBe(1);
  await app.settled();
  const drawn = [
    ...(await app.savedNodes(designId, screen.filename)).values(),
  ].find((node) => node.attrs["data-agent-native-layer-name"] === "Rectangle")!;
  const body = (await savedBody())!;
  expect(drawn.parent, "drawn straight into the Screen root").toBe(body.id);
  expect(
    (await layoutOf(page, drawn.attrs.style)).position,
    "an auto-layout child, not absolute",
  ).not.toBe("absolute");

  await page.getByRole("button", { name: /^W sizing mode — / }).click();
  await page.getByRole("menuitem", { name: "Fill container" }).click();
  await enter(
    page.getByRole("textbox", { name: /^H(?: size in pixels)?$/ }),
    "240",
  );
  await expect
    .poll(async () => {
      const node = (await app.savedNodes(designId, screen.filename)).get(
        drawn.id,
      );
      const saved = await layoutOf(page, node?.attrs.style);
      return [saved.alignSelf, saved.height];
    })
    .toEqual(["stretch", "240px"]);
  await app.settled();

  const nodes = await app.savedNodes(designId, screen.filename);
  expect(
    [...nodes.values()]
      .filter((node) => node.parent === body.id)
      .map((node) => node.id),
    "the Screen holds only the rectangle",
  ).toEqual([drawn.id]);
  const rendered = await designFrame(page, screen.id)
    .locator(`[data-agent-native-node-id="${drawn.id}"]`)
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
  expect(
    rendered,
    "inset by the 12px padding and stretched across the 360px Screen",
  ).toEqual({
    x: 12,
    y: 12,
    width: 336,
    height: 240,
  });
});
