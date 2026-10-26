import { type Locator, type Page } from "@playwright/test";

import { DEFAULT_BIG_NUDGE_PX } from "../shared/canvas-math";
import {
  indexHtml,
  layerRow,
  layersTree,
  openEditor,
  styleNum,
  styleOf,
  toolbar,
} from "./drag-and-drop.shared";
import { expandAllLayers } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf as savedStyleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const GROUP_FILL_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Group Fill</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
  <div data-agent-native-node-id="fill-a" data-agent-native-layer-name="Fill A" style="box-sizing:border-box;position:absolute;left:20px;top:100px;width:120px;height:80px;background:#f97316;border:8px solid #f97316"></div>
  <div data-agent-native-node-id="fill-b" data-agent-native-layer-name="Fill B" style="box-sizing:border-box;position:absolute;left:160px;top:100px;width:120px;height:80px;background:#f97316;border:8px solid #111827"></div>
  <div data-agent-native-node-id="fill-text" data-agent-native-layer-name="Fill Text" style="position:absolute;left:20px;top:196px;width:220px;height:48px;color:#f97316;font-size:24px;line-height:48px">Paint</div>
</body></html>`;
const SELECTION_COLOR_ALPHA_COLLISION_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Selection Color Alpha Collision</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="blue-opaque" data-agent-native-layer-name="Blue 100" style="box-sizing:border-box;position:absolute;left:20px;top:100px;width:120px;height:80px;background:#3b82f6"></div>
  <div data-agent-native-node-id="blue-alpha" data-agent-native-layer-name="Blue 50" style="box-sizing:border-box;position:absolute;left:160px;top:100px;width:120px;height:80px;background:rgba(59,130,246,0.5)"></div>
</body></html>`;
const GROUP_RICH_TEXT_FIXTURE = GROUP_FILL_FIXTURE.replace(
  ">Paint</div>",
  '>Paint <strong style="color:#c026d3">this</strong></div>',
);
const GROUP_VECTOR_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Group SVG fill</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="fill-a" data-agent-native-layer-name="Fill A" data-an-primitive="rectangle" style="position:absolute;left:20px;top:100px;width:120px;height:80px;background:#f97316"></div>
  <svg data-agent-native-node-id="icon" data-agent-native-layer-name="Icon" style="position:absolute;left:160px;top:100px;width:120px;height:80px" viewBox="0 0 120 80"><circle cx="60" cy="40" r="30" fill="#f97316" stroke="#111827" stroke-width="4"/></svg>
</body></html>`;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Structure</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap"
         style="position:absolute;left:16px;top:60px;width:288px;height:220px;background:#111827">
      <div data-agent-native-node-id="kid-1" data-agent-native-layer-name="Kid One"
           style="position:absolute;left:16px;top:20px;width:80px;height:50px;background:#3b82f6"></div>
      <div data-agent-native-node-id="kid-2" data-agent-native-layer-name="Kid Two"
           style="position:absolute;left:106px;top:20px;width:80px;height:50px;background:#22c55e"></div>
      <div data-agent-native-node-id="kid-3" data-agent-native-layer-name="Kid Three"
           style="position:absolute;left:196px;top:20px;width:80px;height:50px;background:#f59e0b"></div>
    </div>
    <div data-agent-native-node-id="loose-a" data-agent-native-layer-name="Loose A"
         style="position:absolute;left:20px;top:520px;width:120px;height:80px;background:#a855f7"></div>
    <div data-agent-native-node-id="loose-b" data-agent-native-layer-name="Loose B"
         style="position:absolute;left:170px;top:520px;width:120px;height:80px;background:#ec4899"></div>
</body>
</html>`;

const IDLESS_MOVE_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Source identity</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <main class="identity-frame" style="position:absolute;left:20px;top:80px;width:360px;height:220px">
    <button class="move-target" data-agent-native-layer-name="Move target" style="position:absolute;left:12px;top:16px;width:140px;height:44px;background:#3b82f6">Move me</button>
    <span class="move-sibling" style="position:absolute;left:172px;top:16px">Sibling</span>
  </main>
</body></html>`;

const SOLO_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Solo</title></head>
<body style="margin:0;width:${PAGE_W}px;min-height:${PAGE_H}px;background:#0f1115">
  <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A" style="position:absolute;left:600px;top:500px;width:120px;height:80px;background:#a855f7"></div>
  <div data-agent-native-node-id="solo-b" data-agent-native-layer-name="Solo B" style="position:absolute;left:750px;top:500px;width:120px;height:80px;background:#ec4899"></div>
</body></html>`;

async function newDesign(app: App, content = FIXTURE): Promise<string> {
  return app.seed(content, { title: "structure and selection" });
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function selectedLayerName(page: Page): Promise<string | null> {
  const text = await page
    .locator('[role="treeitem"][aria-selected="true"]')
    .first()
    .textContent()
    .catch(() => null);
  return text?.trim() ?? null;
}

async function selectViaTree(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click();
  await page.waitForTimeout(1500);
}

async function multiSelect(page: Page, names: string[]): Promise<void> {
  await layerRow(page, names[0]).click();
  await page.waitForTimeout(700);
  for (const name of names.slice(1)) {
    await layerRow(page, name).click({ modifiers: ["Shift"] });
    await page.waitForTimeout(700);
  }
}

async function openGroupedSelectionColors(
  page: Page,
  designId: string,
): Promise<Locator> {
  return groupAndShowSelectionColors(page, designId, ["Blue 100", "Blue 50"]);
}

async function groupAndShowSelectionColors(
  page: Page,
  designId: string,
  layers: string[],
): Promise<Locator> {
  await multiSelect(page, layers);
  await page.keyboard.press(`${MOD}+g`);
  await expect(layerRow(page, "Group")).toBeVisible();
  await expect
    .poll(() => indexHtml(page, designId))
    .toContain('data-agent-native-group="true"');
  await layerRow(page, "Group").click();
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Selection colors",
        exact: true,
      }),
    })
    .first();
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Show selection colors" }).click();
  return section;
}

async function recolorSelectionSwatch(
  page: Page,
  section: Locator,
  from: string,
  toHex: string,
): Promise<void> {
  await section
    .getByRole("button", { name: new RegExp(`^${from}$`, "i") })
    .click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill(toHex);
  await hex.press("Enter");
  await page.keyboard.press("Escape");
}

async function expandSelectionColors(section: Locator) {
  const showSelectionColors = section.getByRole("button", {
    name: "Show selection colors",
  });
  if (await showSelectionColors.isVisible().catch(() => false)) {
    await showSelectionColors.click();
  }
}

