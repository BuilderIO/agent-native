import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Direct-manipulation contract: what you grab is what moves, and a drag tells
 * you what it will do before you commit it. Assertions are Figma's behaviour.
 *
 * Real hooks (discovered, do not invent others): [data-resize-handle] x8,
 * [data-rotate-handle] x4, [data-screen-hover-outline].
 */

const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const ALT = "Alt";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>DnD</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="frame-a" data-agent-native-layer-name="Container"
         style="position:absolute;left:20px;top:60px;width:280px;height:160px;background:#1f2937"></div>
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
         style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
         style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="position:absolute;left:20px;top:600px;width:280px;display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="chip-1" data-agent-native-layer-name="Chip 1"
           style="width:80px;height:50px;background:#a855f7"></div>
      <div data-agent-native-node-id="chip-2" data-agent-native-layer-name="Chip 2"
           style="width:80px;height:50px;background:#ec4899"></div>
      <div data-agent-native-node-id="chip-3" data-agent-native-layer-name="Chip 3"
           style="width:80px;height:50px;background:#f59e0b"></div>
    </div>
  </body>
</html>`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

async function newDesign(page: Page, content = FIXTURE): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "drag and drop",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content,
    fileType: "html",
  });
  return id;
}

async function indexHtml(page: Page, designId: string): Promise<string> {
  const result = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  return (
    (result.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

function styleOf(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
}

async function geom(page: Page, designId: string, id: string) {
  const s = styleOf(await indexHtml(page, designId), id);
  return {
    left: styleNum(s, "left"),
    top: styleNum(s, "top"),
    width: styleNum(s, "width"),
    height: styleNum(s, "height"),
    style: s,
  };
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRow(page: Page, name: string): Locator {
  return layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await toolbar(page)
    .locator('button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i += 1) {
    await page
      .getByRole("button", { name: "Expand layer" })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
}

/** Screen px per page px, so a drag can be expressed in page units. */
async function scale(page: Page): Promise<number> {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
  // Never assume the page size — the screen's own viewport is the truth.
  const inner = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => document.documentElement.clientWidth);
  return card.width / inner;
}

/** The rect the resize/rotate handles enclose. */
async function chromeBounds(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => {
      const el = document.querySelector(
        '[data-agent-native-edit-overlay="selection"]',
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    });
}

/** Overlays the bridge paints inside the iframe, with a non-zero box. */
async function activeOverlays(page: Page): Promise<string[]> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() =>
      Array.from(document.querySelectorAll("[data-agent-native-edit-overlay]"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        })
        .map((el) => el.getAttribute("data-agent-native-edit-overlay") ?? ""),
    );
}

async function selectViaTree(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click();
  await page.waitForTimeout(1600);
}

async function dragBy(
  page: Page,
  from: Box,
  dxPage: number,
  dyPage: number,
  options?: { modifier?: string; cancel?: boolean },
): Promise<void> {
  const s = await scale(page);
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  if (options?.modifier) await page.keyboard.down(options.modifier);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dxPage * s, cy + dyPage * s, { steps: 16 });
  await page.waitForTimeout(350);
  if (options?.cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  if (options?.modifier) await page.keyboard.up(options.modifier);
  await page.waitForTimeout(2000);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
});

test.describe("selection chrome", () => {
  test("handles wrap the selected element, not the screen", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");

    const target = await node(page, "box-a").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const chrome = await chromeBounds(page);
    expect(
      chrome,
      "no selection overlay appeared for a selected element",
    ).not.toBeNull();
    const width = chrome!.right - chrome!.left;
    const height = chrome!.bottom - chrome!.top;
    expect(
      [width, height],
      `Box A is ${Math.round(target.width)}x${Math.round(target.height)} at ` +
        `(${Math.round(target.x)},${Math.round(target.y)}), but the selection handles enclose ` +
        `${width}x${height} at (${chrome!.left},${chrome!.top}) — the whole screen. ` +
        `You cannot grab or resize what you selected.`,
    ).toEqual([
      expect.closeTo(target.width, -1.4),
      expect.closeTo(target.height, -1.4),
    ]);
  });

  test("selecting an element paints a selection overlay", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    expect(await activeOverlays(page)).toContain("selection");
  });

  test("selecting a different element moves the chrome to it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const first = await chromeBounds(page);
    await selectViaTree(page, "Box B");
    const second = await chromeBounds(page);
    expect(
      second,
      `chrome stayed at the same rect after selecting a different layer`,
    ).not.toEqual(first);
  });

  test("hovering an element outlines that element", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const target = await node(page, "box-a").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const onScreen = (await node(page, "box-a").boundingBox())!;
    await page.mouse.move(
      onScreen.x + onScreen.width / 2,
      onScreen.y + onScreen.height / 2,
    );
    await page.waitForTimeout(1200);

    // The hover indicator is painted inside the iframe, not the host document.
    const highlight = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const el = document.querySelector(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
    expect(
      highlight,
      "hovering an element painted no highlight overlay",
    ).not.toBeNull();
    expect(
      [highlight!.w, highlight!.h],
      `hovering a ${Math.round(target.width)}x${Math.round(target.height)} box ` +
        `highlighted ${highlight!.w}x${highlight!.h}`,
    ).toEqual([
      expect.closeTo(target.width, -1),
      expect.closeTo(target.height, -1),
    ]);
  });
});

test.describe("moving by drag", () => {
  test("a drag moves the element by the drag delta", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 120, 60);
    const after = await geom(page, id, "box-a");
    const dx = after.left - before.left;
    const dy = after.top - before.top;
    // A drag-start threshold consumes the first few px (Figma does the same),
    // so assert the movement is proportional rather than exact.
    expect(
      [dx / 120 > 0.9 && dx / 120 < 1.1, dy / 60 > 0.9 && dy / 60 < 1.1],
      `dragged (120,60) page px; moved (${dx},${dy}) — expected within 10%`,
    ).toEqual([true, true]);
  });

  test("Shift+drag locks movement to one axis", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 120, 30, {
      modifier: "Shift",
    });
    const after = await geom(page, id, "box-a");
    expect(
      after.top,
      `Shift+drag moved mostly horizontally but top changed ${before.top} → ${after.top}`,
    ).toBe(before.top);
  });

  test("Alt+drag leaves the original and creates a copy", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await indexHtml(page, id);
    const countBefore = (
      before.match(/data-agent-native-layer-name="Box A"/g) ?? []
    ).length;
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 150, 0, {
      modifier: ALT,
    });
    const after = await indexHtml(page, id);
    expect(
      (after.match(/data-agent-native-layer-name="Box A"/g) ?? []).length,
      `Alt+drag should duplicate; Box A count stayed ${countBefore}`,
    ).toBeGreaterThan(countBefore);
  });

  test("Escape during a drag cancels the move", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 200, 100, {
      cancel: true,
    });
    const after = await geom(page, id, "box-a");
    expect(
      [after.left, after.top],
      "Escape mid-drag must restore the start position",
    ).toEqual([before.left, before.top]);
  });

  test("dragging one element leaves its siblings untouched", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const siblingBefore = (await geom(page, id, "box-b")).style;
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 80, 40);
    expect((await geom(page, id, "box-b")).style).toBe(siblingBefore);
  });

  test("undo restores the position after a drag", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 100, 50);
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(2000);
    const after = await geom(page, id, "box-a");
    expect([after.left, after.top]).toEqual([before.left, before.top]);
  });
});

test.describe("resizing", () => {
  test("dragging the bottom-right corner resizes width and height", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    // Element resize handles live INSIDE the iframe as children of the
    // selection overlay; [data-resize-handle] in the host is the screen's own
    // board chrome.
    const iframeBox = (await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .boundingBox())!;
    const s0 = await scale(page);
    const cornerLocal = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const handles = Array.from(
          document.querySelectorAll("[data-agent-native-edit-handle]"),
        );
        if (handles.length === 0) return null;
        const se = handles
          .map((h) => h.getBoundingClientRect())
          .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
        return { x: se.x + se.width / 2, y: se.y + se.height / 2 };
      });
    const corner = cornerLocal
      ? {
          x: Math.round(iframeBox.x + cornerLocal.x * s0),
          y: Math.round(iframeBox.y + cornerLocal.y * s0),
        }
      : null;
    expect(corner, "no corner resize handle found").not.toBeNull();

    const s = await scale(page);
    await page.mouse.move(corner!.x, corner!.y);
    await page.mouse.down();
    await page.mouse.move(corner!.x + 100 * s, corner!.y + 60 * s, {
      steps: 14,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = await geom(page, id, "box-a");
    expect(
      [after.width - before.width, after.height - before.height],
      `dragged the SE corner by (100,60); size changed by ` +
        `(${after.width - before.width},${after.height - before.height})`,
    ).toEqual([expect.closeTo(100, -1), expect.closeTo(60, -1)]);
  });

  test("resizing keeps the opposite edge anchored", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    const corner = await page.evaluate(() => {
      const small = Array.from(
        document.querySelectorAll("[data-resize-handle]"),
      ).filter((h) => h.getBoundingClientRect().width < 20);
      if (small.length === 0) return null;
      const se = small
        .map((h) => h.getBoundingClientRect())
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
      return {
        x: Math.round(se.x + se.width / 2),
        y: Math.round(se.y + se.height / 2),
      };
    });
    if (!corner) test.skip(true, "no corner handle to drag");
    const s = await scale(page);
    await page.mouse.move(corner!.x, corner!.y);
    await page.mouse.down();
    await page.mouse.move(corner!.x + 80 * s, corner!.y + 40 * s, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = await geom(page, id, "box-a");
    test.skip(
      after.width === before.width && after.height === before.height,
      "resize did not change the size, so anchoring is untested — see the SE corner test",
    );
    expect(
      [after.left, after.top],
      "dragging the SE corner must not move the NW corner",
    ).toEqual([before.left, before.top]);
  });
});

test.describe("reparenting and reordering", () => {
  test("dragging an element into a container nests it", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const box = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(2500);

    const nested = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(nested, "dropping Box A onto Container did not reparent it").toBe(
      true,
    );
  });

  test("dragging within an auto-layout row reorders it", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const first = (await node(page, "chip-1").boundingBox())!;
    const third = (await node(page, "chip-3").boundingBox())!;
    // Select on the canvas, not via the tree: the bridge owns drag state and
    // a Layers-panel selection does not arm it.
    await page.mouse.click(
      first.x + first.width / 2,
      first.y + first.height / 2,
    );
    await page.waitForTimeout(1200);
    await page.mouse.move(
      first.x + first.width / 2,
      first.y + first.height / 2,
    );
    await page.mouse.down();
    // A short first move starts the native drag; jumping straight to the
    // target never leaves the source and no reorder is ever computed.
    await page.mouse.move(
      first.x + first.width / 2 + 12,
      first.y + first.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      third.x + third.width - 4,
      third.y + third.height / 2,
      {
        steps: 24,
      },
    );
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(2500);

    const html = await indexHtml(page, id);
    expect(
      html.indexOf("chip-1"),
      "dragging Chip 1 past Chip 3 did not reorder the auto-layout row",
    ).toBeGreaterThan(html.indexOf("chip-3"));
  });

  test("dragging a layer row onto a container row reparents it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await layerRow(page, "Box A").dragTo(layerRow(page, "Container"));
    await page.waitForTimeout(2500);

    const nested = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(
      nested,
      "dragging the layer row onto Container did not reparent",
    ).toBe(true);
  });
});

test.describe("reparenting rules", () => {
  test("an object smaller than a frame becomes its child when dropped in", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const box = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2500);

    const nested = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(
      nested,
      'Figma: "If an object is smaller than a frame, we will make it a child of the frame."',
    ).toBe(true);
  });

  test("holding Space while dragging keeps the object in its current parent", async ({
    page,
  }) => {
    const inRow = (target: Page) =>
      target
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const row = document.querySelector(
            '[data-agent-native-node-id="row"]',
          );
          const chip = document.querySelector(
            '[data-agent-native-node-id="chip-1"]',
          );
          return !!row && !!chip && row.contains(chip);
        });

    // The control drag mutates the document, so the Space drag needs its own
    // pristine design rather than the one the control already reparented.
    const controlId = await newDesign(page);
    await openEditor(page, controlId);
    await selectViaTree(page, "Chip 1");
    let chip = (await node(page, "chip-1").boundingBox())!;
    let outside = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 18 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2200);
    test.skip(
      await inRow(page),
      "an unmodified drag does not reparent either, so the Space modifier is untestable",
    );

    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Chip 1");
    chip = (await node(page, "chip-1").boundingBox())!;
    outside = (await node(page, "frame-a").boundingBox())!;

    // The retain-parent flag is set by a keydown listener on the IFRAME
    // document; page.keyboard sends to the host, where it only pans.
    const previewBody = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body");
    const spaceKey = (type: "keydown" | "keyup") =>
      previewBody.evaluate((_b, t) => {
        document.dispatchEvent(
          new KeyboardEvent(t, {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
          }),
        );
      }, type);

    await spaceKey("keydown");
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await spaceKey("keyup");
    await page.waitForTimeout(2500);

    expect(
      await inRow(page),
      "Figma: \"When moving an object out of a frame's bounds, hold the Space bar to keep " +
        'an object within the current parent."',
    ).toBe(true);
  });
});

test.describe("drag feedback", () => {
  test("snap guides appear when an edge aligns with a sibling", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const a = (await node(page, "box-a").boundingBox())!;
    const b = (await node(page, "box-b").boundingBox())!;

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, b.y - a.height, { steps: 18 });
    await page.waitForTimeout(900);
    const guides = (await activeOverlays(page)).filter((k) =>
      /snap-guide|measurement|transform-badge/.test(k),
    ).length;
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect(
      guides,
      `Figma: "when using snap to settings ... a red guide appears on the canvas as a visual ` +
        `indicator", and snap-to-objects "aligns the centers and outermost points of ` +
        `different objects". No guide appeared.`,
    ).toBeGreaterThan(0);
  });

  test("a container highlights as a drop target while dragging over it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const a = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 18 },
    );
    await page.waitForTimeout(900);
    const highlights = (await activeOverlays(page)).filter((k) =>
      /insertion-guide|drop/.test(k),
    ).length;
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect(
      highlights,
      `UNVERIFIED for a plain frame: Figma documents a blue indicator only for auto layout ` +
        `containers, and says nothing about highlighting a plain frame. Treat as a usability ` +
        `claim. No feedback of any kind appeared.`,
    ).toBeGreaterThan(0);
  });

  test("the layers panel shows an insertion line while dragging a row", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const src = (await layerRow(page, "Box A").boundingBox())!;
    const dst = (await layerRow(page, "Box B").boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    // A short first move starts the native drag; jumping straight to the
    // target never leaves the source row and no dragover fires.
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 8, {
      steps: 4,
    });
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height - 3, {
      steps: 14,
    });
    await page.waitForTimeout(600);
    const indicators = await page
      .locator("[data-layer-drop-indicator]")
      .count();
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(
      indicators,
      "Figma shows an insertion line while reordering layers",
    ).toBeGreaterThan(0);
  });

  test("the cursor differs between the Move and Hand tools", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const read = () =>
      page.evaluate(() => {
        const world = document.querySelector(
          "[data-multi-screen-canvas-world]",
        );
        const surface = world?.parentElement ?? null;
        return surface ? getComputedStyle(surface).cursor : null;
      });
    const move = await read();
    await toolbar(page).locator('button[aria-label="Move options"]').click();
    await page.getByRole("menuitem", { name: /Hand/i }).first().click();
    await page.waitForTimeout(1200);
    const hand = await read();
    expect(hand, `Move and Hand both show cursor "${move}"`).not.toBe(move);
  });
});

