import { expect, test, type Locator, type Page } from "@playwright/test";

import { expandAllLayers } from "./helpers";

/**
 * Selection reachability: everything a click can select, a rubber band must be
 * able to sweep, and a hairline must be grabbable. Each test drives the gesture
 * a designer performs, then asserts on the Layers panel and the bridge overlay.
 */

const PAGE_W = 320;
const PAGE_H = 820;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Selection</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <div data-agent-native-node-id="wrapper" data-agent-native-layer-name="Wrapper"
         style="position:relative;width:100%;min-height:${PAGE_H}px;background:#fff">
      <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
           style="position:absolute;left:20px;top:120px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
           style="position:absolute;left:170px;top:120px;width:110px;height:80px;background:#22c55e"></div>
      <svg data-agent-native-node-id="rule" data-agent-native-layer-name="Rule"
           width="260" height="12" viewBox="0 0 260 12"
           style="position:absolute;left:20px;top:260px;overflow:visible">
        <path d="M0 6 L260 6" stroke="#111" stroke-width="3" fill="none" />
      </svg>
      <div data-agent-native-layer-name="Unnamed"
           style="position:absolute;left:20px;top:320px;width:200px;height:70px;background:#f59e0b"></div>
      <div data-agent-native-node-id="ghosted" data-agent-native-layer-name="Ghosted"
           style="display:none;position:absolute;left:20px;top:200px;width:120px;height:40px;background:#000"></div>
      <div data-agent-native-node-id="flat" data-agent-native-layer-name="Flat row"
           style="position:absolute;left:20px;top:440px;width:200px;height:0;overflow:visible">
        <span style="display:block;width:200px;height:24px;background:#a855f7"></span>
      </div>
    </div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "selection repros",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function selectedRows(page: Page): Locator {
  return layersTree(page).locator('[role="treeitem"][aria-selected="true"]');
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
  // No blind settle: expandAllLayers waits for the first layer row, which
  // the editor cannot render before it has parsed the document.
  await expandAllLayers(page);
  await page.waitForTimeout(500);
}

async function screenCard(page: Page) {
  const box = await page.locator("[data-screen-card]").first().boundingBox();
  if (!box) throw new Error("no screen card");
  return box;
}

/** Sweeps a rubber band between two page points, clamped inside the screen. */
async function sweep(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.waitForTimeout(2200);
}

/** The bridge's selection outline, or null when nothing is outlined. */
async function selectionOutline(page: Page) {
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
      return { width: Math.round(r.width), height: Math.round(r.height) };
    });
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
});

test.describe("marquee reachability", () => {
  test("a drag from empty space inside a screen rubber-bands its children", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    // Nothing selected: a selected frame is dragged by its own body (Figma
    // does the same), so the rubber band lives in the unselected state.
    const a = (await node(page, "box-a").boundingBox())!;
    const b = (await node(page, "box-b").boundingBox())!;
    const card = await screenCard(page);
    await sweep(
      page,
      { x: Math.max(card.x + 4, a.x - 10), y: a.y - 20 },
      { x: b.x + b.width + 10, y: b.y + b.height + 10 },
    );

    const names = await selectedRows(page).allTextContents();
    expect(
      names.join("|"),
      "a background drag inside a frame must rubber-band, not pick the frame up",
    ).toContain("Box A");
    expect(names.join("|")).toContain("Box B");
    expect(
      names.join("|"),
      "the container the band was drawn inside must not be swept in — its outline covers the whole screen and reads as 'everything is selected'",
    ).not.toContain("Wrapper");
  });

  test("the band catches an element that has no id of its own", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const target = (await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('div[style*="background:#f59e0b"]')
      .first()
      .boundingBox())!;
    const card = await screenCard(page);
    await sweep(
      page,
      { x: Math.max(card.x + 4, target.x - 10), y: target.y - 14 },
      { x: target.x + target.width + 10, y: target.y + target.height + 14 },
    );

    const swept = (await selectedRows(page).allTextContents()).join("|");
    expect(
      swept,
      "an id attribute is a persistence detail; a click selects this element, so a band must too",
    ).not.toBe("");
    expect(swept, "the enclosing wrapper is not the target").not.toContain(
      "Wrapper",
    );
  });

  test("the band catches a zero-height row", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const flat = (await node(page, "flat").boundingBox())!;
    const card = await screenCard(page);
    await sweep(
      page,
      { x: Math.max(card.x + 4, flat.x - 10), y: flat.y - 18 },
      { x: flat.x + flat.width + 10, y: flat.y + 30 },
    );

    expect(
      (await selectedRows(page).allTextContents()).join("|"),
      "a zero-area box is still a layer",
    ).toContain("Flat row");
  });
});

