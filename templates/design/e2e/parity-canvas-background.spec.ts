import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  createFixtureDesign,
  enterDirectMode,
  enterInteractView,
} from "./helpers";

/**
 * Canvas background parity: reproduces feedback.md's "white flash after
 * edits" / "white background comes back after undo" reports, and the peer
 * (Codex) failure at e2e/canvas-background.spec.ts:134 (dark 26->33, light
 * 235->255 after the first shape). Every test samples the RENDERED PIXEL
 * (not a computed style, which can read correctly while something else
 * paints on top) at a point that never touches shape geometry.
 */

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = e2eBaseURL();
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
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

/** getComputedStyle(--design-editor-canvas-bg) resolved to rgb(...), read on
 *  the parent-page canvas container itself, not through the shield. */
async function canvasVarRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-design-canvas-container]");
    if (!el) return "NO_CONTAINER";
    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;visibility:hidden;background-color:var(--design-editor-canvas-bg)";
    el.appendChild(probe);
    const painted = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return painted;
  });
}

async function designTraceDump(page: Page): Promise<unknown> {
  return page.evaluate(
    () => (window as any).__designTrace?.dump?.() ?? "NO_TRACE",
  );
}

/**
 * The naive "15% across the canvas container" point from the older spec
 * actually lands UNDER the absolutely-positioned left chrome rail
 * (`[data-design-chrome-region="left-shell"]`, z-70) here: `elementFromPoint`
 * resolves to the Layers panel, not the canvas, and its
 * `--design-editor-panel-bg` (33/33/33 dark, white light) is exactly the
 * "wrong" colour this whole area is chasing. So compute a point clear of
 * every known chrome region and CONFIRM via `elementFromPoint` that it lands
 * on the canvas container or a transparent descendant before trusting it.
 */
