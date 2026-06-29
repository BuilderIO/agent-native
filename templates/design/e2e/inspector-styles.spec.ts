import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  cdpScreenshot,
  designFrame,
  gotoEditor,
  installBridge,
  readSeedDesignId,
  selectByText,
  waitForBridge,
} from "./helpers";

let designId: string;

const DATA_URI_1X1_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1uoAAAAASUVORK5CYII=";

test.beforeAll(async () => {
  designId = await readSeedDesignId();
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
});

function inspectorSection(page: Page, title: RegExp | string): Locator {
  const heading =
    typeof title === "string"
      ? page.getByRole("heading", { name: title, exact: true })
      : page.getByRole("heading", { name: title });
  return page.locator("section").filter({ has: heading }).first();
}

function pagePropertiesSection(page: Page): Locator {
  return inspectorSection(page, /^Page$/);
}

function bodyElement(page: Page): Locator {
  return designFrame(page).locator("body");
}

async function readInlineStyle(
  page: Page,
  locator: Locator,
  property: string,
): Promise<string> {
  return locator.evaluate((el, name) => {
    const style = (el as HTMLElement).style;
    return (
      style.getPropertyValue(name) ||
      style.getPropertyValue(
        name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      )
    );
  }, property);
}

async function setScrubInput(
  scope: Page | Locator,
  label: string,
  value: string,
): Promise<void> {
  const input = scope.locator(`input[aria-label="${cssAttrValue(label)}" i]`);
  await input.fill(value);
  await input.press("Enter");
}

function cssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openColorPicker(section: Locator): Promise<void> {
  await section.getByRole("button", { name: "Open color picker" }).click();
}