test.describe("hairline selection", () => {
  test("clicking a horizontal rule selects the rule with a grabbable outline", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    const rule = (await node(page, "rule").boundingBox())!;
    await page.mouse.click(rule.x + rule.width / 2, rule.y + rule.height / 2);
    await page.waitForTimeout(2200);

    expect(
      (await selectedRows(page).allTextContents()).join("|"),
      "the <path> is geometry; the layer is the <svg> around it",
    ).toContain("Rule");
    const outline = await selectionOutline(page);
    expect(outline, "a selected rule must be outlined").not.toBeNull();
    expect(
      outline!.height,
      "the outline must match the rule's own box, not its stroke box",
    ).toBeGreaterThanOrEqual(12);
  });
});

test.describe("clicking into a selected screen", () => {
  test("one click selects the element under the cursor", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await page.locator("[data-frame-label]").first().click({ force: true });
    await page.waitForTimeout(1800);

    const a = (await node(page, "box-a").boundingBox())!;
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(2400);

    expect(
      (await selectedRows(page).allTextContents()).join("|"),
      "the frame's drag surface hands a click back to the content, so it must land on the element, not the full-bleed wrapper",
    ).toContain("Box A");
  });
});

/**
 * Where box-a is actually painted, across every preview surface. Returned with
 * the frame index and position so a caller can prove a drag moved it: the
 * survival checks below (exists / not hidden / no leftover transform / in
 * viewport) are all satisfied by a drag that never happened.
 */
async function paintedBoxA(page: Page) {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]!;
      const el = frame.contentDocument?.querySelector(
        '[data-agent-native-node-id="box-a"]',
      );
      if (!el) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        frameIndex: index,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        hidden:
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0,
        transform: style.transform,
        inViewport:
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.x < frame.clientWidth &&
          rect.y < frame.clientHeight,
      };
    }
    return null;
  });
}

test.describe("dragging an element out of a screen", () => {
  test("the element stays visible somewhere instead of vanishing", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    const a = (await node(page, "box-a").boundingBox())!;
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(1800);

    const beforeDrag = await paintedBoxA(page);
    expect(beforeDrag, "box-a must be painted before the drag").not.toBeNull();

    const card = await screenCard(page);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x - 120, card.y - 60, { steps: 24 });
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(4000);

    const painted = await paintedBoxA(page);

    expect(
      painted,
      "the dragged element must still exist somewhere",
    ).not.toBeNull();
    expect(
      painted!.frameIndex !== beforeDrag!.frameIndex ||
        Math.abs(painted!.x - beforeDrag!.x) > 20 ||
        Math.abs(painted!.y - beforeDrag!.y) > 20,
      `the drag must actually relocate box-a, or every survival check below ` +
        `passes for free (frame ${beforeDrag!.frameIndex}@${beforeDrag!.x},${beforeDrag!.y} ` +
        `-> ${painted!.frameIndex}@${painted!.x},${painted!.y})`,
    ).toBe(true);
    expect(painted!.hidden, "a drop must never leave the element hidden").toBe(
      false,
    );
    expect(
      painted!.transform,
      "a leftover drag transform displaces the element away from its own coordinates",
    ).toBe("none");
    expect(
      painted!.inViewport,
      "the element must land inside the surface that renders it",
    ).toBe(true);
  });
});

test.describe("drag preview", () => {
  test("dragging a layer out of its screen shows a proxy the size of the layer", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    const a = (await node(page, "box-a").boundingBox())!;
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(1800);

    const card = await screenCard(page);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x - 140, card.y + 80, { steps: 20 });
    await page.waitForTimeout(700);

    const proxy = await page
      .locator("[data-cross-screen-drag-ghost]")
      .boundingBox();
    const proxyFill = await page
      .locator("[data-cross-screen-drag-ghost]")
      .evaluate((el) => getComputedStyle(el).backgroundColor)
      .catch(() => null);
    await page.mouse.up();
    await page.waitForTimeout(2500);

    expect(
      proxy,
      "a drag that left the screen must still show what moves",
    ).not.toBeNull();
    expect(
      proxyFill,
      "the proxy must carry the layer's own fill, not a generic accent rectangle",
    ).toBe("rgb(59, 130, 246)");
    // A 16px cursor dot is what this looked like before: the host never
    // received the layer's size, so there was nothing to show.
    expect(Math.round(proxy!.width)).toBeGreaterThan(a.width * 0.8);
    expect(Math.round(proxy!.height)).toBeGreaterThan(a.height * 0.8);
  });
});

