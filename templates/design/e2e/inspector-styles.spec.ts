import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  createFixtureDesign,
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
  return inspectorSection(page, /^Screen$/);
}

async function selectLayerFromTree(page: Page, name: string): Promise<void> {
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
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
    .evaluate((el, name) => {
      const node = el as HTMLElement;
      const styled = node.hasAttribute("data-an-text")
        ? (node.parentElement ?? node)
        : node;
      return (
        styled.style.getPropertyValue(name) ||
        window.getComputedStyle(styled).getPropertyValue(name)
      );
    }, property);
}

async function readDesignSource(page: Page, designId: string): Promise<string> {
  const response = await page.request.get(
    new URL("/_agent-native/actions/read-source-file", page.url()).href,
    { params: { designId, path: "index.html" } },
  );
  if (!response.ok()) {
    throw new Error(`read-source-file failed: ${response.status()}`);
  }
  const result = (await response.json()) as { content: string };
  return result.content;
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

// Unreachable standalone, not broken: the page-background section renders only
// at `scope === "document"`, which resolveBackgroundPanelScope grants for
// viewMode "single" + mode "edit" — and standalone, "single" is the Interact
// view, so only a host-embedded editor gets there. Belongs with the
// host-embedded shell specs, not here. The infinite render loop this used to
// hit was a real bug and is fixed (DesignColorPicker.gradient-loop.test.tsx).
test.fixme("page background supports gradient edits", async ({ page }) => {
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

// Same document-scope gate as the gradient test above.
test.fixme("page background exposes image controls and accepts a tiled image URL", async ({
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
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const fillOpacity = page.getByRole("spinbutton", {
    name: "Opacity",
    exact: true,
  });
  await fillOpacity.fill("50");
  await fillOpacity.press("Enter");
  await page.keyboard.press("Escape");

  const initialColor = await selectedElementStyle(
    page,
    "E2E Hero Heading",
    "color",
  );
  expect(initialColor).not.toBe("");
  const initialChannels = await resolvedColorChannels(page, initialColor);
  expect(initialChannels.alpha).toBe(0.5);

  await expect(hideFillButton).toBeVisible();
  await expect(
    fillSection.locator('button[aria-label="Remove layer"]').first(),
  ).toBeVisible();
  await expect(
    fillSection.getByRole("button", { name: "Add fill" }),
  ).toHaveCount(0);

  await hideFillButton.click();
  await expect
    .poll(async () => {
      const hiddenColor = await selectedElementStyle(
        page,
        "E2E Hero Heading",
        "color",
      );
      return (await resolvedColorChannels(page, hiddenColor)).alpha;
    })
    .toBe(0);
  await expect(showFillButton).toBeVisible();

  await page.reload();
  await selectLayerFromTree(page, "E2E Hero Heading");
  await expect(showFillButton).toBeVisible();
  await showFillButton.click();
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "color"))
    .toBe(initialColor);
  await expect(heading).toBeVisible();
});

test("selection hide and Appearance visibility stay in sync with opacity", async ({
  page,
}) => {
  await selectByText(page, "E2E Hero Heading");
  const appearanceSection = inspectorSection(page, /^Appearance$/i);
  const layerRow = page
    .getByRole("treeitem")
    .filter({ hasText: "E2E Hero Heading" })
    .first();
  const shortcut =
    process.platform === "darwin" ? "Meta+Shift+h" : "Control+Shift+h";
  const initialDisplay = await selectedElementStyle(
    page,
    "E2E Hero Heading",
    "display",
  );
  const initialOpacity = await selectedElementStyle(
    page,
    "E2E Hero Heading",
    "opacity",
  );

  await page.keyboard.press(shortcut);
  await expect(
    appearanceSection.getByRole("button", { name: "Show", exact: true }),
  ).toBeVisible();
  await expect(
    layerRow.locator('button[aria-label="Show layer"]'),
  ).toBeVisible();

  await appearanceSection
    .getByRole("button", { name: "Show", exact: true })
    .click();
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "display"))
    .toBe(initialDisplay);

  await appearanceSection
    .getByRole("button", { name: "Hide", exact: true })
    .click();
  await expect(
    layerRow.locator('button[aria-label="Show layer"]'),
  ).toBeVisible();
  await page.keyboard.press(shortcut);
  await expect(
    layerRow.locator('button[aria-label="Hide layer"]'),
  ).toBeVisible();
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "display"))
    .toBe(initialDisplay);

  await setScrubInput(appearanceSection, "Opacity", "0");
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "opacity"))
    .toBe("0");
  await expect(
    appearanceSection.getByRole("button", { name: "Hide", exact: true }),
  ).toBeVisible();

  await setScrubInput(
    appearanceSection,
    "Opacity",
    String(Number.parseFloat(initialOpacity) * 100),
  );
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "opacity"))
    .toBe(initialOpacity);
  await expect
    .poll(async () =>
      /<h1[^>]*data-agent-native-hidden="true"[^>]*>\s*E2E Hero Heading/.test(
        await readDesignSource(page, designId),
      ),
    )
    .toBe(false);
});

