import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";

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

async function screenBox(page: Page) {
  const box = (await page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .boundingBox())!;
  return { ...box, scale: box.width / 320 };
}

async function emptyBoardPoint(
  page: Page,
  avoidBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [],
) {
  const point = await page.evaluate((boxesToAvoid) => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    const blocked = boxesToAvoid.map((box) => ({
      left: box.x - 120,
      right: box.x + box.width + 120,
      top: box.y - 120,
      bottom: box.y + box.height + 120,
    }));
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          ) ||
          blocked.some(
            (c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  }, avoidBoxes);
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

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
    e2eBaseURL();
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
  await expect(page.locator("[data-board-surface-layer]")).toHaveCSS(
    "background-color",
    "rgb(235, 235, 235)",
  );
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

test("a board Frame keeps its drop position after it moves into a Screen", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawFrameTool(page, "Frame", empty, {
    x: empty.x + 90,
    y: empty.y + 90,
  });

  expect(
    await fileContent(page, id, "__board__.html"),
    "precondition: the frame tool must put a frame on the board",
  ).toContain('data-an-primitive="frame"');

  const boardFrame = page
    .locator("[data-board-surface-layer] iframe")
    .first()
    .contentFrame()
    .locator('[data-an-primitive="frame"]')
    .first();
  const nodeId = await boardFrame.getAttribute("data-agent-native-node-id");
  expect(nodeId).toBeTruthy();
  const from = (await boardFrame.boundingBox())!;
  const screen = await screenBox(page);
  const dropPoint = {
    x: screen.x + screen.width / 2,
    y: screen.y + screen.height / 2,
  };
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
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
  await page.mouse.up();
  await expect
    .poll(() => fileContent(page, id, "index.html"), { timeout: 10_000 })
    .toContain('data-an-primitive="frame"');
  await expect
    .poll(() => fileContent(page, id, "__board__.html"), { timeout: 10_000 })
    .not.toContain(`data-agent-native-node-id="${nodeId}"`);

  // Let the delayed drag-cancel grace period finish before checking persisted
  // geometry. Ownership transfer can succeed even if a late cancel restores
  // the frame's original position.
  await page.waitForTimeout(300);
  const screenHtml = await fileContent(page, id, "index.html");
  expect(
    screenHtml.match(new RegExp(`data-agent-native-node-id="${nodeId}"`, "g")),
  ).toHaveLength(1);

  await openEditor(page, id);
  const movedFrame = page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${nodeId}"]`);
  await expect(movedFrame).toBeVisible();
  const movedBox = (await movedFrame.boundingBox())!;
  const reloadedScreen = await screenBox(page);

  // The drag remains anchored at the frame center through activation, so that
  // center should land at the pointer's release point.
  expect(
    Math.abs(
      movedBox.x +
        movedBox.width / 2 -
        (reloadedScreen.x + reloadedScreen.width / 2),
    ),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs(
      movedBox.y +
        movedBox.height / 2 -
        (reloadedScreen.y + reloadedScreen.height / 2),
    ),
  ).toBeLessThanOrEqual(6);
});

