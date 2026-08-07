import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Invariants a direct-manipulation canvas must hold: the inspector, the
 * document and the rendered pixels all describe the same element. Each test
 * asserts the correct behaviour, so a failure is the bug report.
 */

const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Mirrors the reported screenshot: an auto-layout section with three children. */
const INTRO_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Playbook</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="intro" data-agent-native-layer-name="Intro"
             style="position:absolute;left:20px;top:200px;width:280px;display:flex;flex-direction:column;gap:16px">
      <h1 data-agent-native-node-id="intro-title" data-agent-native-layer-name="Title"
          style="margin:0;font-size:24px;line-height:1.1">Title</h1>
      <p data-agent-native-node-id="intro-sub" data-agent-native-layer-name="Sub"
         style="margin:0;font-size:18px">Short, one line sub header</p>
      <p data-agent-native-node-id="intro-body" data-agent-native-layer-name="Body"
         style="margin:0;font-size:16px">A few sentences describing the purpose of the document.</p>
    </section>
    <div data-agent-native-node-id="plain-box" data-agent-native-layer-name="Plain Box"
         style="position:absolute;left:20px;top:420px;width:160px;height:100px;background:#27272a"></div>
  </body>
</html>`;

/** An in-flow child of an auto-layout page: no authored left/top at all. */
const FLOW_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Playbook</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="page-wrap" data-agent-native-layer-name="A4 Playbook Page"
         style="position:absolute;left:16px;top:60px;width:288px;display:flex;flex-direction:column;gap:24px;padding:16px">
      <div data-agent-native-node-id="flow-header" data-agent-native-layer-name="Header"
           style="height:64px;background:#1f2937"></div>
      <section data-agent-native-node-id="flow-intro" data-agent-native-layer-name="Intro"
               style="display:flex;flex-direction:column;gap:16px">
        <h1 data-agent-native-node-id="flow-title" data-agent-native-layer-name="Title"
            style="margin:0;font-size:24px;line-height:1.1">Title</h1>
        <p data-agent-native-node-id="flow-sub" data-agent-native-layer-name="Sub"
           style="margin:0;font-size:18px">Short, one line sub header</p>
      </section>
    </div>
  </body>
</html>`;

const ABSOLUTE_CHILDREN_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Overlap</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="abs-intro" data-agent-native-layer-name="Intro"
             style="position:absolute;left:20px;top:200px;width:280px;height:200px">
      <h1 data-agent-native-node-id="abs-title" data-agent-native-layer-name="Title"
          style="position:absolute;left:0;top:0;margin:0;font-size:40px">Title</h1>
      <p data-agent-native-node-id="abs-sub" data-agent-native-layer-name="Sub"
         style="position:absolute;left:0;top:0;margin:0;font-size:18px">Short, one line sub header</p>
      <p data-agent-native-node-id="abs-body" data-agent-native-layer-name="Body"
         style="position:absolute;left:0;top:0;margin:0;font-size:16px">A few sentences describing the purpose.</p>
    </section>
  </body>
</html>`;

const BLANK_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Blank</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#ffffff"></body>
</html>`;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let baseURL = "";
let pageErrors: string[] = [];

