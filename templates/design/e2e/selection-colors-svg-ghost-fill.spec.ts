import { designFrame, enterDirectMode, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const ORIGINAL_FILL = "#f97316";
const REPLACEMENT_FILL = "#8b5cf6";
const SIBLING_FILL = "#16a34a";
const EXPLICIT_ROOT_FILL = "#cc3399";

const SVG_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Selection color SVG</title></head>
<body style="margin:0"><main style="position:relative;width:640px;height:480px">
  <svg data-agent-native-node-id="color-logo" data-agent-native-layer-name="Pasted SVG" data-an-primitive="pasted-svg" viewBox="0 0 120 80" style="position:absolute;left:40px;top:40px;width:240px;height:160px">
    <g id="color-group">
      <path data-agent-native-node-id="warm-left" d="M0 0h30v30z" fill="${ORIGINAL_FILL}" />
      <path data-agent-native-node-id="warm-right" d="M35 0h30v30z" fill="${ORIGINAL_FILL}" />
      <circle data-agent-native-node-id="cool-sibling" cx="90" cy="15" r="14" fill="${SIBLING_FILL}" />
    </g>
  </svg>
  <svg data-agent-native-node-id="root-filled-svg" data-agent-native-layer-name="Root filled SVG" data-an-primitive="pasted-svg" fill="${EXPLICIT_ROOT_FILL}" viewBox="0 0 40 20" style="position:absolute;left:340px;top:40px;width:80px;height:40px">
    <g><rect data-agent-native-node-id="root-filled-rect" x="0" y="0" width="18" height="20" /><circle data-agent-native-node-id="root-filled-circle" cx="30" cy="10" r="9" /></g>
  </svg>
</main></body></html>`;

const MIXED_PATHS_HTML = `<!doctype html><html><head></head><body style="margin:0"><main style="position:relative;width:640px;height:480px">
  <svg data-agent-native-node-id="pasted" data-agent-native-layer-name="Pasted SVG" data-an-primitive="pasted-svg" width="100" height="40" viewBox="0 0 100 40" style="position: absolute; left: 40px; top: 40px; width: 100px; height: 40px">
    <g data-agent-native-node-id="paths"><path data-agent-native-node-id="warm" data-agent-native-layer-name="Warm" d="M0 0h40v40H0z" fill="${ORIGINAL_FILL}" /><path data-agent-native-node-id="cool" data-agent-native-layer-name="Cool" d="M60 0h40v40H60z" fill="${SIBLING_FILL}" /></g>
  </svg>
</main></body></html>`;

const EQUIVALENT_PATHS_HTML = MIXED_PATHS_HTML.replace(
  `fill="${ORIGINAL_FILL}"`,
  'fill="#d9d9d9"',
).replace(`fill="${SIBLING_FILL}"`, 'fill="rgb(217 217 217)"');

async function openAndSelectBothPaths(app: App, html: string) {
  const designId = await app.seed(html);
  await app.open(designId);
  await expandAllLayers(app.page);
  const layers = app.page.getByRole("tree", { name: "Layers" });
  await layers.getByRole("button", { name: "Warm", exact: true }).click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Warm"]);
  await layers
    .getByRole("button", { name: "Cool", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect.poll(() => app.selectedLayers()).toEqual(["Cool", "Warm"]);
  return designId;
}

function inspectorSection(app: App, title: string) {
  return app.page
    .locator("section")
    .filter({
      has: app.page.getByRole("heading", { name: title, exact: true }),
    })
    .first();
}

test("Selection colors replaces a grouped SVG fill without stale inspector colors", async ({
  app,
  page,
}) => {
  const designId = await app.seed(SVG_HTML);
  const screenId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await app.open(designId);
  await enterDirectMode(page);
  await expandAllLayers(page);

  const layers = page.getByRole("tree", { name: "Layers" });
  const svgRow = layers.getByRole("button", {
    name: "Pasted SVG",
    exact: true,
  });
  await svgRow.click();
  await expect(
    layers.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Pasted SVG");

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

  const colorLabels = () =>
    selectionColors
      .locator('button[aria-label^="#"]')
      .evaluateAll((buttons) =>
        buttons
          .map((button) => button.getAttribute("aria-label")?.toLowerCase())
          .filter((label): label is string => Boolean(label)),
      );
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  const expectNoBaseFill = async () => {
    await expect(
      fillSection.getByRole("button", { name: "Open color picker" }),
    ).toHaveCount(0);
    await expect(
      fillSection.locator('[data-inspector-layout="drag-paint-row"]'),
    ).toHaveCount(0);
  };
  await expectNoBaseFill();
  await expect.poll(colorLabels).toEqual([ORIGINAL_FILL, SIBLING_FILL]);

  await selectionColors
    .getByRole("button", { name: ORIGINAL_FILL, exact: true })
    .click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill(REPLACEMENT_FILL.slice(1));
  await hex.press("Enter");

  const frame = designFrame(page, screenId);
  const readPaints = () =>
    frame
      .locator("svg[data-agent-native-node-id='color-logo']")
      .evaluate((svg) => {
        const fillOf = (id: string) => {
          const shape = svg.querySelector(
            `[data-agent-native-node-id="${id}"]`,
          );
          if (!shape) throw new Error(`Missing SVG shape ${id}`);
          return getComputedStyle(shape).fill;
        };
        return [
          fillOf("warm-left"),
          fillOf("warm-right"),
          fillOf("cool-sibling"),
        ];
      });
  await expect
    .poll(readPaints)
    .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
  await expect.poll(colorLabels).toEqual([REPLACEMENT_FILL, SIBLING_FILL]);
  await expectNoBaseFill();
  await app.settled();
  const replacedSource = await app.savedHtml(designId);
  expect(replacedSource.toLowerCase()).toContain(REPLACEMENT_FILL);
  expect(replacedSource.toLowerCase()).not.toContain(ORIGINAL_FILL);

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(readPaints)
    .toEqual(["rgb(249, 115, 22)", "rgb(249, 115, 22)", "rgb(22, 163, 74)"]);
  await expect.poll(colorLabels).toEqual([ORIGINAL_FILL, SIBLING_FILL]);
  await expectNoBaseFill();
  await app.settled();
  const undoneSource = await app.savedHtml(designId);
  expect(undoneSource.toLowerCase()).toContain(ORIGINAL_FILL);
  expect(undoneSource.toLowerCase()).not.toContain(REPLACEMENT_FILL);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(readPaints)
    .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
  await page.reload();
  await enterDirectMode(page);
  await expandAllLayers(page);
  await layers.getByRole("button", { name: "Pasted SVG", exact: true }).click();
  await selectionColors
    .getByRole("button", { name: "Show selection colors" })
    .click();
  await expect
    .poll(readPaints)
    .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
  await expect.poll(colorLabels).toEqual([REPLACEMENT_FILL, SIBLING_FILL]);
  await expectNoBaseFill();
  await app.settled();
  const reloadedSource = await app.savedHtml(designId);
  expect(reloadedSource.toLowerCase()).toContain(REPLACEMENT_FILL);
  expect(reloadedSource.toLowerCase()).not.toContain(ORIGINAL_FILL);

  await layers
    .getByRole("button", { name: "Root filled SVG", exact: true })
    .click();
  const rootFilledSvg = frame.locator(
    "svg[data-agent-native-node-id='root-filled-svg']",
  );
  await expect
    .poll(() =>
      rootFilledSvg
        .locator("[data-agent-native-node-id='root-filled-rect']")
        .evaluate((node) => getComputedStyle(node).fill),
    )
    .toBe("rgb(204, 51, 153)");
  await expect(
    fillSection.getByRole("button", { name: "Open color picker" }),
  ).toBeVisible();
  await expect(
    fillSection.getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("CC3399");
});

// fixme: product bug: Ghost fill: Add fill writes style='fill: rgb(217 217 217)' but keeps fill='#f97316' and fill='#16a34a' attributes on the paths, so the
test.fixme("adding a fill to mixed SVG paths paints both paths and leaves no ghost of their old fills", async ({
  app,
}) => {
  const designId = await openAndSelectBothPaths(app, MIXED_PATHS_HTML);
  const seeded = await app.savedNodes(designId);
  const fill = inspectorSection(app, "Fill");
  await expect(
    fill.getByText("Click + to replace mixed content", { exact: true }),
  ).toBeVisible();

  await fill.getByRole("button", { name: "Add fill", exact: true }).click();
  await app.settled();

  const after = await app.savedNodes(designId);
  expect([
    styleOf(after.get("warm")).fill,
    styleOf(after.get("cool")).fill,
  ]).toEqual(["rgb(217 217 217)", "rgb(217 217 217)"]);
  expectOnlyChanged(seeded, after, ["warm", "cool"]);
  await expect(app.node("warm")).toHaveCSS("fill", "rgb(217, 217, 217)");
  await expect(app.node("cool")).toHaveCSS("fill", "rgb(217, 217, 217)");
  const saved = (await app.savedHtml(designId)).toLowerCase();
  expect(
    [saved.includes(ORIGINAL_FILL), saved.includes(SIBLING_FILL)],
    "the old fills are gone from the source",
  ).toEqual([false, false]);
});

// fixme: product bug: False Mixed in the multi-selection inspector: two paths with identical default appearance show Opacity, Corner radius and Blend mode as
test.fixme("equivalent SVG paint spellings show one shared fill and identical defaults are not Mixed", async ({
  app,
}) => {
  const designId = await openAndSelectBothPaths(app, EQUIVALENT_PATHS_HTML);
  const seeded = await app.savedNodes(designId);
  const fill = inspectorSection(app, "Fill");
  const selectionColors = inspectorSection(app, "Selection colors");

  await expect(
    fill.getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("D9D9D9");
  await expect(
    fill.getByText("Click + to replace mixed content", { exact: true }),
  ).toHaveCount(0);
  await selectionColors
    .getByRole("button", { name: "Show selection colors" })
    .click();
  await expect
    .poll(() =>
      selectionColors
        .locator('button[aria-label^="#"]')
        .evaluateAll((buttons) =>
          buttons.map((button) =>
            button.getAttribute("aria-label")?.toLowerCase(),
          ),
        ),
    )
    .toEqual(["#d9d9d9"]);
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(designId), []);
  await expect(
    inspectorSection(app, "Appearance").locator(
      'input[aria-label="Opacity" i]',
    ),
  ).toHaveValue("100%");
  await expect(
    inspectorSection(app, "Stroke").getByText(
      "Click + to replace mixed content",
      { exact: true },
    ),
  ).toHaveCount(0);
});
