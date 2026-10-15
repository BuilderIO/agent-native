import { type Locator, type Page } from "@playwright/test";

import { childrenOf, expect, expectOnlyChanged, test, type App } from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const LAYERS_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Layers</title></head>
  <body data-agent-native-node-id="page" style="margin:0;padding:40px;font-family:system-ui,sans-serif;background:#ffffff">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px;width:400px">
      <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button"
        style="width:140px;height:44px;margin:0;padding:0;border:0;background:#6366f1;color:#ffffff">Alpha</button>
      <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button"
        style="width:140px;height:44px;margin:0;padding:0;border:0;background:#22c55e;color:#06240f">Beta</button>
    </div>
    <section data-agent-native-node-id="section" data-agent-native-layer-name="Section"
      style="margin-top:40px;width:400px;padding:16px;background:#eef2ff">
      <h2 data-agent-native-node-id="card-title" data-agent-native-layer-name="Card Title" style="margin:0;height:28px;font-size:20px">Headline</h2>
      <p data-agent-native-node-id="card-body" data-agent-native-layer-name="Card Body" style="margin:0;height:24px">Body copy</p>
    </section>
    <div data-agent-native-node-id="empty" data-agent-native-layer-name="Empty Box" data-an-primitive="frame"
      style="margin-top:40px;width:300px;height:120px;background:#e5e5e5"></div>
  </body>
