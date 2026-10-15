import { type Locator, type Page } from "@playwright/test";

import { appPath, pickFrameMode } from "./helpers";
import { expect, test } from "./rails";

const FIRST_SCREEN_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:400px;height:300px"><h1 data-agent-native-node-id="first-title" style="margin:20px">First screen</h1></body></html>`;
const ABSOLUTE_PAIR_HTML = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script></head><body x-data="{ open: true }" style="margin:0;width:320px;height:200px">
      <section x-show="open" style="position:absolute;left:12px;top:16px;width:80px;height:40px">Alpha</section>
      <section style="position:absolute;left:112px;top:16px;width:80px;height:40px">Beta</section>
    </body></html>`;

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

/** The inspector's Gap field shows exactly this value, not a clipped prefix of it. */
async function expectGapField(layout: Locator, value: string) {
  const gap = layout.getByRole("textbox", { name: "Gap", exact: true });
  await expect(gap).toHaveValue(value);
  expect(
    await gap.evaluate(
      (input: HTMLInputElement) => input.scrollWidth <= input.clientWidth,
    ),
    `the Gap field clips "${value}"`,
  ).toBe(true);
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

// fixme: product bug: The Auto layout Gap input is so narrow it clips its value: it holds '24px' but shows '2' (scrollWidth > clientWidth). All saved-state
test.fixme("a drawn Screen keeps W/H geometry and exposes its auto-layout controls", async ({
  app,
  page,
}) => {
  const designId = await app.seed(FIRST_SCREEN_HTML);
  await app.open(designId);
  const initial = await readDesign(page, designId);
  const beforeIds = new Set(initial.files?.map((file) => file.id));
  const firstScreen = initial.files![0]!;
  await pickFrameMode(page, "Screen");
  const from = await emptyBoardPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 190, from.y + 150, { steps: 16 });
  await page.mouse.up();

  await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
    timeout: 20_000,
  });
  let screenId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const screen = record.files?.find((file) => !beforeIds.has(file.id));
      if (!screen) return null;
      screenId = screen.id;
      return screen.id;
    })
    .not.toBeNull();

  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await shell.locator("[data-frame-title]").click();
  const layoutHeading = page.getByRole("heading", {
    name: "Auto layout",
    exact: true,
  });
  const layout = layoutHeading.locator("xpath=ancestor::section");
  await expect(layoutHeading).toBeVisible();
  await expect(page.locator('[data-flow-value="normal"]')).toBeVisible();
  await expect(
    layout.getByRole("textbox", { name: /^W(?: size in pixels)?$/ }),
  ).toHaveCount(0);
  await expect(
    layout.getByRole("textbox", { name: /^H(?: size in pixels)?$/ }),
  ).toHaveCount(0);
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
    .poll(async () => {
      const data = designData(await readDesign(page, designId));
      const frame = data.canvasFrames?.[screenId];
      const metadata = data.screenMetadata?.[screenId];
      return [frame?.width, frame?.height, metadata?.width, metadata?.height];
    })
    .toEqual([360, 315, 360, 315]);

  await shell.locator("[data-frame-title]").click();
  await page.keyboard.press("Shift+a");
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      return record.files?.find((file) => file.id === screenId)?.content;
    })
    .toMatch(/display:\s*flex/i);
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const data = designData(record);
      const content = record.files?.find(
        (file) => file.id === screenId,
      )?.content;
      return {
        geometry: data.canvasFrames?.[screenId],
        metadata: data.screenMetadata?.[screenId],
        hasFlexRoot: /<body\b[^>]*style="[^"]*display:\s*flex/i.test(
          content ?? "",
        ),
      };
    })
    .toMatchObject({
      geometry: { width: 360, height: 315 },
      metadata: { width: 360, height: 315 },
      hasFlexRoot: true,
    });

  await expect(layoutHeading).toBeVisible();
  await expect(page.locator('[data-flow-value="vertical"]')).toBeVisible();

  const gap = layout.getByRole("textbox", { name: "Gap", exact: true });
  await gap.fill("24");
  await gap.press("Enter");
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      return record.files?.find((file) => file.id === screenId)?.content;
    })
    .toMatch(/gap:\s*24px/i);

  await page.reload();
  const persistedShell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await expect(persistedShell).toHaveCSS("width", "360px");
  await persistedShell.locator("[data-frame-title]").click();
  await expect(width).toHaveValue("360px");
  await expect(height).toHaveValue("315px");
  await expect(layoutHeading).toBeVisible();
  await expect(designFrameForScreen(page, screenId).locator("body")).toHaveCSS(
    "gap",
    "24px",
  );
  const final = await readDesign(page, designId);
  expect(
    final.files
      ?.filter((file) => file.filename !== "__board__.html")
      .map((file) => file.id),
  ).toEqual([firstScreen.id, screenId]);
  expect(
    final.files?.find((file) => file.id === firstScreen.id)?.content,
    "drawing and laying out the new Screen leaves the first Screen untouched",
  ).toBe(firstScreen.content);
  await expectGapField(layout, "24px");
});

function designFrameForScreen(page: Page, screenId: string) {
  return page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    )
    .contentFrame();
}

// fixme: product bug: Same clipped Gap field: value '20px' rendered as '2'. Every other assertion, including the byte-exact undo, passes.
test.fixme("Screen Shift+A saves inferred padding with layout in one undoable edit", async ({
  app,
  page,
}) => {
  const designId = await app.seed(ABSOLUTE_PAIR_HTML);
  const screenId = (await readDesign(page, designId)).files![0]!.id;
  const savedSource = async () =>
    (await readDesign(page, designId)).files?.find(
      (file) => file.id === screenId,
    )?.content;
  await app.open(designId);
  await app.settled();
  const beforeLayout = await savedSource();
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  const frame = designFrameForScreen(page, screenId);
  await expect(frame.getByText("Alpha", { exact: true })).toBeVisible();
  await shell.locator("[data-frame-title]").click();
  await page.keyboard.press("Shift+a");
  const expectLayout = async () => {
    await expect(frame.locator("body")).toHaveCSS("display", "flex");
    await expect(frame.locator("body")).toHaveCSS("gap", "20px");
    await expect(frame.locator("body")).toHaveCSS("padding", "12px");
    await expect
      .poll(
        async () =>
          (await readDesign(page, designId)).files?.find(
            (file) => file.id === screenId,
          )?.content,
      )
      .toMatch(/padding:\s*12px/);
  };
  await expectLayout();
  const primary = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${primary}+z`);
  await expect(frame.locator("body")).toHaveCSS("display", "block");
  await expect(frame.getByText("Alpha", { exact: true })).toHaveCSS(
    "position",
    "absolute",
  );
  await expect
    .poll(savedSource, {
      message: "one undo restores the saved source, padding included",
    })
    .toBe(beforeLayout);
  await page.keyboard.press(`${primary}+Shift+z`);
  await expectLayout();
  await page.reload();
  await expectLayout();
  const saved = (await readDesign(page, designId)).files?.find(
    (file) => file.id === screenId,
  )?.content;
  expect(saved).toContain('x-data="{ open: true }"');
  expect(saved).toContain('x-show="open"');
  await shell.locator("[data-frame-title]").click();
  await expectGapField(
    page
      .getByRole("heading", { name: "Auto layout", exact: true })
      .locator("xpath=ancestor::section"),
    "20px",
  );
});
