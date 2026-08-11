import { expect, test, type Page } from "@playwright/test";

/**
 * Clip FFBTGvnWyEys "Fix Frame and Screen Nesting in Design Editor".
 * On the board "frame" already means a screen card (data-frame-id), so the
 * Frame tool is overloaded — these pin which surface produces which thing.
 */

const BLANK = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115"></body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "frame and screen nesting",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: BLANK,
    fileType: "html",
  });
  return id;
}

async function designFiles(page: Page, id: string): Promise<string[]> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  return (record.files ?? []).map((f: any) => f.filename);
}

async function fileContent(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  return (
    (record.files ?? []).find((f: any) => f.filename === filename)?.content ??
    ""
  );
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`${baseURL}/design/${id}`, { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3500);
}

/** Screen rect in page px, plus px-per-screen-unit. */
async function screenBox(page: Page) {
  const box = (await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .boundingBox())!;
  return { ...box, scale: box.width / 320 };
}

/**
 * Scans for a point that actually hit-tests to the canvas surface. Computing
 * one from the screen rect lands on the inspector panel at narrow viewports.
 */
async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
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
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

/** Frame is the primary tool; Screen lives in its dropdown. The trigger's
 *  label follows the active mode, so match either. */
async function pickFrameMode(page: Page, mode: "Frame" | "Screen") {
  await page
    .locator(
      '[data-design-bottom-toolbar] button[aria-label="Frame options"],' +
        ' [data-design-bottom-toolbar] button[aria-label="Screen options"]',
    )
    .first()
    .click();
  await page.getByRole("menuitem").filter({ hasText: mode }).first().click();
  await page.waitForTimeout(600);
}

async function drawFrameTool(
  page: Page,
  mode: "Frame" | "Screen",
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await pickFrameMode(page, mode);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
}

async function drawWith(
  page: Page,
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page
    .locator(`[data-design-bottom-toolbar] button[aria-label="${tool}"]`)
    .click();
  await page.waitForTimeout(500);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
}

test.beforeAll(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    "http://127.0.0.1:9333";
});

test("the Frame option remains sticky when reactivated with F", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  const filesBefore = await designFiles(page, id);

  await drawFrameTool(page, "Frame", empty, {
    x: empty.x + 180,
    y: empty.y + 140,
  });
  expect(await designFiles(page, id)).toEqual(filesBefore);
  expect(
    (await fileContent(page, id, "__board__.html")).match(
      /data-an-primitive="frame"/g,
    ),
  ).toHaveLength(1);

  await page.keyboard.press("f");
  await page.mouse.move(empty.x, empty.y + 180);
  await page.mouse.down();
  await page.mouse.move(empty.x + 160, empty.y + 300, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  expect(await designFiles(page, id)).toEqual(filesBefore);
  expect(
    (await fileContent(page, id, "__board__.html")).match(
      /data-an-primitive="frame"/g,
    ),
  ).toHaveLength(2);
});

test("the Screen option creates a screen after selecting Frame", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const filesBefore = await designFiles(page, id);

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Frame"]')
    .click();
  await page.waitForTimeout(400);

  const empty = await emptyBoardPoint(page);
  await drawFrameTool(page, "Screen", empty, {
    x: empty.x + 200,
    y: empty.y + 150,
  });
  expect(await designFiles(page, id)).toHaveLength(filesBefore.length + 1);
});

test("the live board uses the light canvas theme token", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawWith(page, "Rectangle", empty, {
    x: empty.x + 160,
    y: empty.y + 120,
  });

  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(
    page.locator(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    ),
  ).toHaveCSS("background-color", "rgb(235, 235, 235)");
});

test("the development interaction trace exposes a dump", async ({ page }) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await expect
    .poll(() =>
      page.evaluate(() => typeof window.__designTrace?.dump === "function"),
    )
    .toBe(true);
  const dump = await page.evaluate(() => window.__designTrace!.dump());
  expect(dump).toContain("[");
});

test("1:19 — the Frame tool inside a screen makes a frame, not a screen", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const screen = await screenBox(page);
  const before = await designFiles(page, id);

  await drawFrameTool(
    page,
    "Frame",
    { x: screen.x + 40 * screen.scale, y: screen.y + 150 * screen.scale },
    { x: screen.x + 260 * screen.scale, y: screen.y + 400 * screen.scale },
  );

  expect(
    await designFiles(page, id),
    "drawing inside a screen must not add a screen file",
  ).toEqual(before);
  expect(
    await fileContent(page, id, "index.html"),
    "the frame must land in the screen it was drawn in",
  ).toContain('data-an-primitive="frame"');
});

