import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { APPROVED_FIGMA_CHROME_REFERENCE as FIGMA_REFERENCE } from "./chrome-geometry.reference";
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

async function assertInspectorTabs(page: Page): Promise<void> {
  const header = page.locator("[data-design-inspector-tabs]");
  const list = page.locator("[data-design-inspector-tabs-list]");
  const headerGeometry = await readGeometry(header, [
    "padding-top",
    "padding-bottom",
    "border-bottom-width",
  ]);
  expect(headerGeometry.height).toBe(
    FIGMA_REFERENCE.inspectorTabs.header.height,
  );
  expect(headerGeometry.styles["padding-top"]).toBe(
    `${FIGMA_REFERENCE.inspectorTabs.header.paddingY}px`,
  );
  expect(headerGeometry.styles["padding-bottom"]).toBe(
    `${FIGMA_REFERENCE.inspectorTabs.header.paddingY}px`,
  );
  expect(headerGeometry.styles["border-bottom-width"]).toBe(
    `${FIGMA_REFERENCE.inspectorTabs.header.borderBottom}px`,
  );

  expect((await readGeometry(list)).height).toBe(
    FIGMA_REFERENCE.inspectorTabs.listHeight,
  );
  const tabs = page.locator("[data-design-inspector-tab]");
  await expect(tabs).toHaveCount(3);
  await expect(
    page.locator('[data-design-inspector-tab="code"]'),
  ).toBeVisible();
  for (let index = 0; index < (await tabs.count()); index += 1) {
    const geometry = await readGeometry(tabs.nth(index), [
      "padding-top",
      "padding-bottom",
      "line-height",
    ]);
    expect(geometry.height).toBe(FIGMA_REFERENCE.inspectorTabs.trigger.height);
    expect(geometry.styles["padding-top"]).toBe(
      `${FIGMA_REFERENCE.inspectorTabs.trigger.paddingY}px`,
    );
    expect(geometry.styles["padding-bottom"]).toBe(
      `${FIGMA_REFERENCE.inspectorTabs.trigger.paddingY}px`,
    );
    expect(geometry.styles["line-height"]).toBe(
      `${FIGMA_REFERENCE.inspectorTabs.trigger.lineHeight}px`,
    );
  }
}