async function waitForSourceChange(
  page: Page,
  designId: string,
  previous: string,
): Promise<string> {
  let current = previous;
  for (let attempt = 0; attempt < 20 && current === previous; attempt += 1) {
    await page.waitForTimeout(250);
    current = await indexHtml(page, designId);
  }
  return current;
}

function bodyId(nodes: Map<string, SavedNode>) {
  return [...nodes.values()].find((saved) => saved.tag === "body")!.id;
}

async function openSeeded(app: App, html = FIXTURE) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function clickDesign(app: App, x: number, y: number, shift = false) {
  const point = await app.pagePoint(x, y);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(point.x, point.y);
  if (shift) await app.page.keyboard.up("Shift");
}

/** Selects Loose A then Shift-clicks Loose B on the canvas. */
async function selectBothLoose(app: App) {
  await clickDesign(app, 80, 560);
  await clickDesign(app, 230, 560, true);
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["Loose A", "Loose B"]);
}

async function groupBothLoose(app: App, id: string) {
  await selectBothLoose(app);
  await app.page.keyboard.press(`${MOD}+g`);
  await expect
    .poll(async () => (await app.savedNodes(id)).get("loose-a")?.parent)
    .not.toBe(bodyId(await app.savedNodes(id)));
  await app.settled();
  return (await app.savedNodes(id)).get("loose-a")!.parent!;
}

async function combinedSelectionWidth(app: App) {
  return app.page
    .frameLocator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .locator("[data-agent-native-multi-selection-bounds]")
    .evaluate((element) => Math.round(element.getBoundingClientRect().width));
}

test.use({ viewport: { width: 1640, height: 1000 } });

test.describe("keyboard selection traversal", () => {
  test("Layers-first selection persists source identity for a later move and reload", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, IDLESS_MOVE_FIXTURE);
    await openEditor(page, id);
    const initial = await indexHtml(page, id);
    const initialNodeId =
      /class="move-target"[^>]*data-agent-native-node-id="([^"]+)"/.exec(
        initial,
      )?.[1];
    expect(initialNodeId).toMatch(/^an-/);

    await selectViaTree(page, "Move target");
    await expect
      .poll(() => indexHtml(page, id))
      .toMatch(
        /<button[^>]*class="move-target"[^>]*data-agent-native-node-id="an-[^"]+"/,
      );
    const stampedHtml = await indexHtml(page, id);
    const nodeId =
      /class="move-target"[^>]*data-agent-native-node-id="([^"]+)"/.exec(
        stampedHtml,
      )?.[1];
    expect(nodeId).toBe(initialNodeId);

    const styleForTarget = (html: string) => {
      const tag = new RegExp(
        `<button[^>]*class="move-target"[^>]*data-agent-native-node-id="${nodeId}"[^>]*>`,
        "i",
      ).exec(html)?.[0];
      return tag
        ? styleNum(/\bstyle="([^"]*)"/i.exec(tag)?.[1] ?? "", "left")
        : NaN;
    };
    const before = styleForTarget(stampedHtml);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => indexHtml(page, id).then(styleForTarget))
      .toBe(before + 1);

    await openEditor(page, id);
    await expect
      .poll(() => indexHtml(page, id))
      .toContain(`data-agent-native-node-id="${nodeId}"`);
    await expect
      .poll(() => indexHtml(page, id).then(styleForTarget))
      .toBe(before + 1);
  });

  test("Enter selects the children of the current selection", async ({
    app,
  }) => {
    await openSeeded(app);
    await expandAllLayers(app.page);
    await layerRow(app.page, "Wrap").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Wrap"]);
    await app.page.keyboard.press("Enter");
    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toEqual(["Kid One", "Kid Three", "Kid Two"]);
  });

  test("Backslash selects the parent of the current selection", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("\\");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `The backslash shortcut selects the parent. Selection is "${name}".`,
    ).toBe("Wrap");
  });

  test("Escape deselects rather than walking up to the parent", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      `Escape should clear selection. Selection is "${await selectedLayerName(page)}".`,
    ).toHaveCount(0);
  });

  test("Escape on a top-level layer does not select the containing screen", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await selectViaTree(page, "Loose A");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      `Selection is "${await selectedLayerName(page)}".`,
    ).toHaveCount(0);
    await expect(
      page.locator("[data-frame-selection-box]"),
      "Escape promoted the selection to the screen frame instead of clearing it",
    ).toHaveCount(0);
  });

  test("Tab selects the next sibling", async ({ app, page }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Tab should select the next sibling. Selection is "${name}".`,
    ).toBe("Kid Two");
  });

  test("Shift+Tab selects the previous sibling", async ({ app, page }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await selectViaTree(page, "Kid Two");
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Shift+Tab should select the previous sibling. Selection is "${name}".`,
    ).toBe("Kid One");
  });

  test("Shift+Arrow nudges a collapsed container by the big nudge on the first press", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    const row = layerRow(page, "Wrap");
    const collapse = row.getByRole("button", { name: "Collapse layer" });
    if (await collapse.isVisible()) await collapse.click();
    await expect(
      row.getByRole("button", { name: "Expand layer" }),
    ).toBeVisible();
    await row.click();
    const before = styleNum(styleOf(await indexHtml(page, id), "wrap"), "left");

    await page.keyboard.press("Shift+ArrowRight");

    await expect
      .poll(() =>
        indexHtml(page, id).then((html) =>
          styleNum(styleOf(html, "wrap"), "left"),
        ),
      )
      .toBe(before + DEFAULT_BIG_NUDGE_PX);
    await expect(
      row.getByRole("button", { name: "Expand layer" }),
    ).toBeVisible();
  });

  test("double-clicking a child of the selected container drills one level down to it", async ({
    app,
  }) => {
    await openSeeded(app);
    await expandAllLayers(app.page);
    await layerRow(app.page, "Wrap").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Wrap"]);
    const kid = await app.pagePoint(72, 105);
    await app.page.mouse.dblclick(kid.x, kid.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Kid One"]);
  });
});

