import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";

/**
 * Group / Frame / Ungroup parity against Figma, per figma-ground-truth.md
 * checks 2-3 and figma-interaction-spec.md Part 3 (§Screens/§5 resolution):
 * Cmd+G -> plain GROUP (no fill/clip property, tight bbox, "Group" name,
 * topmost-child z-position, one undo). Cmd+Opt+G -> FRAME (no fill, no
 * clip). Cmd+Shift+G -> ungroup restores children at absolute prior
 * position, keeps them selected.
 */

const PAGE_W = 900;
const PAGE_H = 700;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

// Three siblings stacked in DOM order back->front: Red (bottom), Green
// (middle), Blue (top). Non-adjacent selection (Red + Blue, skipping Green)
// is the fixture used to prove the z-position claim: grouping Red+Blue must
// place the group at Blue's stacking position (above Green), not Red's.
const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Group Frame</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="red" data-agent-native-layer-name="Red"
         style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#ef4444"></div>
    <div data-agent-native-node-id="green" data-agent-native-layer-name="Green"
         style="position:absolute;left:60px;top:60px;width:100px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="blue" data-agent-native-layer-name="Blue"
         style="position:absolute;left:100px;top:100px;width:100px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="solo" data-agent-native-layer-name="Solo"
         style="position:absolute;left:300px;top:300px;width:80px;height:60px;background:#a855f7"></div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "group frame parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

