import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, cdpScreenshot, expandAllLayers, gotoEditor } from "./helpers";

const CHROME_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Chrome geometry</title></head>
  <body style="margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <main
      data-agent-native-node-id="chrome-root"
      data-agent-native-layer-name="Chrome Root"
      style="display:flex;flex-direction:row;gap:16px;width:480px;height:300px;padding:24px;box-sizing:border-box"
    >
      <section
        data-agent-native-node-id="auto-card"
        data-agent-native-layer-name="Auto Card"
        style="display:flex;flex-direction:column;gap:8px;width:200px;height:180px;padding:16px;box-sizing:border-box;background:#e5e7eb"
      >
        <h2 data-agent-native-node-id="auto-card-heading" data-agent-native-layer-name="Card Heading" style="margin:0;font-size:20px">Card heading</h2>
      </section>
      <div
        data-agent-native-node-id="chrome-sibling"
        data-agent-native-layer-name="Chrome Sibling"
        style="width:160px;height:120px;background:#bfdbfe"
      >
        <span
          data-agent-native-node-id="chrome-sibling-label"
          data-agent-native-layer-name="Sibling Label"
        >Sibling</span>
      </div>
    </main>
  </body>
</html>`;

const APP_GEOMETRY_CONTRACT = {
  layersHeaderHeight: 28,
  layerRowHeight: 32,
  layerActionSize: 20,
  layerIconSize: 12,
  layerRowIconSize: 16,
  layerChevronSize: 16,
  layerChevronGlyphSize: 12,
  layerIndentWidth: 24,
  autoLayoutSectionHeaderHeight: 40,
  autoLayoutSectionPadding: 8,
  autoLayoutPairGutter: 16,
  sizingMenuItemMinHeight: 24,
  sizingMenuItemMaxHeight: 32,
} as const;

const ARTIFACT_DIR = path.resolve(import.meta.dirname, "../../../.tmp");
const COMPACT_SCREENSHOT = path.join(
  ARTIFACT_DIR,
  "design-chrome-geometry-240.png",
);
const WIDE_SCREENSHOT = path.join(
  ARTIFACT_DIR,
  "design-chrome-geometry-320.png",
);

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const origin =
    page.url() === "about:blank" ? e2eBaseURL() : new URL(page.url()).origin;
  const response = await page.request.post(
    new URL(appPath(`/_agent-native/actions/${name}`), origin).toString(),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${name}: ${response.status()} ${(await response.text()).slice(0, 200)}`,
    );
  }
  return response.json();
}

async function createChromeFixture(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "Chrome geometry",
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: CHROME_FIXTURE,
    fileType: "html",
  });
  return designId;
}

async function readGeometry(
  locator: Locator,
  properties: string[] = [],
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  styles: Record<string, string>;
}> {
  return locator.evaluate((element, names) => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      styles: Object.fromEntries(
        names.map((name) => [name, computed.getPropertyValue(name)]),
      ),
    };
  }, properties);
}

function layerRow(page: Page, name: string): Locator {
  return page
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

async function selectLayer(page: Page, name: string): Promise<void> {
  const button = layerRow(page, name);
  await expect(button).toBeVisible();
  await button.click({ force: true });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

// Structural: the tab row is gone, so the panel opens on its header, and the header and every section header sit on one grid box.
async function assertInspectorHeader(page: Page): Promise<void> {
  const panel = page
    .locator('[data-design-chrome-region="right-panel"]')
    .first();
  await expect(page.locator("[data-design-inspector-tabs]")).toHaveCount(0);
  await expect(
    panel.getByRole("tab", { name: /^(Design|Comments|Tweaks|Code)$/ }),
  ).toHaveCount(0);

  const header = panel.locator("[data-design-inspector-header]");
  await expect(header).toHaveCount(1);
  const panelGeometry = await readGeometry(panel);
  expect((await readGeometry(header)).y).toBeCloseTo(panelGeometry.y, 0);

  const grids = await panel
    .locator(
      "[data-design-inspector-header] [data-inspector-grid], [data-design-inspector-section-header] [data-inspector-grid]",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      }),
    );
  expect(grids.length).toBeGreaterThan(2);
  // One shared grid: the panel's 1px left border and 8px of padding come
  // first, and every header spans the same width after that.
  for (const grid of grids) {
    expect(grid.x).toBeCloseTo(panelGeometry.x + 1 + 8, 0);
    expect(grid.width).toBeCloseTo(grids[0]!.width, 0);
  }
}

