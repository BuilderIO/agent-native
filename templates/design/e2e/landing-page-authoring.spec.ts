import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Each test asserts the Figma-correct outcome, so a failure is the bug report.
 * Test names cite clips.agent-native.com/share/jJM4kC0KAkUB.
 *
 * Do not switch to helpers.ts `selectByText`/`enterDirectMode`: they route
 * through the screen card's Interact button, a preview with no edit shield.
 */

const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const BLANK_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Landing</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0b0f19"></body>
</html>`;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let baseURL = "";
let surfacedErrors: string[] = [];

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** A fresh single-screen design, so every test is independent. */
async function newDesign(page: Page, content = BLANK_SCREEN): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "Landing page authoring (clip repro)",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id ?? created?.design?.id;
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

function numProp(style: string, prop: string): number {
  const raw = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(style);
  return raw ? Number(raw[1]) : NaN;
}

/** Inline styles of every committed primitive of one kind, in document order. */
function primitiveStyles(html: string, kind: string): string[] {
  const re = new RegExp(
    `data-an-primitive="${kind}"[^>]*?style="([^"]*)"|style="([^"]*)"[^>]*?data-an-primitive="${kind}"`,
    "gi",
  );
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.push(m[1] ?? m[2] ?? "");
  return found;
}

function rectFromStyle(style: string): Rect {
  return {
    left: numProp(style, "left"),
    top: numProp(style, "top"),
    width: numProp(style, "width"),
    height: numProp(style, "height"),
  };
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function screenCard(page: Page): Locator {
  return page.locator("[data-screen-card]").first();
}

function inFrame(page: Page, selector: string): Locator {
  return page
    .frameLocator("iframe[data-design-preview-iframe]")
    .first()
    .locator(selector);
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await toolbar(page)
    .locator('button[aria-label="Move"]')
    .waitFor({ state: "visible", timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page
    .getByRole("button", { name: "Expand layer" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(800);
}

/** The screen's own content viewport — never assume; it is not the page size. */
async function contentSize(page: Page): Promise<{ w: number; h: number }> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => ({
      w: document.documentElement.clientWidth,
      h: document.documentElement.clientHeight,
    }));
}

async function toScreenPoint(page: Page, x: number, y: number) {
  const card = await screenCard(page).boundingBox();
  if (!card) throw new Error("no screen card on the overview canvas");
  const size = await contentSize(page);
  return {
    x: card.x + (x / size.w) * card.width,
    y: card.y + (y / size.h) * card.height,
  };
}

async function useTool(page: Page, name: string): Promise<void> {
  await toolbar(page).locator(`button[aria-label="${name}"]`).click();
  await expect(
    toolbar(page).locator(`button[aria-label="${name}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(250);
}

async function dragOnCanvas(page: Page, rect: Rect): Promise<void> {
  const a = await toScreenPoint(page, rect.left, rect.top);
  const b = await toScreenPoint(page, rect.left + rect.width, rect.top + rect.height);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(1600);
}

async function drawRect(page: Page, rect: Rect): Promise<void> {
  await useTool(page, "Rectangle");
  await dragOnCanvas(page, rect);
}

async function drawFrame(page: Page, rect: Rect): Promise<void> {
  await useTool(page, "Frame");
  await dragOnCanvas(page, rect);
}

async function addText(
  page: Page,
  at: { x: number; y: number },
  text: string,
): Promise<void> {
  await useTool(page, "Text");
  const point = await toScreenPoint(page, at.x, at.y);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type(text, { delay: 12 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1600);
}

async function readToasts(page: Page): Promise<string[]> {
  return page
    .locator("[data-sonner-toast], [role='alert']")
    .allTextContents()
    .then((all) => all.map((t) => t.trim()).filter(Boolean))
    .catch(() => []);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
  surfacedErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Outdated Optimize Dep|favicon|React DevTools/i.test(text)) return;
    surfacedErrors.push(text.slice(0, 200));
  });
});

// ── Header ────────────────────────────────────────────────────────────────