async function postAction(page: Page, name: string, input: Record<string, unknown>) {
  const res = await page.request.post(`${baseURL}/_agent-native/actions/${name}`, {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function newDesign(page: Page, content: string): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "Canvas invariants",
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
  return (result.files ?? []).find((f: any) => f.filename === "index.html")?.content ?? "";
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRow(page: Page, name: string): Locator {
  return layersTree(page).getByRole("treeitem").filter({ hasText: name }).first();
}

function inFrame(page: Page, selector: string): Locator {
  return page.frameLocator("iframe[data-design-preview-iframe]").first().locator(selector);
}

function node(page: Page, id: string): Locator {
  return inFrame(page, `[data-agent-native-node-id="${id}"]`);
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, { waitUntil: "domcontentloaded" });
  await toolbar(page).locator('button[aria-label="Move"]').waitFor({ timeout: 45_000 });
  await page.locator("iframe[data-design-preview-iframe]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await expandAllLayers(page);
}

/** Nested rows only appear once every ancestor is expanded. */
async function expandAllLayers(page: Page): Promise<void> {
  for (let pass = 0; pass < 6; pass += 1) {
    const toggles = page.getByRole("button", { name: "Expand layer" });
    const count = await toggles.count();
    if (count === 0) break;
    for (let i = 0; i < count; i += 1) {
      await toggles.nth(0).click().catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
}

/** Prefer the real aria-label; a text-then-next-input walk lands on padding. */
async function inspectorField(page: Page, label: string): Promise<string> {
  const aria =
    label === "W" || label === "H"
      ? page.locator(`input[aria-label="${label} size in pixels"]`)
      : page.locator(`input[aria-label="${label}"]`);
  if ((await aria.count()) > 0) {
    const value = (await aria.first().inputValue()).trim();
    if (value !== "") return value;
    const placeholder = await aria.first().getAttribute("placeholder");
    return (placeholder ?? "").trim();
  }
  const input = page
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following::input[1]");
  if ((await input.count()) === 0) return "<absent>";
  return (await input.inputValue()).trim();
}

async function setInspectorField(page: Page, label: string, value: string): Promise<void> {
  const input = page
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following::input[1]");
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(1800);
}

function num(value: string): number {
  const m = /(-?[\d.]+)/.exec(value);
  return m ? Number(m[1]) : NaN;
}

/** The element's real box inside the preview document. */
async function renderedRect(page: Page, id: string): Promise<Rect> {
  return node(page, id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
}

function styleOf(html: string, id: string): string {
  return (
    new RegExp(`data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`, "i").exec(html)?.[1] ?? ""
  );
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(style);
  return m ? Number(m[1]) : NaN;
}

async function selectOnCanvas(page: Page, id: string): Promise<void> {
  const box = await node(page, id).boundingBox();
  if (!box) throw new Error(`no hit box for ${id}`);
  await page.mouse.click(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
  await page.waitForTimeout(1800);
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
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
  const size = await contentSize(page);
  return { x: card.x + (x / size.w) * card.width, y: card.y + (y / size.h) * card.height };
}

async function drawWith(page: Page, tool: string, rect: Rect): Promise<void> {
  await toolbar(page).locator(`button[aria-label="${tool}"]`).click();
  await page.waitForTimeout(250);
  const a = await toScreenPoint(page, rect.left, rect.top);
  const b = await toScreenPoint(page, rect.left + rect.width, rect.top + rect.height);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(1600);
}

async function toasts(page: Page): Promise<string[]> {
  return page
    .locator("[data-sonner-toast], [role='alert']")
    .allTextContents()
    .then((t) => t.map((s) => s.trim()).filter(Boolean))
    .catch(() => []);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`.slice(0, 160)));
});

test.describe("inspector reports the truth", () => {
  test("X/Y match the element's real position, not 0,0", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1800);

    const authored = styleOf(await indexHtml(page, id), "intro");
    const wantX = styleNum(authored, "left");
    const wantY = styleNum(authored, "top");
    const x = num(await inspectorField(page, "X"));
    const y = num(await inspectorField(page, "Y"));
    expect(
      [x, y],
      `Intro is at left:${wantX}px top:${wantY}px in the document, but the inspector ` +
        `shows X=${x} Y=${y}.`,
    ).toEqual([wantX, wantY]);
  });

  test("W/H are non-zero for an element that renders with a size", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "intro");
    const w = num(await inspectorField(page, "W"));
    const h = num(await inspectorField(page, "H"));
    expect(
      rendered.width > 0 && rendered.height > 0,
      "fixture problem: Intro should render with a size",
    ).toBe(true);
    expect(
      [w > 0, h > 0],
      `Intro renders ${rendered.width}x${rendered.height} but the inspector shows W=${w} H=${h}.`,
    ).toEqual([true, true]);
  });

  test("W/H match the rendered size within a pixel", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "plain-box");
    expect(num(await inspectorField(page, "W"))).toBeCloseTo(rendered.width, -1);
    expect(num(await inspectorField(page, "H"))).toBeCloseTo(rendered.height, -1);
  });

  test("a hug-sized auto-layout container reports its measured width", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "intro");
    const w = num(await inspectorField(page, "W"));
    expect(
      w,
      `Hug sizing reported W=${w} for a container measuring ${rendered.width}px.`,
    ).toBeCloseTo(rendered.width, -1);
  });

  test("an in-flow element reports its real position, not 0,0", async ({ page }) => {
    const id = await newDesign(page, FLOW_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "flow-intro");
    const wrap = await renderedRect(page, "page-wrap");
    const x = num(await inspectorField(page, "X"));
    const y = num(await inspectorField(page, "Y"));
    expect(
      [x, y],
      `Intro is laid out by its auto-layout parent at (${rendered.left - wrap.left}, ` +
        `${rendered.top - wrap.top}) relative to the page wrapper, but the inspector ` +
        `reports X=${x} Y=${y}. NOT a Figma-parity claim (Figma has no in-flow concept); the claim is that an inspector must not report 0 for an element that is demonstrably positioned.`,
    ).not.toEqual([0, 0]);
  });

  test("an in-flow element reports a non-zero size", async ({ page }) => {
    const id = await newDesign(page, FLOW_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "flow-intro");
    const w = num(await inspectorField(page, "W"));
    const h = num(await inspectorField(page, "H"));
    expect(
      [w > 0, h > 0],
      `Intro renders ${rendered.width}x${rendered.height}; inspector shows W=${w} H=${h}.`,
    ).toEqual([true, true]);
  });

  test("selecting on canvas and in the tree give the same geometry", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);

    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1600);
    const viaTree = [await inspectorField(page, "X"), await inspectorField(page, "Y")];

    await openEditor(page, id);
    const box = await node(page, "plain-box").boundingBox();
    await page.keyboard.down(MOD === "Meta" ? "Meta" : "Control");
    await page.mouse.click(box!.x + 10, box!.y + box!.height / 2);
    await page.keyboard.up(MOD === "Meta" ? "Meta" : "Control");
    await page.waitForTimeout(1800);
    const viaCanvas = [await inspectorField(page, "X"), await inspectorField(page, "Y")];

    expect(viaCanvas, `tree said ${viaTree}, canvas said ${viaCanvas}`).toEqual(viaTree);
  });

  test("a child of an auto-layout parent still reports real geometry", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Title").click();
    await page.waitForTimeout(1800);

    const rendered = await renderedRect(page, "intro-title");
    const w = num(await inspectorField(page, "W"));
    const h = num(await inspectorField(page, "H"));
    expect(
      [w > 0, h > 0],
      `Title renders ${rendered.width}x${rendered.height} but the inspector shows W=${w} H=${h}.`,
    ).toEqual([true, true]);
  });

  test("setting X moves the element by exactly that amount", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1600);

    await setInspectorField(page, "X", "300");
    expect(styleNum(styleOf(await indexHtml(page, id), "plain-box"), "left")).toBe(300);
  });

  test("setting Y moves the element by exactly that amount", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1600);

    await setInspectorField(page, "Y", "400");
    expect(styleNum(styleOf(await indexHtml(page, id), "plain-box"), "top")).toBe(400);
  });

  test("re-entering the value already shown does not move the element", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1600);

    const shown = await inspectorField(page, "X");
    const before = styleNum(styleOf(await indexHtml(page, id), "plain-box"), "left");
    await setInspectorField(page, "X", String(num(shown)));
    const after = styleNum(styleOf(await indexHtml(page, id), "plain-box"), "left");
    expect(
      after,
      `inspector showed X=${shown}; typing it back moved left from ${before} to ${after}.`,
    ).toBe(before);
  });

  test("changing width does not change the element's position", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1600);

    const before = styleOf(await indexHtml(page, id), "plain-box");
    await setInspectorField(page, "W", "500");
    const after = styleOf(await indexHtml(page, id), "plain-box");
    expect([styleNum(after, "left"), styleNum(after, "top")]).toEqual([
      styleNum(before, "left"),
      styleNum(before, "top"),
    ]);
  });
});

// ── Auto layout must actually lay out ─────────────────────────────────────

test.describe("auto layout", () => {
  test("children of a column do not overlap each other", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);

    const boxes = await Promise.all(
      ["intro-title", "intro-sub", "intro-body"].map((n) => renderedRect(page, n)),
    );
    const overlaps: string[] = [];
    for (let i = 1; i < boxes.length; i += 1) {
      if (boxes[i].top < boxes[i - 1].top + boxes[i - 1].height) {
        overlaps.push(
          `child ${i} starts at y=${boxes[i].top} before child ${i - 1} ends at ` +
            `y=${boxes[i - 1].top + boxes[i - 1].height}`,
        );
      }
    }
    expect(
      overlaps,
      `Auto-layout column children are painted on top of each other: ${overlaps.join("; ")}`,
    ).toEqual([]);
  });

  test("every child stays inside its auto-layout parent", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);

    const parent = await renderedRect(page, "intro");
    const escaped: string[] = [];
    for (const child of ["intro-title", "intro-sub", "intro-body"]) {
      const r = await renderedRect(page, child);
      if (r.top < parent.top - 1 || r.left < parent.left - 1) {
        escaped.push(`${child} at (${r.left},${r.top}) vs parent (${parent.left},${parent.top})`);
      }
    }
    expect(escaped, `children escaped their container: ${escaped.join("; ")}`).toEqual([]);
  });

  test("the gap declared on the container is honoured between children", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);

    const a = await renderedRect(page, "intro-title");
    const b = await renderedRect(page, "intro-sub");
    expect(
      b.top - (a.top + a.height),
      `container declares gap:16px; measured ${b.top - (a.top + a.height)}px between the first two children.`,
    ).toBeCloseTo(16, -1);
  });

  test("absolutely-positioned children are reflowed, not left stacked", async ({ page }) => {
    const id = await newDesign(page, ABSOLUTE_CHILDREN_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1200);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(2500);

    const boxes = await Promise.all(
      ["abs-title", "abs-sub", "abs-body"].map((n) => renderedRect(page, n)),
    );
    // A row layout legitimately shares tops, so test for overlap, not for
    // differing tops.
    const overlapping = boxes.filter((b, i) =>
      boxes.some(
        (other, j) =>
          j < i &&
          b.left < other.left + other.width &&
          b.left + b.width > other.left &&
          b.top < other.top + other.height &&
          b.top + b.height > other.top,
      ),
    );
    expect(
      overlapping,
      `Enabling auto layout must reflow the children so they no longer overlap, ` +
        `as Figma does. Boxes: ${JSON.stringify(boxes)}. Opting a child out is ` +
        `the explicit "ignore auto layout" toggle, not the default.`,
    ).toEqual([]);
  });

  test("Shift+A on a container preserves its children's order", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const before = await indexHtml(page, id);
    const orderBefore = ["intro-title", "intro-sub", "intro-body"].map((n) => before.indexOf(n));

    await layerRow(page, "Intro").click();
    await page.waitForTimeout(1200);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(2500);

    const after = await indexHtml(page, id);
    const orderAfter = ["intro-title", "intro-sub", "intro-body"].map((n) => after.indexOf(n));
    expect(orderAfter.every((v) => v >= 0), "a child vanished from the document").toBe(true);
    expect(
      orderAfter[0] < orderAfter[1] && orderAfter[1] < orderAfter[2],
      `child order changed: ${JSON.stringify(orderBefore)} → ${JSON.stringify(orderAfter)}`,
    ).toBe(true);
  });
});

// ── What you draw is what you get ─────────────────────────────────────────

test.describe("drawing fidelity", () => {
  for (const tool of ["Rectangle", "Frame"]) {
    test(`${tool} commits the exact rect you dragged`, async ({ page }) => {
      const id = await newDesign(page, BLANK_PAGE);
      await openEditor(page, id);
      const want: Rect = { left: 40, top: 120, width: 160, height: 200 };
      await drawWith(page, tool, want);

      const html = await indexHtml(page, id);
      const kind = tool.toLowerCase();
      const style =
        new RegExp(`data-an-primitive="${kind}"[^>]*?style="([^"]*)"`, "i").exec(html)?.[1] ?? "";
      expect(style, `${tool} committed nothing`).not.toBe("");
      expect([
        styleNum(style, "left"),
        styleNum(style, "top"),
        styleNum(style, "width"),
        styleNum(style, "height"),
      ]).toEqual([
        expect.closeTo(want.left, -1),
        expect.closeTo(want.top, -1),
        expect.closeTo(want.width, -1),
        expect.closeTo(want.height, -1),
      ]);
    });
  }

  test("a shape drawn at the page origin lands at 0,0", async ({ page }) => {
    const id = await newDesign(page, BLANK_PAGE);
    await openEditor(page, id);
    await drawWith(page, "Rectangle", { left: 0, top: 0, width: 200, height: 120 });

    const style =
      /data-an-primitive="rectangle"[^>]*?style="([^"]*)"/i.exec(await indexHtml(page, id))?.[1] ?? "";
    expect(style, "nothing committed when drawing from the page origin").not.toBe("");
    expect([styleNum(style, "left"), styleNum(style, "top")]).toEqual([
      expect.closeTo(0, -1),
      expect.closeTo(0, -1),
    ]);
  });

  test("the same drag at a different zoom produces the same rect", async ({ page }) => {
    const id = await newDesign(page, BLANK_PAGE);
    await openEditor(page, id);
    const want: Rect = { left: 40, top: 200, width: 160, height: 150 };
    await drawWith(page, "Rectangle", want);
    const first =
      /data-an-primitive="rectangle"[^>]*?style="([^"]*)"/i.exec(await indexHtml(page, id))?.[1] ?? "";

    const id2 = await newDesign(page, BLANK_PAGE);
    await openEditor(page, id2);
    await page.keyboard.press(`${MOD}+-`);
    await page.waitForTimeout(1200);
    await drawWith(page, "Rectangle", want);
    const second =
      /data-an-primitive="rectangle"[^>]*?style="([^"]*)"/i.exec(await indexHtml(page, id2))?.[1] ?? "";

    expect(
      [styleNum(second, "width"), styleNum(second, "height")],
      `zoomed out then drew the same rect: ${styleNum(first, "width")}x${styleNum(first, "height")} ` +
        `vs ${styleNum(second, "width")}x${styleNum(second, "height")}`,
    ).toEqual([
      expect.closeTo(styleNum(first, "width"), -1),
      expect.closeTo(styleNum(first, "height"), -1),
    ]);
  });

  test("a drawn shape primitive is visible — it has a fill or stroke", async ({ page }) => {
    const id = await newDesign(page, BLANK_PAGE);
    await openEditor(page, id);
    await drawWith(page, "Rectangle", { left: 40, top: 100, width: 200, height: 200 });

    const paint = await inFrame(page, '[data-an-primitive="rectangle"]')
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopWidth };
      })
      .catch(() => null);
    expect(paint, "no rectangle rendered in the preview").not.toBeNull();
    expect(
      /rgba\(0, 0, 0, 0\)/.test(paint!.bg) && paint!.border === "0px",
      `a shape primitive must paint something; got background ${paint!.bg} and ` +
        `border ${paint!.border}`,
    ).toBe(false);
  });

  test("a drawn frame stays unstyled and is shown by selection chrome instead", async ({
    page,
  }) => {
    const id = await newDesign(page, BLANK_PAGE);
    await openEditor(page, id);
    await drawWith(page, "Frame", { left: 40, top: 100, width: 200, height: 200 });

    // A frame commits as unstyled structure on purpose (see the frame branch
    // in canvas-primitive-insert.ts); baking a tint into the design's real
    // HTML would be styling pollution. Its bounds come from selection chrome.
    const state = await inFrame(page, "body")
      .first()
      .evaluate(() => {
        const el = document.querySelector('[data-an-primitive="frame"]') as HTMLElement | null;
        if (!el) return null;
        const selection = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        const rect = el.getBoundingClientRect();
        const chrome = selection?.getBoundingClientRect();
        return {
          inlineBackground: el.style.background,
          selectionTracksFrame: chrome
            ? Math.abs(chrome.width - rect.width) < 4 &&
              Math.abs(chrome.left - rect.left) < 4
            : false,
        };
      });
    expect(state, "no frame rendered in the preview").not.toBeNull();
    expect(state!.inlineBackground, "a committed frame must not bake in a fill").toBe("");
    expect(
      state!.selectionTracksFrame,
      "an unstyled frame is only visible via selection chrome, so it must be " +
        "selected and outlined the moment it is drawn",
    ).toBe(true);
  });
});

