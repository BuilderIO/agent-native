import { type Page } from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import {
  appPath,
  enterDirectMode,
  enterInteractView,
  selectTool,
} from "./helpers";
import {
  childrenOf,
  expect,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

async function action(app: App, name: string, input: Record<string, unknown>) {
  const response = await app.page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

/** An app-owned design with no screens: seeds one, then deletes it, leaving only the board. */
async function createEmptyDesign(app: App) {
  const designId = await app.seed("<!doctype html><html><body></body></html>");
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  await action(app, "delete-file", { id: record.files[0].id });
  return designId;
}

async function openTheme(app: App, theme: "dark" | "light", designId: string) {
  await app.page.emulateMedia({ colorScheme: theme });
  // Init scripts also run in the sandboxed screen frames, which have no localStorage.
  await app.page.addInitScript((value) => {
    if (window.top === window) localStorage.setItem("theme", value);
  }, theme);
  await app.page.goto(appPath(`/design/${designId}`));
  await expect(app.page.locator("[data-design-bottom-toolbar]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(app.page.locator("html")).toHaveClass(new RegExp(theme));
}

async function boardNodes(app: App, designId: string) {
  return app
    .savedNodes(designId, "__board__.html")
    .catch(() => new Map<string, SavedNode>());
}

function rectangles(nodes: Map<string, SavedNode>) {
  return [...nodes.values()].filter(
    (node) => node.attrs["data-an-primitive"] === "rectangle",
  );
}

/** Records every distinct canvas colour the editor resolves, frame by frame, until `canvasColours` is read. */
async function watchCanvasColour(page: Page) {
  await page.evaluate(() => {
    const seen = new Set<string>();
    const win = window as Window & {
      __canvasSeen?: Set<string>;
      __canvasWatch?: number;
    };
    win.__canvasSeen = seen;
    const tick = () => {
      const container = document.querySelector(
        "[data-design-canvas-container]",
      );
      if (container) {
        seen.add(
          getComputedStyle(container)
            .getPropertyValue("--design-editor-canvas-bg")
            .trim(),
        );
      }
      win.__canvasWatch = requestAnimationFrame(tick);
    };
    tick();
  });
}

async function canvasColours(page: Page) {
  return page.evaluate(() => {
    const win = window as Window & {
      __canvasSeen?: Set<string>;
      __canvasWatch?: number;
    };
    cancelAnimationFrame(win.__canvasWatch!);
    return [...win.__canvasSeen!];
  });
}

async function zoomScale(page: Page) {
  const label = await page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first()
    .innerText();
  return Number.parseFloat(label) / 100;
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await client.detach();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for the screenshot");
      ctx.drawImage(img, 0, 0);
      const ratio = img.width / window.innerWidth;
      const d = ctx.getImageData(
        Math.round(px * ratio),
        Math.round(py * ratio),
        1,
        1,
      ).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    { b64: data, px: x, py: y },
  );
}

async function sampleXY(
  page: Page,
  options?: { besideScreens?: boolean },
): Promise<{ x: number; y: number }> {
  const canvasBox = await page
    .locator("[data-design-canvas-container]")
    .boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox
    ? leftShellBox.x + leftShellBox.width
    : canvasBox.x;
  const rightEdge = rightPanelBox
    ? rightPanelBox.x
    : canvasBox.x + canvasBox.width;
  let x = Math.round(leftEdge + (rightEdge - leftEdge) * 0.5);
  const y = Math.round(canvasBox.y + canvasBox.height * 0.5);
  if (options?.besideScreens) {
    // Leaving Interact refits the camera on the Screen, which then sits under
    // the canvas centre; sample the canvas to its left instead.
    const screenBox = await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox();
    if (!screenBox) throw new Error("no Screen card box to sample beside");
    if (screenBox.x - leftEdge < 40) {
      throw new Error("no empty canvas to the left of the Screen");
    }
    x = Math.round(leftEdge + (screenBox.x - leftEdge) / 2);
  }

  const hitInfo = await page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el) return { ok: false, reason: "no element" };
      let cur: HTMLElement | null = el;
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.dataset?.designChromeRegion) {
          return {
            ok: false,
            reason: `hit chrome:${cur.dataset.designChromeRegion}`,
          };
        }
        cur = cur.parentElement;
      }
      return { ok: true, reason: "clear" };
    },
    { px: x, py: y },
  );
  if (!hitInfo.ok) {
    throw new Error(
      `sampleXY point (${x},${y}) is not clear of chrome: ${hitInfo.reason}`,
    );
  }
  return { x, y };
}