async function assertLayersChrome(page: Page): Promise<void> {
  const panel = page.locator("[data-layers-panel]");
  const layersHeader = page.locator('[data-layers-panel-header="layers"]');
  await expect(layersHeader).toBeVisible();
  expect((await readGeometry(layersHeader)).height).toBe(
    APP_GEOMETRY_CONTRACT.layersHeaderHeight,
  );

  const actions = page.locator("[data-layers-panel-action]");
  await expect(actions).toHaveCount(3);
  for (let index = 0; index < (await actions.count()); index += 1) {
    const button = actions.nth(index);
    const buttonGeometry = await readGeometry(button);
    const glyphGeometry = await readGeometry(button.locator("svg"));
    expect(buttonGeometry.width).toBe(APP_GEOMETRY_CONTRACT.layerActionSize);
    expect(buttonGeometry.height).toBe(APP_GEOMETRY_CONTRACT.layerActionSize);
    expect(glyphGeometry.width).toBe(APP_GEOMETRY_CONTRACT.layerIconSize);
    expect(glyphGeometry.height).toBe(APP_GEOMETRY_CONTRACT.layerIconSize);
  }

  const row = layerRow(page, "Auto Card").locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
  const rowContent = row.locator("[data-layer-row-content]");
  const chevron = row.locator("[data-layer-row-chevron]");
  const icon = row.locator("[data-layer-row-icon]");
  const rowGeometry = await readGeometry(rowContent);
  expect(rowGeometry.height).toBe(APP_GEOMETRY_CONTRACT.layerRowHeight);
  const chevronGeometry = await readGeometry(chevron);
  expect(chevronGeometry.width).toBe(APP_GEOMETRY_CONTRACT.layerChevronSize);
  expect(chevronGeometry.height).toBe(APP_GEOMETRY_CONTRACT.layerChevronSize);
  const chevronGlyphGeometry = await readGeometry(chevron.locator("svg"));
  expect(chevronGlyphGeometry.width).toBe(
    APP_GEOMETRY_CONTRACT.layerChevronGlyphSize,
  );
  expect(chevronGlyphGeometry.height).toBe(
    APP_GEOMETRY_CONTRACT.layerChevronGlyphSize,
  );
  const iconGeometry = await readGeometry(icon);
  expect(iconGeometry.width).toBe(APP_GEOMETRY_CONTRACT.layerRowIconSize);
  expect(iconGeometry.height).toBe(APP_GEOMETRY_CONTRACT.layerRowIconSize);
  const indents = rowContent.locator("[data-layer-row-indent]");
  for (let index = 0; index < (await indents.count()); index += 1) {
    expect((await readGeometry(indents.nth(index))).width).toBe(
      APP_GEOMETRY_CONTRACT.layerIndentWidth,
    );
  }
  const panelGeometry = await readGeometry(panel);
  expect(rowGeometry.x).toBeGreaterThanOrEqual(panelGeometry.x);
  expect(rowGeometry.x + rowGeometry.width).toBeLessThanOrEqual(
    panelGeometry.x + panelGeometry.width + 1,
  );
}

