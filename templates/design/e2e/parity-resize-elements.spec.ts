import { expect, test, type Page } from "@playwright/test";

import {
  setBaseURL,
  MOD,
  ALT,
  newDesign,
  geom,
  openEditor,
  scale,
  selectViaTree,
  chromeBounds,
} from "./drag-and-drop.shared";
import { appPath } from "./helpers";

/**
 * Figma parity: §3 Resize + Part 3 resolutions.
 * - Corner handle = both dims; edge handle = one dim only.
 * - Shift locks aspect ratio on any handle; Alt resizes symmetrically from
 *   the element's center.
 * - One resize gesture = one undo step.
 * - Multi-selection resize (plain drag, no tool switch) scales the group
 *   bounds, anchored at the opposite corner.
 *
 * Handle attributes (bridge/editor-chrome.bridge.ts): corners carry
 * data-agent-native-edit-handle="nw|ne|se|sw"; edges carry
 * data-agent-native-edge-handle="n|e|s|w"; a 2+ selection's group handles
 * carry data-corner on [data-agent-native-multi-selection-bounds].
 */

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

/** A resize/edge handle's center, in host page coordinates. */
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

/** Corner handle on a live 2+ element multi-selection's group bounds box. */
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
  // The layers tree row click, not a canvas click: additive-select via the
  // panel avoids relying on canvas hit-testing for the second member.
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first()
    .click({ modifiers: ["Shift"] });
}

/** Manual mouse-driven drag so intermediate positions can be sampled. */
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
  // An asymmetric drag (much more X than Y): if the ratio lock is real, the
  // resulting box still matches the ORIGINAL ratio, not one skewed toward X.
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
  // The outline must grow monotonically with the pointer, not jump straight
  // to the final size or stay frozen at the start size.
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
  // NW is the anchor for an SE-handle drag: the group's top-left member (A)
  // keeps its own top-left corner fixed.
  expect(afterA.left).toBe(beforeA.left);
  expect(afterA.top).toBe(beforeA.top);
  // The proportional gap between the two members' vertical bands is
  // preserved by a uniform group scale, not collapsed to a fixed pixel gap.
  const gapAfter = afterB.top - (afterA.top + afterA.height);
  expect(
    gapAfter,
    `group scale should shrink the inter-member gap too (was ${gapBefore}, now ${gapAfter})`,
  ).toBeLessThan(gapBefore);
});

/**
 * Steve's report (2026-09-12): dragging a screen's LEFT edge also changed
 * its HEIGHT. Screen-frame resize is owned by the Codex peer; this one case
 * documents the delta from this agent's side without attempting a fix.
 */
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
