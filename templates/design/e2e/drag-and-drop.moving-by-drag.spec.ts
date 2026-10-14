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
    expect(
      [dx / 120 > 0.9 && dx / 120 < 1.1, dy / 60 > 0.9 && dy / 60 < 1.1],
      `dragged (120,60) page px; moved (${dx},${dy}) — expected within 10%`,
    ).toEqual([true, true]);
  });

  test("dropping over a sibling keeps the moved position after reload", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");

    const beforeB = (await node(page, "box-b").boundingBox())!;
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 0, 160, {
      settle: false,
    });

    await expect
      .poll(async () => {
        const moved = await node(page, "box-a").boundingBox();
        return moved && [moved.x, moved.y];
      })
      .toEqual([beforeB.x, beforeB.y]);
    const parentBeforeReload = await node(page, "box-a").evaluate((element) =>
      element.parentElement?.getAttribute("data-agent-native-node-id"),
    );

    await openEditor(page, id);
    const afterReload = await node(page, "box-a").boundingBox();
    expect(afterReload?.x).toBeCloseTo(beforeB.x, 0);
    expect(afterReload?.y).toBeCloseTo(beforeB.y, 0);
    expect(
      await node(page, "box-a").evaluate((element) =>
        element.parentElement?.getAttribute("data-agent-native-node-id"),
      ),
    ).toBe(parentBeforeReload);
    const html = await indexHtml(page, id);
    expect(
      (html.match(/data-agent-native-node-id="box-a"/g) ?? []).length,
    ).toBe(1);
    expect(
      (html.match(/data-agent-native-node-id="box-b"/g) ?? []).length,
    ).toBe(1);
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
    const screenFrame = page
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame();
    await expect
      .poll(() =>
        screenFrame
          .locator('[data-agent-native-transient-drag-clone="true"]')
          .count(),
      )
      .toBe(0);
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