test.describe("groups", () => {
  test("Selection colors recolors a Group's text without flattening a nested rich-text run", async ({
    app,
    page,
  }, testInfo) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(app, GROUP_RICH_TEXT_FIXTURE);
    await openEditor(page, id);
    const section = await groupAndShowSelectionColors(page, id, [
      "Fill A",
      "Fill B",
      "Fill Text",
    ]);
    await recolorSelectionSwatch(page, section, "#f97316", "3B82F6");

    const readText = () =>
      node(page, "fill-text").evaluate((paragraph) => {
        const strong = paragraph.querySelector("strong");
        return {
          color: getComputedStyle(paragraph).color,
          strongTag: strong?.tagName ?? null,
          strongText: strong?.textContent ?? null,
          strongColor: strong ? getComputedStyle(strong).color : null,
        };
      });
    const recolored = {
      color: "rgb(59, 130, 246)",
      strongTag: "STRONG",
      strongText: "this",
      strongColor: "rgb(192, 38, 211)",
    };
    await expect.poll(readText).toEqual(recolored);
    const readSavedRichText = async () => {
      const saved = await indexHtml(page, id);
      return page.evaluate((html) => {
        const document = new DOMParser().parseFromString(html, "text/html");
        const paragraph = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="fill-text"]',
        );
        const strong = paragraph?.querySelector<HTMLElement>("strong");
        return {
          color: paragraph?.style.color ?? null,
          strongTag: strong?.tagName ?? null,
          strongText: strong?.textContent ?? null,
          strongColor: strong?.style.color ?? null,
        };
      }, saved);
    };
    await expect.poll(readSavedRichText).toEqual(recolored);
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .screenshot({ path: testInfo.outputPath("group-rich-text.png") });
    await page.reload({ waitUntil: "domcontentloaded" });
    await toolbar(page).locator('button[aria-label="Move"]').waitFor();
    await expect.poll(readText).toEqual(recolored);
    expect(viteUpdates).toEqual([]);
  });

  test("Selection colors recolors a simple inline SVG shape without painting its box", async ({
    app,
    page,
  }, testInfo) => {
    const id = await newDesign(app, GROUP_VECTOR_FIXTURE);
    await openEditor(page, id);
    const section = await groupAndShowSelectionColors(page, id, [
      "Fill A",
      "Icon",
    ]);
    await recolorSelectionSwatch(page, section, "#f97316", "3B82F6");

    const readVector = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const icon = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="icon"]',
          );
          const circle = icon?.querySelector("circle");
          const rect = document.querySelector<HTMLElement>(
            '[data-agent-native-node-id="fill-a"]',
          );
          if (!icon || !circle || !rect) throw new Error("SVG fixture missing");
          return {
            fill: getComputedStyle(circle).fill,
            stroke: getComputedStyle(circle).stroke,
            boxFill: getComputedStyle(icon).fill,
            background: getComputedStyle(icon).backgroundColor,
            rect: getComputedStyle(rect).backgroundColor,
          };
        });
    await expect.poll(readVector).toEqual({
      fill: "rgb(59, 130, 246)",
      stroke: "rgb(17, 24, 39)",
      boxFill: "rgb(0, 0, 0)",
      background: "rgba(0, 0, 0, 0)",
      rect: "rgb(59, 130, 246)",
    });
    await expect
      .poll(() => indexHtml(page, id))
      .toMatch(/<circle[^>]*fill="#3b82f6"/i);
    const saved = await indexHtml(page, id);
    expect(saved).toMatch(/<circle[^>]*stroke="#111827"/i);
    expect(saved).not.toMatch(/<svg[^>]*#3b82f6/i);
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .screenshot({ path: testInfo.outputPath("group-inline-svg.png") });
  });

  test("Selection colors records a repeated preview as one undo step", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
    await page.keyboard.press(`${MOD}+g`);
    await layerRow(page, "Group").click();
    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    await selectionColors
      .getByRole("button", { name: "Show selection colors" })
      .click();
    await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();
    const opacity = page.getByRole("slider", {
      name: "Opacity",
      exact: true,
    });
    await opacity.click();
    await page.keyboard.press("Escape");

    const readPaints = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const style = (id: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            if (!element) throw new Error(`Missing ${id}`);
            return getComputedStyle(element);
          };
          return {
            fillA: style("fill-a").backgroundColor,
            strokeA: style("fill-a").borderTopColor,
            fillB: style("fill-b").backgroundColor,
            text: style("fill-text").color,
          };
        });
    await expect.poll(readPaints).toEqual({
      fillA: "rgba(249, 115, 22, 0.5)",
      strokeA: "rgba(249, 115, 22, 0.5)",
      fillB: "rgba(249, 115, 22, 0.5)",
      text: "rgba(249, 115, 22, 0.5)",
    });
    const repeatedPreviewCommit = await indexHtml(page, id);
    expect(repeatedPreviewCommit).toContain('data-agent-native-group="true"');
    expect(styleOf(repeatedPreviewCommit, "fill-a")).toMatch(/0\.5|50%/);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(readPaints).toEqual({
      fillA: "rgb(249, 115, 22)",
      strokeA: "rgb(249, 115, 22)",
      fillB: "rgb(249, 115, 22)",
      text: "rgb(249, 115, 22)",
    });
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .not.toMatch(/0\.5|50%/);
    const undone = await indexHtml(page, id);
    expect(undone).toContain('data-agent-native-group="true"');
    expect(styleOf(undone, "fill-a")).not.toMatch(/0\.5|50%/);
    expect(styleOf(undone, "fill-b")).not.toMatch(/0\.5|50%/);
    expect(styleOf(undone, "fill-text")).not.toMatch(/0\.5|50%/);
  });

  test("Group Selection colors cancel restores authored paint and keeps gaps transparent", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
    await page.keyboard.press(`${MOD}+g`);
    await expect(layerRow(page, "Group")).toBeVisible();
    await layerRow(page, "Group").click();

    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    await selectionColors
      .getByRole("button", { name: "Show selection colors" })
      .click();
    await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();

    const readPaint = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const style = (id: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            if (!element) throw new Error(`Missing ${id}`);
            return getComputedStyle(element);
          };
          const group = document.querySelector<HTMLElement>(
            '[data-agent-native-group="true"]',
          );
          if (!group) throw new Error("Missing Group wrapper");
          const groupRect = group.getBoundingClientRect();
          return {
            fillA: style("fill-a").backgroundColor,
            strokeA: style("fill-a").borderTopColor,
            fillB: style("fill-b").backgroundColor,
            strokeB: style("fill-b").borderTopColor,
            text: style("fill-text").color,
            groupBackground: getComputedStyle(group).backgroundColor,
            groupRect: { width: groupRect.width, height: groupRect.height },
            bodyBackground: getComputedStyle(document.body).backgroundColor,
          };
        });

    await expect
      .poll(async () => await indexHtml(page, id))
      .toContain('data-agent-native-group="true"');
    const authoredSource = await indexHtml(page, id);
    const authoredStyles = ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
      styleOf(authoredSource, nodeId),
    );
    const authoredPaint = {
      fillA: "rgb(249, 115, 22)",
      strokeA: "rgb(249, 115, 22)",
      fillB: "rgb(249, 115, 22)",
      strokeB: "rgb(17, 24, 39)",
      text: "rgb(249, 115, 22)",
      groupBackground: "rgba(0, 0, 0, 0)",
      groupRect: { width: 260, height: 144 },
      bodyBackground: "rgb(15, 17, 21)",
    };
    await expect.poll(readPaint).toMatchObject(authoredPaint);

    const opacity = page.getByRole("slider", {
      name: "Opacity",
      exact: true,
    });
    const box = await opacity.boundingBox();
    if (!box) throw new Error("Selection color opacity slider is missing");
    const startX = box.x + box.width - 1;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, startY, { steps: 6 });
    await expect
      .poll(async () => Number(await opacity.getAttribute("aria-valuenow")))
      .toBeLessThan(100);
    await expect.poll(readPaint).toMatchObject({
      fillA: expect.stringMatching(/^rgba\(249, 115, 22, 0\./),
      fillB: expect.stringMatching(/^rgba\(249, 115, 22, 0\./),
      groupBackground: "rgba(0, 0, 0, 0)",
      bodyBackground: "rgb(15, 17, 21)",
    });

    await page.keyboard.press(`${MOD}+z`);
    await expect(opacity).toHaveAttribute("aria-valuenow", "100");
    await expect.poll(readPaint).toMatchObject(authoredPaint);
    await expect
      .poll(async () => {
        const source = await indexHtml(page, id);
        return ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
          styleOf(source, nodeId),
        );
      })
      .toEqual(authoredStyles);
    await page.mouse.up();
    await expect.poll(readPaint).toMatchObject(authoredPaint);
    await expect.poll(async () => indexHtml(page, id)).toBe(authoredSource);
  });

  test("Selection Colors keeps an opacity gesture attached when it collides with another swatch", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    await openEditor(page, id);
    await openGroupedSelectionColors(page, id);
    const section = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    const laterHalfAlpha = section
      .getByRole("button")
      .filter({ hasText: "50%" });
    await expect(laterHalfAlpha).toHaveCount(1);
    await laterHalfAlpha.click();
    const opacity = page.getByRole("slider", {
      name: "Opacity",
      exact: true,
    });
    await expect(opacity).toHaveAttribute("aria-valuenow", "50");
    const before = await indexHtml(page, id);
    const beforeOpaqueStyle = styleOf(before, "blue-opaque");
    const beforeAlphaStyle = styleOf(before, "blue-alpha");
    const box = await opacity.boundingBox();
    if (!box) throw new Error("Selection color opacity slider is missing");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, y, { steps: 6 });
    const readPaints = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const read = (nodeId: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${nodeId}"]`,
            );
            if (!element) throw new Error(`Missing ${nodeId}`);
            return getComputedStyle(element).backgroundColor;
          };
          return {
            opaque: read("blue-opaque"),
            edited: read("blue-alpha"),
          };
        });
    await expect.poll(readPaints).toEqual({
      opaque: "rgb(59, 130, 246)",
      edited: "rgb(59, 130, 246)",
    });
    const pickerStillVisibleBeforeRelease = await opacity
      .isVisible()
      .catch(() => false);
    const rowsBeforeRelease = await section
      .getByRole("button")
      .allInnerTexts()
      .catch(() => [] as string[]);
    await page.mouse.up();
    await expect(opacity).toBeVisible();
    await expect(opacity).toHaveAttribute("aria-valuenow", "100");
    const afterRelease = await waitForSourceChange(page, id, before);
    const afterAlphaStyle = styleOf(afterRelease, "blue-alpha");
    const targetWasSaved =
      afterAlphaStyle !== beforeAlphaStyle &&
      !/(?:0\.5|50%)/i.test(afterAlphaStyle);
    const opaqueLayerStayedUnchanged =
      styleOf(afterRelease, "blue-opaque") === beforeOpaqueStyle;
    const paintsAfterRelease = await readPaints();
    const groupSurvivedRelease = afterRelease.includes(
      'data-agent-native-group="true"',
    );

    expect({
      pickerStillVisibleBeforeRelease,
      rowsBeforeRelease,
      paintsAfterRelease,
      groupSurvivedRelease,
      targetWasSaved,
      opaqueLayerStayedUnchanged,
    }).toMatchObject({
      pickerStillVisibleBeforeRelease: true,
      targetWasSaved: true,
      opaqueLayerStayedUnchanged: true,
    });

    const dragFromFullOpacity = async (target: number) => {
      const rect = await opacity.evaluate(async (element) => {
        let ancestor = element.parentElement;
        while (ancestor) {
          const running = ancestor
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running");
          if (running.length) {
            await Promise.all(
              running.map((animation) => animation.finished.catch(() => {})),
            );
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const { left, top, width, height } = element.getBoundingClientRect();
        // The knob's centre, and the pointer's value, stop half a knob short of each end.
        const knob = element.querySelector("span")!.getBoundingClientRect();
        return { x: left, y: top, width, height, inset: knob.width / 2 };
      });
      const y = rect.y + rect.height / 2;
      const startX = rect.x + rect.width * 0.9;
      const hit = await page.evaluate(
        ({ x, y }) => {
          const slider = document.querySelector<HTMLElement>(
            '[role="slider"][aria-label="Opacity"]',
          );
          const target = document.elementFromPoint(x, y);
          return {
            sliderHit: Boolean(slider && target && slider.contains(target)),
            targetTag: target?.tagName ?? null,
            targetRole: target?.getAttribute("role") ?? null,
            value: slider?.getAttribute("aria-valuenow") ?? null,
            rect: slider?.getBoundingClientRect().toJSON() ?? null,
          };
        },
        { x: startX, y },
      );
      expect(hit.sliderHit).toBe(true);
      await page.mouse.move(startX, y);
      await page.mouse.down();
      const travel = rect.width - rect.inset * 2;
      await page.mouse.move(rect.x + rect.inset + (travel * target) / 100, y, {
        steps: 6,
      });
      await expect
        .poll(async () => Number(await opacity.getAttribute("aria-valuenow")))
        .toBe(target);
      await page.mouse.up();
    };

    const afterFirstRelease = afterRelease;
    await dragFromFullOpacity(80);
    const afterSecondGesture = await waitForSourceChange(
      page,
      id,
      afterFirstRelease,
    );
    await expect(opacity).toBeVisible();
    await expect(opacity).toHaveAttribute("aria-valuenow", "80");
    await expect.poll(readPaints).toEqual({
      opaque: "rgb(59, 130, 246)",
      edited: "rgba(59, 130, 246, 0.8)",
    });
    expect(styleOf(afterSecondGesture, "blue-opaque")).toBe(beforeOpaqueStyle);

    await page.keyboard.press(`${MOD}+z`);
    const afterUndoBetweenGestures = await waitForSourceChange(
      page,
      id,
      afterSecondGesture,
    );
    expect(afterUndoBetweenGestures).not.toBe(afterSecondGesture);
    expect(styleOf(afterUndoBetweenGestures, "blue-alpha")).toBe(
      afterAlphaStyle,
    );
    await expect(opacity).toBeHidden();
    await expect.poll(readPaints).toEqual({
      opaque: "rgb(59, 130, 246)",
      edited: "rgb(59, 130, 246)",
    });

    await page.keyboard.press(`${MOD}+Shift+z`);
    const afterRedoBetweenGestures = await waitForSourceChange(
      page,
      id,
      afterUndoBetweenGestures,
    );
    expect(styleOf(afterRedoBetweenGestures, "blue-alpha")).toBe(
      styleOf(afterSecondGesture, "blue-alpha"),
    );
    await expect(opacity).toBeHidden();

    await page.keyboard.press(`${MOD}+z`);
    const afterUndoForReopen = await waitForSourceChange(
      page,
      id,
      afterRedoBetweenGestures,
    );
    expect(styleOf(afterUndoForReopen, "blue-alpha")).toBe(afterAlphaStyle);
    await expect(opacity).toBeHidden();
    await expect.poll(readPaints).toEqual({
      opaque: "rgb(59, 130, 246)",
      edited: "rgb(59, 130, 246)",
    });

    await expandSelectionColors(section);
    await section.getByRole("button", { name: /^#3b82f6$/i }).click();
    await expect(opacity).toBeVisible();
    await expect(opacity).toHaveAttribute("aria-valuenow", "100");
    await dragFromFullOpacity(70);
    const afterGestureAfterUndo = await waitForSourceChange(
      page,
      id,
      afterUndoForReopen,
    );
    await expect.poll(readPaints).toEqual({
      opaque: "rgba(59, 130, 246, 0.7)",
      edited: "rgba(59, 130, 246, 0.7)",
    });
    expect(styleOf(afterGestureAfterUndo, "blue-opaque")).not.toBe(
      beforeOpaqueStyle,
    );
  });

  test("Undo and Redo work from the Selection Colors Hex field and close the picker", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    await openEditor(page, id);
    const section = await openGroupedSelectionColors(page, id);
    const before = await indexHtml(page, id);
    const beforeOpaqueStyle = styleOf(before, "blue-opaque");
    const beforeAlphaStyle = styleOf(before, "blue-alpha");

    await section.getByRole("button", { name: /^#3b82f6$/i }).click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("10B981");
    await hex.press("Enter");
    const afterCommit = await waitForSourceChange(page, id, before);
    const committedOpaqueStyle = styleOf(afterCommit, "blue-opaque");
    const committedAlphaStyle = styleOf(afterCommit, "blue-alpha");
    expect(committedOpaqueStyle).not.toBe(beforeOpaqueStyle);
    expect(committedAlphaStyle).toBe(beforeAlphaStyle);

    await hex.focus();
    await page.keyboard.press(`${MOD}+z`);
    const afterUndo = await waitForSourceChange(page, id, afterCommit);
    expect(styleOf(afterUndo, "blue-opaque")).toBe(beforeOpaqueStyle);
    await expect(hex).toBeHidden();

    await page.keyboard.press(`${MOD}+Shift+z`);
    const afterRedo = await waitForSourceChange(page, id, afterUndo);
    expect(styleOf(afterRedo, "blue-opaque")).toBe(committedOpaqueStyle);
    expect(styleOf(afterRedo, "blue-alpha")).toBe(committedAlphaStyle);
    await expect(hex).toBeHidden();
    await expandSelectionColors(section);
    await expect(
      section.getByRole("button", { name: /^#10b981$/i }),
    ).toBeVisible();
  });

  test("Selection Colors keeps an opacity-zero preview attached until gesture release", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    await openEditor(page, id);
    await openGroupedSelectionColors(page, id);
    const section = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    const laterHalfAlpha = section
      .getByRole("button")
      .filter({ hasText: "50%" });
    await expect(laterHalfAlpha).toHaveCount(1);
    await laterHalfAlpha.click();
    const opacity = page.getByRole("slider", {
      name: "Opacity",
      exact: true,
    });
    await expect(opacity).toHaveAttribute("aria-valuenow", "50");
    const before = await indexHtml(page, id);
    const beforeOpaqueStyle = styleOf(before, "blue-opaque");
    const beforeAlphaStyle = styleOf(before, "blue-alpha");
    const box = await opacity.boundingBox();
    if (!box) throw new Error("Selection color opacity slider is missing");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x - box.width, y, { steps: 6 });
    const readPaints = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const read = (nodeId: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${nodeId}"]`,
            );
            if (!element) throw new Error(`Missing ${nodeId}`);
            return getComputedStyle(element).backgroundColor;
          };
          return {
            opaque: read("blue-opaque"),
            edited: read("blue-alpha"),
          };
        });
    await expect.poll(readPaints).toEqual({
      opaque: "rgb(59, 130, 246)",
      edited: "rgba(59, 130, 246, 0)",
    });
    const pickerStillVisibleBeforeRelease = await opacity
      .isVisible()
      .catch(() => false);
    const rowsBeforeRelease = await section
      .getByRole("button")
      .allInnerTexts()
      .catch(() => [] as string[]);
    await page.mouse.up();
    const afterRelease = await waitForSourceChange(page, id, before);
    const afterAlphaStyle = styleOf(afterRelease, "blue-alpha");
    const targetWasSaved =
      afterAlphaStyle !== beforeAlphaStyle &&
      /(?:,\s*0(?:\.0+)?\s*\)|0%|transparent)/i.test(afterAlphaStyle);
    const opaqueLayerStayedUnchanged =
      styleOf(afterRelease, "blue-opaque") === beforeOpaqueStyle;

    await page.keyboard.press(`${MOD}+z`);
    const afterUndo = await waitForSourceChange(page, id, afterRelease);
    const undoRestoredTarget =
      styleOf(afterUndo, "blue-alpha") === beforeAlphaStyle;
    const undoPreservedGroup = afterUndo.includes(
      'data-agent-native-group="true"',
    );
    await page.keyboard.press(`${MOD}+Shift+z`);
    const afterRedo = await waitForSourceChange(page, id, afterUndo);
    const redoRestoredTarget =
      styleOf(afterRedo, "blue-alpha") === afterAlphaStyle;

    expect({
      pickerStillVisibleBeforeRelease,
      rowsBeforeRelease,
      targetWasSaved,
      opaqueLayerStayedUnchanged,
      undoRestoredTarget,
      undoPreservedGroup,
      redoRestoredTarget,
    }).toMatchObject({
      pickerStillVisibleBeforeRelease: true,
      targetWasSaved: true,
      opaqueLayerStayedUnchanged: true,
      undoRestoredTarget: true,
      undoPreservedGroup: true,
      redoRestoredTarget: true,
    });
  });

  test("Undo cancels a held Selection colors opacity scrub before undoing the committed color", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
    await page.keyboard.press(`${MOD}+g`);
    await layerRow(page, "Group").click();
    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    await selectionColors
      .getByRole("button", { name: "Show selection colors" })
      .click();
    await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("3B82F6");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    const readPaints = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const style = (id: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            if (!element) throw new Error(`Missing ${id}`);
            return getComputedStyle(element);
          };
          return {
            fillA: style("fill-a").backgroundColor,
            fillB: style("fill-b").backgroundColor,
            text: style("fill-text").color,
          };
        });
    await expect.poll(readPaints).toEqual({
      fillA: "rgb(59, 130, 246)",
      fillB: "rgb(59, 130, 246)",
      text: "rgb(59, 130, 246)",
    });

    await selectionColors.getByRole("button", { name: /^#3b82f6$/i }).click();
    const opacity = page.getByRole("slider", {
      name: "Opacity",
      exact: true,
    });
    const box = await opacity.boundingBox();
    if (!box) throw new Error("Selection color opacity slider is missing");
    const startX = box.x + box.width * 0.9;
    const startY = box.y + box.height / 2;
    const startHit = await opacity.evaluate(
      (slider, { x, y }) => {
        const target = document.elementFromPoint(x, y);
        return {
          sliderHit: Boolean(slider && target && slider.contains(target)),
          targetTag: target?.tagName ?? null,
          targetRole: target?.getAttribute("role") ?? null,
          sliderValue: slider?.getAttribute("aria-valuenow") ?? null,
        };
      },
      { x: startX, y: startY },
    );
    expect(startHit.sliderHit).toBe(true);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - box.width / 2, startY, { steps: 6 });
    await expect
      .poll(async () => {
        const current = Number(await opacity.getAttribute("aria-valuenow"));
        return current > 0 && current < 100;
      })
      .toBe(true);
    const previewOpacity = Number(await opacity.getAttribute("aria-valuenow"));
    await expect.poll(readPaints).toMatchObject({
      fillA: `rgba(59, 130, 246, ${previewOpacity / 100})`,
    });

    await page.keyboard.press(`${MOD}+z`);
    await expect(opacity).toBeVisible();
    await expect(opacity).toHaveAttribute("aria-valuenow", "100");
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toContain("#3b82f6");
    await expect.poll(readPaints).toEqual({
      fillA: "rgb(59, 130, 246)",
      fillB: "rgb(59, 130, 246)",
      text: "rgb(59, 130, 246)",
    });

    await page.mouse.up();
    await expect.poll(readPaints).toEqual({
      fillA: "rgb(59, 130, 246)",
      fillB: "rgb(59, 130, 246)",
      text: "rgb(59, 130, 246)",
    });
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toContain("#3b82f6");
    const afterScrubUndo = await indexHtml(page, id);
    expect(afterScrubUndo).toContain('data-agent-native-group="true"');
    expect(styleOf(afterScrubUndo, "fill-a")).toContain("#3b82f6");
    expect(styleOf(afterScrubUndo, "fill-a")).not.toMatch(/0\.9|90%/);
  });

  test("Cmd+G wraps the selection in a group whose bounds fit its contents and leaves the children in place", async ({
    app,
  }) => {
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    const group = await groupBothLoose(app, id);

    const after = await app.savedNodes(id);
    expect(childrenOf(after, group)).toEqual(["loose-a", "loose-b"]);
    expect(after.get(group)?.parent).toBe(bodyId(before));
    expect(after.get(group)?.attrs["data-agent-native-group"]).toBe("true");
    expectOnlyChanged(before, after, ["loose-a", "loose-b", group]);
    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);
    expect(
      await app.designRect(group),
      "the group hugs its two children",
    ).toEqual({ x: 20, y: 520, width: 270, height: 80 });
    expect(await app.designRect("loose-a")).toEqual({
      x: 20,
      y: 520,
      width: 120,
      height: 80,
    });
    expect(await app.designRect("loose-b")).toEqual({
      x: 170,
      y: 520,
      width: 120,
      height: 80,
    });
  });

  test("Rapid Undo after a Selection colors recolor preserves the committed group", async ({
    app,
    page,
  }) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    const section = await groupAndShowSelectionColors(page, id, [
      "Fill A",
      "Fill B",
      "Fill Text",
    ]);
    const readFill = () =>
      node(page, "fill-a").evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
    await recolorSelectionSwatch(page, section, "#f97316", "3B82F6");
    await expect.poll(readFill).toBe("rgb(59, 130, 246)");
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => {
        const source = await indexHtml(page, id);
        return {
          grouped: source.includes('data-agent-native-group="true"'),
          style: styleOf(source, "fill-a"),
        };
      })
      .toEqual({
        grouped: true,
        style: expect.stringContaining("#f97316"),
      });
    await expect.poll(readFill).toBe("rgb(249, 115, 22)");
    expect(
      viteUpdates,
      "Rapid Undo must be observed without a Vite update or editor reload.",
    ).toEqual([]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await toolbar(page).locator('button[aria-label="Move"]').waitFor();
    const reloaded = await indexHtml(page, id);
    expect(reloaded).toContain('data-agent-native-group="true"');
    expect(styleOf(reloaded, "fill-a")).toContain("#f97316");
  });

  test("Selection colors recolors a Group's shared paint across fills, text, and strokes, keeps gaps, and undoes once", async ({
    app,
    page,
  }) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    const section = await groupAndShowSelectionColors(page, id, [
      "Fill A",
      "Fill B",
      "Fill Text",
    ]);
    const readPaint = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const style = (id: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            if (!element) throw new Error(`Missing ${id}`);
            return getComputedStyle(element);
          };
          const group = document.querySelector<HTMLElement>(
            '[data-agent-native-group="true"]',
          );
          if (!group) throw new Error("Missing Group wrapper");
          const groupRect = group.getBoundingClientRect();
          return {
            aFill: style("fill-a").backgroundColor,
            aStroke: style("fill-a").borderTopColor,
            bFill: style("fill-b").backgroundColor,
            bStroke: style("fill-b").borderTopColor,
            text: style("fill-text").color,
            textWrapperCount: document
              .querySelector('[data-agent-native-node-id="fill-text"]')!
              .querySelectorAll("[data-an-text]").length,
            groupBackground: getComputedStyle(group).backgroundColor,
            groupRect: { width: groupRect.width, height: groupRect.height },
            bodyBackground: getComputedStyle(document.body).backgroundColor,
          };
        });
    const authoredSource = await indexHtml(page, id);
    const authoredStyles = ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
      styleOf(authoredSource, nodeId),
    );
    const firstPaintEditViteUpdateIndex = viteUpdates.length;
    await recolorSelectionSwatch(page, section, "#f97316", "3B82F6");

    await expect.poll(readPaint).toEqual({
      aFill: "rgb(59, 130, 246)",
      aStroke: "rgb(59, 130, 246)",
      bFill: "rgb(59, 130, 246)",
      bStroke: "rgb(17, 24, 39)",
      text: "rgb(59, 130, 246)",
      textWrapperCount: 0,
      groupBackground: "rgba(0, 0, 0, 0)",
      groupRect: { width: 260, height: 144 },
      bodyBackground: "rgb(15, 17, 21)",
    });
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-text"))
      .toContain("#3b82f6");
    const committed = await indexHtml(page, id);
    expect(styleOf(committed, "fill-a")).not.toContain("#f97316");
    expect(styleOf(committed, "fill-b")).toContain("#3b82f6");
    expect(styleOf(committed, "fill-b")).toContain("#111827");

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => {
        const source = await indexHtml(page, id);
        return ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
          styleOf(source, nodeId),
        );
      })
      .toEqual(authoredStyles);
    await expect.poll(readPaint).toMatchObject({
      aFill: "rgb(249, 115, 22)",
      aStroke: "rgb(249, 115, 22)",
      bFill: "rgb(249, 115, 22)",
      text: "rgb(249, 115, 22)",
    });
    expect(await indexHtml(page, id)).toContain(
      'data-agent-native-group="true"',
    );

    const groupRow = layerRow(page, "Group");
    const expandGroup = groupRow.getByRole("button", {
      name: "Expand layer",
      exact: true,
    });
    if ((await expandGroup.count()) > 0) await expandGroup.click();
    const textRow = layerRow(page, "Fill Text");
    await expect(textRow).toHaveCount(1);
    const textBox = (await node(page, "fill-text").boundingBox())!;
    await page.mouse.dblclick(
      textBox.x + textBox.width / 2,
      textBox.y + textBox.height / 2,
    );
    const editableText = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[contenteditable="true"]');
    await expect(editableText).toBeVisible();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(editableText).toHaveCount(0);
    await expect(textRow).toHaveCount(1);
    expect(
      await node(page, "fill-text").evaluate((element) => element.tagName),
    ).toBe("DIV");
    await page.reload({ waitUntil: "domcontentloaded" });
    await toolbar(page).locator('button[aria-label="Move"]').waitFor();
    await expandAllLayers(page);
    await expect(layerRow(page, "Fill Text")).toHaveCount(1);
    const reloadedSource = await indexHtml(page, id);
    expect(reloadedSource).toContain('data-agent-native-group="true"');
    expect(
      await node(page, "fill-text").evaluate((element) => element.tagName),
    ).toBe("DIV");
    await expect
      .poll(() =>
        node(page, "fill-text").evaluate(
          (element) => getComputedStyle(element).color,
        ),
      )
      .toBe("rgb(249, 115, 22)");
    expect(
      viteUpdates.slice(firstPaintEditViteUpdateIndex),
      "Selection colors history assertions are invalid if Vite updates or reloads the editor between paint edit and Undo.",
    ).toEqual([]);
  });

  test("a Group shows Selection colors but no Fill, Stroke, or Corner radius", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    const heading = (name: string) =>
      page.getByRole("heading", { name, exact: true });
    const cornerRadius = page.getByRole("textbox", {
      name: "Corner radius",
      exact: true,
    });

    await layerRow(page, "Fill A").click();
    await expect(heading("Fill")).toBeVisible();
    await expect(heading("Stroke")).toBeVisible();
    await expect(cornerRadius).toBeVisible();

    await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
    await page.keyboard.press(`${MOD}+g`);
    await expect(layerRow(page, "Group")).toBeVisible();
    await layerRow(page, "Group").click();
    await expect(heading("Selection colors")).toBeVisible();
    await expect(heading("Fill")).toHaveCount(0);
    await expect(heading("Stroke")).toHaveCount(0);
    await expect(cornerRadius).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Opacity", exact: true }),
    ).toBeVisible();
  });

  test("Cmd+Shift+G ungroups: the children return to the page at their original positions and stay selected together", async ({
    app,
  }) => {
    const id = await openSeeded(app);
    const original = await app.savedNodes(id);
    const group = await groupBothLoose(app, id);
    expect(
      childrenOf(await app.savedNodes(id), group),
      "grouped first",
    ).toEqual(["loose-a", "loose-b"]);

    await layersTree(app.page)
      .getByRole("button", { name: "Group", exact: true })
      .click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);
    await app.page.keyboard.press(`${MOD}+Shift+g`);
    await expect
      .poll(async () => (await app.savedNodes(id)).has(group))
      .toBe(false);
    await app.settled();
    const after = await app.savedNodes(id);
    expectOnlyChanged(original, after, ["loose-a", "loose-b"]);
    for (const loose of ["loose-a", "loose-b"]) {
      expect(
        savedStyleOf(after.get(loose)),
        `${loose} is back exactly as authored`,
      ).toEqual(savedStyleOf(original.get(loose)));
    }
    expect(childrenOf(after, bodyId(after))).toEqual([
      "wrap",
      "loose-a",
      "loose-b",
    ]);
    expect(await app.designRect("loose-b")).toEqual({
      x: 170,
      y: 520,
      width: 120,
      height: 80,
    });
    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toEqual(["Loose A", "Loose B"]);
    expect(
      await combinedSelectionWidth(app),
      "one combined box around both",
    ).toBe(270);
    await expect(
      app.page
        .frameLocator(
          'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
        )
        .getByText(/^\d+ × \d+$/),
      "the size badge describes the whole selection",
    ).toHaveText("270 × 80");
  });

  test("nudging a group moves the group, not each child, and both children follow", async ({
    app,
  }) => {
    const id = await openSeeded(app);
    const group = await groupBothLoose(app, id);
    const grouped = await app.savedNodes(id);
    const groupLeft = parseFloat(savedStyleOf(grouped.get(group)).left);

    for (let press = 1; press <= 5; press += 1) {
      await app.page.keyboard.press("Shift+ArrowRight");
      await expect
        .poll(
          async () => (await app.designRect(group)).x,
          `after press ${press}`,
        )
        .toBe(20 + press * DEFAULT_BIG_NUDGE_PX);
    }
    await expect
      .poll(async () =>
        parseFloat(savedStyleOf((await app.savedNodes(id)).get(group)).left),
      )
      .toBe(groupLeft + 5 * DEFAULT_BIG_NUDGE_PX);
    await app.settled();
    const after = await app.savedNodes(id);
    expectOnlyChanged(grouped, after, [group]);
    expect((await app.designRect("loose-a")).x).toBe(
      20 + 5 * DEFAULT_BIG_NUDGE_PX,
    );
    expect((await app.designRect("loose-b")).x).toBe(
      170 + 5 * DEFAULT_BIG_NUDGE_PX,
    );
  });
});

