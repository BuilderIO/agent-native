import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  ALT,
  newDesign,
  indexHtml,
  geom,
  node,
  openEditor,
  selectViaTree,
  dragBy,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("moving by drag", () => {
  test("a drag moves the element by the drag delta", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 120, 60, {
      settle: false,
    });
    await expect
      .poll(async () => (await geom(page, id, "box-a")).left - before.left)
      .toBeGreaterThan(60);
    const after = await geom(page, id, "box-a");
    const dx = after.left - before.left;
    const dy = after.top - before.top;
    // A drag-start threshold consumes the first few px (Figma does the same),
    // so assert the movement is proportional rather than exact.
    expect(
      [dx / 120 > 0.9 && dx / 120 < 1.1, dy / 60 > 0.9 && dy / 60 < 1.1],
      `dragged (120,60) page px; moved (${dx},${dy}) — expected within 10%`,
    ).toEqual([true, true]);
  });

  test("Shift+drag locks movement to one axis", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 120, 30, {
      modifier: "Shift",
      settle: false,
    });
    await expect
      .poll(async () => (await geom(page, id, "box-a")).left - before.left)
      .toBeGreaterThan(60);
    const after = await geom(page, id, "box-a");
    // Assert the free axis moved too: locking is only meaningful if the drag
    // happened, and `top` alone is satisfied by a drag that does nothing.
    expect(
      after.left - before.left,
      `Shift+drag should still move along the free axis (${before.left} → ${after.left})`,
    ).toBeGreaterThan(60);
    expect(
      after.top,
      `Shift+drag moved mostly horizontally but top changed ${before.top} → ${after.top}`,
    ).toBe(before.top);
  });

  test("Alt+drag leaves the original and creates a copy", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await indexHtml(page, id);
    const countBefore = (
      before.match(/data-agent-native-layer-name="Box A"/g) ?? []
    ).length;
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 150, 0, {
      modifier: ALT,
    });
    const after = await indexHtml(page, id);
    expect(
      (after.match(/data-agent-native-layer-name="Box A"/g) ?? []).length,
      `Alt+drag should duplicate; Box A count stayed ${countBefore}`,
    ).toBeGreaterThan(countBefore);
  });

  test("Escape during a drag cancels the move", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 200, 100, {
      cancel: true,
    });
    const after = await geom(page, id, "box-a");
    expect(
      [after.left, after.top],
      "Escape mid-drag must restore the start position",
    ).toEqual([before.left, before.top]);
  });
});
