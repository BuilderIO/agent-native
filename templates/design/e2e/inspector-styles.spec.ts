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

async function dragScrubInputLabel(
  scope: Page | Locator,
  label: string,
  dx: number,
): Promise<void> {
  const input = scope.locator(`input[aria-label="${cssAttrValue(label)}" i]`);
  await expect(input).toBeVisible();
  const id = await input.first().getAttribute("id");
  if (!id) throw new Error(`missing input id for ${label}`);
  const scrubLabel = scope.locator(`label[for="${cssAttrValue(id)}"]`);
  await expect(scrubLabel).toBeVisible();
  const box = await scrubLabel.first().boundingBox();
  if (!box) throw new Error(`missing scrub label box for ${label}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await pageMouse(scope).move(x, y);
  await pageMouse(scope).down();
  await pageMouse(scope).move(x + dx, y, { steps: 8 });
  await pageMouse(scope).up();
}

function pageMouse(scope: Page | Locator): Page["mouse"] {
  return "mouse" in scope ? scope.mouse : scope.page().mouse;
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

async function resolvedColorChannels(
  page: Page,
  value: string,
): Promise<{ rgb: [number, number, number]; alpha: number }> {
  return page.evaluate((color) => {
    const probe = document.createElement("span");
    probe.style.color = color;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const channels = resolved.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (channels.length < 3) {
      throw new Error(`Could not resolve color channels for ${color}`);
    }
    return {
      rgb: [channels[0]!, channels[1]!, channels[2]!],
      alpha: channels[3] ?? 1,
    };
  }, value);
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

test("page background exposes image controls and accepts a tiled image URL", async ({
  page,
}) => {
  await page.keyboard.press("Escape");
  const pageSection = pagePropertiesSection(page);
  await expect(pageSection).toBeVisible();

  await openColorPicker(pageSection);
  await choosePaintType(page, "Image");
  await setScrubInput(page, "Image URL", "/icon-180.svg");
  await page.getByRole("combobox", { name: "Fill", exact: true }).click();
  await page.getByRole("option", { name: "Tile", exact: true }).click();

  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-image"))
    .toContain("/icon-180.svg");
  await expect
    .poll(() => readInlineStyle(page, bodyElement(page), "background-image"))
    .toContain("linear-gradient");
  await expect
    .poll(async () =>
      (await readInlineStyle(page, bodyElement(page), "background-repeat"))
        .split(",")[0]
        ?.trim(),
    )
    .toBe("repeat");
  await expect
    .poll(async () =>
      (await readInlineStyle(page, bodyElement(page), "background-position"))
        .split(",")[0]
        ?.trim(),
    )
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
  const initialChannels = await resolvedColorChannels(page, initialColor);

  await expect(hideFillButton).toBeVisible();
  await expect(
    fillSection.locator('button[aria-label="Remove layer"]').first(),
  ).toBeVisible();

  await hideFillButton.click();
  await expect
    .poll(async () => {
      const hiddenColor = await selectedElementStyle(
        page,
        "E2E Hero Heading",
        "color",
      );
      return resolvedColorChannels(page, hiddenColor);
    })
    .toEqual({ rgb: initialChannels.rgb, alpha: 0 });
  await expect(showFillButton).toBeVisible();

  await showFillButton.click();
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "color"))
    .toBe(initialColor);
  await expect(heading).toBeVisible();
});

test("style layer row actions stay visible and toggle visibility state", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");

  const strokeSection = inspectorSection(page, /^Stroke$/i);
  await strokeSection.getByRole("button", { name: "Add layer" }).click();
  const hideStrokeButton = strokeSection
    .locator('button[aria-label="Hide layer"]')
    .first();
  const removeStrokeButton = strokeSection
    .locator('button[aria-label="Remove layer"]')
    .first();
  await expect(hideStrokeButton).toBeVisible();
  await expect(removeStrokeButton).toBeVisible();

  await hideStrokeButton.click();
  await expect(
    strokeSection.locator('button[aria-label="Show layer"]').first(),
  ).toBeVisible();

  const effectsSection = inspectorSection(page, /^Effects$/i);
  await effectsSection.getByRole("button", { name: "Add layer" }).click();
  await page.getByRole("menuitem", { name: "Drop shadow" }).click();
  const hideEffectButton = effectsSection
    .locator('button[aria-label="Hide layer"]')
    .first();
  const removeEffectButton = effectsSection
    .locator('button[aria-label="Remove layer"]')
    .first();
  await expect(hideEffectButton).toBeVisible();
  await expect(removeEffectButton).toBeVisible();

  await hideEffectButton.click();
  await expect(
    effectsSection.locator('button[aria-label="Show layer"]').first(),
  ).toBeVisible();
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "box-shadow"))
    .toContain("rgba(0, 0, 0, 0)");
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

test("numeric scrub handles use terse tooltips and drag from compact labels", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");
  const input = page.locator('input[aria-label="X-position" i]');
  await expect(input).toBeVisible();
  const initial = parseFloat(await input.inputValue());

  const id = await input.first().getAttribute("id");
  expect(id).toBeTruthy();
  const label = page.locator(`label[for="${cssAttrValue(id!)}"]`);
  await label.hover();
  await expect(page.getByRole("tooltip")).toHaveText("X-position");
  await expect(label).toHaveCSS("border-top-right-radius", "0px");
  await expect(label).toHaveCSS("border-bottom-right-radius", "0px");

  await dragScrubInputLabel(page, "X-position", 16);

  await expect
    .poll(async () => parseFloat(await input.inputValue()))
    .toBeGreaterThan(initial);
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toMatch(/px$/);

  const rotationInput = page.locator('input[aria-label="Rotation" i]');
  await expect(rotationInput).toBeVisible();
  const rotationId = await rotationInput.first().getAttribute("id");
  expect(rotationId).toBeTruthy();
  const rotationLabel = page.locator(
    `label[for="${cssAttrValue(rotationId!)}"]`,
  );
  await expect(rotationLabel.locator("svg")).toBeVisible();
  await expect(rotationLabel).toHaveCSS("border-top-right-radius", "0px");
  await expect(rotationLabel).toHaveCSS("border-bottom-right-radius", "0px");

  const constraintsTrigger = page.getByRole("button", {
    name: "Constraints",
  });
  const horizontalConstraints = page.getByRole("combobox", {
    name: "Horizontal",
  });
  const verticalConstraints = page.getByRole("combobox", { name: "Vertical" });
  await expect(constraintsTrigger).toBeVisible();
  await expect(constraintsTrigger).toHaveAttribute("aria-pressed", "false");
  await expect(horizontalConstraints).toBeHidden();

  await constraintsTrigger.click();
  await expect(constraintsTrigger).toHaveAttribute("aria-pressed", "true");
  await expect(horizontalConstraints).toBeVisible();
  await expect(verticalConstraints).toBeVisible();

  await constraintsTrigger.click();
  await expect(constraintsTrigger).toHaveAttribute("aria-pressed", "false");
  await expect(horizontalConstraints).toBeHidden();
});

test("appearance controls use droplet blend menu and inline independent corners", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");
  const appearanceSection = inspectorSection(page, /^Appearance$/i);
  await expect(appearanceSection).toBeVisible();
  await expect(
    appearanceSection.getByRole("combobox", { name: /Normal|Blend/i }),
  ).toHaveCount(0);

  await appearanceSection.getByRole("button", { name: "Blend mode" }).click();
  await expect(
    page.getByRole("menuitem", { name: /Pass through/i }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Normal", exact: true }).click();
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "isolation"))
    .toBe("isolate");

  await appearanceSection.getByRole("button", { name: "Blend mode" }).click();
  await page.getByRole("menuitem", { name: /Pass through/i }).click();
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "isolation"))
    .toBe("auto");

  const radiusInput = appearanceSection.locator(
    'input[aria-label="Corner radius" i]',
  );
  await setScrubInput(appearanceSection, "Corner radius", "12");
  await expect(radiusInput).toHaveValue("12");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "border-radius"))
    .toContain("12px");

  await appearanceSection
    .getByRole("button", { name: "Independent corners" })
    .click();
  await expect(
    appearanceSection.locator('input[aria-label="Top left" i]'),
  ).toBeVisible();
  await setScrubInput(appearanceSection, "Top left", "4");
  await expect
    .poll(() =>
      selectedElementStyle(page, "Alpha Button", "border-top-left-radius"),
    )
    .toBe("4px");
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