async function sampleXY(page: Page): Promise<{ x: number; y: number }> {
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
  const x = Math.round(leftEdge + (rightEdge - leftEdge) * 0.5);
  const y = Math.round(canvasBox.y + canvasBox.height * 0.5);

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

async function drawFirstRectangle(page: Page): Promise<void> {
  await page.locator('button[aria-label="Rectangle"]').first().click();
  await expect(
    page.locator('button[aria-label="Rectangle"]').first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(800, 380);
  await page.mouse.down();
  await page.mouse.move(1000, 520, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator("[data-board-surface-layer]")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[role="treeitem"]').filter({ hasText: "Rectangle" }),
  ).toHaveCount(1);
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const { theme, canvasRgb } of [
  { theme: "dark", canvasRgb: "26,26,26" },
  { theme: "light", canvasRgb: "235,235,235" },
] as const) {
  test(`${theme}: canvas pixel matches the themed colour before AND after the first shape`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    let designId: string | undefined;
    try {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      const created = await postAction(page.request, "create-design", {
        title: `E2E Parity Canvas Background ${theme}`,
        projectType: "prototype",
      });
      designId = created?.id ?? created?.data?.id;
      expect(designId).toBeTruthy();

      await page.goto(appPath(`/design/${designId}`), {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      const { x, y } = await sampleXY(page);
      await expect.poll(() => pixelAt(page, x, y)).toBe(canvasRgb);

      await drawFirstRectangle(page);

      // This is the exact peer-reported regression: dark 26->33, light
      // 235->255 once the board-surface layer mounts its first content.
      const after = await pixelAt(page, x, y);
      if (after !== canvasRgb) {
        console.log(
          `${theme} canvas-var after shape:`,
          await canvasVarRgb(page),
          "trace:",
          JSON.stringify(await designTraceDump(page)).slice(0, 2000),
        );
      }
      expect(after).toBe(canvasRgb);
    } finally {
      if (designId) {
        await postAction(page.request, "delete-design", {
          id: designId,
        }).catch(() => {});
      }
    }
  });
}

test("dark: canvas background does not flash light after undoing the first shape", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background undo",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });

    const { x, y } = await sampleXY(page);
    await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

    await drawFirstRectangle(page);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator('[role="treeitem"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    // Sample repeatedly across the settle window: a one-frame flash that a
    // single sample after a fixed wait would miss.
    const samples: string[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await pixelAt(page, x, y));
      await page.waitForTimeout(120);
    }
    const bad = samples.filter((s) => s !== "26,26,26");
    if (bad.length > 0) {
      console.log(
        "post-undo samples:",
        samples,
        "canvas-var:",
        await canvasVarRgb(page),
      );
    }
    expect(bad).toEqual([]);
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

test("dark: canvas background does not flash light after dragging a shape", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background drag",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    const { x, y } = await sampleXY(page);
    await drawFirstRectangle(page);
    await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

    // Drag the newly created board rectangle across the board.
    await page.mouse.move(900, 450);
    await page.mouse.down();
    await page.mouse.move(1100, 620, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const samples: string[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await pixelAt(page, x, y));
      await page.waitForTimeout(120);
    }
    const bad = samples.filter((s) => s !== "26,26,26");
    if (bad.length > 0) {
      console.log("post-drag samples:", samples);
    }
    expect(bad).toEqual([]);
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

test("dark: canvas background stays correct after grouping two shapes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background group",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    const { x, y } = await sampleXY(page);
    await drawFirstRectangle(page);

    // Second rectangle, elsewhere on the board. Drawn BELOW the first rather
    // than to its right: at this viewport width the right inspector panel
    // (`[data-design-chrome-region="right-panel"]`) opens once the first
    // rectangle is selected and covers screen-x from ~1020 to the page edge,
    // so a draw starting at x=1050 lands entirely inside the panel chrome
    // and never reaches the canvas — the drag is silently swallowed and no
    // second layer is created. Staying in the already-confirmed-clear
    // x=800-1000 column sidesteps that without depending on panel geometry.
    await page.locator('button[aria-label="Rectangle"]').first().click();
    await page.mouse.move(800, 600);
    await page.mouse.down();
    await page.mouse.move(1000, 740, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('[role="treeitem"]')).toHaveCount(2, {
      timeout: 10_000,
    });

    // Select both via marquee, then group. Vertical span matching the two
    // rectangles' new stacked layout above.
    await page.mouse.move(760, 340);
    await page.mouse.down();
    await page.mouse.move(1050, 780, { steps: 15 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+g");
    // Grouping leaves the two original rows nested under the new Group row;
    // depending on default expand state the tree can hold 1 (collapsed) or
    // 3 (expanded) treeitems — scope to the topmost (the group) either way.
    await expect(page.locator('[role="treeitem"]').first()).toContainText(
      "Group",
      { timeout: 10_000 },
    );

    const after = await pixelAt(page, x, y);
    expect(after).toBe("26,26,26");
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

test("dark: canvas background is unaffected by entering and exiting single-screen mode", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    designId = await createFixtureDesign(
      page,
      "E2E Parity Canvas Background direct-mode",
    );
    expect(designId).toBeTruthy();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    const { x, y } = await sampleXY(page);
    await drawFirstRectangle(page);
    await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

    await enterInteractView(page);
    await page.waitForTimeout(300);
    await enterDirectMode(page);
    await page.waitForTimeout(300);

    const { x: x2, y: y2 } = await sampleXY(page);
    const after = await pixelAt(page, x2, y2);
    expect(after).toBe("26,26,26");
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

test("theme toggle with existing board content: no stale colour from the other scheme", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background theme-toggle",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    const { x, y } = await sampleXY(page);
    await drawFirstRectangle(page);
    await expect.poll(() => pixelAt(page, x, y)).toBe("26,26,26");

    // Flip the OS/browser scheme to light while the app is already mounted
    // with dark board content baked in (this is what board-surface-html's
    // "a block from the other scheme is stale" comment is guarding against).
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.evaluate(() => {
      // Nudge next-themes without a full reload, matching a user's
      // in-app theme-switcher click rather than a hard refresh.
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    });
    await expect(page.locator("html")).toHaveClass(/light/, {
      timeout: 10_000,
    });
    await page.waitForTimeout(400);

    const after = await pixelAt(page, x, y);
    if (after !== "235,235,235") {
      console.log(
        "post-toggle pixel:",
        after,
        "canvas-var:",
        await canvasVarRgb(page),
      );
    }
    expect(after).toBe("235,235,235");
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

test("light: canvas background does not flash light->white on initial load before any content", async ({
  page,
}) => {
  test.setTimeout(60_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background load-flash",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();

    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "commit",
    });

    // Sample as fast as possible from first paint through settle. The
    // reported bug is a literal white (255,255,255) flash, which is neither
    // the dark canvas (26,26,26) nor the dark skeleton bg (~28,28,28) — so
    // any 255 sample here is the regression, not noise.
    const samples: string[] = [];
    for (let i = 0; i < 25; i++) {
      const box = await page
        .locator("[data-design-canvas-container], [data-design-editor]")
        .first()
        .boundingBox()
        .catch(() => null);
      if (box) {
        samples.push(
          await pixelAt(
            page,
            Math.round(box.x + box.width * 0.1),
            Math.round(box.y + box.height * 0.15),
          ),
        );
      }
      await page.waitForTimeout(80);
    }
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });

    const whiteFlash = samples.filter((s) => s === "255,255,255");
    if (whiteFlash.length > 0) {
      console.log("load samples:", samples);
    }
    expect(whiteFlash).toEqual([]);
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});

/**
 * A board FRAME (auto-layout, `data-agent-native-group-wrapper="true"` +
 * `data-an-primitive="frame"`) is a live-DOM drag: the bridge writes
 * left/top straight onto the element and only the persisted file goes
 * through undo's content-revert path (replaceRuntimeDocument /
 * getEmbeddedFrameDocumentContent), which never carried the board's
 * render-style tag. Reproduces feedback.md's "white canvas after drag /
 * Cmd+Z / double-click" on a Frame specifically (a plain shape has no
 * group-wrapper marker and does not exercise the same path).
 */
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

test("dark: dragging a board Frame then undoing restores its position and the canvas stays dark", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let designId: string | undefined;
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      "dark",
    );
    const created = await postAction(page.request, "create-design", {
      title: "E2E Parity Canvas Background board-frame drag-undo",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id;
    expect(designId).toBeTruthy();
    const board = await postAction(page.request, "create-file", {
      designId,
      filename: "__board__.html",
      fileType: "html",
      content: BOARD_FRAME_HTML,
    });
    const boardFileId = board?.id ?? board?.data?.id ?? board?.file?.id;
    expect(boardFileId, "board file id").toBeTruthy();
    await postAction(page.request, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["boardFileId"], value: boardFileId },
      ],
    });

    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });

    const frame = boardIframe(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="wc-frame"]');
    await expect(frame).toBeVisible({ timeout: 20_000 });
    const before = await frame.boundingBox();
    if (!before) throw new Error("no bounding box for the board frame");

    // A point well inside the frame's own empty flex space — both
    // rectangles sit in the left half of the fixture's 320px-wide frame, see
    // its geometry above — clear of both children (so this grabs the FRAME
    // itself, never a click-through) and far enough from every edge to miss
    // the selected frame's own resize handles.
    const px = before.x + before.width * 0.7;
    const py = before.y + before.height / 2;
    // A point safely below the frame's own box, clear of it at every one of
    // before/dragged/undone positions in this test — the canvas's own
    // colour shows through here whenever bug (A) is fixed, regardless of
    // whether (B) also put the frame itself back.
    const bgX = before.x + before.width / 2;
    const bgY = before.y + before.height + 120;

    await page.mouse.click(px, py);
    await expect(
      page.getByRole("treeitem").filter({ hasText: "Frame 1" }),
    ).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px + 150, py + 120, { steps: 16 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const dragged = await frame.boundingBox();
    if (!dragged) throw new Error("frame disappeared after drag");
    expect(
      [Math.round(dragged.x), Math.round(dragged.y)],
      "precondition: the drag must actually move the frame",
    ).not.toEqual([Math.round(before.x), Math.round(before.y)]);

    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(500);

    // (B) the LIVE canvas position, not just the persisted file, must
    // follow the undo.
    const undone = await frame.boundingBox();
    if (!undone) throw new Error("frame disappeared after undo");
    expect(
      [Math.round(undone.x), Math.round(undone.y)],
      `undo must restore the pre-drag on-screen position (${before.x},${before.y}); got (${undone.x},${undone.y}). Trace: ${JSON.stringify(await designTraceDump(page)).slice(-1000)}`,
    ).toEqual([Math.round(before.x), Math.round(before.y)]);

    // (A) the board iframe's document must keep its dark-theme render style
    // (color-scheme:dark + transparent background) across the undo's
    // content revert, or Chrome paints its opaque light UA base behind the
    // still-transparent document — a white canvas.
    const boardHtml = boardIframe(page).contentFrame().locator("html");
    await expect
      .poll(() => boardHtml.evaluate((el) => getComputedStyle(el).colorScheme))
      .toBe("dark");
    await expect
      .poll(() =>
        boardHtml.evaluate(
          (el) =>
            el.ownerDocument.querySelector(
              "style[data-agent-native-board-surface-render]",
            ) !== null,
        ),
      )
      .toBe(true);

    // Ground truth: the actual rendered pixel below the frame, sampled
    // repeatedly across the settle window so a one-frame flash can't hide
    // between two checks.
    const samples: string[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await pixelAt(page, bgX, bgY));
      await page.waitForTimeout(120);
    }
    const bad = samples.filter((s) => s !== "26,26,26");
    if (bad.length > 0) {
      console.log(
        "post-undo board-frame samples:",
        samples,
        "canvas-var:",
        await canvasVarRgb(page),
      );
    }
    expect(bad).toEqual([]);
  } finally {
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  }
});