test("text gradient apply and removal survive reselection; box gradient editor persists", async ({
  page,
}) => {
  const fillDesignId = await createFixtureDesign(
    page,
    `Fill gradient regression ${Date.now()}`,
  );
  await gotoEditor(page, fillDesignId);

  const headingText = "E2E Hero Heading";
  await selectByText(page, headingText);
  const originalTextColor = await selectedElementStyle(
    page,
    headingText,
    "color",
  );
  const textFillSection = inspectorSection(page, /^Fill$/i);
  await openColorPicker(textFillSection);
  await choosePaintType(page, "Linear");

  await expect
    .poll(() => selectedElementStyle(page, headingText, "background-image"))
    .toContain("linear-gradient(");
  await expect
    .poll(() => selectedElementStyle(page, headingText, "background-clip"))
    .toBe("text");
  await expect
    .poll(() => selectedElementStyle(page, headingText, "color"))
    .toBe("transparent");
  await expect
    .poll(() => readDesignSource(page, fillDesignId))
    .toContain("linear-gradient(");
  const sourceAfterApply = await readDesignSource(page, fillDesignId);
  const headingStart = sourceAfterApply.indexOf("<h1");
  const headingTagEnd = sourceAfterApply.indexOf(">", headingStart);
  expect(sourceAfterApply.slice(headingStart, headingTagEnd)).toContain(
    "linear-gradient(",
  );

  await selectLayerFromTree(
    page,
    "First fixture paragraph for selection tests.",
  );
  await selectLayerFromTree(page, headingText);
  const sourceAfterReselection = await readDesignSource(page, fillDesignId);
  const reselectedHeadingStart = sourceAfterReselection.indexOf("<h1");
  const reselectedHeadingTagEnd = sourceAfterReselection.indexOf(
    ">",
    reselectedHeadingStart,
  );
  expect(
    sourceAfterReselection.slice(
      reselectedHeadingStart,
      reselectedHeadingTagEnd,
    ),
  ).toContain("linear-gradient(");
  await expect
    .poll(() => selectedElementStyle(page, headingText, "background-image"))
    .toContain("linear-gradient(");
  await expect(
    textFillSection.getByRole("button", { name: "Linear gradient 1" }),
  ).toBeVisible();
  await textFillSection
    .getByRole("button", { name: "Linear gradient 1" })
    .click();
  await expect(
    page.locator('input[aria-label="Gradient angle"]'),
  ).toBeVisible();

  await textFillSection
    .getByRole("button", { name: "Remove layer" })
    .nth(1)
    .click();
  await expect
    .poll(() => selectedElementStyle(page, headingText, "background-image"))
    .toBe("none");
  await expect
    .poll(() => selectedElementStyle(page, headingText, "background-clip"))
    .toBe("border-box");
  await expect
    .poll(() => selectedElementStyle(page, headingText, "color"))
    .toBe(originalTextColor);

  const boxText = "Alpha Button";
  await selectByText(page, boxText);
  const boxFillSection = inspectorSection(page, /^Fill$/i);
  await openColorPicker(boxFillSection);
  await choosePaintType(page, "Linear");

  await expect
    .poll(() => selectedElementStyle(page, boxText, "background-image"))
    .toContain("linear-gradient(");
  await expect
    .poll(() => selectedElementStyle(page, boxText, "background-color"))
    .toBe("transparent");

  await selectLayerFromTree(
    page,
    "First fixture paragraph for selection tests.",
  );
  await selectLayerFromTree(page, boxText);
  await expect(
    boxFillSection.getByRole("button", { name: "Linear gradient 1" }),
  ).toBeVisible();
  await boxFillSection
    .getByRole("button", { name: "Linear gradient 1" })
    .click();
  await expect(
    page.locator('input[aria-label="Gradient angle"]'),
  ).toBeVisible();
});