test.describe("drop containers", () => {
  const dropFixture = (
    primitive: string,
  ) => `<!doctype html><html><head><meta charset="utf-8"><title>Drop</title></head>
<body style="margin:0;min-height:900px;background:#0f1115">
<div data-agent-native-node-id="mover" data-agent-native-layer-name="Mover"
     style="position:absolute;left:20px;top:300px;width:100px;height:60px;background:#a855f7"></div>
<div data-agent-native-node-id="target" data-agent-native-layer-name="Target" data-an-primitive="${primitive}"
     style="position:absolute;left:170px;top:300px;width:120px;height:120px;background:#ec4899"></div>
</body></html>`;

  const dragMoverOntoTarget = async (page: Page, primitive: string) => {
    const id = await newDesign(page, dropFixture(primitive));
    await openEditor(page, id);
    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const mover = (await preview
      .locator('[data-agent-native-node-id="mover"]')
      .boundingBox())!;
    const target = (await preview
      .locator('[data-agent-native-node-id="target"]')
      .boundingBox())!;
    await page.mouse.move(
      mover.x + mover.width / 2,
      mover.y + mover.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      mover.x + mover.width / 2 + 10,
      mover.y + mover.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(2500);
    return preview
      .locator("body")
      .evaluate(
        () =>
          document
            .querySelector('[data-agent-native-node-id="mover"]')
            ?.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
      );
  };

  test("a frame adopts an element dragged into it", async ({ page }) => {
    expect(
      await dragMoverOntoTarget(page, "frame"),
      "frames are the container primitive and must adopt a dropped element",
    ).toBe("target");
  });

  test("a rectangle never adopts an element dragged onto it", async ({
    page,
  }) => {
    expect(
      await dragMoverOntoTarget(page, "rectangle"),
      "a rectangle is a vector shape, not a container — matching Figma and the " +
        "same contract the draw path enforces",
    ).not.toBe("target");
  });
});

test.describe("modifier collisions", () => {
  /** Synthetic input under-travels (the first move starts the drag and rAF
   *  coalesces the rest), so compare the two drags rather than absolutes. */
  const dragUp = async (page: Page, withModifier: boolean) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    await page.waitForTimeout(1200);
    const read = async () =>
      Number(
        /box-a"[\s\S]{0,200}?top:\s*(-?\d+(?:\.\d+)?)px/.exec(
          await indexHtml(page, id),
        )?.[1] ?? NaN,
      );
    const before = await read();
    const box = (await node(page, "box-a").boundingBox())!;
    const s = box.height / 80;
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    if (withModifier) await page.keyboard.down(mod);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2 - 100 * s,
      {
        steps: 40,
      },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();
    if (withModifier) await page.keyboard.up(mod);
    await page.waitForTimeout(2200);
    return before - (await read());
  };

  test("the primary modifier does not hijack a drag", async ({ page }) => {
    const plain = await dragUp(page, false);
    const modified = await dragUp(page, true);
    expect(
      plain,
      `an unmodified 100px drag should travel most of the way; moved ${plain}`,
    ).toBeGreaterThan(85);
    expect(
      Math.abs(plain - modified),
      `the primary modifier is Figma's snap bypass, not a selection change — ` +
        `plain drag moved ${plain}, modified moved ${modified}. A large gap ` +
        `means the chord (additive-select / deep-select) consumed the gesture.`,
    ).toBeLessThanOrEqual(8);
  });
});

test.describe("marquee", () => {
  test("dragging from empty canvas marquee-selects the elements it covers", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    // Starting outside the screen marquees the BOARD (screens), not the
    // elements — the drag has to begin on empty space inside the screen.
    const a = (await node(page, "box-a").boundingBox())!;
    const scale = a.width / 120;
    const originX = a.x - 30 * scale;
    const originY = a.y - 280 * scale;
    const at = (sx: number, sy: number) => ({
      x: originX + sx * scale,
      y: originY + sy * scale,
    });
    const from = at(180, 240);
    const to = at(15, 545);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(1800);

    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      "a marquee across Box A and Box B should select both",
    ).toHaveCount(2);
  });
});
