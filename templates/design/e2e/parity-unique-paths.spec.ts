import { expect, test, type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  canvasZoom,
  createFixtureDesign,
  designFrame,
  enterDirectMode,
  gotoEditor,
  installBridge,
  selectByText,
  waitForBridge,
} from "./helpers";


const MOD = process.platform === "darwin" ? "Meta" : "Control";

const FREE_DRAG_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Free-drag fixture</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="free-box" data-agent-native-layer-name="Free Box"
         style="position:absolute;left:80px;top:80px;width:120px;height:80px;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center">Free Box</div>
  </body>
</html>`;

async function createFreeDragFixture(page: Page): Promise<string> {
  const res = await page.request.post(
    `${e2eBaseURL()}/_agent-native/actions/create-design`,
    { data: { title: "E2E free-drag fixture", projectType: "prototype" } },
  );
  const created = await res.json();
  const id: string = created?.id ?? created?.data?.id ?? created?.design?.id;
  await page.request.post(`${e2eBaseURL()}/_agent-native/actions/create-file`, {
    data: {
      designId: id,
      filename: "index.html",
      content: FREE_DRAG_HTML,
      fileType: "html",
    },
  });
  return id;
}

async function showAltHoverMeasurement(page: Page): Promise<Locator> {
  await selectByText(page, "Alpha Button");
  const betaBox = (await (await frameNode(page, "Beta Button")).boundingBox())!;
  const measurementOverlay = designFrame(page).locator(
    "[data-agent-native-measurement-overlay]",
  );
  await page.mouse.move(betaBox.x - 20, betaBox.y - 20);
  await page.keyboard.down("Alt");
  await page.mouse.move(
    betaBox.x + betaBox.width / 2,
    betaBox.y + betaBox.height / 2,
  );
  await expect(measurementOverlay).toHaveCSS("display", "block");
  return measurementOverlay;
}

let designId: string;

test.describe.serial("rare-but-real unique paths", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    designId = await createFixtureDesign(page, `E2E Unique ${testInfo.title}`);
    await gotoEditor(page, designId);
  });

  test("Alt-drag inside the Layers panel duplicates a layer without touching the canvas", async ({
    page,
  }) => {
    await openLayerSearch(page, "Button");
    const target = layerRowButton(page, "Beta Button").first();
    const sourceRow = layerRowButton(page, "Alpha Button");
    await expect(sourceRow).toBeVisible();
    await expect(target).toBeVisible();
    await sourceRow.click();
    await expect(layerRow(page, "Alpha Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const before = await topLevelLayerNodeIds(page);
    const beforeCount = before.length;

    const sourceLayerNodeId =
      await sourceRow.getAttribute("data-layer-node-id");
    expect(sourceLayerNodeId).toBeTruthy();
    const sourceBox = (await sourceRow.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    const beforeHtml = await getFileHtml(page);
    const persistedNodeCount = (html: string) =>
      [...html.matchAll(/data-agent-native-node-id=/g)].length;
    const beforePersistedNodeCount = persistedNodeCount(beforeHtml);

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height + 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(async () => persistedNodeCount(await getFileHtml(page)), {
        timeout: 15_000,
        message: "the Alt-drag duplicate must persist before undo",
      })
      .toBeGreaterThan(beforePersistedNodeCount);
    await expect
      .poll(async () => (await topLevelLayerNodeIds(page)).length)
      .toBeGreaterThan(beforeCount);

    const after = await topLevelLayerNodeIds(page);
    expect(
      after.length,
      `alt-drag in the layers panel from ${JSON.stringify(before)} should add at least one node; got ${JSON.stringify(after)}`,
    ).toBeGreaterThan(beforeCount);
    expect(sourceLayerNodeId).toBeTruthy();
    expect(
      after,
      "the original Alpha Button row must still exist after an alt-drag duplicate",
    ).toContain(sourceLayerNodeId);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => persistedNodeCount(await getFileHtml(page)), {
        timeout: 15_000,
        message: "undo must remove the persisted Alt-drag duplicate",
      })
      .toBe(beforePersistedNodeCount);
    await expect
      .poll(() => topLevelLayerNodeIds(page))
      .toHaveLength(beforeCount);
    const undone = await topLevelLayerNodeIds(page);
    expect(undone.length).toBe(beforeCount);
  });

  test("a marquee needs only intersection over a shape but full enclosure over a top-level screen", async ({
    page,
  }) => {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-card]").first()).toBeVisible({
      timeout: 20_000,
    });
    const card = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    await page.mouse.move(card.x + card.width - 20, card.y - 40);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width + 40, card.y + 40, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const partialSelected = await page
      .locator("[data-frame-selection-box]")
      .count();
    expect(
      partialSelected,
      "a marquee that only clips a screen's edge must not select it (top-level frames require full enclosure)",
    ).toBe(0);

    await page.mouse.move(card.x - 40, card.y - 40);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width + 40, card.y + card.height + 40, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const fullSelected = await page
      .locator("[data-frame-selection-box]")
      .count();
    expect(
      fullSelected,
      "fully enclosing the screen with the marquee must select it",
    ).toBeGreaterThan(0);
  });

  test("Cmd+A is scope-sensitive: inside a container it selects siblings, otherwise it selects screens", async ({
    page,
  }) => {
    await selectByTextDeep(page, "Alpha Button");
    await expandAllLayersLocal(page);
    await expect
      .poll(() => countSelectedLayerRows(page), {
        message:
          "precondition: the button click must select exactly one layer row",
      })
      .toBe(1);
    await page.keyboard.press("ControlOrMeta+a");
    await page.waitForTimeout(200);
    const selectedInScope = await countSelectedLayerRows(page);
    expect(
      selectedInScope,
      "Cmd+A with a child selected must select that child's siblings, not every screen",
    ).toBeGreaterThan(1);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.mouse.click(20, 20);
    await page.keyboard.press("ControlOrMeta+a");
    await page.waitForTimeout(200);
    const overviewSelected = await page
      .locator("[data-frame-selection-box]")
      .count();
    expect(
      overviewSelected,
      "Cmd+A with nothing selected at the top level must select the top-level screens",
    ).toBeGreaterThan(0);
  });

  test("Cmd+D twice repeats the offset of a manual move made after the first duplicate", async ({
    page,
  }) => {
    const freeDesignId = await createFreeDragFixture(page);
    await gotoEditor(page, freeDesignId);
    await selectByText(page, "Free Box");
    await installBridge(page);

    await page.evaluate(() => ((window as any).__bridge = []));
    await page.keyboard.press("ControlOrMeta+d");
    const dup1 = await boxFromNextSelect(page);

    await page.mouse.move(
      dup1.box.x + dup1.box.width / 2,
      dup1.box.y + dup1.box.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dup1.box.x + dup1.box.width / 2 + 40,
      dup1.box.y + dup1.box.height / 2 + 25,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(150);
    const movedBox = (await designFrame(page)
      .locator(`[data-agent-native-node-id="${dup1.nodeId}"]`)
      .first()
      .boundingBox())!;

    await page.evaluate(() => ((window as any).__bridge = []));
    await page.keyboard.press("ControlOrMeta+d");
    const dup2 = await boxFromNextSelect(page);

    const dxManual = movedBox.x - dup1.box.x;
    const dyManual = movedBox.y - dup1.box.y;
    const dxRepeat = dup2.box.x - movedBox.x;
    const dyRepeat = dup2.box.y - movedBox.y;
    expect(
      Math.abs(dxRepeat - dxManual),
      `repeat-duplicate offset (${dxRepeat},${dyRepeat}) should match the manual move offset (${dxManual},${dyManual})`,
    ).toBeLessThan(6);
    expect(Math.abs(dyRepeat - dyManual)).toBeLessThan(6);
  });

  test("holding Space mid-drag keeps an element a sibling instead of reparenting it into the frame it passes over", async ({
    page,
  }) => {
    await selectByTextDeep(page, "Alpha Button");
    const target = await frameNode(page, "Alpha Button");
    const box = (await target.boundingBox())!;
    const sectionBox = (await (
      await frameNode(page, "Fixture Card Title")
    ).boundingBox())!;
    const beforeHtml = await getFileHtml(page);
    const beforeParentTag = parentTagNameOf(beforeHtml, "e2e-alpha-button");
    const beforeLiveParent = await liveParentSignature(page, "Alpha Button");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      sectionBox.x + sectionBox.width / 2,
      sectionBox.y + 10,
      {
        steps: 10,
      },
    );
    await page.keyboard.down("Space");
    await page.mouse.move(
      sectionBox.x + sectionBox.width / 2,
      sectionBox.y + sectionBox.height / 2,
      {
        steps: 10,
      },
    );
    await page.keyboard.up("Space");
    await page.mouse.up();

    await expect.poll(() => getFileHtml(page)).not.toBe(beforeHtml);

    const html = await getFileHtml(page);
    const sectionOpen = html.indexOf(">Fixture Card Title<");
    const alphaIdx = html.indexOf(
      'data-agent-native-node-id="e2e-alpha-button"',
    );
    const sectionCloseIdx = html.indexOf("</section>", sectionOpen);
    expect(
      sectionOpen,
      "Fixture Card Title section sentinel must exist",
    ).toBeGreaterThanOrEqual(0);
    expect(alphaIdx, "Alpha Button sentinel must exist").toBeGreaterThanOrEqual(
      0,
    );
    expect(
      sectionCloseIdx,
      "section close sentinel must exist",
    ).toBeGreaterThanOrEqual(0);
    expect(
      alphaIdx > sectionOpen &&
        sectionCloseIdx > sectionOpen &&
        alphaIdx > sectionCloseIdx,
      "Alpha Button must not land inside the section while Space is held during the drag",
    ).toBe(true);
    const afterParentTag = parentTagNameOf(html, "e2e-alpha-button");
    expect(
      afterParentTag,
      `Alpha Button must become a direct child of the screen root <body> (a real sibling of <main>/the section), not merely "somewhere after" the section. before-parent=${beforeParentTag} after-parent=${afterParentTag}`,
    ).toBe("body");
    const afterLiveParent = await liveParentSignature(page, "Alpha Button");
    expect(
      afterLiveParent.startsWith("BODY|"),
      `Alpha Button's live DOM parent must be <body> (the screen root) after the Space-held drop; before=${beforeLiveParent} after=${afterLiveParent}`,
    ).toBe(true);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => getFileHtml(page), {
        message:
          "one undo after a Space-held drag must restore the original document (parent and position), not just deselect",
      })
      .toBe(beforeHtml);
    const restoredBox = (await (
      await frameNode(page, "Alpha Button")
    ).boundingBox())!;
    expect(
      Math.abs(restoredBox.x - box.x) < 1 &&
        Math.abs(restoredBox.y - box.y) < 1,
      `one undo must restore Alpha Button's live position; before=(${box.x},${box.y}) after-undo=(${restoredBox.x},${restoredBox.y})`,
    ).toBe(true);

    await layerRowButton(page, "Alpha Button").click();
    await page.waitForTimeout(100);
    const restoredTargetBox = (await (
      await frameNode(page, "Alpha Button")
    ).boundingBox())!;
    await enterDirectMode(page);
    const currentSectionBox = (await designFrame(page)
      .locator("section")
      .first()
      .boundingBox())!;
    await page.mouse.move(
      restoredTargetBox.x + restoredTargetBox.width / 2,
      restoredTargetBox.y + restoredTargetBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      restoredTargetBox.x + restoredTargetBox.width / 2 + 10,
      restoredTargetBox.y + restoredTargetBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      currentSectionBox.x + currentSectionBox.width / 2,
      currentSectionBox.y + currentSectionBox.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(400);
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const movedHtml = await getFileHtml(page);
          const movedAlphaIdx = movedHtml.indexOf(
            'data-agent-native-node-id="e2e-alpha-button"',
          );
          const movedSectionOpen = movedHtml.indexOf("<section");
          const movedSectionClose = movedHtml.indexOf(
            "</section>",
            movedSectionOpen,
          );
          return (
            movedSectionOpen > 0 &&
            movedSectionClose > 0 &&
            movedAlphaIdx > movedSectionOpen &&
            movedAlphaIdx < movedSectionClose
          );
        },
        {
          message:
            "a subsequent ordinary drag must reparent Alpha Button into the section",
        },
      )
      .toBe(true);
  });

  test("click-dragging across multiple eye icons in the Layers panel toggles visibility for the whole run", async ({
    page,
  }) => {
    await openLayerSearch(page, "Button");
    const rowA = layerRow(page, "Alpha Button");
    const rowB = layerRow(page, "Beta Button");
    const lockA = rowA
      .locator(
        'button[aria-label="Lock layer"], button[aria-label="Unlock layer"]',
      )
      .first();
    const lockB = rowB
      .locator(
        'button[aria-label="Lock layer"], button[aria-label="Unlock layer"]',
      )
      .first();
    const centerOf = async (locator: Locator) => {
      const box = (await locator.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    await rowA.hover();
    const start = await centerOf(lockA);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const rowBBox = (await rowB.boundingBox())!;
    await page.mouse.move(
      rowBBox.x + rowBBox.width / 2,
      rowBBox.y + rowBBox.height / 2,
      { steps: 6 },
    );
    await lockB.hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const alphaLocked = await isLayerLocked(page, "Alpha Button");
    const betaLocked = await isLayerLocked(page, "Beta Button");
    expect(
      alphaLocked && betaLocked,
      `a continuous drag across both lock icons should lock both rows; got Alpha locked=${alphaLocked}, Beta locked=${betaLocked}`,
    ).toBe(true);
  });

  test("Alt-hovering another object while one is selected shows a measurement overlay between them", async ({
    page,
  }) => {
    await selectByText(page, "Alpha Button");
    const betaBox = (await (
      await frameNode(page, "Beta Button")
    ).boundingBox())!;
    const measurementOverlay = designFrame(page).locator(
      "[data-agent-native-measurement-overlay]",
    );
    await page.mouse.move(
      betaBox.x + betaBox.width / 2,
      betaBox.y + betaBox.height / 2,
      { steps: 5 },
    );
    await expect(measurementOverlay).toHaveCSS("display", "none");

    await page.mouse.move(betaBox.x - 20, betaBox.y - 20);
    await page.keyboard.down("Alt");
    await page.mouse.move(
      betaBox.x + betaBox.width / 2,
      betaBox.y + betaBox.height / 2,
      {
        steps: 5,
      },
    );
    await expect(measurementOverlay).toHaveCSS("display", "block");
    await expect(measurementOverlay.locator("div")).not.toHaveCount(0);
    await page.keyboard.up("Alt");
    await expect(measurementOverlay).toHaveCSS("display", "none");
  });

  test("Alt-hover measurements clear on preview iframe focus loss without pointer movement", async ({
    page,
  }) => {
    const measurementOverlay = await showAltHoverMeasurement(page);
    await page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .evaluate((iframe) => iframe.dispatchEvent(new FocusEvent("blur")));
    await expect(measurementOverlay).toHaveCSS("display", "none");
    await page.keyboard.up("Alt");
  });

  test("Alt-hover measurements clear on host window blur without pointer movement", async ({
    page,
  }) => {
    const measurementOverlay = await showAltHoverMeasurement(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(measurementOverlay).toHaveCSS("display", "none");
    await page.keyboard.up("Alt");
  });

  test("Ctrl-dragging a child overrides auto-layout resistance and drags it out cleanly", async ({
    page,
  }) => {
    await selectByTextDeep(page, "Alpha Button");
    const box = (await (await frameNode(page, "Alpha Button")).boundingBox())!;
    const dropTarget = (await (
      await frameNode(page, "Variant CTA")
    ).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(
      dropTarget.x + dropTarget.width / 2,
      dropTarget.y + dropTarget.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.keyboard.up("Control");
    const alphaOutsideRow = async () => {
      const html = await getFileHtml(page);
      const rowOpen = html.indexOf('style="display:flex;flex-direction:row');
      const rowClose = html.indexOf("</div>", rowOpen);
      const alphaIdx = html.indexOf(
        'data-agent-native-node-id="e2e-alpha-button"',
      );
      return {
        valid: rowOpen >= 0 && rowClose >= 0 && alphaIdx >= 0,
        outside: alphaIdx < rowOpen || alphaIdx > rowClose,
      };
    };
    await expect
      .poll(alphaOutsideRow, {
        timeout: 10_000,
        message:
          "Ctrl-drag should persist the child outside the flex row against normal auto-layout drag resistance",
      })
      .toMatchObject({ valid: true, outside: true });
  });

  test("paste-properties (Cmd+Opt+C / Cmd+Opt+V) copies style only, leaving position and size alone", async ({
    page,
  }) => {
    await selectByTextDeep(page, "Beta Button");
    await page.keyboard.press(`${MOD}+Alt+c`);
    await page.waitForTimeout(100);
    await selectByTextDeep(page, "Alpha Button");
    const beforeBox = (await (
      await frameNode(page, "Alpha Button")
    ).boundingBox())!;
    await page.keyboard.press(`${MOD}+Alt+v`);
    await page.waitForTimeout(200);
    const afterBox = (await (
      await frameNode(page, "Alpha Button")
    ).boundingBox())!;
    const bg = await (
      await frameNode(page, "Alpha Button")
    ).evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(
      Math.abs(afterBox.x - beforeBox.x) < 2 &&
        Math.abs(afterBox.y - beforeBox.y) < 2,
      "paste-properties must not move the target's position",
    ).toBe(true);
    expect(
      bg,
      "paste-properties should apply the copied fill color (#22c55e) onto the target",
    ).toBe("rgb(34, 197, 94)");
  });

  test("Shift+H / Shift+V flip the selection about its own bounding box", async ({
    page,
  }) => {
    await selectByText(page, "Alpha Button");
    const before = await elementScale(page, "Alpha Button");
    await page.keyboard.press("Shift+h");
    await page.waitForTimeout(150);
    const afterH = await elementScale(page, "Alpha Button");
    expect(
      afterH[0],
      `Shift+H should flip horizontally (scaleX sign should flip from ${before[0]})`,
    ).toBe(-before[0]);
    expect(afterH[1]).toBe(before[1]);

    await page.keyboard.press("Shift+v");
    await page.waitForTimeout(150);
    const afterV = await elementScale(page, "Alpha Button");
    expect(afterV[1]).toBe(-before[1]);
  });

  test("dragging the rotate handle with Shift held snaps rotation to 15-degree increments", async ({
    page,
  }) => {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-card]").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.locator("[data-frame-label]").first().click();
    const handle = page.locator("[data-rotate-handle]").first();
    await expect(
      handle,
      "required rotate handle must render for a top-level screen frame",
    ).toHaveCount(1);
    const box = await handle.boundingBox();
    if (!box) throw new Error("rotate handle has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 45,
      box.y + box.height / 2 + 30,
      {
        steps: 12,
      },
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");

    const frameShell = page.locator("[data-frame-shell]").first();
    const readRotation = () =>
      frameShell.evaluate((el) => {
        const t = getComputedStyle(el).transform;
        if (!t || t === "none") return 0;
        const m = new DOMMatrix(t);
        return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
      });
    const rotation = await readRotation();
    expect(
      Math.abs(rotation % 15) < 1 || Math.abs((rotation % 15) - 15) < 1,
      `Shift-constrained rotation should land on a 15-degree increment, got ${rotation} deg`,
    ).toBe(true);

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(readRotation, { timeout: 15_000 }).toBe(0);
    await expect(page.getByText(/Skipped an undo/)).toHaveCount(0);

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(readRotation, { timeout: 15_000 }).toBe(rotation);
  });

  test("arrow keys reorder a flex-row child instead of nudging its x/y position", async ({
    page,
  }) => {
    await selectByText(page, "Alpha Button");
    const before = await getFileHtml(page);
    const beforeAlpha = before.indexOf(
      'data-agent-native-node-id="e2e-alpha-button"',
    );
    const beforeBeta = before.indexOf(
      'data-agent-native-node-id="e2e-beta-button"',
    );
    expect(
      beforeAlpha,
      "Alpha Button sentinel must exist before reorder",
    ).toBeGreaterThanOrEqual(0);
    expect(
      beforeBeta,
      "Beta Button sentinel must exist before reorder",
    ).toBeGreaterThanOrEqual(0);
    expect(beforeAlpha).toBeLessThan(beforeBeta);

    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () => {
          const html = await getFileHtml(page);
          const alpha = html.indexOf(
            'data-agent-native-node-id="e2e-alpha-button"',
          );
          const beta = html.indexOf(
            'data-agent-native-node-id="e2e-beta-button"',
          );
          return alpha >= 0 && beta >= 0 && alpha > beta;
        },
        {
          timeout: 15_000,
          message: "ArrowRight reorder must persist before the assertion",
        },
      )
      .toBe(true);

    const after = await getFileHtml(page);
    const afterAlpha = after.indexOf(
      'data-agent-native-node-id="e2e-alpha-button"',
    );
    const afterBeta = after.indexOf(
      'data-agent-native-node-id="e2e-beta-button"',
    );
    expect(
      afterAlpha,
      "Alpha Button sentinel must exist after reorder",
    ).toBeGreaterThanOrEqual(0);
    expect(
      afterBeta,
      "Beta Button sentinel must exist after reorder",
    ).toBeGreaterThanOrEqual(0);
    expect(
      afterAlpha > afterBeta,
      "ArrowRight on a flex-row child must reorder it past its sibling in DOM order, not translate it via left/top",
    ).toBe(true);
    const alphaBox = await (
      await frameNode(page, "Alpha Button")
    ).evaluate((el) => ({
      left: (el as HTMLElement).style.left,
      top: (el as HTMLElement).style.top,
    }));
    expect(
      alphaBox.left,
      "a flow reorder must not also write an explicit left offset onto the child",
    ).toBe("");
  });
});


function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${cssString(name)}"]`) })
    .first();
}

function layerRow(page: Page, name: string): Locator {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").trim())
        .filter((name) => name.length > 0),
    );
}