test("style layer row actions stay visible and toggle visibility state", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");

  const effectsSection = inspectorSection(page, /^Effects$/i);
  await effectsSection.getByRole("button", { name: "Add effect" }).click();
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
    typographySection.getByRole("button", { name: "Font" }),
  ).toContainText(/\S/);
  await expect(
    typographySection.getByRole("button", { name: "Auto width" }),
  ).toHaveCount(0);
  await typographySection
    .getByRole("button", { name: "Typography details" })
    .click();
  const typographyDetails = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("tablist") })
    .first();
  await expect(
    typographyDetails.getByText("Preview", { exact: true }),
  ).toBeVisible();
  await expect(
    typographyDetails.getByRole("button", { name: "Auto width" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await setScrubInput(typographySection, "Size", "52");
  await setScrubInput(typographySection, "Line height", "125%");
  await setScrubInput(typographySection, "Letter spacing", "2");

  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "font-size"))
    .toBe("52px");
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "line-height"))
    .toBe("125%");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("2px");

  await setScrubInput(typographySection, "Letter spacing", "2%");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("0.02em");
  await expect(
    typographySection.locator('input[aria-label="Letter spacing" i]'),
  ).toHaveValue("2%");
  await setScrubInput(typographySection, "Letter spacing", "0.64px");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("0.64px");

  await setScrubInput(typographySection, "Letter spacing", "0.01%");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("0.0001em");
  await expect(
    typographySection.locator('input[aria-label="Letter spacing" i]'),
  ).toHaveValue("0.01%");

  await setScrubInput(typographySection, "Letter spacing", "0.005em");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("0.005em");
  await expect(
    typographySection.locator('input[aria-label="Letter spacing" i]'),
  ).toHaveValue("0.5%");

  await setScrubInput(typographySection, "Letter spacing", "2pxpx");
  await expect
    .poll(() =>
      selectedElementStyle(page, "E2E Hero Heading", "letter-spacing"),
    )
    .toBe("0.005em");
  await expect(
    typographySection.locator('input[aria-label="Letter spacing" i]'),
  ).toHaveValue("0.5%");
});