test.describe("dragging back into a screen", () => {
  test("the layer lands where it was released, not in the corner", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    // Out to the canvas first.
    const start = (await node(page, "box-a").boundingBox())!;
    const card = await screenCard(page);
    await page.mouse.click(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.waitForTimeout(1700);
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(card.x - 160, card.y + 120, { steps: 20 });
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(4000);

    // Then back in, released well away from the screen's top-left corner.
    const onCanvas = await page.evaluate(() => {
      for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        const el = frame.contentDocument?.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const frameBox = frame.getBoundingClientRect();
        const scaleX = frameBox.width / (frame.clientWidth || 1);
        const scaleY = frameBox.height / (frame.clientHeight || 1);
        return {
          x: frameBox.x + rect.x * scaleX,
          y: frameBox.y + rect.y * scaleY,
        };
      }
      return null;
    });
    if (!onCanvas) throw new Error("dragged layer is not on any surface");
    await page.mouse.click(onCanvas.x + 8, onCanvas.y + 8);
    await page.waitForTimeout(1700);
    const dropX = card.x + card.width * 0.6;
    const dropY = card.y + card.height * 0.55;
    await page.mouse.move(onCanvas.x + 8, onCanvas.y + 8);
    await page.mouse.down();
    await page.mouse.move(dropX, dropY, { steps: 22 });
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(4500);

    const html = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
      .then((r) => r.json())
      .then(
        (d) =>
          (d.files ?? []).find(
            (f: { filename: string }) => f.filename === "index.html",
          )?.content ?? "",
      );
    const style =
      /data-agent-native-node-id="box-a"[^>]*?style="([^"]*)"/i.exec(
        html,
      )?.[1] ?? "";
    const left = Number(/(?:^|;)\s*left\s*:\s*(-?[\d.]+)px/i.exec(style)?.[1]);
    const top = Number(/(?:^|;)\s*top\s*:\s*(-?[\d.]+)px/i.exec(style)?.[1]);

    expect(
      style,
      "a drop into a freeform screen must keep absolute placement, or the layer flow-inserts into the corner",
    ).toContain("position: absolute");
    expect(left, "left must survive the round trip").toBeGreaterThan(40);
    expect(top, "top must survive the round trip").toBeGreaterThan(40);
  });
});

test.describe("dragging out and back onto the same screen", () => {
  test("the layer stays in the screen instead of landing on the board behind it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    const box = (await node(page, "box-b").boundingBox())!;
    const card = await screenCard(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1700);

    // Out past the screen edge, then back in — the pointer re-entering the
    // source screen stops the cross-screen move messages, so the host's target
    // is stale by the time of the release.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x - 150, card.y + 100, { steps: 14 });
    await page.waitForTimeout(300);
    await page.mouse.move(
      card.x + card.width * 0.5,
      card.y + card.height * 0.45,
      {
        steps: 16,
      },
    );
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(4500);

    const files = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
      .then((r) => r.json())
      .then((d) => d.files ?? []);
    const board =
      files.find((f: { filename: string }) => f.filename === "__board__.html")
        ?.content ?? "";
    const screen =
      files.find((f: { filename: string }) => f.filename === "index.html")
        ?.content ?? "";

    expect(
      board.includes('node-id="box-b"'),
      "a release over the screen must not move the layer onto the board, which paints behind it",
    ).toBe(false);
    expect(screen.includes('node-id="box-b"')).toBe(true);
    const style =
      /data-agent-native-node-id="box-b"[^>]*?style="([^"]*)"/i.exec(
        screen,
      )?.[1] ?? "";
    const top = Number(/(?:^|;)\s*top\s*:\s*(-?[\d.]+)px/i.exec(style)?.[1]);
    expect(
      top,
      "the layer must land near the release point, not back up at the top",
    ).toBeGreaterThan(150);
  });
});

test.describe("hidden layers", () => {
  test("a band over a display:none layer does not select it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);

    // The band spans the hidden layer's coordinates, between the two boxes and
    // the rule below them.
    const a = (await node(page, "box-a").boundingBox())!;
    const rule = (await node(page, "rule").boundingBox())!;
    const card = await screenCard(page);
    await sweep(
      page,
      { x: Math.max(card.x + 4, a.x - 10), y: a.y + a.height + 4 },
      { x: rule.x + rule.width, y: rule.y - 4 },
    );

    expect(
      (await selectedRows(page).allTextContents()).join("|"),
      "padding a zero-size box must not make an invisible layer selectable",
    ).not.toContain("Ghosted");
  });
});