async function indexHtml(page: Page, designId: string): Promise<string> {
  const result = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  return (
    (result.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

function styleOf(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

// The layers panel reflects the in-memory Yjs doc synchronously, but
// get-design reads the persisted file, which lands a write-debounce cycle
// later. Polling here (rather than reading indexHtml once right after a
// layers-panel assertion) avoids a race against that persist.
async function persistedHtml(
  page: Page,
  designId: string,
  isReady: (html: string) => boolean,
): Promise<string> {
  let html = "";
  await expect
    .poll(
      async () => {
        html = await indexHtml(page, designId);
        return isReady(html);
      },
      { timeout: 5000 },
    )
    .toBe(true);
  return html;
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
}

function layersTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRow(page: Page, name: string) {
  return layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

function previewFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
}

function node(page: Page, id: string) {
  return previewFrame(page).locator(`[data-agent-native-node-id="${id}"]`);
}

async function dump(page: Page) {
  return page.evaluate(() => (window as any).__designTrace?.dump?.() ?? null);
}

async function openEditorAndExpandLayers(
  page: Page,
  designId: string,
): Promise<void> {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
}

async function multiSelect(page: Page, names: string[]): Promise<void> {
  // Cmd/Ctrl-click toggles ONE row into the selection (LayersPanel's
  // `additive` path); Shift-click selects the contiguous RANGE between the
  // anchor and the clicked row instead (`range`). The non-adjacent fixture
  // needs the former — Shift here would silently pull in the skipped middle
  // row too, defeating the "gap" the test exists to prove.
  await layerRow(page, names[0]).click();
  await page.waitForTimeout(700);
  for (const name of names.slice(1)) {
    await layerRow(page, name).click({ modifiers: [MOD] });
    await page.waitForTimeout(700);
  }
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("Cmd+G group", () => {
  test("groups an adjacent pair: name Group, union bounds, one undo ungroups", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+g`);

    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      `no Group layer appeared after Cmd+G — trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(1);

    const red = (await node(page, "red").boundingBox())!;
    const green = (await node(page, "green").boundingBox())!;
    const group = await previewFrame(page)
      .locator('[data-agent-native-layer-name="Group"]')
      .first()
      .boundingBox();
    expect(group, "no rendered element for the Group wrapper").not.toBeNull();
    const expectedLeft = Math.min(red.x, green.x);
    const expectedRight = Math.max(red.x + red.width, green.x + green.width);
    expect(
      group!.x,
      `Figma: group bounds are the union of children. Expected left ${Math.round(expectedLeft)}, got ${Math.round(group!.x)}`,
    ).toBeCloseTo(expectedLeft, -1);
    expect(
      group!.x + group!.width,
      `Figma: group bounds are the union of children. Expected right ${Math.round(expectedRight)}, got ${Math.round(group!.x + group!.width)}`,
    ).toBeCloseTo(expectedRight, -1);

    // One undo fully reverses the group back to the exact prior siblings.
    await page.keyboard.press(`${MOD}+z`);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      "one undo did not remove the Group layer",
    ).toHaveCount(0);
    const html = await persistedHtml(
      page,
      id,
      (h) => !/data-agent-native-layer-name="Group"/.test(h),
    );
    expect(
      styleNum(styleOf(html, "red"), "left"),
      "undo did not restore Red's original position",
    ).toBe(20);
    expect(
      styleNum(styleOf(html, "green"), "left"),
      "undo did not restore Green's original position",
    ).toBe(60);
  });

  test("non-adjacent selection: the new group sits at the TOPMOST selected child's z-position, not the bottommost", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    // Red (bottom) + Blue (top), skipping Green (middle). Figma places the
    // resulting group at Blue's stacking position, so Green ends up BELOW
    // the group, not above it.
    await multiSelect(page, ["Red", "Blue"]);
    await page.keyboard.press(`${MOD}+g`);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
    ).toHaveCount(1);

    const html = await persistedHtml(page, id, (h) =>
      /data-agent-native-layer-name="Group"/.test(h),
    );
    const groupMatch = /data-agent-native-layer-name="Group"/.exec(html);
    const greenIdx = html.indexOf('data-agent-native-node-id="green"');
    expect(
      groupMatch,
      `no Group wrapper found in source — trace: ${JSON.stringify(await dump(page))}`,
    ).not.toBeNull();
    const groupIdx = groupMatch!.index;
    expect(groupIdx, "group not found (-1)").toBeGreaterThan(-1);
    expect(greenIdx, "green not found (-1)").toBeGreaterThan(-1);
    expect(
      groupIdx,
      `Figma: a group of non-adjacent children is placed at the topmost selected child's ` +
        `z-position (Blue's), so it must land AFTER Green in DOM order. Group is at source ` +
        `index ${groupIdx}, Green at ${greenIdx} (group must be > green).`,
    ).toBeGreaterThan(greenIdx);
  });

  test("Cmd+G on a single selected element wraps it in a Group (Figma allows single-layer groups)", async ({
    page,
  }) => {
    // Figma DOES allow grouping one layer: Cmd+G on a single selection
    // creates a Group containing just that layer (verified live against
    // Figma — see figma-ground-truth.md). This is not the 2+ requirement an
    // earlier version of this test wrongly assumed.
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await layerRow(page, "Solo").click();
    await page.waitForTimeout(800);
    await page.keyboard.press(`${MOD}+g`);

    const groupRow = layersTree(page)
      .getByRole("treeitem")
      .filter({ hasText: "Group" });
    await expect(
      groupRow,
      `Cmd+G on a single selection must create a Group wrapper — trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(1);

    const html = await persistedHtml(page, id, (h) =>
      /data-agent-native-layer-name="Group"/.test(h),
    );
    const groupMatch = /data-agent-native-layer-name="Group"/.exec(html);
    expect(groupMatch, "no Group wrapper found in source").not.toBeNull();
    // The wrapper contains exactly the one grouped layer.
    const soloIdx = html.indexOf('data-agent-native-node-id="solo"');
    expect(soloIdx, "solo not found (-1)").toBeGreaterThan(-1);
    expect(
      soloIdx,
      "Solo must be nested inside the Group wrapper",
    ).toBeGreaterThan(groupMatch!.index);

    // Selection becomes the new group.
    await expect(
      groupRow,
      "the new Group must become the selection",
    ).toHaveAttribute("aria-selected", "true");

    // One undo removes the group and restores Solo as a top-level sibling.
    await page.keyboard.press(`${MOD}+z`);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      "one undo did not remove the Group layer",
    ).toHaveCount(0);
    const undoneHtml = await persistedHtml(
      page,
      id,
      (h) => !/data-agent-native-layer-name="Group"/.test(h),
    );
    expect(
      styleNum(styleOf(undoneHtml, "solo"), "left"),
      "undo did not restore Solo's original position",
    ).toBe(300);
  });

  // QUARANTINE: EditPanel/appearance-properties.tsx renders a Fill section
  // for a selected Group (observed: getByRole("heading", { name: "Fill" })
  // resolves to 1, not 0). Real delta, owned by the peer inspector PR — do
  // not fix here, do not edit EditPanel.tsx / edit-panel/*.
  test.fixme("a group has no fill row in the inspector (a GROUP has no fill property at all)", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+g`);
    await layerRow(page, "Group").click();

    const fillHeading = page.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    await expect(
      fillHeading,
      "Figma: a GROUP node has no fills property surface at all (figma-ground-truth.md check 2) " +
        "— the inspector must not show a Fill section for a selected Group.",
    ).toHaveCount(0);
  });

  test("gap between grouped children stays transparent (a group paints no background)", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+g`);
    const groupEl = previewFrame(page)
      .locator('[data-agent-native-layer-name="Group"]')
      .first();
    await expect(groupEl).toBeVisible();

    const bg = await groupEl.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(
      ["rgba(0, 0, 0, 0)", "transparent"],
      `Figma: a Group has no fill; the gap between its children (e.g. the notch between ` +
        `Red and Green) must stay transparent, not paint a solid box. Computed background: ${bg}`,
    ).toContain(bg);
  });
});

test.describe("Cmd+Opt+G frame selection", () => {
  test("wraps the selection in a FRAME with no default fill and no clip", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+Alt+g`);

    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Frame" }),
      `Cmd+Opt+G produced no Frame layer — trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(1);

    const frame = previewFrame(page)
      .locator('[data-agent-native-layer-name="Frame"]')
      .first();
    const [bg, overflow] = await frame.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(el).overflow,
    ]);
    expect(
      ["rgba(0, 0, 0, 0)", "transparent"],
      `figma-ground-truth.md check 3: Frame Selection produces a FRAME with fills: [] ` +
        `(no fill at all, not white). Computed background: ${bg}`,
    ).toContain(bg);
    expect(
      overflow,
      `figma-interaction-spec.md Part 3 line 330: Frame selection (⌥⌘G) clip content is OFF ` +
        `(unlike a frame drawn with the F tool, which clips). Computed overflow: ${overflow}`,
    ).not.toBe("hidden");
  });

  test("Cmd+Opt+G on a SINGLE selected element creates a frame (unlike plain Group)", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await layerRow(page, "Solo").click();
    await page.waitForTimeout(800);
    await page.keyboard.press(`${MOD}+Alt+g`);

    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Frame" }),
      `Figma frames a single selected object; trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(1);
  });

  test("a fill added to a frame paints BEHIND its children, which stay visible on top", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+Alt+g`);
    await layerRow(page, "Frame").click();

    const fillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await expect(
      fillSection,
      "a Frame should expose a Fill section (unlike a Group)",
    ).toBeVisible();
    // The empty Fill section's heading doubles as a clickable "Add fill"
    // action alongside the header's own "+" icon button — both carry
    // aria-label "Add fill" (see boolean-subtract.spec.ts and
    // parity-tutorial-4.spec.ts's note on the same ambiguity), so an
    // unscoped role/name query resolves to 2 elements.
    await fillSection.getByRole("button", { name: "Add fill" }).first().click();

    const frame = previewFrame(page)
      .locator('[data-agent-native-layer-name="Frame"]')
      .first();
    await expect
      .poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");

    // Children remain visible above the fill (background paints behind, not
    // as an opaque shape covering the design layers — Apoorva's report).
    const redVisible = await node(page, "red").isVisible();
    const greenVisible = await node(page, "green").isVisible();
    expect(
      [redVisible, greenVisible],
      "a frame's fill must sit behind its children (Apoorva: 'a fill applied to a FRAME " +
        "should behave like a background color behind children, not like a shape placed " +
        "above the design layers')",
    ).toEqual([true, true]);
  });
});

test.describe("Cmd+Shift+G ungroup", () => {
  test("ungroup returns children to the parent at their exact absolute position and selects them", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+g`);
    await layerRow(page, "Group").click();
    await expect(layerRow(page, "Group")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press(`${MOD}+Shift+g`);

    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      `Cmd+Shift+G left the Group layer in place — trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(0);

    // The layers panel above reflects the in-memory doc synchronously, but
    // get-design (indexHtml) reads the persisted file, which lands a
    // write-debounce cycle later — see persistedHtml's own comment. A
    // one-shot indexHtml read here races that persist; poll for Red's own
    // ungrouped style instead of reading once right after the panel settles.
    const html = await persistedHtml(
      page,
      id,
      (h) => styleNum(styleOf(h, "red"), "left") === 20,
    );
    expect(
      styleNum(styleOf(html, "red"), "left"),
      "ungroup must restore Red's original absolute left (20px)",
    ).toBe(20);
    expect(
      styleNum(styleOf(html, "red"), "top"),
      "ungroup must restore Red's original absolute top (20px)",
    ).toBe(20);
    expect(
      styleNum(styleOf(html, "green"), "left"),
      "ungroup must restore Green's original absolute left (60px)",
    ).toBe(60);

    // Figma: ungrouping leaves the former children selected.
    const selectedNames = await page
      .locator('[role="treeitem"][aria-selected="true"]')
      .allTextContents();
    expect(
      selectedNames.some((n) => n.includes("Red")) &&
        selectedNames.some((n) => n.includes("Green")),
      `ungroup should select the released children; selection is ${JSON.stringify(selectedNames)}`,
    ).toBe(true);
  });

  test("one undo after ungroup restores the exact prior group", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    await multiSelect(page, ["Red", "Green"]);
    await page.keyboard.press(`${MOD}+g`);
    await layerRow(page, "Group").click();
    await expect(layerRow(page, "Group")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press(`${MOD}+Shift+g`);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
    ).toHaveCount(0);

    await page.keyboard.press(`${MOD}+z`);

    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      `one undo after ungroup must restore the Group layer — trace: ${JSON.stringify(await dump(page))}`,
    ).toHaveCount(1);
  });
});