test("search selects Lato Medium and keeps custom font names offline", async ({
  page,
}) => {
  await selectByText(page, "E2E Hero Heading");
  const typographySection = inspectorSection(page, /^Typography$/i);
  const fontPicker = typographySection.getByRole("button", { name: "Font" });
  const latoMediumUrl =
    "https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/lato/Lato-Medium.ttf";

  await fontPicker.click();
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("Lato");
  const latoOption = page.getByRole("option", { name: "Lato", exact: true });
  await expect(latoOption).toBeVisible();
  const mediumFontResponse = page.waitForResponse(
    (response) => response.url() === latoMediumUrl,
  );
  await latoOption.click();
  expect(await (await mediumFontResponse).status()).toBe(200);

  const loadedFaces = await designFrame(page)
    .locator("body")
    .evaluate(async (body) => {
      const faces = await body.ownerDocument.fonts.load(
        '500 16px "Lato"',
        "Card",
      );
      return faces.map((face) => ({
        family: face.family,
        weight: face.weight,
        status: face.status,
      }));
    });
  expect(loadedFaces).toContainEqual({
    family: "Lato",
    weight: "500",
    status: "loaded",
  });

  await page.reload();
  await selectLayerFromTree(page, "E2E Hero Heading");
  const persistedFrame = designFrame(page);
  await expect(
    persistedFrame.locator('style[data-agent-native-font-face="Lato-500"]'),
  ).toHaveCount(1);
  await expect(
    inspectorSection(page, /^Typography$/i).getByRole("button", {
      name: "Font",
    }),
  ).toContainText("Lato");

  await fontPicker.click();
  await search.fill("Custom Display Face");
  const customOption = page.getByRole("option", {
    name: "Custom Display Face",
    exact: true,
  });
  await expect(customOption).toBeVisible();
  await customOption.click();
  await expect
    .poll(() => selectedElementStyle(page, "E2E Hero Heading", "font-family"))
    .toContain("Custom Display Face");
  await expect(
    persistedFrame.locator(
      'link[href*="fonts.googleapis.com"][href*="Custom"]',
    ),
  ).toHaveCount(0);
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

test("numeric input applies Figma math and starts an Option scrub drag", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");
  const input = page.locator('input[aria-label="X-position" i]');
  await expect(input).toBeVisible();

  await input.fill("-5");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("-5px");
  await expect(input).toHaveValue("-5px");

  await input.fill("+5");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("5px");

  await input.fill("*2");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("5px");
  await expect(input).toHaveValue("5px");

  await input.fill("(10+5)*2");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("30px");

  await input.fill("2^3");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("8px");

  await input.fill("10");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("10px");
  await input.click();
  await input.press("ArrowRight");
  await input.pressSequentially("*2");
  await expect(input).toHaveValue("10px*2");
  await input.press("Enter");
  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("20px");

  const box = await input.boundingBox();
  if (!box) throw new Error("missing X-position input bounds");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y);
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect
    .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
    .toBe("25px");
  await expect(input).toHaveValue("25px");
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

test("pointercancel restores a scrubbed value without adding a history step", async ({
  page,
}) => {
  const scratchDesignId = await createFixtureDesign(
    page,
    `Scrub pointer cancel ${Date.now()}`,
  );
  try {
    await gotoEditor(page, scratchDesignId);
    await selectByText(page, "Alpha Button");
    const input = page.locator('input[aria-label="X-position" i]');
    await expect(input).toBeVisible();
    const inputId = await input.getAttribute("id");
    if (!inputId) throw new Error("X-position input has no id");
    const label = page.locator(`label[for="${cssAttrValue(inputId)}"]`);
    const initialXText =
      (await input.inputValue()) ||
      (await input.getAttribute("placeholder")) ||
      "";
    const initialX = Number.parseFloat(initialXText);
    if (!Number.isFinite(initialX)) {
      throw new Error(`invalid initial X-position: ${initialXText}`);
    }
    const fixtureX = initialX + 10;
    await input.fill(String(fixtureX));
    await input.press("Enter");
    await expect
      .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
      .toBe(`${fixtureX}px`);

    const originalLeft = await selectedElementStyle(
      page,
      "Alpha Button",
      "left",
    );
    const originalNumber = Number.parseFloat(originalLeft);
    if (!Number.isFinite(originalNumber)) {
      throw new Error(`invalid original X-position: ${originalLeft}`);
    }

    const committedLeft = `${originalNumber + 40}px`;
    await input.fill(String(originalNumber + 40));
    await input.press("Enter");
    await expect(input).toHaveValue(committedLeft);
    await expect
      .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
      .toBe(committedLeft);

    const labelBox = await label.boundingBox();
    if (!labelBox) throw new Error("X-position scrub label is not visible");
    await page.evaluate((id) => {
      const target = document.querySelector<HTMLLabelElement>(
        `label[for="${CSS.escape(id)}"]`,
      );
      if (!target) throw new Error("X-position scrub label disappeared");
      (
        window as Window & { __qaScrubPointerId?: number | null }
      ).__qaScrubPointerId = null;
      target.addEventListener(
        "pointerdown",
        (event) => {
          (
            window as Window & { __qaScrubPointerId?: number | null }
          ).__qaScrubPointerId = event.pointerId;
        },
        { capture: true, once: true },
      );
    }, inputId);

    const startX = labelBox.x + labelBox.width / 2;
    const startY = labelBox.y + labelBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 32, startY, { steps: 8 });
    await expect.poll(() => input.inputValue()).not.toBe(committedLeft);

    const cancelled = await page.evaluate((id) => {
      const target = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const pointerId = (
        window as Window & { __qaScrubPointerId?: number | null }
      ).__qaScrubPointerId;
      if (!target || pointerId == null) {
        throw new Error("scrub pointerdown was not observed");
      }
      return target.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "mouse",
        }),
      );
    }, inputId);
    expect(cancelled).toBe(true);
    await expect(input).toHaveValue(committedLeft);
    await expect
      .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
      .toBe(committedLeft);
    await page.mouse.up();

    await page.keyboard.press("ControlOrMeta+z");
    await expect(input).toHaveValue(originalLeft);
    await expect
      .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
      .toBe(originalLeft);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(input).toHaveValue(committedLeft);
    await expect
      .poll(() => selectedElementStyle(page, "Alpha Button", "left"))
      .toBe(committedLeft);
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: scratchDesignId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
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