async function assertAutoLayoutGeometry(page: Page): Promise<void> {
  const section = page
    .locator("[data-design-inspector-section]")
    .filter({ has: page.getByRole("heading", { name: "Auto layout" }) })
    .first();
  await expect(section).toBeVisible();
  const sectionHeader = section.locator(
    "[data-design-inspector-section-header]",
  );
  const sectionContent = section.locator(
    "[data-design-inspector-section-content]",
  );
  expect((await readGeometry(sectionHeader)).height).toBe(
    APP_GEOMETRY_CONTRACT.autoLayoutSectionHeaderHeight,
  );
  const sectionStyles = await readGeometry(section, ["box-shadow"]);
  expect(sectionStyles.styles["box-shadow"]).toContain("inset");
  const contentStyles = await readGeometry(sectionContent, [
    "padding-left",
    "padding-right",
    "padding-bottom",
  ]);
  expect(contentStyles.styles["padding-left"]).toBe(
    `${APP_GEOMETRY_CONTRACT.autoLayoutSectionPadding}px`,
  );
  expect(contentStyles.styles["padding-right"]).toBe(
    `${APP_GEOMETRY_CONTRACT.autoLayoutSectionPadding}px`,
  );
  expect(contentStyles.styles["padding-bottom"]).toBe(
    `${APP_GEOMETRY_CONTRACT.autoLayoutSectionPadding}px`,
  );

  const pair = section.locator('[data-inspector-layout="pair-flow"]').first();
  const cells = pair.locator(":scope > [data-inspector-grid-cell]");
  await expect(cells).toHaveCount(2);
  const pairGeometry = await readGeometry(pair, ["grid-template-columns"]);
  const pairColumns = pairGeometry.styles["grid-template-columns"]
    .trim()
    .split(/\s+/);
  expect(pairColumns).toHaveLength(3);
  expect(pairColumns[1]).toBe(
    `${APP_GEOMETRY_CONTRACT.autoLayoutPairGutter}px`,
  );
  const left = await readGeometry(cells.nth(0));
  const right = await readGeometry(cells.nth(1));
  expect(left.width).toBeGreaterThan(0);
  expect(right.width).toBeGreaterThan(0);
  expect(Math.abs(left.width - right.width)).toBeLessThan(1);
  expect(right.x - (left.x + left.width)).toBeCloseTo(
    APP_GEOMETRY_CONTRACT.autoLayoutPairGutter,
    0,
  );
  expect(right.x + right.width).toBeLessThanOrEqual(
    pairGeometry.x + pairGeometry.width + 1,
  );

  const widthTrigger = page.getByRole("button", { name: /^W / }).first();
  await widthTrigger.click();
  const hug = page.locator('[data-design-sizing-menu-item="Hug contents"]');
  const fill = page.locator('[data-design-sizing-menu-item="Fill container"]');
  await expect(hug).toBeVisible();
  await expect(fill).toBeVisible();
  await hug.evaluate(async (item) => {
    const menu = item.closest<HTMLElement>('[role="menu"]');
    await Promise.all(
      menu?.getAnimations().map((animation) => animation.finished) ?? [],
    );
  });
  await expect
    .poll(async () => (await readGeometry(hug)).height, { timeout: 2_000 })
    .toBeGreaterThanOrEqual(APP_GEOMETRY_CONTRACT.sizingMenuItemMinHeight);
  const hugGeometry = await readGeometry(hug, [
    "padding-top",
    "padding-bottom",
    "line-height",
  ]);
  const fillGeometry = await readGeometry(fill);
  expect(hugGeometry.height).toBeLessThanOrEqual(
    APP_GEOMETRY_CONTRACT.sizingMenuItemMaxHeight,
  );
  expect(fillGeometry.height).toBeCloseTo(hugGeometry.height, 1);
  expect(fillGeometry.y - hugGeometry.y).toBeCloseTo(hugGeometry.height, 0);
  expect(hugGeometry.styles["padding-top"]).toBe("6px");
  expect(hugGeometry.styles["padding-bottom"]).toBe("6px");
  expect(
    Number.parseFloat(hugGeometry.styles["line-height"]),
  ).toBeGreaterThanOrEqual(12);
  expect(
    Number.parseFloat(hugGeometry.styles["line-height"]),
  ).toBeLessThanOrEqual(20);
  await expect
    .poll(async () => (await readGeometry(hug.locator("span").first())).width)
    .toBeCloseTo(16, 1);
  await expect
    .poll(async () => (await readGeometry(hug.locator("span").last())).width)
    .toBeCloseTo(14, 1);
  await page.keyboard.press("Escape");
  await expect(hug).toBeHidden();
  await page.mouse.move(600, 300);
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="tooltip"]')).toBeHidden();
}