async function choosePaintType(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function resizeSelectedElement(
  page: Page,
  handle: "nw" | "ne" | "se" | "sw",
  dx: number,
  dy: number,
): Promise<void> {
  const handleLocator = designFrame(page).locator(
    `[data-agent-native-edit-handle="${handle}"]`,
  );
  const box = await handleLocator.boundingBox();
  if (!box) throw new Error(`missing resize handle ${handle}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

async function selectedElementStyle(
  page: Page,
  text: string,
  property: string,
): Promise<string> {
  return designFrame(page)
    .getByText(text, { exact: false })
    .first()
    .evaluate(
      (el, name) =>
        (el as HTMLElement).style.getPropertyValue(name) ||
        window.getComputedStyle(el).getPropertyValue(name),
      property,
    );
}

test("page background supports gradient edits", async ({ page }) => {
  await page.keyboard.press("Escape");
  const pageSection = pagePropertiesSection(page);
  await expect(pageSection).toBeVisible();

  await openColorPicker(pageSection);
  await choosePaintType(page, "Linear");
  await setScrubInput(page, "Gradient angle", "135");
  await setScrubInput(page, "Stop position", "25");

  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-image"))
    .toContain("linear-gradient(135deg");
  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-image"))
    .toContain("25%");
});

test("page background exposes image controls and accepts a tiled data URL", async ({
  page,
}) => {
  await page.keyboard.press("Escape");
  const pageSection = pagePropertiesSection(page);
  await expect(pageSection).toBeVisible();

  await openColorPicker(pageSection);
  await choosePaintType(page, "Image");
  await setScrubInput(page, "Image URL", DATA_URI_1X1_PNG);
  await page.getByRole("combobox", { name: "Fill", exact: true }).click();
  await page.getByRole("option", { name: "Tile", exact: true }).click();

  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-image"))
    .toContain("data:image/png;base64");
  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-repeat"))
    .toBe("repeat");
  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-position"))
    .toBe("left top");
});

test("text fills hide and restore without losing the original color", async ({
  page,
}) => {
  const payload = await selectByText(page, "E2E Hero Heading");
  expect((payload.tagName ?? "").toUpperCase()).toBe("H1");

  const heading = designFrame(page).getByText("E2E Hero Heading", {
    exact: false,
  });
  const fillSection = inspectorSection(page, /^Fill$/i);
  const hideFillButton = fillSection.locator('button[aria-label="Hide layer"]');
  const showFillButton = fillSection.locator('button[aria-label="Show layer"]');
  await expect(fillSection).toBeVisible();

  const initialColor = await selectedElementStyle(
    page,
    "E2E Hero Heading",
    "color",
  );
  expect(initialColor).not.toBe("");

  await hideFillButton.click({ force: true });
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "color"))
    .toBe("transparent");
  await expect(showFillButton).toHaveCount(1);

  await showFillButton.click({ force: true });
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "color"))
    .toBe(initialColor);
  await expect(heading).toBeVisible();
});

test("typography edits update size and spacing inputs", async ({ page }) => {
  await selectByText(page, "E2E Hero Heading");
  const typographySection = inspectorSection(page, /^Typography$/i);
  await expect(typographySection).toBeVisible();

  await expect(
    typographySection.getByRole("combobox", { name: "Font" }),
  ).toContainText(/\S/);
  await expect(
    typographySection.getByRole("button", { name: "Auto width" }),
  ).toHaveCount(0);
  await typographySection
    .getByRole("button", { name: "Typography details" })
    .click();
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto width" })).toBeVisible();
  await page.keyboard.press("Escape");

  await setScrubInput(typographySection, "Size", "52");
  await setScrubInput(typographySection, "Line height", "1.25");
  await setScrubInput(typographySection, "Tracking", "2");

  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "font-size"))
    .toBe("52px");
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "line-height"))
    .toBe("1.25");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("2px");
});

test("export rows add, remove, and reset when selection changes", async ({
  page,
}) => {
  await selectByText(page, "E2E Hero Heading");
  const exportSection = inspectorSection(page, /^Export$/i);
  await expect(exportSection).toBeVisible();

  const suffixInputs = () => exportSection.getByLabel("Suffix");

  await expect(suffixInputs()).toHaveCount(1);
  await exportSection.getByRole("button", { name: "Add export" }).click();
  await expect(suffixInputs()).toHaveCount(2);

  const secondRow = suffixInputs().nth(1);
  await secondRow.fill("-2x");
  await secondRow.press("Enter");

  await exportSection
    .getByRole("button", { name: "Remove export" })
    .last()
    .click({
      force: true,
    });
  await expect(suffixInputs()).toHaveCount(1);

  await exportSection.getByRole("button", { name: "Add export" }).click();
  await expect(suffixInputs()).toHaveCount(2);

  await selectByText(page, "Alpha Button");
  await expect(suffixInputs()).toHaveCount(1);
  await selectByText(page, "E2E Hero Heading");
  await expect(suffixInputs()).toHaveCount(1);
});

test("resizing a selected element emits a visual-style-change payload", async ({
  page,
}) => {
  const payload = await selectByText(page, "Alpha Button");
  expect((payload.tagName ?? "").toUpperCase()).toBe("BUTTON");

  await installBridge(page);
  await page.evaluate(() => {
    (window as any).__bridge = [];
  });

  await resizeSelectedElement(page, "se", 32, 18);
  const message = await waitForBridge(page, "visual-style-change");
  const styles = message?.styles ?? {};

  expect(message.selector ?? "").toContain("data-agent-native-node-id");
  expect(styles.width ?? "").not.toBe("");
  expect(styles.height ?? "").not.toBe("");
  expect(styles.position ?? "").not.toBe("");
  expect((message.payload?.tagName ?? "").toUpperCase()).toBe("BUTTON");
  expect(String(message.payload?.textContent ?? "")).toContain("Alpha Button");
});

test("can capture a screenshot of inspector coverage via CDP", async ({
  page,
}, info) => {
  const out = info.outputPath("inspector-styles.png");
  await cdpScreenshot(page, out);
  await info.attach("inspector-styles", {
    path: out,
    contentType: "image/png",
  });
});