// ── Moving things ─────────────────────────────────────────────────────────

test.describe("moving", () => {
  test("a canvas drag moves the element by the drag delta", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await selectOnCanvas(page, "plain-box");

    const before = styleOf(await indexHtml(page, id), "plain-box");
    const box = await node(page, "plain-box").boundingBox();
    const card = await page.locator("[data-screen-card]").first().boundingBox();
    const scale = card!.width / (await contentSize(page)).w;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 100 * scale, box!.y + box!.height / 2, {
      steps: 16,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = styleOf(await indexHtml(page, id), "plain-box");
    const moved = styleNum(after, "left") - styleNum(before, "left");
    // A drag-start threshold consumes the first few px, as in Figma.
    expect(
      moved > 90 && moved < 110,
      `dragged 100 page-px right; left went ${styleNum(before, "left")} → ` +
        `${styleNum(after, "left")} (moved ${moved}, expected within 10%)`,
    ).toBe(true);
  });

  test("arrow-key nudge moves exactly one pixel", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1400);
    const before = styleNum(styleOf(await indexHtml(page, id), "plain-box"), "left");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
    expect(styleNum(styleOf(await indexHtml(page, id), "plain-box"), "left")).toBe(before + 1);
  });

  test("moving one element does not move any other", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const introBefore = styleOf(await indexHtml(page, id), "intro");
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1400);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(1500);
    expect(styleOf(await indexHtml(page, id), "intro")).toBe(introBefore);
  });

  test("no move raises a user-facing failure toast", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1400);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
    const bad = (await toasts(page)).filter((t) =>
      /could not|failed|not found|error/i.test(t),
    );
    expect(bad, `move surfaced: ${bad.join(" | ")}`).toHaveLength(0);
  });
});

