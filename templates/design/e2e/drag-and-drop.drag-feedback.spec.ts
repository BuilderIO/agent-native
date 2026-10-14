import { type Page } from "@playwright/test";

import {
  FIXTURE,
  layerRow,
  openEditor,
  setBaseURL,
  toolbar,
} from "./drag-and-drop.shared";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

const SNAP_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f1115">
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:100px;top:100px;width:120px;height:80px;background:#3b82f6"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:400px;top:300px;width:120px;height:80px;background:#22c55e"></div>
</body></html>`;

/** Visible editor overlays inside the live screen, with their boxes in design pixels. */
async function overlays(page: Page) {
  return page
    .frameLocator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .locator("body")
    .evaluate(() =>
      Array.from(document.querySelectorAll("[data-agent-native-edit-overlay]"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            kind: element.getAttribute("data-agent-native-edit-overlay") ?? "",
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((overlay) => overlay.width > 0 || overlay.height > 0),
    );
}

async function clickCentre(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  return point;
}

function bodyChildren(
  nodes: Map<string, { tag: string; parent: string | null; index: number }>,
) {
  const body = [...nodes.entries()].find(
    ([, node]) => node.tag === "body",
  )?.[0];
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === body)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

test.describe("drag feedback", () => {
  test("snap guides appear when an edge aligns with a sibling", async ({
    app,
    page,
  }) => {
    const id = await app.seed(SNAP_HTML);
    await app.open(id);
    await app.zoomToFit();
    const grab = await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);
    const nearlyFlush = await app.pagePoint(402 + 60, 218 + 40);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    const distance = Math.hypot(nearlyFlush.x - grab.x, nearlyFlush.y - grab.y);
    await page.mouse.move(nearlyFlush.x, nearlyFlush.y, {
      steps: Math.ceil(distance / 3),
    });
    await expect
      .poll(async () => (await overlays(page)).map((overlay) => overlay.kind))
      .toContain("snap-guide");
    expect(await app.savedNodes(id)).toEqual(before);
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual({
      ...styleOf(before.get("box-a")),
      left: "400px",
      top: "220px",
    });
    expectOnlyChanged(before, after, ["box-a"]);
    expect(await app.designRect("box-a")).toEqual({
      x: 400,
      y: 220,
      width: 120,
      height: 80,
    });
  });

  test("dragging Box A over the empty Container highlights exactly the Container and drops Box A into it", async ({
    app,
    page,
  }) => {
    const id = await app.seed(FIXTURE);
    await app.open(id);
    const grab = await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);
    const container = await app.designRect("frame-a");
    const over = await app.pagePoint(
      container.x + container.width / 2,
      container.y + container.height / 2,
    );

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 18 });
    await expect
      .poll(async () =>
        (await overlays(page)).filter(
          (overlay) => overlay.kind === "insertion-guide",
        ),
      )
      .toHaveLength(1);
    const [highlight] = (await overlays(page)).filter(
      (overlay) => overlay.kind === "insertion-guide",
    );
    expect({ x: highlight!.x, y: highlight!.y }).toEqual({
      x: container.x,
      y: container.y,
    });
    expect(highlight!.width - container.width).toBeGreaterThanOrEqual(0);
    expect(highlight!.width - container.width).toBeLessThanOrEqual(12);
    expect(highlight!.height - container.height).toBeGreaterThanOrEqual(0);
    expect(highlight!.height - container.height).toBeLessThanOrEqual(12);
    expect(await app.savedNodes(id)).toEqual(before);
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("box-a")?.parent).toBe("frame-a");
    expectOnlyChanged(before, after, ["box-a", "frame-a"]);
  });

  test("dragging Box A's layer row above Box B shows an insertion line and moves Box A in front of Box B", async ({
    app,
    page,
  }) => {
    const id = await app.seed(FIXTURE);
    await openEditor(page, id);
    const before = await app.savedNodes(id);
    expect(bodyChildren(before)).toEqual(["frame-a", "box-a", "box-b", "row"]);
    const src = (await layerRow(page, "Box A").boundingBox())!;
    const dst = (await layerRow(page, "Box B").boundingBox())!;

    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 - 8, {
      steps: 4,
    });
    await page.mouse.move(dst.x + dst.width / 2, dst.y + 3, { steps: 14 });
    await expect(page.locator("[data-layer-drop-indicator]")).toHaveCount(1);
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(bodyChildren(after)).toEqual(["frame-a", "box-b", "box-a", "row"]);
    expectOnlyChanged(before, after, []);
    const rows = await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .allInnerTexts();
    expect(
      rows
        .map((row) => row.trim())
        .filter((row) => row === "Box A" || row === "Box B"),
    ).toEqual(["Box A", "Box B"]);
  });

  test("the canvas shows the default cursor with the Move tool and the grab cursor with the Hand tool", async ({
    app,
    page,
  }) => {
    const id = await app.seed(FIXTURE);
    await app.open(id);
    const cursor = () =>
      page.evaluate(() => {
        const surface = document.querySelector(
          "[data-multi-screen-canvas-world]",
        )?.parentElement;
        return surface ? getComputedStyle(surface).cursor : null;
      });
    expect(await cursor()).toBe("default");
    await toolbar(page).locator('button[aria-label="Move options"]').click();
    await page.getByRole("menuitem", { name: /Hand/i }).first().click();
    await expect.poll(cursor).toBe("grab");
  });
});