test("a board Frame keeps its drop position when moved over another board Frame", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const firstStart = await emptyBoardPoint(page);
  await drawFrameTool(page, "Frame", firstStart, {
    x: firstStart.x + 90,
    y: firstStart.y + 90,
  });

  const boardDocument = () =>
    page.locator("[data-board-surface-layer] iframe").first().contentFrame();
  const boardFrames = () =>
    boardDocument().locator('[data-an-primitive="frame"]');
  const source = boardFrames().first();
  const sourceId = await source.getAttribute("data-agent-native-node-id");
  expect(sourceId).toBeTruthy();
  const sourceBox = (await source.boundingBox())!;
  const secondStart = await emptyBoardPoint(page, [sourceBox]);
  await drawFrameTool(page, "Frame", secondStart, {
    x: secondStart.x + 90,
    y: secondStart.y + 90,
  });

  const target = boardFrames().nth(1);
  const targetId = await target.getAttribute("data-agent-native-node-id");
  expect(targetId).toBeTruthy();
  const targetBox = (await target.boundingBox())!;
  const dropPoint = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  expect(dropPoint.x).toBeGreaterThan(targetBox.x);
  expect(dropPoint.x).toBeLessThan(targetBox.x + targetBox.width);
  expect(dropPoint.y).toBeGreaterThan(targetBox.y);
  expect(dropPoint.y).toBeLessThan(targetBox.y + targetBox.height);
  const releaseOverScreen = await page.evaluate(
    ({ x, y }) =>
      Array.from(document.querySelectorAll("[data-screen-iframe-id]")).some(
        (screen) => {
          const rect = screen.getBoundingClientRect();
          return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          );
        },
      ),
    dropPoint,
  );
  expect(releaseOverScreen).toBe(false);

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .click();
  await page.evaluate(() => {
    const debugWindow = window as Window & {
      __boardDragPhases?: string[];
    };
    debugWindow.__boardDragPhases = [];
    window.addEventListener("message", (event) => {
      const data = event.data as {
        boardSurface?: boolean;
        phase?: string;
        type?: string;
      };
      if (
        data?.type === "agent-native:cross-screen-drag" &&
        data.boardSurface === true
      ) {
        debugWindow.__boardDragPhases?.push(data.phase ?? "");
      }
    });
  });
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 - 12,
    sourceBox.y + sourceBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const boardDragPhases = await page.evaluate(() => {
    const debugWindow = window as Window & {
      __boardDragPhases?: string[];
    };
    return debugWindow.__boardDragPhases ?? [];
  });
  expect(boardDragPhases).toContain("start");
  expect(boardDragPhases).toContain("move");
  expect(boardDragPhases).toContain("end");

  const boardHtml = await fileContent(page, id, "__board__.html");
  expect(
    boardHtml.match(new RegExp(`data-agent-native-node-id="${sourceId}"`, "g")),
  ).toHaveLength(1);
  expect(
    boardHtml.match(new RegExp(`data-agent-native-node-id="${targetId}"`, "g")),
  ).toHaveLength(1);

  await openEditor(page, id);
  const movedSource = boardDocument().locator(
    `[data-agent-native-node-id="${sourceId}"]`,
  );
  await expect(movedSource).toBeVisible();
  const targetAfter = boardDocument().locator(
    `[data-agent-native-node-id="${targetId}"]`,
  );
  await expect(targetAfter).toBeVisible();
  const movedBox = (await movedSource.boundingBox())!;
  const targetAfterBox = (await targetAfter.boundingBox())!;
  expect(
    Math.abs(
      movedBox.x +
        movedBox.width / 2 -
        (targetAfterBox.x + targetAfterBox.width / 2),
    ),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs(
      movedBox.y +
        movedBox.height / 2 -
        (targetAfterBox.y + targetAfterBox.height / 2),
    ),
  ).toBeLessThanOrEqual(6);
});