async function assertLayersInteractions(page: Page): Promise<void> {
  const search = page.locator('[data-layers-panel-action="search"]');
  await search.click();
  const input = page.getByPlaceholder("Search layers...");
  await expect(input).toBeVisible();
  await input.fill("Auto Card");
  await expect(layerRow(page, "Auto Card")).toBeVisible();
  await input.fill("not a real layer");
  await expect(
    page.locator("[data-layers-panel]").getByText("No layers match", {
      exact: true,
    }),
  ).toBeVisible();
  await input.fill("");
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();

  const screenRows = page.locator("[data-screen-row]");
  await expect(screenRows).toHaveCount(1);
  const addScreen = page.locator('[data-layers-panel-action="add-screen"]');
  await expect(addScreen).toBeEnabled();
  await addScreen.click();
  await expect.poll(() => screenRows.count(), { timeout: 15_000 }).toBe(2);

  const autoCard = layerRow(page, "Auto Card").locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
  const chevron = autoCard.locator("[data-layer-row-chevron]");
  await expect(chevron).toHaveAttribute("data-layer-row-chevron", "expanded");
  await expect(layerRow(page, "Card Heading")).toBeVisible();
  await chevron.click();
  await expect(chevron).toHaveAttribute("data-layer-row-chevron", "collapsed");
  await expect(layerRow(page, "Card Heading")).toBeHidden();
  await chevron.click();
  await expect(chevron).toHaveAttribute("data-layer-row-chevron", "expanded");
  await expect(layerRow(page, "Card Heading")).toBeVisible();

  await selectLayer(page, "Card Heading");
  await page.locator('[data-layers-panel-action="collapse"]').click();
  await expect(layerRow(page, "Sibling Label")).toBeHidden();
  await expandAllLayers(page);
  await expect(layerRow(page, "Sibling Label")).toBeVisible();
}

async function reopenAutoCard(page: Page, designId: string): Promise<void> {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await selectLayer(page, "Auto Card");
}

async function chooseWidthMode(
  page: Page,
  label: "Hug contents" | "Fill container",
): Promise<void> {
  const widthTrigger = page.getByRole("button", { name: /^W / }).first();
  await widthTrigger.click();
  await page.locator(`[data-design-sizing-menu-item="${label}"]`).click();
  const triggerMode = label === "Hug contents" ? "Hug" : "Fill";
  await expect(widthTrigger).toHaveAccessibleName(
    new RegExp(`^W .* ${triggerMode}$`),
  );
}

async function assertEmptyLayersState(page: Page): Promise<void> {
  const created = await postAction(page, "create-design", {
    title: "Empty screens geometry",
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id;
  if (!designId) throw new Error("create-design returned no empty design id");
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const layersPanel = page.locator("[data-layers-panel]");
  await expect(layersPanel).toContainText("No layers");
  await expect(layersPanel.locator("[data-screen-section]")).toHaveCount(0);
  await expect(
    layersPanel.locator('[data-layers-panel-action="add-screen"]'),
  ).toHaveCount(0);
}

async function dragLeftPanelBy(page: Page, deltaX: number): Promise<void> {
  const separator = page.locator(
    '[data-design-chrome-region="left-shell"] [role="separator"][aria-orientation="vertical"]',
  );
  const geometry = await readGeometry(separator);
  const startX = geometry.x + geometry.width / 2;
  const y = geometry.y + geometry.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 8 });
  await page.mouse.up();
}