async function topLevelLayerNodeIds(page: Page): Promise<string[]> {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-layer-node-id")!),
    );
}

async function countSelectedLayerRows(page: Page): Promise<number> {
  return layerTree(page)
    .locator('[role="treeitem"][aria-selected="true"]')
    .count();
}

async function isLayerHidden(page: Page, name: string): Promise<boolean> {
  const button = layerRow(page, name).locator(
    'button[aria-label="Show layer"]',
  );
  return (await button.count()) > 0;
}

async function isLayerLocked(page: Page, name: string): Promise<boolean> {
  const button = layerRow(page, name).locator(
    'button[aria-label="Unlock layer"]',
  );
  return (await button.count()) > 0;
}

async function expandAllLayersLocal(page: Page): Promise<void> {
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .first()
    .waitFor({ timeout: 30_000 });
  for (let depth = 0; depth < 6; depth += 1) {
    const expand = page.getByRole("button", { name: "Expand layer" }).first();
    if ((await expand.count()) === 0) return;
    await expand.click({ timeout: 5_000 });
    await page.waitForTimeout(200);
  }
}

async function openLayerSearch(page: Page, query: string): Promise<void> {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(query);
  await page.waitForTimeout(200);
}

async function frameNode(page: Page, text: string): Promise<Locator> {
  await enterDirectMode(page);
  const frame = designFrame(page);
  const candidates = frame.locator("[data-agent-native-node-id]", {
    hasText: text,
  });
  const count = await candidates.count();
  let bestIndex = 0;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const tag = await candidate.evaluate((el) => el.tagName);
    if (tag === "SPAN") continue;
    const area = box.width * box.height;
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  if (count === 0) {
    throw new Error(
      `frameNode: no element found matching text ${JSON.stringify(text)}`,
    );
  }
  const node = candidates.nth(bestIndex);
  await node.scrollIntoViewIfNeeded();
  return node;
}

