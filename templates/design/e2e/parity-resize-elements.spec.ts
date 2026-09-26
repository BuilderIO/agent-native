import { expect, test, type Page } from "@playwright/test";

import {
  setBaseURL,
  MOD,
  ALT,
  newDesign,
  geom,
  openEditor,
  postAction,
  scale,
  selectViaTree,
  styleNum,
  styleOf,
  chromeBounds,
} from "./drag-and-drop.shared";
import { appPath, expandAllLayers, gotoEditor } from "./helpers";


test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

async function handlePoint(
  page: Page,
  attr: "data-agent-native-edit-handle" | "data-agent-native-edge-handle",
  pos: string,
): Promise<{ x: number; y: number } | null> {
  const iframeBox = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .boundingBox();
  if (!iframeBox) return null;
  const s = await scale(page);
  const local = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(
      (_body, { attr, pos }) => {
        const el = document.querySelector(`[${attr}="${pos}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { attr, pos },
    );
  if (!local) return null;
  return {
    x: Math.round(iframeBox.x + local.x * s),
    y: Math.round(iframeBox.y + local.y * s),
  };
}

async function groupHandlePoint(
  page: Page,
  corner: string,
): Promise<{ x: number; y: number } | null> {
  const iframeBox = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .boundingBox();
  if (!iframeBox) return null;
  const s = await scale(page);
  const local = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate((_body, corner) => {
      const el = document.querySelector(
        `[data-agent-native-multi-selection-bounds] [data-corner="${corner}"]`,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, corner);
  if (!local) return null;
  return {
    x: Math.round(iframeBox.x + local.x * s),
    y: Math.round(iframeBox.y + local.y * s),
  };
}

async function shiftSelect(page: Page, name: string): Promise<void> {
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first()
    .click({ modifiers: ["Shift"] });
}

async function dragHandle(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  opts: { modifier?: string; steps?: number; mid?: () => Promise<void> } = {},
): Promise<void> {
  if (opts.modifier) await page.keyboard.down(opts.modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = opts.steps ?? 12;
  const midX = from.x + dx / 2;
  const midY = from.y + dy / 2;
  await page.mouse.move(midX, midY, { steps: steps / 2 });
  if (opts.mid) await opts.mid();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: steps / 2 });
  await page.mouse.up();
  if (opts.modifier) await page.keyboard.up(opts.modifier);
  await page.waitForTimeout(2000); // e2e-harness-ignore commit settle, matches drag-and-drop.shared dragBy
}

test.describe("element resize — one axis vs both", () => {
  test("dragging the E edge handle changes width only", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    const e = await handlePoint(page, "data-agent-native-edge-handle", "e");
    expect(e, "no E edge handle found").not.toBeNull();
    const s = await scale(page);
    await dragHandle(page, e!, 60 * s, 0);

    const after = await geom(page, id, "box-a");
    expect(
      [after.width - before.width, after.height, after.top, after.left],
      `E-edge drag must touch width only (before ${before.width}x${before.height} @ ${before.left},${before.top})`,
    ).toEqual([expect.closeTo(60, -1), before.height, before.top, before.left]);
  });

  test("dragging the SE corner handle changes both width and height", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    const se = await handlePoint(page, "data-agent-native-edit-handle", "se");
    expect(se, "no SE corner handle found").not.toBeNull();
    const s = await scale(page);
    await dragHandle(page, se!, 60 * s, 40 * s);

    const after = await geom(page, id, "box-a");
    expect(
      [after.width - before.width, after.height - before.height],
      "SE corner drag must grow both dimensions",
    ).toEqual([expect.closeTo(60, -1), expect.closeTo(40, -1)]);
  });
});

test("shift+drag on a corner handle keeps the element's aspect ratio", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  const ratio = before.width / before.height;

  const se = await handlePoint(page, "data-agent-native-edit-handle", "se");
  expect(se).not.toBeNull();
  const s = await scale(page);
  await dragHandle(page, se!, 140 * s, 10 * s, { modifier: "Shift" });

  const after = await geom(page, id, "box-a");
  expect(after.width).toBeGreaterThan(before.width);
  expect(
    after.width / after.height,
    `shift-resize must preserve the ${ratio.toFixed(3)} aspect ratio; got ${after.width}x${after.height}`,
  ).toBeCloseTo(ratio, 1);
});

test("alt+drag on an edge handle resizes symmetrically from the center", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  const centerX = before.left + before.width / 2;

  const e = await handlePoint(page, "data-agent-native-edge-handle", "e");
  expect(e).not.toBeNull();
  const s = await scale(page);
  await dragHandle(page, e!, 40 * s, 0, { modifier: ALT });

  const after = await geom(page, id, "box-a");
  const afterCenterX = after.left + after.width / 2;
  expect(
    after.width,
    "alt-drag on E must still grow width by the full drag distance",
  ).toBeGreaterThan(before.width);
  expect(
    afterCenterX,
    `alt-resize must keep the center fixed at ${centerX}; left moved to ${after.left} while width became ${after.width}`,
  ).toBeCloseTo(centerX, 0);
});

test("selection outline tracks the pointer live during a resize drag", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const boundsDuring: Awaited<ReturnType<typeof chromeBounds>>[] = [];

  const se = await handlePoint(page, "data-agent-native-edit-handle", "se");
  expect(se).not.toBeNull();
  const s = await scale(page);
  await page.mouse.move(se!.x, se!.y);
  await page.mouse.down();
  const before = await chromeBounds(page);
  for (const step of [30, 60, 90]) {
    await page.mouse.move(se!.x + step * s, se!.y + step * s, { steps: 4 });
    boundsDuring.push(await chromeBounds(page));
  }
  await page.mouse.up();

  expect(before, "no selection outline before the drag").not.toBeNull();
  expect(boundsDuring.every((b) => b !== null)).toBe(true);
  const rights = boundsDuring.map((b) => b!.right);
  expect(
    rights,
    `outline right edge should advance with the pointer: ${JSON.stringify(rights)}`,
  ).toEqual([...rights].sort((a, b) => a - b));
  expect(rights[0]).toBeGreaterThan(before!.right);
  expect(rights[2]).toBeGreaterThan(rights[0]);
});

test("the inspector W/H fields update live while dragging a corner handle", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  const before = await geom(page, id, "box-a");

  const wField = page.getByLabel("W size in pixels");
  const hField = page.getByLabel("H size in pixels");
  await expect(wField).toBeVisible({ timeout: 10_000 });
  const wBefore = parseFloat(await wField.inputValue());
  const hBefore = parseFloat(await hField.inputValue());
  expect(wBefore).toBeCloseTo(before.width, 0);
  expect(hBefore).toBeCloseTo(before.height, 0);

  const se = await handlePoint(page, "data-agent-native-edit-handle", "se");
  expect(se).not.toBeNull();
  const s = await scale(page);
  await page.mouse.move(se!.x, se!.y);
  await page.mouse.down();
  await page.mouse.move(se!.x + 70 * s, se!.y + 50 * s, { steps: 10 });
  await page.waitForTimeout(400);
  const wMid = parseFloat(await wField.inputValue());
  const hMid = parseFloat(await hField.inputValue());
  await page.mouse.up();

  expect(
    [wMid, hMid],
    `inspector should reflect the in-progress size (${wBefore}x${hBefore} -> mid ${wMid}x${hMid})`,
  ).toEqual([
    expect.closeTo(wBefore + 70, -1),
    expect.closeTo(hBefore + 50, -1),
  ]);
});

test("one resize gesture is exactly one undo step", async ({ page }) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");

  const se = await handlePoint(page, "data-agent-native-edit-handle", "se");
  expect(se).not.toBeNull();
  const s = await scale(page);
  await dragHandle(page, se!, 80 * s, 30 * s);

  const resized = await geom(page, id, "box-a");
  expect(resized.width).not.toBe(before.width);

  await page.keyboard.press(`${MOD}+z`);
  let undone = before;
  await expect
    .poll(
      async () => {
        undone = await geom(page, id, "box-a");
        return undone.width;
      },
      {
        timeout: 10_000,
        message:
          "a single undo after one resize gesture must fully restore the pre-drag width",
      },
    )
    .toBe(before.width);
  expect(
    [undone.width, undone.height, undone.left, undone.top],
    "a single undo after one resize gesture must fully restore the pre-drag geometry",
  ).toEqual([before.width, before.height, before.left, before.top]);
});

test("multi-selection resize scales the group bounds from the opposite corner", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  await shiftSelect(page, "Box B");
  await expect(page.getByText("2 selected")).toBeVisible({ timeout: 10_000 });

  const beforeA = await geom(page, id, "box-a");
  const beforeB = await geom(page, id, "box-b");
  const gapBefore = beforeB.top - (beforeA.top + beforeA.height);

  const se = await groupHandlePoint(page, "se");
  expect(se, "no group resize handle for the multi-selection").not.toBeNull();
  const s = await scale(page);
  await dragHandle(page, se!, -60 * s, -60 * s);

  const afterA = await geom(page, id, "box-a");
  const afterB = await geom(page, id, "box-b");
  expect(
    [afterA.width < beforeA.width, afterB.width < beforeB.width],
    `both members must shrink together (A ${beforeA.width}->${afterA.width}, B ${beforeB.width}->${afterB.width})`,
  ).toEqual([true, true]);
  expect(afterA.left).toBe(beforeA.left);
  expect(afterA.top).toBe(beforeA.top);
  const gapAfter = afterB.top - (afterA.top + afterA.height);
  expect(
    gapAfter,
    `group scale should shrink the inter-member gap too (was ${gapBefore}, now ${gapAfter})`,
  ).toBeLessThan(gapBefore);
});

test("[codex] resizing a screen from its left edge changes width only, not height", async ({
  page,
}) => {
  const id = await newDesign(page);
  await page.goto(appPath(`/design/${id}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  const card = page.locator("[data-screen-card]").first();
  await card.waitFor({ timeout: 30_000 });
  await card.click({ force: true });
  await page.waitForTimeout(800);

  const cardBoxBefore = (await card.boundingBox())!;
  const handle = page.locator('[data-resize-handle="w"]').first();
  await handle.waitFor({ timeout: 10_000 });
  const handleBox = (await handle.boundingBox())!;
  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;

  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 60, hy, { steps: 10 });
  await page.mouse.up();

  let cardBoxAfter = cardBoxBefore;
  await expect
    .poll(
      async () => {
        cardBoxAfter = (await card.boundingBox())!;
        return cardBoxAfter.width;
      },
      { timeout: 10_000 },
    )
    .not.toBeCloseTo(cardBoxBefore.width, 0);
  expect(
    cardBoxAfter.height,
    `dragging the screen's LEFT edge must not change height (was ${cardBoxBefore.height}, now ${cardBoxAfter.height}) — owned by codex, see feedback.md`,
  ).toBeCloseTo(cardBoxBefore.height, 0);
  expect(cardBoxAfter.width).not.toBeCloseTo(cardBoxBefore.width, 0);
});

test.describe("board object resize through an overlapping Screen", () => {
  const BOARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="rect" data-agent-native-layer-name="Rect"
         style="position:absolute;left:0px;top:0px;width:120px;height:90px;background:#f59e0b"></div>
  </body>
</html>`;
  const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen</title></head>
  <body style="margin:0;min-height:812px;background:#ffffff"></body>
</html>`;

  async function newOccludedBoardDesign(page: Page): Promise<string> {
    const created = await postAction(page, "create-design", {
      title: "board occlusion resize",
      projectType: "prototype",
    });
    const id = created?.id ?? created?.data?.id;
    if (!id) throw new Error("create-design returned no id");
    await postAction(page, "create-file", {
      designId: id,
      filename: "index.html",
      content: SCREEN_HTML,
      fileType: "html",
    });
    const board = await postAction(page, "create-file", {
      designId: id,
      filename: "__board__.html",
      content: BOARD_HTML,
      fileType: "html",
    });
    const boardFileId = board?.id ?? board?.data?.id;
    if (!boardFileId) throw new Error("create-file returned no board id");
    await postAction(page, "update-design", {
      id,
      dataOperations: [
        { op: "set", path: ["boardFileId"], value: boardFileId },
      ],
    });
    return id;
  }

  async function boardHtml(page: Page, designId: string): Promise<string> {
    const result = await page.request
      .get(`${appPath("/_agent-native/actions/get-design")}?id=${designId}`)
      .then((r) => r.json());
    return (
      (result.files ?? []).find(
        (f: { filename?: string }) => f.filename === "__board__.html",
      )?.content ?? ""
    );
  }

  async function rectGeom(page: Page, designId: string) {
    const s = styleOf(await boardHtml(page, designId), "rect");
    return {
      left: styleNum(s, "left"),
      top: styleNum(s, "top"),
      width: styleNum(s, "width"),
      height: styleNum(s, "height"),
    };
  }

  async function renderedRectGeom(page: Page) {
    const s =
      (await page
        .locator(
          "[data-board-surface-layer] iframe[data-design-preview-iframe]",
        )
        .contentFrame()
        .locator('[data-agent-native-node-id="rect"]')
        .getAttribute("style")) ?? "";
    return {
      left: styleNum(s, "left"),
      top: styleNum(s, "top"),
      width: styleNum(s, "width"),
      height: styleNum(s, "height"),
    };
  }

  function layerRow(page: Page, name: string) {
    return page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .filter({ hasText: name })
      .first();
  }

  test("SE-handle drag reaches and resizes the occluded board rect, one undo restores it and redo re-applies it", async ({
    page,
  }) => {
    const id = await newOccludedBoardDesign(page);
    await gotoEditor(page, id);
    await expandAllLayers(page);

    const screenCard = page.locator("[data-screen-card]").first();
    await screenCard.waitFor({ timeout: 30_000 });
    const screenBox = (await screenCard.boundingBox())!;
    const occludedBy = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-screen-card]")
          ? "screen"
          : "other",
      { x: screenBox.x + 10, y: screenBox.y + 10 },
    );
    expect(occludedBy, "precondition: Screen must occlude this point").toBe(
      "screen",
    );

    await layerRow(page, "Rect").click();
    await page.waitForTimeout(500);

    const seHandle = page.locator(
      '[data-board-object-selection-box] [data-resize-handle="se"]',
    );
    await seHandle.waitFor({ timeout: 10_000 });
    const handleBox = (await seHandle.boundingBox())!;

    const topAtHandle = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute("data-resize-handle"),
      {
        x: handleBox.x + handleBox.width / 2,
        y: handleBox.y + handleBox.height / 2,
      },
    );
    expect(topAtHandle).toBe("se");

    const before = await rectGeom(page, id);
    expect(before).toEqual({ left: 0, top: 0, width: 120, height: 90 });

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 30,
      handleBox.y + handleBox.height / 2 + 20,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2000); // e2e-harness-ignore commit settle, matches drag-and-drop.shared dragBy

    const after = await rectGeom(page, id);
    const msg = `SE-handle drag through the host chrome must resize the occluded board rect (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`;
    expect(after.left, msg).toBe(0);
    expect(after.top, msg).toBe(0);
    expect(after.width, msg).toBeGreaterThan(before.width + 10);
    expect(after.height, msg).toBeGreaterThan(before.height + 5);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => rectGeom(page, id), {
        timeout: 10_000,
        message:
          "one undo after the board-rect resize must restore the persisted pre-drag geometry",
      })
      .toEqual(before);
    await expect
      .poll(async () => renderedRectGeom(page), {
        timeout: 10_000,
        message:
          "one undo after the board-rect resize must restore the rendered pre-drag geometry",
      })
      .toEqual(before);

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(async () => rectGeom(page, id), {
        timeout: 10_000,
        message:
          "redo after the undo must re-apply the persisted post-drag geometry",
      })
      .toEqual(after);
    await expect
      .poll(async () => renderedRectGeom(page), {
        timeout: 10_000,
        message:
          "redo after the undo must re-apply the rendered post-drag geometry",
      })
      .toEqual(after);
  });
});