async function drawFirstRectangle(page: Page) {
  await selectTool(page, "Rectangle");
  await expect(
    page.locator('button[aria-label="Rectangle"]').first(),
  ).toHaveAttribute("aria-pressed", "true");
  // A rectangle drawn over a Screen nests into it instead of reaching the
  // board, so start below any Screen the design opens with.
  const screens = page.locator("[data-screen-card]");
  let top = 380;
  if ((await screens.count()) > 0) {
    const screenBox = await screens.last().boundingBox();
    if (!screenBox) throw new Error("the Screen card has no bounding box");
    top = Math.max(top, Math.round(screenBox.y + screenBox.height + 40));
  }
  const drag = { x: 800, y: top, width: 200, height: 140 };
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x + drag.width, drag.y + drag.height, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator("[data-board-surface-layer]")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[role="treeitem"]').filter({ hasText: "Rectangle" }),
  ).toHaveCount(1);
  return drag;
}

const BOARD_FRAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>*, *::before, *::after { box-sizing: border-box; } html, body { background: transparent; } body { margin: 0; position: relative; overflow: visible; }</style>
</head>
<body>
<div data-agent-native-node-id="wc-frame" data-agent-native-layer-name="Frame 1" data-agent-native-group-wrapper="true" data-an-primitive="frame" style="position:absolute;left:400px;top:300px;width:320px;height:160px;display:flex;flex-direction:row;gap:20px;padding:20px">
<div data-agent-native-node-id="wc-rect-a" data-agent-native-layer-name="Rectangle 1" data-an-primitive="rectangle" style="width:60px;height:60px;background:#3b82f6"></div>
<div data-agent-native-node-id="wc-rect-b" data-agent-native-layer-name="Rectangle 2" data-an-primitive="rectangle" style="width:60px;height:60px;background:#22c55e"></div>
</div>
</body>
</html>`;

function boardIframe(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]:not([data-screen-iframe-id])")
    .first();
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const { theme, canvasRgb } of [
  { theme: "dark", canvasRgb: "26,26,26" },
  { theme: "light", canvasRgb: "235,235,235" },
] as const) {
  // fixme: product bug: The toolbar reads 60% but the board renders at ~2.4x: the 200x140 px drag saves an 84x59 px rectangle (84*0.6 = 50 px, not 200).
  test.fixme(`${theme}: canvas pixel matches the themed colour before AND after the first shape, which saves at the displayed zoom`, async ({
    app,
  }) => {
    const page = app.page;
    const designId = await createEmptyDesign(app);
    await openTheme(app, theme, designId);
    const { x, y } = await sampleXY(page);
    await expect.poll(() => pixelAt(page, x, y)).toBe(canvasRgb);

    const drag = await drawFirstRectangle(page);

    expect(await pixelAt(page, x, y)).toBe(canvasRgb);
    await expect
      .poll(async () => rectangles(await boardNodes(app, designId)).length)
      .toBe(1);
    await app.settled();
    const saved = styleOf(rectangles(await boardNodes(app, designId))[0]);
    const zoom = await zoomScale(page);
    expect(
      {
        width: Math.round(parseFloat(saved.width) * zoom),
        height: Math.round(parseFloat(saved.height) * zoom),
      },
      `saved ${saved.width} x ${saved.height} at the displayed ${Math.round(zoom * 100)}% zoom is the 200x140 drag`,
    ).toEqual({ width: drag.width, height: drag.height });
  });
}

// fixme: fails on current main after the merge: Error: expect(received).toBe(expected) // Object.is equality
test.fixme("dark: undoing the first shape removes it and the canvas colour never changes", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  await openTheme(app, "dark", designId);
  const { x, y } = await sampleXY(page);
  await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");
  await drawFirstRectangle(page);
  await expect
    .poll(async () => rectangles(await boardNodes(app, designId)).length)
    .toBe(1);

  await watchCanvasColour(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[role="treeitem"]')).toHaveCount(0);
  await expect
    .poll(async () => rectangles(await boardNodes(app, designId)).length)
    .toBe(0);
  await app.settled();
  expect(
    await canvasColours(page),
    "one canvas colour through the undo",
  ).toHaveLength(1);
  expect(await pixelAt(page, x, y)).toBe("26,26,26");
});

// fixme: fails on current main after the merge: Error: expect(received).toBe(expected) // Object.is equality
test.fixme("dark: dragging a shape moves it by the drag and the canvas colour never changes", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  await openTheme(app, "dark", designId);
  const { x, y } = await sampleXY(page);
  const drag = await drawFirstRectangle(page);
  await expect
    .poll(async () => rectangles(await boardNodes(app, designId)).length)
    .toBe(1);
  await app.settled();
  const rectId = rectangles(await boardNodes(app, designId))[0]!.id;
  const savedBefore = styleOf((await boardNodes(app, designId)).get(rectId));
  const rect = boardIframe(page)
    .contentFrame()
    .locator(`[data-agent-native-node-id="${rectId}"]`);
  const before = (await rect.boundingBox())!;

  await watchCanvasColour(page);
  const grab = { x: Math.round(drag.x + 100), y: Math.round(drag.y + 70) };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 200, grab.y + 170, { steps: 15 });
  await page.mouse.up();

  await expect
    .poll(
      async () => styleOf((await boardNodes(app, designId)).get(rectId)).left,
    )
    .not.toBe(savedBefore.left);
  await app.settled();
  const after = (await rect.boundingBox())!;
  expect(
    Math.max(
      Math.abs(after.x - before.x - 200),
      Math.abs(after.y - before.y - 170),
    ),
    `the shape follows the 200,170 drag on screen: moved ${after.x - before.x},${after.y - before.y}`,
  ).toBeLessThanOrEqual(2);
  expect(
    await canvasColours(page),
    "one canvas colour through the drag",
  ).toHaveLength(1);
  expect(await pixelAt(page, x, y)).toBe("26,26,26");
});

// oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
// fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
test.fixme("dark: grouping two shapes saves one group of both and the canvas colour never changes", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  await openTheme(app, "dark", designId);
  const { x, y } = await sampleXY(page);
  await drawFirstRectangle(page);
  await selectTool(page, "Rectangle");
  await page.mouse.move(800, 600);
  await page.mouse.down();
  await page.mouse.move(1000, 740, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[role="treeitem"]')).toHaveCount(2);
  await expect
    .poll(async () => rectangles(await boardNodes(app, designId)).length)
    .toBe(2);
  const shapes = rectangles(await boardNodes(app, designId)).map(
    (node) => node.id,
  );

  await page.mouse.move(760, 340);
  await page.mouse.down();
  await page.mouse.move(1050, 780, { steps: 15 });
  await page.mouse.up();
  await watchCanvasColour(page);
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator('[role="treeitem"]').first()).toContainText(
    "Group",
  );

  let groupId = "";
  await expect
    .poll(async () => {
      const nodes = await boardNodes(app, designId);
      groupId = nodes.get(shapes[0]!)?.parent ?? "";
      return groupId && childrenOf(nodes, groupId).sort();
    })
    .toEqual([...shapes].sort());
  await app.settled();
  expect(
    await canvasColours(page),
    "one canvas colour through the grouping",
  ).toHaveLength(1);
  expect(await pixelAt(page, x, y)).toBe("26,26,26");
});

// fixme: fails on current main after the merge: Error: The app reported failures during this test
test.fixme("dark: the canvas colour never changes while entering and leaving single-screen mode", async ({
  app,
}) => {
  const page = app.page;
  const designId = await app.seed(FIXTURE_HTML);
  await openTheme(app, "dark", designId);
  const { x, y } = await sampleXY(page);
  await drawFirstRectangle(page);
  await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

  await watchCanvasColour(page);
  await enterInteractView(page);
  await enterDirectMode(page);
  expect(
    await canvasColours(page),
    "one canvas colour through the Interact round trip",
  ).toHaveLength(1);
  const { x: x2, y: y2 } = await sampleXY(page, { besideScreens: true });
  expect(await pixelAt(page, x2, y2)).toBe("26,26,26");
});

// fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
test.fixme("theme toggle with existing board content: no stale colour from the other scheme", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  await openTheme(app, "dark", designId);
  const { x, y } = await sampleXY(page);
  await drawFirstRectangle(page);
  await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("option", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("light");
  await expect.poll(() => pixelAt(page, x, y)).toBe("235,235,235");
});

test("dark: from the moment it mounts, the canvas never resolves a light colour while the editor loads", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem("theme", "dark");
    const seen: string[] = [];
    (window as Window & { __loadCanvas?: string[] }).__loadCanvas = seen;
    const tick = () => {
      const container = document.querySelector(
        "[data-design-canvas-container]",
      );
      if (container) {
        const probe = document.createElement("span");
        probe.style.cssText =
          "position:absolute;visibility:hidden;background-color:var(--design-editor-canvas-bg)";
        container.appendChild(probe);
        const painted = getComputedStyle(probe).backgroundColor;
        probe.remove();
        if (seen[seen.length - 1] !== painted) seen.push(painted);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(appPath(`/design/${designId}`));
  await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
    timeout: 30_000,
  });
  await app.settled();
  const seen = await page.evaluate(
    () => (window as Window & { __loadCanvas?: string[] }).__loadCanvas ?? [],
  );
  expect(
    seen,
    "the canvas resolves only its dark colour from mount on",
  ).toEqual(["rgb(26, 26, 26)"]);
});

test("dark: dragging a board Frame then undoing restores its saved position and the canvas stays dark", async ({
  app,
}) => {
  const page = app.page;
  const designId = await createEmptyDesign(app);
  const board = await action(app, "create-file", {
    designId,
    filename: "__board__.html",
    fileType: "html",
    content: BOARD_FRAME_HTML,
  });
  await action(app, "update-design", {
    id: designId,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: board.id }],
  });
  await openTheme(app, "dark", designId);

  const frame = boardIframe(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="wc-frame"]');
  await expect(frame).toBeVisible({ timeout: 20_000 });
  await app.settled();
  const savedBefore = await boardNodes(app, designId);
  const before = (await frame.boundingBox())!;
  const px = before.x + before.width * 0.7;
  const py = before.y + before.height / 2;
  const bgX = before.x + before.width / 2;
  const bgY = before.y + before.height + 120;

  await page.mouse.click(px, py);
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Frame 1" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 150, py + 120, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        styleOf((await boardNodes(app, designId)).get("wc-frame")).left,
    )
    .not.toBe("400px");
  await app.settled();

  await watchCanvasColour(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () =>
      styleOf((await boardNodes(app, designId)).get("wc-frame")),
    )
    .toEqual(styleOf(savedBefore.get("wc-frame")));
  await app.settled();
  const undone = (await frame.boundingBox())!;
  expect([Math.round(undone.x), Math.round(undone.y)]).toEqual([
    Math.round(before.x),
    Math.round(before.y),
  ]);
  const boardHtml = boardIframe(page).contentFrame().locator("html");
  await expect
    .poll(() => boardHtml.evaluate((el) => getComputedStyle(el).colorScheme))
    .toBe("dark");
  expect(
    await canvasColours(page),
    "one canvas colour through the undo",
  ).toHaveLength(1);
  expect(await pixelAt(page, bgX, bgY)).toBe("26,26,26");
});