test.describe("multi-selection", () => {
  test("dragging a two-element selection moves both by the drag distance and keeps one combined box", async ({
    app,
  }) => {
    const id = await openSeeded(app, SOLO_FIXTURE);
    await clickDesign(app, 660, 540);
    await clickDesign(app, 810, 540, true);
    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toEqual(["Solo A", "Solo B"]);
    const before = await app.savedNodes(id);
    const from = await app.pagePoint(660, 540);
    const to = await app.pagePoint(660, 660);

    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 16 });
    await app.page.mouse.up();

    await expect
      .poll(
        async () => savedStyleOf((await app.savedNodes(id)).get("solo-b")).top,
      )
      .not.toBe("500px");
    await app.settled();
    const after = await app.savedNodes(id);
    expectOnlyChanged(before, after, ["solo-a", "solo-b"]);
    for (const [solo, left] of [
      ["solo-a", 600],
      ["solo-b", 750],
    ] as const) {
      const style = savedStyleOf(after.get(solo));
      expect(parseFloat(style.left), `${solo} kept its x`).toBe(left);
      expect(
        Math.abs(parseFloat(style.top) - 620),
        `${solo} top ${style.top}`,
      ).toBeLessThanOrEqual(2);
    }
    expect(
      await combinedSelectionWidth(app),
      "still one combined box around both",
    ).toBe(270);
  });

  test("a drag lands the object where the cursor landed", async ({ app }) => {
    const id = await openSeeded(app, SOLO_FIXTURE);
    await clickDesign(app, 660, 540);
    await expect.poll(() => app.selectedLayers()).toEqual(["Solo A"]);
    const before = await app.savedNodes(id);
    const from = await app.pagePoint(660, 540);
    const to = await app.pagePoint(660, 420);

    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 16 });
    await app.page.mouse.up();

    await expect
      .poll(
        async () => savedStyleOf((await app.savedNodes(id)).get("solo-a")).top,
      )
      .not.toBe("500px");
    await app.settled();
    const after = await app.savedNodes(id);
    const style = savedStyleOf(after.get("solo-a"));
    expect(parseFloat(style.left)).toBe(600);
    expect(
      Math.abs(parseFloat(style.top) - 380),
      `top ${style.top}`,
    ).toBeLessThanOrEqual(2);
    expectOnlyChanged(before, after, ["solo-a"]);
    const rendered = await app.designRect("solo-a");
    expect(
      Math.abs(rendered.y - 380),
      `rendered y ${rendered.y}`,
    ).toBeLessThanOrEqual(2);
  });

  test("a multi-selection shows one combined bounding box", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.waitForTimeout(800);

    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const measured = await preview.locator("body").evaluate(() => {
      const union = ["loose-a", "loose-b"]
        .map((id) =>
          document
            .querySelector(`[data-agent-native-node-id="${id}"]`)
            ?.getBoundingClientRect(),
        )
        .filter((rect): rect is DOMRect => Boolean(rect));
      if (union.length !== 2) return null;
      const box = document.querySelector(
        "[data-agent-native-multi-selection-bounds]",
      );
      if (!box) return null;
      const chrome = box.getBoundingClientRect();
      return {
        contentWidth:
          Math.max(...union.map((r) => r.right)) -
          Math.min(...union.map((r) => r.left)),
        chromeWidth: chrome.width,
      };
    });

    expect(
      measured,
      "no multi-selection chrome inside the preview",
    ).not.toBeNull();
    expect(
      measured!.chromeWidth,
      `two boxes spanning ${Math.round(measured!.contentWidth)}px are enclosed ` +
        `by ${Math.round(measured!.chromeWidth)}px of chrome`,
    ).toBeCloseTo(measured!.contentWidth, -1);
  });
});

test.describe("frames versus groups", () => {
  test("a frame keeps its explicit size when a child moves", async ({
    app,
    page,
  }) => {
    const id = await newDesign(app);
    await openEditor(page, id);
    const beforeHtml = await indexHtml(page, id);
    const before = styleOf(beforeHtml, "wrap");
    const wBefore = styleNum(before, "width");
    const hBefore = styleNum(before, "height");
    const kidLeftBefore = styleNum(styleOf(beforeHtml, "kid-1"), "left");

    await selectViaTree(page, "Kid One");
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(2000);

    const afterHtml = await indexHtml(page, id);
    expect(
      styleNum(styleOf(afterHtml, "kid-1"), "left"),
      `the child must move for this to test anything (left stayed ${kidLeftBefore})`,
    ).not.toBe(kidLeftBefore);

    const after = styleOf(afterHtml, "wrap");
    expect(
      [styleNum(after, "width"), styleNum(after, "height")],
      `Moving a child must not resize the frame. It went ${wBefore}x${hBefore} → ` +
        `${styleNum(after, "width")}x${styleNum(after, "height")}.`,
    ).toEqual([wBefore, hBefore]);
  });
});