async function assertLayersChrome(page: Page): Promise<void> {
  const panel = page.locator("[data-layers-panel]");
  const layersHeader = page.locator('[data-layers-panel-header="layers"]');
  expect((await readGeometry(layersHeader)).height).toBe(
    FIGMA_REFERENCE.layers.sectionHeaderHeight,
  );

  const actions = page.locator("[data-layers-panel-action]");
  await expect(actions).toHaveCount(3);
  for (let index = 0; index < (await actions.count()); index += 1) {
    const button = actions.nth(index);
    const buttonGeometry = await readGeometry(button);
    const glyphGeometry = await readGeometry(button.locator("svg"));
    expect(buttonGeometry.width).toBe(FIGMA_REFERENCE.layers.action.width);
    expect(buttonGeometry.height).toBe(FIGMA_REFERENCE.layers.action.height);
    expect(glyphGeometry.width).toBe(FIGMA_REFERENCE.layers.action.glyph);
    expect(glyphGeometry.height).toBe(FIGMA_REFERENCE.layers.action.glyph);
  }

  const row = layerRow(page, "Auto Card").locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
  const rowContent = row.locator("[data-layer-row-content]");
  const chevron = row.locator("[data-layer-row-chevron]");
  const icon = row.locator("[data-layer-row-icon]");
  expect((await readGeometry(rowContent)).height).toBe(
    FIGMA_REFERENCE.layers.row.height,
  );
  expect((await readGeometry(chevron)).width).toBe(
    FIGMA_REFERENCE.layers.row.chevron,
  );
  expect((await readGeometry(chevron)).height).toBe(
    FIGMA_REFERENCE.layers.row.chevron,
  );
  expect((await readGeometry(chevron.locator("svg"))).width).toBe(
    FIGMA_REFERENCE.layers.row.chevronGlyph,
  );
  expect((await readGeometry(chevron.locator("svg"))).height).toBe(
    FIGMA_REFERENCE.layers.row.chevronGlyph,
  );
  expect((await readGeometry(icon)).width).toBe(
    FIGMA_REFERENCE.layers.row.icon,
  );
  expect((await readGeometry(icon)).height).toBe(
    FIGMA_REFERENCE.layers.row.icon,
  );
  const panelGeometry = await readGeometry(panel);
  const rowGeometry = await readGeometry(rowContent);
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
    FIGMA_REFERENCE.autoLayout.sectionHeaderHeight,
  );
  const sectionStyles = await readGeometry(section, ["box-shadow"]);
  expect(sectionStyles.styles["box-shadow"]).toContain("inset");
  const contentStyles = await readGeometry(sectionContent, [
    "padding-left",
    "padding-right",
    "padding-bottom",
  ]);
  expect(contentStyles.styles["padding-left"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.contentPaddingX}px`,
  );
  expect(contentStyles.styles["padding-right"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.contentPaddingX}px`,
  );
  expect(contentStyles.styles["padding-bottom"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.contentPaddingBottom}px`,
  );

  const pair = section.locator('[data-inspector-layout="pair-flow"]').first();
  const cells = pair.locator(":scope > [data-inspector-grid-cell]");
  await expect(cells).toHaveCount(2);
  const pairGeometry = await readGeometry(pair, ["grid-template-columns"]);
  expect(pairGeometry.styles["grid-template-columns"]).toContain(
    `${FIGMA_REFERENCE.autoLayout.pairSlotWidth}px`,
  );
  const left = await readGeometry(cells.nth(0));
  const right = await readGeometry(cells.nth(1));
  expect(Math.abs(left.width - right.width)).toBeLessThan(1);
  expect(right.x - (left.x + left.width)).toBeCloseTo(
    FIGMA_REFERENCE.autoLayout.pairGap,
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
  await expect
    .poll(async () => (await readGeometry(hug)).height, { timeout: 2_000 })
    .toBe(30);
  const hugGeometry = await readGeometry(hug, [
    "padding-top",
    "padding-bottom",
    "line-height",
    "font-size",
    "box-sizing",
  ]);
  const fillGeometry = await readGeometry(fill);
  expect(hugGeometry.height).toBe(FIGMA_REFERENCE.autoLayout.menuItemHeight);
  expect(fillGeometry.height).toBe(FIGMA_REFERENCE.autoLayout.menuItemHeight);
  expect(fillGeometry.y - hugGeometry.y).toBe(
    FIGMA_REFERENCE.autoLayout.menuItemHeight,
  );
  expect(hugGeometry.styles["padding-top"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.menuItemPaddingY}px`,
  );
  expect(hugGeometry.styles["padding-bottom"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.menuItemPaddingY}px`,
  );
  expect(hugGeometry.styles["line-height"]).toBe(
    `${FIGMA_REFERENCE.autoLayout.menuItemLineHeight}px`,
  );
  expect((await readGeometry(hug.locator("span").first())).width).toBe(
    FIGMA_REFERENCE.autoLayout.menuLeadingSlotWidth,
  );
  expect((await readGeometry(hug.locator("span").last())).width).toBe(
    FIGMA_REFERENCE.autoLayout.menuTrailingSlotWidth,
  );
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
  await page.getByRole("tab", { name: "Design", exact: true }).click();
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
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  const layersPanel = page.locator("[data-layers-panel]");
  await expect(layersPanel).toContainText("No layers");
  await expect(layersPanel.locator("[data-screen-section]")).toHaveCount(0);
  await expect(
    layersPanel.locator('[data-layers-panel-action="add-screen"]'),
  ).toHaveCount(0);
}

test("keeps Design chrome geometry stable at compact and wide inspector widths", async ({
  page,
}) => {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const designId = await createChromeFixture(page);
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await expandAllLayers(page);

  await assertInspectorTabs(page);
  await assertLayersChrome(page);
  await assertLayersInteractions(page);
  await selectLayer(page, "Auto Card");
  await assertAutoLayoutGeometry(page);
  await chooseWidthMode(page, "Hug contents");
  await reopenAutoCard(page, designId);
  await expect(page.getByRole("button", { name: /^W .* Hug$/ })).toBeVisible();
  await chooseWidthMode(page, "Fill container");
  await reopenAutoCard(page, designId);
  await expect(page.getByRole("button", { name: /^W .* Fill$/ })).toBeVisible();
  await assertEmptyLayersState(page);

  await reopenAutoCard(page, designId);
  await assertInspectorTabs(page);
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

  await assertInspectorTabs(page);
  await assertLayersChrome(page);
  await assertAutoLayoutGeometry(page);
  await cdpScreenshot(page, WIDE_SCREENSHOT);
});