test("0:53 — a frame commits the rectangle you dragged", async ({ page }) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);

  // Inset from the very top edge so this measures size fidelity, not the
  // separate "nothing commits at y=0" case the full-page test covers.
  const requested: Rect = { left: 20, top: 40, width: 280, height: 96 };
  await drawFrame(page, requested);

  const styles = primitiveStyles(await indexHtml(page, designId), "frame");
  expect(styles, "the Frame tool committed no frame at all").toHaveLength(1);
  const actual = rectFromStyle(styles[0]);
  expect(
    [actual.left, actual.top, actual.width, actual.height],
    `Dragged ${requested.width}x${requested.height} at (${requested.left},${requested.top}); ` +
      `committed ${actual.width}x${actual.height} at (${actual.left},${actual.top}). ` +
      `Clip 0:53 "it created a longer one".`,
  ).toEqual([
    expect.closeTo(requested.left, -1),
    expect.closeTo(requested.top, -1),
    expect.closeTo(requested.width, -1),
    expect.closeTo(requested.height, -1),
  ]);
});

test("1:16 — header text is readable against the canvas background", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await addText(page, { x: 24, y: 36 }, "Builder.io");

  const styles = primitiveStyles(await indexHtml(page, designId), "text");
  expect(styles, "the Text tool committed no text").not.toHaveLength(0);
  const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styles[0])?.[1]?.trim();
  expect(
    colour,
    `Text committed color:"${colour}" on a #0b0f19 canvas. currentcolor resolves ` +
      `to the UA default black, so the header is invisible. NOT Figma parity — Figma ` +
      `defaults to black too; this asserts Design's own intent, since it stamps ` +
      `data-an-auto-text-color on every text primitive.`,
  ).not.toBe("currentcolor");
});

// ── Foundation ────────────────────────────────────────────────────────────

test("6:03 — every shape you draw lands inside the page", async ({ page }) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  const requested: Rect = { left: 120, top: 220, width: 1200, height: 420 };
  await drawRect(page, requested);

  const styles = primitiveStyles(await indexHtml(page, designId), "rectangle");
  expect(styles, "the Rectangle tool committed no rectangle").toHaveLength(1);
  const hero = rectFromStyle(styles[0]);
  expect(
    hero.top + hero.height,
    `Drew a hero at top=${requested.top} height=${requested.height}; it committed ` +
      `top=${hero.top} height=${hero.height}, ending ${hero.top + hero.height}px down a ` +
      `${PAGE_H}px page. Clip 6:03 "where are the rectangles?".`,
  ).toBeLessThanOrEqual(PAGE_H);
  expect(
    hero.left + hero.width,
    `Hero spans to x=${hero.left + hero.width} in a ${PAGE_W}px page.`,
  ).toBeLessThanOrEqual(PAGE_W + 1);
});

test("8:35 — a frame adopts an element drawn inside it", async ({ page }) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawFrame(page, { left: 20, top: 150, width: 280, height: 300 });
  await addText(page, { x: 60, y: 260 }, "Design and code, one canvas");

  const html = await indexHtml(page, designId);
  const frameAt = html.indexOf('data-an-primitive="frame"');
  const textAt = html.indexOf('data-an-primitive="text"');
  const frameCloses = html.indexOf("</div>", frameAt);
  expect(
    textAt > frameAt && textAt < frameCloses,
    `Text drawn inside the frame's bounds committed as a sibling, not a child ` +
      `(frame at ${frameAt}, closes at ${frameCloses}, text at ${textAt}). ` +
      `Frames are the container primitive — clip 8:35.`,
  ).toBe(true);
});

test("a rectangle does NOT adopt children, matching Figma", async ({ page }) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 20, top: 150, width: 280, height: 300 });
  await addText(page, { x: 60, y: 260 }, "Not a child");

  const html = await indexHtml(page, designId);
  const rectAt = html.indexOf('data-an-primitive="rectangle"');
  const textAt = html.indexOf('data-an-primitive="text"');
  const rectCloses = html.indexOf("</div>", rectAt);
  expect(
    textAt > rectAt && textAt < rectCloses,
    "a rectangle is a vector shape and must never become a container",
  ).toBe(false);
});

test("2:35 — Shift+A turns a selected frame into an auto-layout container", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawFrame(page, { left: 20, top: 120, width: 280, height: 300 });
  await layersTree(page).getByRole("treeitem").filter({ hasText: "Frame" }).first().click();
  await page.waitForTimeout(800);

  const before = await indexHtml(page, designId);
  await page.keyboard.press("Shift+A");
  await page.waitForTimeout(2500);
  const after = await indexHtml(page, designId);

  expect(
    after,
    `Shift+A on a selected frame left index.html byte-identical. ` +
      `Clip 2:35 "should make it auto layout but doesn't".`,
  ).not.toBe(before);
  expect(primitiveStyles(after, "frame")[0] ?? "").toMatch(/display\s*:\s*flex/i);
});