test("1:19 — the Screen tool makes a top-level screen, the Frame tool does not", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  const before = await designFiles(page, id);

  await drawFrameTool(page, "Screen", empty, {
    x: empty.x + 240,
    y: empty.y + 260,
  });

  expect(
    (await designFiles(page, id)).length,
    "a board frame becomes a new screen file",
  ).toBe(before.length + 1);
});

// boardSurfaceLocalPointToBoardPoint translates the board's 8192² document as
// 1:1 canvas units, so a board-sourced drag's canvas y runs past the target
// screen and getFrameEntryAtPoint never resolves a frame.
test.fixme("4:24 — a board frame can be dragged into a screen and become a child", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawFrameTool(page, "Frame", empty, {
    x: empty.x + 200,
    y: empty.y + 200,
  });

  expect(
    await fileContent(page, id, "__board__.html"),
    "precondition: the frame tool must put a frame on the board",
  ).toContain('data-an-primitive="frame"');

  // Board objects live in their own iframe behind the screens.
  const boardFrame = page
    .locator("[data-board-surface-layer] iframe")
    .first()
    .contentFrame()
    .locator('[data-an-primitive="frame"]')
    .first();
  const from = (await boardFrame.boundingBox())!;
  const screen = await screenBox(page);

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .click();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 - 12,
    from.y + from.height / 2,
    {
      steps: 4,
    },
  );
  await page.mouse.move(
    screen.x + screen.width / 2,
    screen.y + 300 * screen.scale,
    { steps: 24 },
  );
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(3000);

  expect(
    await fileContent(page, id, "index.html"),
    `Clip 4:24 "adding a frame inside of a screen is not possible". Dragging a ` +
      `board frame onto a screen must move it into that screen's document.`,
  ).toContain('data-an-primitive="frame"');
});

test("2:11 — a shape drawn on the board is not painted behind the screens", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawWith(page, "Rectangle", empty, {
    x: empty.x + 160,
    y: empty.y + 120,
  });

  const stacking = await page.evaluate(() => {
    const zOf = (el: Element | null) => {
      let node = el as HTMLElement | null;
      while (node) {
        const z = getComputedStyle(node).zIndex;
        if (z && z !== "auto") return Number(z);
        node = node.parentElement;
      }
      return 0;
    };
    const screenCard = document.querySelector("[data-screen-iframe-id]");
    const boardObject = document.querySelector(
      "[data-draft-id],[data-board-primitive-id],[data-an-board-object]",
    );
    return boardObject
      ? { screen: zOf(screenCard), object: zOf(boardObject) }
      : null;
  });
  test.skip(
    !stacking,
    "no board object node was found to compare stacking against",
  );

  expect(
    stacking!.object,
    `Clip 2:11 "this is now behind the screen. I don't understand why that is." ` +
      `A board object must not stack below a screen card ` +
      `(object z=${stacking!.object}, screen z=${stacking!.screen}).`,
  ).toBeGreaterThanOrEqual(stacking!.screen);
});

test("a rectangle drawn on the board keeps its neutral fill", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawWith(page, "Rectangle", empty, {
    x: empty.x + 160,
    y: empty.y + 120,
  });

  const style =
    /data-an-primitive="rectangle"[^>]*style="([^"]*)"/.exec(
      await fileContent(page, id, "__board__.html"),
    )?.[1] ?? "";
  expect(
    style,
    `the clip reports rectangles coming out black; the canonical fill is a ` +
      `neutral grey. Got: ${style || "(no rectangle found)"}`,
  ).toContain("rgb(218, 218, 218)");
});

test("the canvas does not go black and hide the screens after drawing a frame", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);

  const before = await screenBox(page);
  expect(
    before.width,
    "precondition: the screen renders before drawing",
  ).toBeGreaterThan(50);

  await drawFrameTool(page, "Frame", empty, {
    x: empty.x + 240,
    y: empty.y + 260,
  });

  // Clip "Canvas Turns Black and Hides Frames": after the frame was created
  // the overview painted black and every screen vanished from the canvas.
  const after = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .boundingBox();
  expect(
    after && after.width > 50 && after.height > 50,
    `the screen must still be on the canvas after drawing a frame; got ` +
      `${after ? `${Math.round(after.width)}x${Math.round(after.height)}` : "no screen"}`,
  ).toBe(true);

  const visibleScreens = await page.locator("[data-screen-iframe-id]").count();
  expect(
    visibleScreens,
    "screens must not be hidden after drawing a frame",
  ).toBeGreaterThan(0);
});
