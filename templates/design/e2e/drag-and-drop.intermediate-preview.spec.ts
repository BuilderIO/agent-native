import { expect, test, type Page } from "@playwright/test";

import {
  indexHtml,
  newDesign,
  node,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

const FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="row" data-agent-native-layer-name="Row"
    style="position:absolute;left:60px;top:80px;width:320px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="a" data-agent-native-layer-name="A" style="width:180px;height:48px;background:#6366f1">A</div>
    <div data-agent-native-node-id="b" data-agent-native-layer-name="B" style="width:180px;height:48px;background:#a855f7">B</div>
    <div data-agent-native-node-id="c" data-agent-native-layer-name="C" style="width:180px;height:48px;background:#ec4899">C</div>
  </section>
</body></html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => setBaseURL(testInfo));

function preview(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator("body");
}

async function orderInSource(page: Page, designId: string): Promise<string[]> {
  const html = await indexHtml(page, designId);
  return ["a", "b", "c"].sort(
    (left, right) =>
      html.indexOf(`data-agent-native-node-id="${left}"`) -
      html.indexOf(`data-agent-native-node-id="${right}"`),
  );
}

async function heldPreview(page: Page) {
  return preview(page).evaluate(() => {
    const row = document.querySelector('[data-agent-native-node-id="row"]');
    const source = document.querySelector('[data-agent-native-node-id="a"]');
    const guide = Array.from(
      document.documentElement.querySelectorAll<HTMLElement>(
        "[data-agent-native-insertion-guide]",
      ),
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        getComputedStyle(candidate).display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    if (!row || !source || !guide) return null;
    const rect = guide.getBoundingClientRect();
    const b = document.querySelector('[data-agent-native-node-id="b"]');
    const c = document.querySelector('[data-agent-native-node-id="c"]');
    if (!b || !c) return null;
    const bRect = b.getBoundingClientRect();
    const cRect = c.getBoundingClientRect();
    return {
      slotY: rect.top + rect.height / 2,
      bTop: bRect.top,
      bBottom: bRect.bottom,
      cTop: cRect.top,
      cBottom: cRect.bottom,
      parent: source.parentElement?.getAttribute("data-agent-native-node-id"),
      order: Array.from(row.children).map((child) =>
        child.getAttribute("data-agent-native-node-id"),
      ),
      guideColor: getComputedStyle(guide).backgroundColor,
    };
  });
}

test("held canvas reorder tracks each intermediate insertion slot and is one undo step", async ({
  page,
}) => {
  const id = await newDesign(page, FIXTURE);
  try {
    await openEditor(page, id);
    const a = node(page, "a");
    const [aBox, bBox, cBox] = await Promise.all([
      a.boundingBox(),
      node(page, "b").boundingBox(),
      node(page, "c").boundingBox(),
    ]);
    if (!aBox || !bBox || !cBox)
      throw new Error("fixture nodes are not visible");
    await page.mouse.click(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2);
    await page.waitForTimeout(500);
    await page.mouse.dblclick(
      aBox.x + aBox.width / 2,
      aBox.y + aBox.height / 2,
    );
    await page.waitForTimeout(900);
    const start = { x: aBox.x + aBox.width / 2, y: aBox.y + aBox.height / 2 };
    const slots: Array<{
      x: number;
      y: number;
      targetEdge: "bBottom" | "cTop";
    }> = [
      {
        x: bBox.x + bBox.width / 2,
        y: bBox.y + bBox.height * 0.85,
        targetEdge: "bBottom",
      },
      {
        x: cBox.x + cBox.width / 2,
        y: cBox.y + cBox.height * 0.25,
        targetEdge: "cTop",
      },
      {
        x: bBox.x + bBox.width / 2,
        y: bBox.y + bBox.height * 0.85,
        targetEdge: "bBottom",
      },
    ];
    const before = await indexHtml(page, id);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      await page.mouse.move(start.x + 10, start.y + 6, { steps: 5 });
      const sampleYs: number[] = [];
      for (const slot of slots) {
        await page.mouse.move(slot.x, slot.y, { steps: 8 });
        await expect
          .poll(
            async () => {
              const held = await heldPreview(page);
              const targetEdge = held?.[slot.targetEdge];
              return held && targetEdge !== undefined
                ? Math.abs(Math.round(held.slotY - targetEdge))
                : null;
            },
            { timeout: 5_000 },
          )
          .toBe(0);
        const held = await heldPreview(page);
        expect(held).not.toBeNull();
        sampleYs.push(held!.slotY);
        expect(held!.parent).toBe("row");
        expect(held!.order).toEqual(["a", "b", "c"]);
        expect(held!.guideColor).toBe("rgb(15, 155, 255)");
        expect(await indexHtml(page, id)).toBe(before);
      }
      expect(
        sampleYs
          .slice(1)
          .every((sampleY, index) => Math.abs(sampleY - sampleYs[index]!) > 4),
      ).toBe(true);
    } finally {
      await page.mouse.up();
    }
    await expect.poll(() => orderInSource(page, id)).toEqual(["b", "a", "c"]);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Z" : "Control+Z",
    );
    await expect.poll(() => orderInSource(page, id)).toEqual(["a", "b", "c"]);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z",
    );
    await expect.poll(() => orderInSource(page, id)).toEqual(["b", "a", "c"]);
  } finally {
    await postAction(page, "delete-design", { id });
  }
});