async function assertLeftPanelWidth(page: Page): Promise<void> {
  const leftPanel = page.locator(
    '[data-design-chrome-region="left-shell"] > div[style*="width"]',
  );
  const width = async () =>
    (await readGeometry(leftPanel, ["width"])).styles.width;
  expect(await width()).toBe("240px");
  await dragLeftPanelBy(page, 9);
  await expect.poll(width).toBe("248px");
  await dragLeftPanelBy(page, 1000);
  await expect.poll(width).toBe("416px");
  await dragLeftPanelBy(page, -1000);
  await expect.poll(width).toBe("232px");
}

test("keeps Design chrome geometry stable at compact and wide inspector widths", async ({
  page,
}) => {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const designId = await createChromeFixture(page);
  await gotoEditor(page, designId);
  await expandAllLayers(page);

  await assertLayersChrome(page);
  await assertLayersInteractions(page);
  await selectLayer(page, "Auto Card");
  await assertInspectorHeader(page);
  await assertAutoLayoutGeometry(page);
  await chooseWidthMode(page, "Hug contents");
  await reopenAutoCard(page, designId);
  await expect(page.getByRole("button", { name: /^W .* Hug$/ })).toBeVisible();
  await chooseWidthMode(page, "Fill container");
  await reopenAutoCard(page, designId);
  await expect(page.getByRole("button", { name: /^W .* Fill$/ })).toBeVisible();
  await assertEmptyLayersState(page);

  await reopenAutoCard(page, designId);
  await assertInspectorHeader(page);
  await assertLayersChrome(page);
  await cdpScreenshot(page, COMPACT_SCREENSHOT);

  const separator = page.locator(
    '[data-design-chrome-region="right-panel"] > [role="separator"]',
  );
  const rightPanel = page
    .locator('[data-design-chrome-region="right-panel"]')
    .first();
  const separatorGeometry = await readGeometry(separator);
  const currentPanelGeometry = await readGeometry(rightPanel);
  const topBarGeometry = await readGeometry(
    page.locator("[data-design-top-bar]"),
  );
  const leftShellGeometry = await readGeometry(
    page.locator('[data-design-chrome-region="left-shell"]'),
  );
  const leftHeaderGeometry = await readGeometry(
    page.locator('[data-design-chrome-region="left-header"]'),
  );
  const zoneGeometry = await readGeometry(
    page.locator("[data-design-top-bar-inspector-zone]"),
  );
  // The 48px line runs over the canvas and inspector columns only; the rail
  // and left panel share its top row.
  expect(topBarGeometry.y).toBe(0);
  expect(topBarGeometry.height).toBe(48);
  expect(leftShellGeometry.y).toBe(0);
  expect(leftHeaderGeometry.y).toBe(0);
  expect(leftHeaderGeometry.height).toBe(48);
  expect(topBarGeometry.x).toBe(leftShellGeometry.x + leftShellGeometry.width);
  expect(currentPanelGeometry.y).toBe(topBarGeometry.height);
  expect(zoneGeometry.x).toBeLessThanOrEqual(currentPanelGeometry.x + 1);
  expect(zoneGeometry.x + zoneGeometry.width).toBeCloseTo(
    topBarGeometry.x + topBarGeometry.width - 8,
    0,
  );
  const targetPanelWidth = 320;
  const dragStartX = separatorGeometry.x + separatorGeometry.width / 2;
  await page.mouse.move(
    dragStartX,
    separatorGeometry.y + separatorGeometry.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragStartX - (targetPanelWidth - currentPanelGeometry.width),
    separatorGeometry.y + separatorGeometry.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await readGeometry(rightPanel, ["width"])).styles.width)
    .toBe(`${targetPanelWidth}px`);

  await assertInspectorHeader(page);
  await assertLayersChrome(page);
  await assertAutoLayoutGeometry(page);
  await cdpScreenshot(page, WIDE_SCREENSHOT);
  await assertLeftPanelWidth(page);
});