test("8:09 — enabling auto layout keeps the container's children", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawFrame(page, { left: 20, top: 120, width: 280, height: 300 });
  await addText(page, { x: 50, y: 200 }, "Hero title");
  const before = await indexHtml(page, designId);
  const textsBefore = primitiveStyles(before, "text").length;

  await layersTree(page).getByRole("treeitem").filter({ hasText: "Frame" }).first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Shift+A");
  await page.waitForTimeout(2500);

  const after = await indexHtml(page, designId);
  test.skip(
    after === before,
    "Shift+A did not apply auto layout, so there is nothing to drop — see the 2:35 test",
  );
  expect(
    primitiveStyles(after, "text").length,
    `Auto layout dropped text children: ${textsBefore} before, ` +
      `${primitiveStyles(after, "text").length} after. ` +
      `Clip 8:09 "it has the rectangle but doesn't have title and the description".`,
  ).toBe(textsBefore);
});

// ── Drag and drop ─────────────────────────────────────────────────────────

test("3:17 — dragging a layer on the canvas moves it", async ({ page }) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 40, top: 200, width: 200, height: 160 });
  const before = rectFromStyle(
    primitiveStyles(await indexHtml(page, designId), "rectangle")[0] ?? "",
  );

  const target = inFrame(page, '[data-an-primitive="rectangle"]').first();
  const box = await target.boundingBox();
  expect(box, "the rectangle has no hit box on the canvas").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 40,
    box!.y + box!.height / 2 + 100,
    { steps: 16 },
  );
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2000);

  const after = rectFromStyle(
    primitiveStyles(await indexHtml(page, designId), "rectangle")[0] ?? "",
  );
  expect(
    [after.left, after.top],
    `Dragged the rectangle by (40,100); it stayed at (${before.left},${before.top}). ` +
      `Clip 3:17 "let me try moving them vertically — doesn't work".`,
  ).not.toEqual([before.left, before.top]);
});

test("2:59 — moving a layer raises no 'Could not move that layer' toast", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 40, top: 200, width: 200, height: 160 });

  const target = inFrame(page, '[data-an-primitive="rectangle"]').first();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, {
      steps: 16,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);
  }
  expect(
    (await readToasts(page)).filter((t) => /could not move that layer/i.test(t)),
    `Clip 2:59 shows this toast on an ordinary move.`,
  ).toHaveLength(0);
});

test("5:41 — no internal node-resolution error reaches the user", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 40, top: 200, width: 200, height: 160 });
  await addText(page, { x: 60, y: 260 }, "Drag me");

  const target = inFrame(page, '[data-an-primitive="text"]').first();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + box.height / 2 + 80, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
  }

  const leaked = [...(await readToasts(page)), ...surfacedErrors].filter((t) =>
    /not found in sourceHtml|data-agent-native-node-id="draft-/i.test(t),
  );
  expect(
    leaked,
    `Clip 5:41 surfaces the raw internal message ` +
      `'Node with data-agent-native-node-id="draft-rect-…" not found in sourceHtml'.`,
  ).toHaveLength(0);
});

const STACK_SCREEN = `<!doctype html><html><head><meta charset="utf-8"><title>Stack</title></head>
<body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
<div data-agent-native-node-id="stack" data-agent-native-layer-name="Stack"
     style="position:absolute;left:20px;top:200px;width:280px;display:flex;flex-direction:column;gap:12px">
  <p data-agent-native-node-id="p1" data-agent-native-layer-name="First"
     style="margin:0;padding:12px;background:#1f2937">First paragraph</p>
  <p data-agent-native-node-id="p2" data-agent-native-layer-name="Second"
     style="margin:0;padding:12px;background:#374151">Second paragraph</p>
</div></body></html>`;