test("a board Frame keeps its position when released over a locked Screen", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const homeRow = page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-level="1"]')
    .filter({ has: page.locator('span[title="Home"]') })
    .first();
  await homeRow.hover();
  await homeRow.locator('button[aria-label="Lock layer"]').click({
    force: true,
  });
  await expect(
    homeRow.locator('button[aria-label="Unlock layer"]'),
  ).toBeVisible();

  const start = await emptyBoardPoint(page);
  await drawFrameTool(page, "Frame", start, {
    x: start.x + 90,
    y: start.y + 90,
  });
  const boardDocument = () =>
    page.locator("[data-board-surface-layer] iframe").first().contentFrame();
  const source = boardDocument().locator('[data-an-primitive="frame"]').first();
  const sourceId = await source.getAttribute("data-agent-native-node-id");
  expect(sourceId).toBeTruthy();
  const sourceBefore = (await source.boundingBox())!;
  const targetBefore = await screenBox(page);
  const dropPoint = {
    x: targetBefore.x + targetBefore.width / 2,
    y: targetBefore.y + targetBefore.height / 2,
  };

  await boardDocument()
    .locator("html")
    .evaluate(() => {
      const debugWindow = window as Window & {
        __hostDragCancels?: number;
      };
      debugWindow.__hostDragCancels = 0;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "agent-native:cancel-active-drag") {
          debugWindow.__hostDragCancels =
            (debugWindow.__hostDragCancels ?? 0) + 1;
        }
      });
    });
  await page.evaluate(() => {
    const debugWindow = window as Window & {
      __hostMouseUpCount?: number;
    };
    debugWindow.__hostMouseUpCount = 0;
    window.addEventListener(
      "mouseup",
      () => {
        debugWindow.__hostMouseUpCount =
          (debugWindow.__hostMouseUpCount ?? 0) + 1;
      },
      true,
    );
  });

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .click();
  await page.evaluate(() => {
    const debugWindow = window as Window & {
      __hostMouseUpCount?: number;
    };
    debugWindow.__hostMouseUpCount = 0;
  });
  await page.mouse.move(
    sourceBefore.x + sourceBefore.width / 2,
    sourceBefore.y + sourceBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const sourceAfterDrop = (await source.boundingBox())!;
  expect(
    Math.abs(sourceAfterDrop.x + sourceAfterDrop.width / 2 - dropPoint.x),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs(sourceAfterDrop.y + sourceAfterDrop.height / 2 - dropPoint.y),
  ).toBeLessThanOrEqual(6);

  const hostDragCancels = await boardDocument()
    .locator("html")
    .evaluate(() => {
      const debugWindow = window as Window & {
        __hostDragCancels?: number;
      };
      return debugWindow.__hostDragCancels ?? 0;
    });
  const hostMouseUpCount = await page.evaluate(() => {
    const debugWindow = window as Window & {
      __hostMouseUpCount?: number;
    };
    return debugWindow.__hostMouseUpCount ?? 0;
  });
  expect(hostMouseUpCount).toBe(1);
  expect(
    hostDragCancels,
    "a locked Screen is not a drop target and must not cancel the board move",
  ).toBe(0);

  const boardHtml = await fileContent(page, id, "__board__.html");
  expect(
    boardHtml.match(new RegExp(`data-agent-native-node-id="${sourceId}"`, "g")),
  ).toHaveLength(1);
  await openEditor(page, id);
  const movedSource = boardDocument().locator(
    `[data-agent-native-node-id="${sourceId}"]`,
  );
  await expect(movedSource).toBeVisible();
  const movedBox = (await movedSource.boundingBox())!;
  const targetAfter = await screenBox(page);
  expect(
    Math.abs(
      movedBox.x + movedBox.width / 2 - (targetAfter.x + targetAfter.width / 2),
    ),
  ).toBeLessThanOrEqual(6);
  expect(
    Math.abs(
      movedBox.y +
        movedBox.height / 2 -
        (targetAfter.y + targetAfter.height / 2),
    ),
  ).toBeLessThanOrEqual(6);
});

// Was an invisible skip: it fired on EVERY run, so this guarded nothing while
// still counting toward the suite total. Measured cause — its three selectors
// cannot match a committed board object. `data-draft-id` is transient (the
// in-progress draw, gone once committed) and `data-board-primitive-id` /
// `data-an-board-object` do not exist anywhere in the app. Committed board
// objects live INSIDE the board-surface iframe, so a host-level z-index
// comparison cannot see them. Rewriting it needs the real stacking contract
// between `[data-board-surface-layer]` and `[data-screen-iframe-id]`, which is
// a product decision in the canvas-layering area, not a test fix.
test.fixme("2:11 — a shape drawn on the board is not painted behind the screens", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const empty = await emptyBoardPoint(page);
  await drawWith(page, "Rectangle", empty, {
    x: empty.x + 160,
    y: empty.y + 120,
  });

  const readStacking = () =>
    page.evaluate(() => {
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
  let stacking: { screen: number; object: number } | null = null;
  await expect
    .poll(
      async () => {
        stacking = await readStacking();
        return stacking !== null;
      },
      {
        timeout: 10_000,
        message:
          "board-object-camera-and-click: no board object node was found to compare stacking against",
      },
    )
    .toBe(true);

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
  ).toContain("rgb(217, 217, 217)");
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
    x: empty.x + 90,
    y: empty.y + 90,
  });

  await expect
    .poll(() => fileContent(page, id, "__board__.html"), { timeout: 20_000 })
    .toContain('data-an-primitive="frame"');

  const after = await page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
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
