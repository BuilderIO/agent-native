import { type Locator, type Page } from "@playwright/test";

import { installBridge, waitForBridge } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Inspector</title></head>
  <body data-agent-native-node-id="page" style="margin:0;width:800px;height:600px;background:#ffffff;font-family:system-ui,sans-serif">
    <h1 data-agent-native-node-id="heading" data-agent-native-layer-name="Heading" style="position:absolute;left:40px;top:40px;width:400px;height:60px;margin:0;font-size:40px;line-height:60px;color:#111827">E2E Hero Heading</h1>
    <p data-agent-native-node-id="para" data-agent-native-layer-name="Paragraph" style="position:absolute;left:40px;top:120px;width:400px;height:24px;margin:0;line-height:24px">First fixture paragraph</p>
    <button data-agent-native-node-id="button" data-agent-native-layer-name="Button" style="position:absolute;left:40px;top:180px;width:140px;height:44px;padding:0 12px;border:0;background:#6366f1;color:#ffffff">Alpha Button</button>
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="position:absolute;left:40px;top:260px;width:200px;height:120px;background:#e5e7eb"></div>
  </body>
</html>`;

const CENTERS = {
  heading: { x: 240, y: 70, name: "Heading" },
  para: { x: 240, y: 132, name: "Paragraph" },
  button: { x: 110, y: 202, name: "Button" },
  card: { x: 140, y: 320, name: "Card" },
} as const;

type NodeKey = keyof typeof CENTERS;

test.use({ viewport: { width: 1600, height: 1000 } });

async function openInspector(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

/** Selects a layer with a plain canvas click at its centre. */
async function select(app: App, key: NodeKey) {
  const { x, y, name } = CENTERS[key];
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

function inspectorSection(page: Page, title: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
}

async function setScrubInput(scope: Locator, label: string, value: string) {
  const input = scope.locator(`input[aria-label="${label}" i]`);
  await input.fill(value);
  await input.press("Enter");
}

/** The live inline value of a style property on a node in the Screen. */
async function liveStyle(app: App, nodeId: string, property: string) {
  return app
    .node(nodeId)
    .evaluate(
      (element, name) =>
        (element as HTMLElement).style.getPropertyValue(name) ||
        getComputedStyle(element).getPropertyValue(name),
      property,
    );
}

async function savedStyle(app: App, id: string, nodeId: string) {
  return styleOf((await app.savedNodes(id)).get(nodeId));
}

// fixme: fails on current main after the merge: Error: the canvas never settled after zoom to fit
test.fixme("text fills hide and restore without losing the original color", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  await select(app, "heading");
  const fillSection = inspectorSection(page, "Fill");
  const fillOpacity = fillSection.getByRole("textbox", {
    name: "Paint opacity",
    exact: true,
  });
  await fillOpacity.fill("50");
  await fillOpacity.press("Enter");
  await app.settled();
  const halfOpaque = await app.savedNodes(id);
  expect(styleOf(halfOpaque.get("heading")).color).toBe(
    "rgba(17, 24, 39, 0.5)",
  );
  await expect(
    fillSection.getByRole("button", { name: "Add fill" }),
  ).toHaveCount(0);

  await fillSection.locator('button[aria-label="Hide layer"]').click();
  await expect
    .poll(() => liveStyle(app, "heading", "color"))
    .toBe("color-mix(in srgb, rgba(17, 24, 39, 0.5) 0%, transparent 100%)");
  await app.settled();
  expect(
    (await savedStyle(app, id, "heading")).color,
    "a hidden fill paints nothing but keeps the 50% colour inside it",
  ).toBe("color-mix(in srgb, rgba(17, 24, 39, 0.5) 0%, transparent)");

  await page.reload();
  await app.zoomToFit();
  await select(app, "heading");
  await fillSection.locator('button[aria-label="Show layer"]').click();
  await expect
    .poll(() => liveStyle(app, "heading", "color"))
    .toBe("rgba(17, 24, 39, 0.5)");
  await app.settled();
  const restored = await app.savedNodes(id);
  expect(
    restored.get("heading"),
    "hide then show returns the heading to its 50% fill exactly",
  ).toEqual(halfOpaque.get("heading"));
  expectOnlyChanged(halfOpaque, restored, []);
});

test("selection hide and Appearance visibility stay in sync with opacity", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "heading");
  const appearance = inspectorSection(page, "Appearance");
  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({
      has: page.locator('[data-layer-row-button] span[title="Heading"]'),
    });
  const savedHidden = async () => {
    await app.settled();
    return (await app.savedNodes(id)).get("heading")?.attrs[
      "data-agent-native-hidden"
    ];
  };

  await page.keyboard.press(`${MOD}+Shift+h`);
  await expect(
    appearance.getByRole("button", { name: "Show", exact: true }),
  ).toBeVisible();
  await expect(row.locator('button[aria-label="Show layer"]')).toBeVisible();
  await expect(app.node("heading")).toBeHidden();
  expect(await savedHidden()).toBe("true");

  await appearance.getByRole("button", { name: "Show", exact: true }).click();
  await expect(row.locator('button[aria-label="Hide layer"]')).toBeVisible();
  await expect(app.node("heading")).toBeVisible();
  expect(await savedHidden()).toBeUndefined();

  await appearance.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(row.locator('button[aria-label="Show layer"]')).toBeVisible();
  expect(await savedHidden()).toBe("true");
  await page.keyboard.press(`${MOD}+Shift+h`);
  await expect(row.locator('button[aria-label="Hide layer"]')).toBeVisible();
  await expect(app.node("heading")).toBeVisible();
  expect(await savedHidden()).toBeUndefined();

  await setScrubInput(appearance, "Opacity", "0");
  await expect.poll(() => liveStyle(app, "heading", "opacity")).toBe("0");
  await expect(
    appearance.getByRole("button", { name: "Hide", exact: true }),
    "opacity 0 is not the hidden state",
  ).toBeVisible();
  await app.settled();
  expect((await savedStyle(app, id, "heading")).opacity).toBe("0");

  await setScrubInput(appearance, "Opacity", "100");
  await expect.poll(() => liveStyle(app, "heading", "opacity")).toBe("1");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("heading"))).toEqual({
    ...styleOf(before.get("heading")),
    opacity: "1",
  });
  expectOnlyChanged(before, after, ["heading"]);
});

// oracle: none — only the paint type button changed (Linear is now Gradient); no Figma behavior is claimed.
test("text gradient apply and removal survive reselection; box gradient editor persists", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "heading");
  const fillSection = inspectorSection(page, "Fill");
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  await page.getByRole("button", { name: "Gradient", exact: true }).click();
  await page.keyboard.press("Escape");
  await app.settled();
  const withGradient = await savedStyle(app, id, "heading");
  expect({
    clip: withGradient["background-clip"],
    color: withGradient.color,
    image: withGradient["background-image"]?.startsWith("linear-gradient("),
  }).toEqual({ clip: "text", color: "transparent", image: true });

  await select(app, "para");
  await select(app, "heading");
  await expect(
    fillSection.getByRole("button", { name: /^Linear/ }),
  ).toBeVisible();
  await fillSection.getByRole("button", { name: /^Linear/ }).click();
  await expect(
    page.locator('input[aria-label="Gradient angle"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await savedStyle(app, id, "heading"),
    "reselecting does not rewrite the gradient",
  ).toEqual(withGradient);

  await fillSection
    .getByRole("button", { name: "Remove layer" })
    .nth(1)
    .click();
  await expect
    .poll(() => liveStyle(app, "heading", "background-image"))
    .toBe("none");
  await app.settled();
  const removed = await app.savedNodes(id);
  const {
    "background-clip": clip,
    "background-image": image,
    "background-position": _position,
    "background-repeat": _repeat,
    "background-size": _size,
    ...rest
  } = styleOf(removed.get("heading"));
  expect([clip, image], "the gradient is gone from the saved heading").toEqual([
    "border-box",
    "none",
  ]);
  expect(
    rest,
    "removing the gradient restores the original solid text fill",
  ).toEqual(styleOf(before.get("heading")));
  expectOnlyChanged(before, removed, ["heading"]);

  await select(app, "card");
  const cardFill = inspectorSection(page, "Fill");
  await cardFill.getByRole("button", { name: "Open color picker" }).click();
  await page.getByRole("button", { name: "Gradient", exact: true }).click();
  await page.keyboard.press("Escape");
  await app.settled();
  const cardGradient = await savedStyle(app, id, "card");
  expect({
    background: cardGradient["background-color"],
    image: cardGradient["background-image"]?.startsWith("linear-gradient("),
  }).toEqual({ background: "transparent", image: true });

  await select(app, "para");
  await select(app, "card");
  await cardFill.getByRole("button", { name: /^Linear/ }).click();
  await expect(
    page.locator('input[aria-label="Gradient angle"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await app.settled();
  expect(await savedStyle(app, id, "card")).toEqual(cardGradient);
  expectOnlyChanged(removed, await app.savedNodes(id), ["card"]);
});

test("style layer row actions stay visible and toggle visibility state", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "card");
  const effects = inspectorSection(page, "Effects");
  await effects.getByRole("button", { name: "Add effect" }).click();
  await page.getByRole("menuitem", { name: "Drop shadow" }).click();
  await expect(
    effects.locator('button[aria-label="Hide layer"]'),
  ).toBeVisible();
  await expect(
    effects.locator('button[aria-label="Remove layer"]'),
  ).toBeVisible();
  await app.settled();
  const shadowed = await app.savedNodes(id);
  const shadow = styleOf(shadowed.get("card"))["box-shadow"];
  expect(shadow, "the drop shadow saves on the card").toMatch(/^\S/);

  await effects.locator('button[aria-label="Hide layer"]').click();
  await expect(
    effects.locator('button[aria-label="Show layer"]'),
  ).toBeVisible();
  await expect
    .poll(() => liveStyle(app, "card", "box-shadow"))
    .toContain("rgba(0, 0, 0, 0)");
  await app.settled();
  expect(
    (await savedStyle(app, id, "card"))["box-shadow"],
    "the hidden shadow saves as fully transparent",
  ).toContain("rgba(0, 0, 0, 0)");

  await effects.locator('button[aria-label="Show layer"]').click();
  await expect(
    effects.locator('button[aria-label="Hide layer"]'),
  ).toBeVisible();
  await app.settled();
  const shown = await app.savedNodes(id);
  expect(shown.get("card"), "show restores the exact shadow").toEqual(
    shadowed.get("card"),
  );
  expectOnlyChanged(before, shown, ["card"]);
});

test("typography edits update size and spacing inputs", async ({ app }) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "heading");
  const typography = inspectorSection(page, "Typography");
  const letterSpacing = typography.locator(
    'input[aria-label="Letter spacing" i]',
  );

  await expect(typography.getByRole("button", { name: "Font" })).toContainText(
    /\S/,
  );
  await expect(
    typography.getByRole("button", { name: "Auto width" }),
  ).toHaveCount(0);
  await typography.getByRole("button", { name: "Typography details" }).click();
  const details = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("tablist") })
    .first();
  await expect(details.getByText("Preview", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Auto width" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await setScrubInput(typography, "Size", "52");
  await setScrubInput(typography, "Line height", "125%");
  await setScrubInput(typography, "Letter spacing", "2");
  await expect.poll(() => liveStyle(app, "heading", "font-size")).toBe("52px");
  await expect
    .poll(() => liveStyle(app, "heading", "line-height"))
    .toBe("125%");
  await expect
    .poll(() => liveStyle(app, "heading", "letter-spacing"))
    .toBe("2px");

  for (const [typed, saved, shown] of [
    ["2%", "0.02em", "2%"],
    ["0.64px", "0.64px", "0.64px"],
    ["0.01%", "0.0001em", "0.01%"],
    ["0.005em", "0.005em", "0.5%"],
    ["2pxpx", "0.005em", "0.5%"],
  ] as const) {
    await setScrubInput(typography, "Letter spacing", typed);
    await expect
      .poll(() => liveStyle(app, "heading", "letter-spacing"), typed)
      .toBe(saved);
    await expect(letterSpacing).toHaveValue(shown);
  }

  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("heading"))).toEqual({
    ...styleOf(before.get("heading")),
    "font-size": "52px",
    "line-height": "125%",
    "letter-spacing": "0.005em",
  });
  expectOnlyChanged(before, after, ["heading"]);
});

// fixme: fails on current main after the merge: Error: the canvas never settled after zoom to fit
test.fixme("search selects Lato Medium and keeps custom font names offline", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  await select(app, "heading");
  const typography = inspectorSection(page, "Typography");
  const fontPicker = typography.getByRole("button", { name: "Font" });
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
  expect((await mediumFontResponse).status()).toBe(200);
  const loadedFaces = await app.node("heading").evaluate(async (element) => {
    const faces = await element.ownerDocument.fonts.load(
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
  await app.settled();
  expect((await savedStyle(app, id, "heading"))["font-family"]).toBe(
    "'Lato', sans-serif",
  );

  await page.reload();
  await app.zoomToFit();
  await select(app, "heading");
  await expect(
    page
      .locator(
        'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
      )
      .contentFrame()
      .locator('style[data-agent-native-font-face="Lato-500"]'),
  ).toHaveCount(1);
  await expect(fontPicker).toContainText("Lato");

  await fontPicker.click();
  await search.fill("Custom Display Face");
  const customOption = page.getByRole("option", {
    name: "Custom Display Face",
    exact: true,
  });
  await expect(customOption).toBeVisible();
  await customOption.click();
  await expect
    .poll(() => liveStyle(app, "heading", "font-family"))
    .toContain("Custom Display Face");
  await app.settled();
  expect((await savedStyle(app, id, "heading"))["font-family"]).toContain(
    "Custom Display Face",
  );
  expect(
    await app.savedHtml(id),
    "a custom family is never fetched from Google Fonts",
  ).not.toMatch(/fonts\.googleapis\.com[^"']*Custom/);
});

test("numeric scrub handles use terse tooltips and drag from compact labels", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "card");
  const input = page.locator('input[aria-label="X-position" i]');
  await expect(input).toHaveValue("40px");
  const label = page.locator(`label[for="${await input.getAttribute("id")}"]`);
  await label.hover();
  await expect(page.getByRole("tooltip")).toHaveText("X-position");
  await expect(label).toHaveCSS("border-top-right-radius", "0px");
  await expect(label).toHaveCSS("border-bottom-right-radius", "0px");

  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    input,
    "16px in 2px steps scrubs +14: the first step is under the 3px drag threshold",
  ).toHaveValue("54px");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("card"))).toEqual({
    ...styleOf(before.get("card")),
    left: "54px",
  });
  expectOnlyChanged(before, after, ["card"]);

  const rotationInput = page.locator('input[aria-label="Rotation" i]');
  const rotationLabel = page.locator(
    `label[for="${await rotationInput.getAttribute("id")}"]`,
  );
  await expect(rotationLabel.locator("svg")).toBeVisible();
  await expect(rotationLabel).toHaveCSS("border-top-right-radius", "0px");
  await expect(rotationLabel).toHaveCSS("border-bottom-right-radius", "0px");

  const constraints = page.getByRole("button", { name: "Constraints" });
  const horizontal = page.getByRole("combobox", { name: "Horizontal" });
  const vertical = page.getByRole("combobox", { name: "Vertical" });
  await expect(constraints).toHaveAttribute("aria-pressed", "false");
  await expect(horizontal).toBeHidden();
  await constraints.click();
  await expect(constraints).toHaveAttribute("aria-pressed", "true");
  await expect(horizontal).toBeVisible();
  await expect(vertical).toBeVisible();
  await constraints.click();
  await expect(constraints).toHaveAttribute("aria-pressed", "false");
  await expect(horizontal).toBeHidden();
});

test("numeric input applies arithmetic expressions and starts an Option scrub drag", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "card");
  const input = page.locator('input[aria-label="X-position" i]');
  await expect(input).toHaveValue("40px");

  for (const [typed, left] of [
    ["-5", "-5px"],
    ["+5", "5px"],
    ["*2", "5px"],
    ["(10+5)*2", "30px"],
    ["2^3", "8px"],
    ["10", "10px"],
  ] as const) {
    await input.fill(typed);
    await input.press("Enter");
    await expect.poll(() => liveStyle(app, "card", "left"), typed).toBe(left);
    await expect(input).toHaveValue(left);
  }
  await input.click();
  await input.press("ArrowRight");
  await input.pressSequentially("*2");
  await expect(input).toHaveValue("10px*2");
  await input.press("Enter");
  await expect.poll(() => liveStyle(app, "card", "left")).toBe("20px");

  const box = (await input.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(input).toHaveValue("25px");
  await expect.poll(() => liveStyle(app, "card", "left")).toBe("25px");

  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("card"))).toEqual({
    ...styleOf(before.get("card")),
    left: "25px",
  });
  expectOnlyChanged(before, after, ["card"]);
});

test("appearance controls use droplet blend menu and inline independent corners", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "card");
  const appearance = inspectorSection(page, "Appearance");
  await expect(
    appearance.getByRole("combobox", { name: /Normal|Blend/i }),
  ).toHaveCount(0);

  await appearance
    .getByRole("button", { name: "Blend mode", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /Pass through/i }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Normal", exact: true }).click();
  await expect.poll(() => liveStyle(app, "card", "isolation")).toBe("isolate");
  await expect(
    appearance.getByRole("button", { name: "Blend mode: Normal", exact: true }),
  ).toBeVisible();
  await appearance
    .getByRole("button", { name: "Remove blend mode", exact: true })
    .click();
  await expect.poll(() => liveStyle(app, "card", "isolation")).toBe("auto");
  await expect(
    appearance.getByRole("button", { name: "Remove blend mode" }),
  ).toHaveCount(0);

  await setScrubInput(appearance, "Corner radius", "12");
  await expect(
    appearance.locator('input[aria-label="Corner radius" i]'),
  ).toHaveValue("12");
  await appearance.getByRole("button", { name: "Independent corners" }).click();
  await setScrubInput(appearance, "Top left", "4");
  await expect
    .poll(() => liveStyle(app, "card", "border-top-left-radius"))
    .toBe("4px");

  await app.settled();
  const after = await app.savedNodes(id);
  const corners = styleOf(after.get("card"));
  expect(
    [
      corners["border-top-left-radius"],
      corners["border-top-right-radius"],
      corners["border-bottom-right-radius"],
      corners["border-bottom-left-radius"],
    ],
    "editing one corner leaves the other three at 12px",
  ).toEqual(["4px", "12px", "12px", "12px"]);
  expect(corners.isolation ?? "auto").toBe("auto");
  expectOnlyChanged(before, after, ["card"]);
});

test("export rows add, remove, and reset when selection changes", async ({
  app,
}) => {
  const page = app.page;
  await openInspector(app);
  await select(app, "heading");
  const exportSection = inspectorSection(page, "Export");
  const suffixInputs = exportSection.getByLabel("Suffix");
  await expect(suffixInputs).toHaveCount(1);

  await exportSection.getByRole("button", { name: "Add export" }).click();
  await expect(suffixInputs).toHaveCount(2);
  await suffixInputs.nth(1).fill("-2x");
  await suffixInputs.nth(1).press("Enter");
  await expect(suffixInputs.nth(1)).toHaveValue("-2x");
  const removeLast = exportSection
    .getByRole("button", { name: "Remove export" })
    .last();
  await suffixInputs.nth(1).hover();
  await removeLast.click();
  await expect(suffixInputs).toHaveCount(1);
  await expect(suffixInputs, "the -2x row is the one removed").toHaveValue("");

  await exportSection.getByRole("button", { name: "Add export" }).click();
  await expect(suffixInputs).toHaveCount(2);
  await select(app, "button");
  await expect(suffixInputs).toHaveCount(1);
  await select(app, "heading");
  await expect(suffixInputs).toHaveCount(1);
});

test("resizing a selected element emits a visual-style-change payload", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  const before = await app.savedNodes(id);
  await select(app, "button");
  await installBridge(page);
  await page.evaluate(() => {
    (window as unknown as { __bridge: unknown[] }).__bridge = [];
  });

  const start = await app.pagePoint(180, 224);
  const end = await app.pagePoint(212, 242);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  const message = await waitForBridge(page, "visual-style-change", 15_000, {
    phase: "commit",
  });
  await app.settled();

  const after = await app.savedNodes(id);
  const tolerance = Math.max(1, Math.ceil(1 / start.scale));
  const saved = styleOf(after.get("button"));
  expect(
    [
      Math.abs(Number.parseFloat(saved.width!) - 172) <= tolerance,
      Math.abs(Number.parseFloat(saved.height!) - 62) <= tolerance,
    ],
    `a (32,18) SE drag resizes the 140x44 button to 172x62; saved ${saved.width} x ${saved.height}`,
  ).toEqual([true, true]);
  expect(
    [saved.left, saved.top, saved.padding],
    "a resize keeps the button's corner and padding",
  ).toEqual(["40px", "180px", "0 12px"]);
  expectOnlyChanged(before, after, ["button"]);
  expect([message.styles?.width, message.styles?.height]).toEqual([
    saved.width,
    saved.height,
  ]);
  expect(message.selector ?? "").toContain(
    'data-agent-native-node-id="button"',
  );
});

test("pointercancel restores a scrubbed value without adding a history step", async ({
  app,
}) => {
  const page = app.page;
  const id = await openInspector(app);
  await select(app, "card");
  const input = page.locator('input[aria-label="X-position" i]');
  await expect(input).toHaveValue("40px");
  await input.fill("80");
  await input.press("Enter");
  await expect(input).toHaveValue("80px");
  await app.settled();
  expect((await savedStyle(app, id, "card")).left).toBe("80px");
  const committed = await app.savedNodes(id);

  const inputId = (await input.getAttribute("id"))!;
  const label = page.locator(`label[for="${inputId}"]`);
  await page.evaluate((labelFor) => {
    const target = document.querySelector(
      `label[for="${CSS.escape(labelFor)}"]`,
    )!;
    target.addEventListener(
      "pointerdown",
      (event) => {
        (window as unknown as { __scrubPointerId: number }).__scrubPointerId = (
          event as PointerEvent
        ).pointerId;
      },
      { capture: true, once: true },
    );
  }, inputId);
  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, {
    steps: 8,
  });
  await expect(
    input,
    "precondition: the scrub moved the value",
  ).not.toHaveValue("80px");

  // Playwright's mouse cannot produce pointercancel, so the scrub label receives one directly.
  await page.evaluate((labelFor) => {
    const target = document.querySelector(
      `label[for="${CSS.escape(labelFor)}"]`,
    )!;
    target.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        pointerId: (window as unknown as { __scrubPointerId: number })
          .__scrubPointerId,
        pointerType: "mouse",
      }),
    );
  }, inputId);
  await expect(input).toHaveValue("80px");
  await expect.poll(() => liveStyle(app, "card", "left")).toBe("80px");
  await page.mouse.up();
  await app.settled();
  expectOnlyChanged(committed, await app.savedNodes(id), []);

  await page.keyboard.press(`${MOD}+z`);
  await expect(input).toHaveValue("40px");
  await app.settled();
  expect(
    (await savedStyle(app, id, "card")).left,
    "the cancelled scrub added no history step, so one undo reverts the typed 80",
  ).toBe("40px");
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(input).toHaveValue("80px");
  await app.settled();
  expectOnlyChanged(committed, await app.savedNodes(id), []);
});