test("5:07 — a text layer can be reordered by dragging it on the canvas", async ({
  page,
}) => {
  // Absolutely-positioned text moves in x/y when dragged, as in Figma; the
  // clip's complaint is about reordering a stack, which is the flow path.
  const designId = await newDesign(page, STACK_SCREEN);
  await openEditor(page, designId);

  const second = (await inFrame(page, '[data-agent-native-node-id="p2"]').boundingBox())!;
  const first = (await inFrame(page, '[data-agent-native-node-id="p1"]').boundingBox())!;

  // The in-iframe "shield" overlay swallows locator clicks — drive the
  // pointer directly.
  await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
  await page.waitForTimeout(1200);
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2 - 10, { steps: 4 });
  await page.mouse.move(first.x + first.width / 2, first.y + 3, { steps: 20 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(2500);

  const html = await indexHtml(page, designId);
  expect(
    html.indexOf("Second paragraph"),
    `Dragging "Second paragraph" above "First paragraph" on the canvas did not ` +
      `reorder the document. Clip 5:07 "why can't I simply drag and drop a text ` +
      `just above a text I want? I need to use this left panel".`,
  ).toBeLessThan(html.indexOf("First paragraph"));
});

test("5:30 — dragging does not repaint the canvas background", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 40, top: 200, width: 200, height: 160 });

  const readBackground = () =>
    inFrame(page, "body").evaluate((b) => getComputedStyle(b).backgroundColor);
  const before = await readBackground();

  const target = inFrame(page, '[data-an-primitive="rectangle"]').first();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2 + 60, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(1800);
  }
  expect(
    await readBackground(),
    `Clip 5:30 "why did the background become black" mid-drag.`,
  ).toBe(before);
});

// ── Footer ────────────────────────────────────────────────────────────────

test("4:39 — aligning a multi-selection moves every selected layer", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);
  await drawRect(page, { left: 20, top: 500, width: 130, height: 120 });
  await drawRect(page, { left: 170, top: 560, width: 130, height: 120 });

  const rows = layersTree(page).getByRole("treeitem").filter({ hasText: "Rectangle" });
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await page.waitForTimeout(1000);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(2);

  await page.locator('button[aria-label="Start"]').first().click();
  await page.waitForTimeout(2500);

  const styles = primitiveStyles(await indexHtml(page, designId), "rectangle");
  const tops = styles.map((s) => numProp(s, "top"));
  expect(
    new Set(tops).size,
    `Align-top on a 2-layer selection left them at tops ${JSON.stringify(tops)}. ` +
      `Clip 4:39 "why did the alignment only shift this and not this".`,
  ).toBe(1);
});

test("0:28 — a deleted screen stays deleted", async ({ page }) => {
  const designId = await newDesign(page);
  await postAction(page, "create-file", {
    designId,
    filename: "scratch.html",
    content: BLANK_SCREEN,
    fileType: "html",
  });
  await openEditor(page, designId);

  const row = layersTree(page).getByRole("treeitem").filter({ hasText: "Scratch" }).first();
  await row.click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(1500);
  // Deleting a whole screen is destructive, so it confirms first.
  await page
    .getByRole("alertdialog")
    .getByRole("button")
    .filter({ hasText: /^Delete$/ })
    .first()
    .click();
  await page.waitForTimeout(2500);

  const files = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  expect(
    (files.files ?? []).map((f: any) => f.filename),
    `Clip 0:28 "that screen was never deleted, it seems".`,
  ).not.toContain("scratch.html");
});

// ── The whole page ────────────────────────────────────────────────────────

test("a header + hero + footer landing page renders entirely on the page", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await openEditor(page, designId);

  await drawFrame(page, { left: 0, top: 0, width: 320, height: 96 });
  await addText(page, { x: 24, y: 36 }, "Builder.io");
  await drawRect(page, { left: 20, top: 220, width: 280, height: 200 });
  await addText(page, { x: 40, y: 300 }, "Ship design and code together");
  await drawRect(page, { left: 20, top: 620, width: 130, height: 140 });
  await drawRect(page, { left: 170, top: 620, width: 130, height: 140 });

  const painted = await inFrame(page, "[data-an-primitive]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const doc = el.ownerDocument.documentElement;
      return {
        kind: el.getAttribute("data-an-primitive"),
        top: Math.round(r.top),
        right: Math.round(r.right),
        withinPage:
          r.width > 0 &&
          r.height > 0 &&
          r.top >= -1 &&
          r.bottom <= doc.clientHeight + 1 &&
          r.right <= doc.clientWidth + 1,
      };
    }),
  );
  const escaped = painted.filter((p) => !p.withinPage);
  expect(
    escaped,
    `${escaped.length} of ${painted.length} layers of the finished landing page fall ` +
      `outside the ${PAGE_W}x${PAGE_H} page: ${JSON.stringify(escaped)}`,
  ).toEqual([]);
});