// ── Selection ─────────────────────────────────────────────────────────────

test.describe("selection", () => {
  test("clicking selects the deepest node, and Escape walks up to the parent", async ({
    page,
  }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);

    // Deliberate divergence from Figma (see selectionTargetForHit in
    // editor-chrome.bridge.ts): this canvas is real HTML, where climbing to
    // the outermost ancestor makes a label select its whole container.
    await selectOnCanvas(page, "intro-title");
    const clicked = (
      await page.locator('[role="treeitem"][aria-selected="true"]').first().textContent()
    )?.trim();
    expect(
      clicked,
      `a plain click selects the deepest node under the pointer; got "${clicked}"`,
    ).toContain("Title");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const parent = (
      await page.locator('[role="treeitem"][aria-selected="true"]').first().textContent()
    )?.trim();
    expect(
      parent,
      `Escape is how this editor reaches the ancestor Figma would have picked ` +
        `on click; got "${parent}"`,
    ).toContain("Intro");
  });

  test("selecting a second element deselects the first", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1200);
    await layerRow(page, "Title").click();
    await page.waitForTimeout(1200);
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
  });
});

// ── The document is the source of truth ───────────────────────────────────

test.describe("persistence and history", () => {
  test("a reload changes nothing", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const before = await indexHtml(page, id);
    await openEditor(page, id);
    expect(await indexHtml(page, id)).toBe(before);
  });

  test("idling in the editor changes nothing", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const before = await indexHtml(page, id);
    await page.waitForTimeout(6000);
    expect(await indexHtml(page, id)).toBe(before);
  });

  test("undo restores the exact previous document", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const before = await indexHtml(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1400);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(2000);
    expect(await indexHtml(page, id)).toBe(before);
  });

  test("redo restores the exact post-edit document", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1400);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
    const edited = await indexHtml(page, id);
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(1800);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await page.waitForTimeout(1800);
    expect(await indexHtml(page, id)).toBe(edited);
  });
});

