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
      >Sibling</div>
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
}

async function assertInspectorTabs(page: Page): Promise<void> {
  const header = page.locator("[data-design-inspector-tabs]");
  const list = page.locator("[data-design-inspector-tabs-list]");
  const headerGeometry = await readGeometry(header, [
    "padding-top",
    "padding-bottom",
    "border-bottom-width",
  ]);
  expect(headerGeometry.height).toBe(48);
  expect(headerGeometry.styles["padding-top"]).toBe("8px");
  expect(headerGeometry.styles["padding-bottom"]).toBe("8px");
  expect(headerGeometry.styles["border-bottom-width"]).toBe("1px");

  expect((await readGeometry(list)).height).toBe(28);
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
    expect(geometry.height).toBe(24);
    expect(geometry.styles["padding-top"]).toBe("4px");
    expect(geometry.styles["padding-bottom"]).toBe("4px");
    expect(geometry.styles["line-height"]).toBe("16px");
  }
}

async function assertLayersChrome(page: Page): Promise<void> {
  const panel = page.locator("[data-layers-panel]");
  const layersHeader = page.locator('[data-layers-panel-header="layers"]');
  expect((await readGeometry(layersHeader)).height).toBe(28);

  const actions = page.locator("[data-layers-panel-action]");
  await expect(actions).toHaveCount(3);
  for (let index = 0; index < (await actions.count()); index += 1) {
    const button = actions.nth(index);
    const buttonGeometry = await readGeometry(button);
    const glyphGeometry = await readGeometry(button.locator("svg"));
    expect(buttonGeometry.width).toBe(20);
    expect(buttonGeometry.height).toBe(20);
    expect(glyphGeometry.width).toBe(12);
    expect(glyphGeometry.height).toBe(12);
  }

  const row = layerRow(page, "Auto Card").locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
  const rowContent = row.locator("[data-layer-row-content]");
  const chevron = row.locator("[data-layer-row-chevron]");
  const icon = row.locator("[data-layer-row-icon]");
  expect((await readGeometry(rowContent)).height).toBe(24);
  expect((await readGeometry(chevron)).width).toBe(20);
  expect((await readGeometry(chevron)).height).toBe(20);
  expect((await readGeometry(chevron.locator("svg"))).width).toBe(10);
  expect((await readGeometry(chevron.locator("svg"))).height).toBe(10);
  expect((await readGeometry(icon)).width).toBe(12);
  expect((await readGeometry(icon)).height).toBe(12);
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
  expect((await readGeometry(sectionHeader)).height).toBe(40);
  const sectionStyles = await readGeometry(section, ["box-shadow"]);
  expect(sectionStyles.styles["box-shadow"]).toContain("inset");
  const contentStyles = await readGeometry(sectionContent, [
    "padding-left",
    "padding-right",
    "padding-bottom",
  ]);
  expect(contentStyles.styles["padding-left"]).toBe("8px");
  expect(contentStyles.styles["padding-right"]).toBe("8px");
  expect(contentStyles.styles["padding-bottom"]).toBe("8px");

  const pair = section.locator('[data-inspector-layout="pair-flow"]').first();
  const cells = pair.locator(":scope > [data-inspector-grid-cell]");
  await expect(cells).toHaveCount(2);
  const pairGeometry = await readGeometry(pair, ["grid-template-columns"]);
  expect(pairGeometry.styles["grid-template-columns"]).toContain("16px");
  const left = await readGeometry(cells.nth(0));
  const right = await readGeometry(cells.nth(1));
  expect(Math.abs(left.width - right.width)).toBeLessThan(1);
  expect(right.x - (left.x + left.width)).toBeCloseTo(16, 0);
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
  expect(hugGeometry.height).toBe(30);
  expect(fillGeometry.height).toBe(30);
  expect(fillGeometry.y - hugGeometry.y).toBe(30);
  expect(hugGeometry.styles["padding-top"]).toBe("6px");
  expect(hugGeometry.styles["padding-bottom"]).toBe("6px");
  expect(hugGeometry.styles["line-height"]).toBe("18px");
  expect((await readGeometry(hug.locator("span").first())).width).toBe(16);
  expect((await readGeometry(hug.locator("span").last())).width).toBe(14);
  await page.keyboard.press("Escape");
  await expect(hug).toBeHidden();
  await page.mouse.move(600, 300);
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="tooltip"]')).toBeHidden();
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
  await selectLayer(page, "Auto Card");
  await assertAutoLayoutGeometry(page);
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