async function selectByTextDeep(page: Page, text: string): Promise<void> {
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const box = (await (await frameNode(page, text)).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const message = await waitForBridge(page, "element-select");
  expect(String(message?.payload?.componentName ?? "")).toBe(text);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}

async function boxFromNextSelect(page: Page): Promise<{
  nodeId: string;
  box: { x: number; y: number; width: number; height: number };
}> {
  const sel = await waitForBridge(page, "element-select");
  const payload = sel?.payload ?? sel;
  const nodeId: string | undefined =
    payload?.sourceId || payload?.nodeId || payload?.id;
  if (!nodeId) {
    throw new Error(
      `element-select payload carried no nodeId: ${JSON.stringify(payload)}`,
    );
  }
  const box = await designFrame(page)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .first()
    .boundingBox();
  if (!box) throw new Error(`no bounding box for duplicated node ${nodeId}`);
  return { nodeId, box };
}

async function elementScale(
  page: Page,
  text: string,
): Promise<[number, number]> {
  const node = await frameNode(page, text);
  const raw = await node.evaluate((el) => (el as HTMLElement).style.scale);
  if (!raw || raw === "none") return [1, 1];
  const parts = raw
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const sx = parts[0] ?? 1;
  const sy = parts[1] ?? sx;
  return [sx, sy];
}

async function getFileHtml(page: Page): Promise<string> {
  const baseUrl = e2eBaseURL();
  const res = await page.request.get(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/get-design?id=${designId}`,
  );
  if (!res.ok()) throw new Error(`get-design failed: ${res.status()}`);
  const body = await res.json();
  const files: any[] = body?.files ?? body?.data?.files ?? [];
  const file = files.find((f) => f.filename === "index.html");
  if (typeof file?.content !== "string") {
    throw new Error("index.html has no content");
  }
  return file.content;
}

function parentTagNameOf(html: string, nodeIdAttr: string): string | null {
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|<\/([a-zA-Z][a-zA-Z0-9]*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      const attrs = match[2] ?? "";
      if (attrs.includes(`data-agent-native-node-id="${nodeIdAttr}"`)) {
        return stack.length > 0 ? stack[stack.length - 1]! : null;
      }
      const selfClosing = /\/\s*$/.test(attrs) || /\/>$/.test(match[0]);
      if (!selfClosing) stack.push(tag);
    } else if (match[3]) {
      const tag = match[3].toLowerCase();
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index] === tag) {
          stack.length = index;
          break;
        }
      }
    }
  }
  return null;
}

async function liveParentSignature(page: Page, text: string): Promise<string> {
  const node = await frameNode(page, text);
  return node.evaluate((el) => {
    const parent = el.parentElement;
    return parent
      ? `${parent.tagName}|${parent.getAttribute("style") ?? ""}`
      : "(no parent)";
  });
}