</html>`;

const ALPHA = { x: 40, y: 40, width: 140, height: 44 };
const BETA = { x: 196, y: 40, width: 140, height: 44 };

async function openSeeded(app: App) {
  const id = await app.seed(LAYERS_HTML);
  await app.open(id);
  await app.zoomToFit();
  await expandLayer(app.page, "Home");
  await expandLayer(app.page, "Row");
  return id;
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string) {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) });
}

function layerRow(page: Page, name: string) {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

async function expandLayer(page: Page, name: string) {
  const row = layerRow(page, name);
  await expect(row).toBeVisible();
  const expand = row.getByRole("button", { name: "Expand layer" }).first();
  if (await expand.isVisible()) await expand.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
}

async function rowLevel(page: Page, name: string) {
  return Number(await layerRow(page, name).getAttribute("aria-level"));
}

async function clickLayerAction(page: Page, name: string, label: string) {
  const row = layerRow(page, name);
  await row.hover();
  await row.locator(`button[aria-label="${label}"]`).click();
}

async function clickCanvas(app: App, rect: typeof ALPHA) {
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
}

/** Boxes of the canvas selection chrome drawn around each selected layer, in design px. */
async function canvasSelectionBoxes(app: App) {
  return app.page
    .locator(LIVE_SCREEN)
    .contentFrame()
    .locator(
      '[data-agent-native-edit-overlay="selection"], [data-agent-native-edit-overlay="multi-selection"]:not([data-agent-native-multi-selection-bounds])',
    )
    .evaluateAll((overlays) =>
      overlays
        .filter((overlay) => getComputedStyle(overlay).display !== "none")
        .map((overlay) => {
          const r = overlay.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .sort((a, b) => a.x - b.x),
    );
}

async function dragRowOnto(
  page: Page,
  source: Locator,
  target: Locator,
  y: "top" | "middle",
) {
  const box = (await target.boundingBox())!;
  await source.dragTo(target, {
    targetPosition: { x: 96, y: y === "top" ? 2 : box.height / 2 },
  });
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("layers menu structure operations", () => {
  test("selecting rows syncs the canvas and supports additive multi-select", async ({
    app,
  }) => {
    const page = app.page;
    await openSeeded(app);

    await layerRowButton(page, "Alpha Button").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
    await expect.poll(() => canvasSelectionBoxes(app)).toEqual([ALPHA]);

    await layerRowButton(page, "Beta Button").click({ modifiers: [MOD] });
    await expect
      .poll(() => app.selectedLayers())
      .toEqual(["Alpha Button", "Beta Button"]);
    await expect.poll(() => canvasSelectionBoxes(app)).toEqual([ALPHA, BETA]);

    await layerRowButton(page, "Beta Button").click({ modifiers: [MOD] });
    await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
    await expect.poll(() => canvasSelectionBoxes(app)).toEqual([ALPHA]);

    await layerRowButton(page, "Alpha Button").click();
    await layerRowButton(page, "Beta Button").click({ modifiers: ["Shift"] });
    await expect
      .poll(() => app.selectedLayers())
      .toEqual(["Alpha Button", "Beta Button"]);
    await expect.poll(() => canvasSelectionBoxes(app)).toEqual([ALPHA, BETA]);
  });

  test("dragging a sibling row reorders it before its peer", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "row")).toEqual(["alpha", "beta"]);

    await dragRowOnto(
      page,
      layerRow(page, "Beta Button"),
      layerRow(page, "Alpha Button"),
      "top",
    );
    await app.settled();

    const swapped = await app.savedNodes(id);
    expect(childrenOf(swapped, "row")).toEqual(["beta", "alpha"]);
    expectOnlyChanged(before, swapped, []);
    expect(await app.designRect("beta")).toEqual(ALPHA);
    expect(await app.designRect("alpha")).toEqual(BETA);

    await dragRowOnto(
      page,
      layerRow(page, "Alpha Button"),
      layerRow(page, "Beta Button"),
      "top",
    );
    await app.settled();

    const restored = await app.savedNodes(id);
    expect(childrenOf(restored, "row")).toEqual(["alpha", "beta"]);
    expectOnlyChanged(before, restored, []);
    expect(await app.designRect("alpha")).toEqual(ALPHA);
    expect(await app.designRect("beta")).toEqual(BETA);
  });

  // fixme: product bug: Alpha is saved inside the non-positioned Section as position:absolute; left:0; top:0, so it renders at the screen's 0,0 corner over Beta.
  test.fixme("reparenting into a different parent updates layer grouping", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    await expandLayer(page, "Section");
    const sectionLevel = await rowLevel(page, "Section");

    await dragRowOnto(
      page,
      layerRow(page, "Alpha Button"),
      layerRow(page, "Section"),
      "middle",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "row")).toEqual(["beta"]);
    expect(childrenOf(after, "section")).toEqual([
      "card-title",
      "card-body",
      "alpha",
    ]);
    expectOnlyChanged(before, after, ["alpha"]);
    expect(await rowLevel(page, "Alpha Button")).toBe(sectionLevel + 1);
    expect(
      await app.designRect("alpha"),
      "a Layers reparent changes the hierarchy, not where Alpha sits on the canvas",
    ).toEqual(ALPHA);
  });

  // fixme: product bug: Alpha nests correctly but renders at 0,-40, above the screen's top edge. The inspector reads X -40px / Y -288px relative to the frame, so
  test.fixme("dragging onto an empty container reparents inside and persists after reload", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);

    await dragRowOnto(
      page,
      layerRow(page, "Alpha Button"),
      layerRow(page, "Empty Box"),
      "middle",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "row")).toEqual(["beta"]);
    expect(childrenOf(after, "empty")).toEqual(["alpha"]);
    expectOnlyChanged(before, after, ["alpha", "empty"]);
    const inside = { x: 40, y: 248, width: 140, height: 44 };
    expect(
      await app.designRect("alpha"),
      "Alpha sits at the empty box's top-left",
    ).toEqual(inside);

    await app.open(id);
    await expandLayer(page, "Home");
    await expandLayer(page, "Empty Box");
    expect(await rowLevel(page, "Alpha Button")).toBe(
      (await rowLevel(page, "Empty Box")) + 1,
    );
    expect(await app.designRect("alpha")).toEqual(inside);
  });

  test("locking a layer keeps panel selection but blocks canvas selection", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const seededHtml = await app.savedHtml(id);
    const before = await app.savedNodes(id);

    await layerRowButton(page, "Beta Button").click();
    await clickLayerAction(page, "Beta Button", "Lock layer");
    await app.settled();
    const locked = await app.savedNodes(id);
    expect(locked.get("beta")?.attrs["data-agent-native-locked"]).toBe("true");
    expectOnlyChanged(before, locked, ["beta"]);

    await layerRowButton(page, "Alpha Button").click();
    await layerRowButton(page, "Beta Button").click({ modifiers: [MOD] });
    await expect
      .poll(() => app.selectedLayers(), {
        message: "a locked layer can still be selected in Layers",
      })
      .toEqual(["Alpha Button", "Beta Button"]);

    await layerRowButton(page, "Alpha Button").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
    await clickCanvas(app, BETA);
    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "a canvas click on the locked layer leaves the selection alone",
      })
      .toEqual(["Alpha Button"]);

    await clickLayerAction(page, "Beta Button", "Unlock layer");
    await app.settled();
    expect(await app.savedHtml(id)).toBe(seededHtml);
    await clickCanvas(app, BETA);
    await expect.poll(() => app.selectedLayers()).toEqual(["Beta Button"]);
  });

  test("hiding a layer keeps panel selection but blocks canvas selection until restored", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const seededHtml = await app.savedHtml(id);
    const before = await app.savedNodes(id);

    await layerRowButton(page, "Beta Button").click();
    await clickLayerAction(page, "Beta Button", "Hide layer");
    await app.settled();
    const hidden = await app.savedNodes(id);
    expect(hidden.get("beta")?.attrs["data-agent-native-hidden"]).toBe("true");
    expectOnlyChanged(before, hidden, ["beta"]);
    await expect(app.node("beta")).toBeHidden();

    await layerRowButton(page, "Alpha Button").click();
    await layerRowButton(page, "Beta Button").click({ modifiers: [MOD] });
    await expect
      .poll(() => app.selectedLayers(), {
        message: "a hidden layer can still be selected in Layers",
      })
      .toEqual(["Alpha Button", "Beta Button"]);

    await layerRowButton(page, "Alpha Button").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
    await clickCanvas(app, BETA);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "a canvas click where the hidden layer was does not select it",
      })
      .toEqual(["Row"]);

    await clickLayerAction(page, "Beta Button", "Show layer");
    await app.settled();
    expect(await app.savedHtml(id)).toBe(seededHtml);
    await expect(app.node("beta")).toBeVisible();
    await clickCanvas(app, BETA);
    await expect.poll(() => app.selectedLayers()).toEqual(["Beta Button"]);
  });
});
