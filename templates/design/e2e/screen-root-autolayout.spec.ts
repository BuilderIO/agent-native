import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  gotoEditor,
  pickFrameMode,
  resetPersistedCanvasState,
} from "./helpers";

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; content?: string }>;
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

test("a drawn Screen keeps W/H geometry and exposes its auto-layout controls", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen root auto layout ${Date.now()}`,
  );
  try {
    await gotoEditor(page, designId);
    const initial = await readDesign(page, designId);
    const beforeIds = new Set(initial.files?.map((file) => file.id));

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
    await expect(
      designFrameForScreen(page, screenId).locator("body"),
    ).toHaveCSS("gap", "24px");
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});

function designFrameForScreen(page: Page, screenId: string) {
  return page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    )
    .contentFrame();
}

test("Screen Shift+A saves inferred padding with layout in one undoable edit", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen inferred padding ${Date.now()}`,
  );
  try {
    const initial = await readDesign(page, designId);
    const screenId = initial.files?.[0]?.id;
    if (!screenId) throw new Error("fixture Screen is missing");
    const content = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script></head><body x-data="{ open: true }" style="margin:0;width:320px;height:200px">
      <section x-show="open" style="position:absolute;left:12px;top:16px;width:80px;height:40px">Alpha</section>
      <section style="position:absolute;left:112px;top:16px;width:80px;height:40px">Beta</section>
    </body></html>`;
    const update = await page.request.post(
      appPath("/_agent-native/actions/update-file"),
      {
        data: { id: screenId, content },
      },
    );
    if (!update.ok()) throw new Error(await update.text());

    await resetPersistedCanvasState(page);
    await page.goto(appPath(`/design/${designId}`));
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
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
    await page.keyboard.press(`${primary}+Shift+z`);
    await expectLayout();
    await page.reload();
    await expectLayout();
    const saved = (await readDesign(page, designId)).files?.find(
      (file) => file.id === screenId,
    )?.content;
    expect(saved).toContain('x-data="{ open: true }"');
    expect(saved).toContain('x-show="open"');
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      {
        data: { id: designId },
      },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});