// ── Layer tree mirrors the document ───────────────────────────────────────

test.describe("layers panel", () => {
  test("tree nesting matches DOM nesting", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const rows = await layersTree(page)
      .getByRole("treeitem")
      .evaluateAll((els) =>
        els.map((el) => ({
          level: Number(el.getAttribute("aria-level")),
          text: (el.textContent ?? "").trim().slice(0, 20),
        })),
      );
    const intro = rows.find((r) => r.text.includes("Intro"));
    const title = rows.find((r) => r.text.includes("Title"));
    expect(intro, "Intro missing from the layers tree").toBeTruthy();
    expect(title, "Title missing from the layers tree").toBeTruthy();
    expect(
      title!.level,
      `Title is a DOM child of Intro (level ${intro!.level}) but sits at level ${title!.level}`,
    ).toBe(intro!.level + 1);
  });

  test("deleting a layer removes it from the document", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    await layerRow(page, "Plain Box").click();
    await page.waitForTimeout(1200);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(2000);
    expect(await indexHtml(page, id)).not.toContain('data-agent-native-node-id="plain-box"');
  });

  test("hiding a layer hides it in the preview", async ({ page }) => {
    const id = await newDesign(page, INTRO_PAGE);
    await openEditor(page, id);
    const row = layerRow(page, "Plain Box");
    await row.hover();
    await row.getByRole("button", { name: "Hide layer" }).first().click();
    await page.waitForTimeout(2000);
    const visible = await node(page, "plain-box")
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      })
      .catch(() => false);
    expect(visible, "layer marked hidden still paints in the preview").toBe(false);
  });
});

// ── Nothing should throw ──────────────────────────────────────────────────

test("basic authoring raises no uncaught page errors", async ({ page }) => {
  const id = await newDesign(page, BLANK_PAGE);
  await openEditor(page, id);
  await drawWith(page, "Rectangle", { left: 100, top: 100, width: 200, height: 120 });
  await drawWith(page, "Frame", { left: 400, top: 100, width: 300, height: 200 });
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(1500);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.waitForTimeout(1500);
  expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
