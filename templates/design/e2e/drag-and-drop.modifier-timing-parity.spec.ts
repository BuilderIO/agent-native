import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  indexHtml,
  newDesign,
  node,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

const CONTROL_FIXTURE = `<!doctype html>
<html><body style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="control-row" data-agent-native-layer-name="Control Row"
    style="position:absolute;left:80px;top:80px;width:360px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px;background:#1f2937">
    <div data-agent-native-node-id="control-child" data-agent-native-layer-name="Control Child"
      style="width:100px;height:48px;background:#6366f1">Control Child</div>
    <div data-agent-native-node-id="control-peer" data-agent-native-layer-name="Control Peer"
      style="width:100px;height:48px;background:#a855f7">Control Peer</div>
  </section>
  <section data-agent-native-node-id="control-target-row" data-agent-native-layer-name="Control Target Row"
    style="position:absolute;left:520px;top:80px;width:280px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px;background:#374151">
    <div data-agent-native-node-id="control-target-peer" data-agent-native-layer-name="Control Target Peer"
      style="width:100px;height:48px;background:#ec4899">Control Target Peer</div>
  </section>
</body></html>`;

const GRID_FLOW_ALT_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="grid-flow" data-agent-native-layer-name="Grid Flow"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="grid-flow-source" data-agent-native-layer-name="Grid Flow Source"
      style="grid-column:1;grid-row:1;width:120px;height:56px;background:#6366f1">Source</div>
    <div data-agent-native-node-id="grid-flow-peer" data-agent-native-layer-name="Grid Flow Peer"
      style="width:120px;height:56px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

const COPY_FIXTURE = `<!doctype html>
<html><body style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="copy-source" data-agent-native-layer-name="Copy Source"
    style="position:absolute;left:80px;top:80px;width:120px;height:64px;background:#6366f1">Copy Source</div>
  <div data-agent-native-node-id="copy-peer" data-agent-native-layer-name="Copy Peer"
    style="position:absolute;left:300px;top:80px;width:120px;height:64px;background:#a855f7">Copy Peer</div>
</body></html>`;

const META_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="meta-row" data-agent-native-layer-name="Meta Row"
    style="position:absolute;left:60px;top:80px;width:300px;height:100px;padding:16px;display:flex;flex-direction:row;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="meta-child" data-agent-native-layer-name="Meta Child" style="width:100px;height:48px;background:#6366f1">Child</div>
    <div data-agent-native-node-id="meta-peer" data-agent-native-layer-name="Meta Peer" style="width:100px;height:48px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

const COMMAND_FIXTURE = `<!doctype html>
<html><body style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="command-source-row" data-agent-native-layer-name="Command Source Row"
    style="position:absolute;left:60px;top:360px;width:320px;height:120px;padding:16px;box-sizing:border-box;display:flex;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="command-source" data-agent-native-layer-name="Command Source"
      style="width:260px;height:80px;background:#6366f1">Command Source</div>
  </section>
  <section data-agent-native-node-id="command-target-row" data-agent-native-layer-name="Command Target Row"
    style="position:absolute;left:460px;top:80px;width:190px;height:140px;padding:16px;box-sizing:border-box;display:flex;gap:12px;background:#374151">
    <div data-agent-native-node-id="command-peer" data-agent-native-layer-name="Command Peer"
      style="width:80px;height:64px;background:#a855f7">Command Peer</div>
  </section>
</body></html>`;

function preview(page: Page): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body");
}

async function deleteDesign(page: Page, designId: string): Promise<void> {
  await postAction(page, "delete-design", { id: designId }).catch(() => {});
}

async function selectCanvasNode(page: Page, rawNodeId: string): Promise<void> {
  const layerName = await node(page, rawNodeId).getAttribute(
    "data-agent-native-layer-name",
  );
  if (!layerName) throw new Error(`missing layer name for ${rawNodeId}`);
  const tree = page.getByRole("tree", { name: "Layers" });
  const row = tree
    .getByRole("button", { name: layerName, exact: true })
    .first();
  await expect(row).toBeVisible();
  await row.click({ force: true });
  await expect(
    tree.locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
    ),
  ).toHaveCount(1);
}

async function previewPoint(
  page: Page,
  cssX: number,
  cssY: number,
): Promise<{ x: number; y: number }> {
  const iframe = page.locator("iframe[data-design-preview-iframe]").first();
  const iframeBox = await iframe.boundingBox();
  if (!iframeBox) throw new Error("preview iframe has no box");
  const size = await preview(page).evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  return {
    x: iframeBox.x + (cssX / size.width) * iframeBox.width,
    y: iframeBox.y + (cssY / size.height) * iframeBox.height,
  };
}

async function runtimeState(page: Page, id: string) {
  return node(page, id).evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const rect = htmlElement.getBoundingClientRect();
    const parent = htmlElement.parentElement;
    return {
      parent:
        parent?.tagName === "BODY"
          ? "BODY"
          : (parent?.getAttribute("data-agent-native-node-id") ??
            parent?.tagName ??
            null),
      position: getComputedStyle(htmlElement).position,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      transform: getComputedStyle(htmlElement).transform,
      name: htmlElement.getAttribute("data-agent-native-layer-name"),
      style: htmlElement.getAttribute("style") ?? "",
    };
  });
}

async function visibleInsertionGuides(page: Page) {
  return preview(page)
    .locator("[data-agent-native-insertion-guide]")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const htmlElement = element as HTMLElement;
          const style = getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return {
            display: style.display,
            width: rect.width,
            height: rect.height,
            borderTop: style.borderTopWidth,
            borderLeft: style.borderLeftWidth,
          };
        })
        .filter(
          (guide) =>
            guide.display !== "none" && guide.width > 0 && guide.height > 0,
        ),
    );
}

async function visibleDuplicateState(page: Page) {
  return preview(page)
    .locator("[data-agent-native-clone-root]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        return {
          id: htmlElement.getAttribute("data-agent-native-node-id"),
          name: htmlElement.getAttribute("data-agent-native-layer-name"),
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          visible: getComputedStyle(htmlElement).display !== "none",
        };
      }),
    );
}

async function htmlNodeCount(html: string, name: string): Promise<number> {
  return (
    html.match(new RegExp(`data-agent-native-layer-name="${name}"`, "g")) ?? []
  ).length;
}

test("literal Control after pointerdown removes a flow child from flow and it returns cleanly", async ({
  page,
}) => {
  const designId = await newDesign(page, CONTROL_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "control-child");
    const source = (await node(page, "control-child").boundingBox())!;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const targetPeerBefore = await node(
      page,
      "control-target-peer",
    ).boundingBox();
    expect(targetPeerBefore).not.toBeNull();
    const target = {
      x: targetPeerBefore!.x + targetPeerBefore!.width / 2,
      y: targetPeerBefore!.y + targetPeerBefore!.height / 2,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 5, start.y + 4, { steps: 2 });
    await page.keyboard.down("Control");
    await page.mouse.move(target.x, target.y, { steps: 18 });
    await page.waitForTimeout(120);

    const held = await runtimeState(page, "control-child");
    const peerHeld = await node(page, "control-target-peer").boundingBox();
    const guidesHeld = await visibleInsertionGuides(page);
    expect(held.transform).not.toBe("none");
    expect(peerHeld).toMatchObject({
      x: expect.closeTo(targetPeerBefore!.x, 2),
      y: expect.closeTo(targetPeerBefore!.y, 2),
    });
    expect(
      guidesHeld.every(
        (guide) => guide.borderTop === "0px" || guide.borderLeft !== "0px",
      ),
      JSON.stringify({ held, guidesHeld }),
    ).toBe(true);

    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect
      .poll(() => indexHtml(page, designId))
      .toMatch(
        /data-agent-native-node-id="control-child"[^>]*position:\s*absolute/i,
      );

    const ignored = await runtimeState(page, "control-child");
    expect(ignored).toMatchObject({
      parent: "control-target-row",
      position: "absolute",
    });
    expect(ignored.name).toBe("Control Child");
    const peerAfterIgnore = await node(
      page,
      "control-target-peer",
    ).boundingBox();
    expect(peerAfterIgnore).toMatchObject({
      x: expect.closeTo(targetPeerBefore!.x, 2),
      y: expect.closeTo(targetPeerBefore!.y, 2),
    });

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => indexHtml(page, designId))
      .not.toMatch(
        /data-agent-native-node-id="control-child"[^>]*position:\s*absolute/i,
      );
    expect(await runtimeState(page, "control-child")).toMatchObject({
      parent: "control-row",
      position: "static",
    });

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => indexHtml(page, designId))
      .toMatch(
        /data-agent-native-node-id="control-child"[^>]*position:\s*absolute/i,
      );
    await openEditor(page, designId);
    expect(await runtimeState(page, "control-child")).toMatchObject({
      parent: "control-target-row",
      position: "absolute",
    });

    await selectCanvasNode(page, "control-child");
    const absolute = (await node(page, "control-child").boundingBox())!;
    const peer = (await node(page, "control-target-peer").boundingBox())!;
    await page.mouse.move(
      absolute.x + absolute.width / 2,
      absolute.y + absolute.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(absolute.x + 8, absolute.y + 6, { steps: 3 });
    await page.mouse.move(
      peer.x + peer.width * 0.25,
      peer.y + peer.height / 2,
      {
        steps: 18,
      },
    );
    await expect.poll(() => visibleInsertionGuides(page)).not.toHaveLength(0);
    await page.mouse.up();

    await expect
      .poll(() => indexHtml(page, designId), {
        message: "Control Child did not return to the flow row",
      })
      .toMatch(
        /data-agent-native-node-id="control-target-row"[\s\S]*data-agent-native-node-id="control-child"/,
      );
    const selectedAfterDrop = await page
      .getByRole("tree", { name: "Layers" })
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
      )
      .getAttribute("data-layer-node-id");
    expect(selectedAfterDrop).toBeTruthy();
    await openEditor(page, designId);
    const returned = await runtimeState(page, "control-child");
    expect(returned).toMatchObject({
      parent: "control-target-row",
      position: "static",
    });
    expect(returned.style).not.toMatch(/position:\s*absolute/i);
    expect(returned.name).toBe("Control Child");

    await openEditor(page, designId);
    expect(await runtimeState(page, "control-child")).toMatchObject({
      parent: "control-target-row",
      position: "static",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("late Alt duplicate keeps the source visible, names a clone, and supports Escape", async ({
  page,
}) => {
  const designId = await newDesign(page, COPY_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "copy-source");
    const sourceBefore = (await node(page, "copy-source").boundingBox())!;
    const target = await previewPoint(page, 560, 300);

    await page.mouse.move(
      sourceBefore.x + sourceBefore.width / 2,
      sourceBefore.y + sourceBefore.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceBefore.x + 5, sourceBefore.y + 4, { steps: 2 });
    await page.keyboard.down("Alt");
    await page.mouse.move(target.x, target.y, { steps: 18 });
    await page.waitForTimeout(120);

    const heldSource = await node(page, "copy-source").boundingBox();
    const heldClones = await visibleDuplicateState(page);
    expect(heldSource).toMatchObject({
      x: expect.closeTo(sourceBefore.x, 2),
      y: expect.closeTo(sourceBefore.y, 2),
    });
    expect(heldClones).toHaveLength(1);
    expect(heldClones[0]).toMatchObject({
      name: "Copy Source",
      visible: true,
    });
    expect(heldClones[0].id).not.toBe("copy-source");
    expect(heldClones[0].left).not.toBeCloseTo(sourceBefore.x, 0);

    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(() => indexHtml(page, designId))
      .toMatch(/data-agent-native-node-id="copy-source"/);
    await expect
      .poll(() =>
        indexHtml(page, designId).then((html) =>
          htmlNodeCount(html, "Copy Source"),
        ),
      )
      .toBe(2);

    await openEditor(page, designId);
    expect(await node(page, "copy-source")).toBeVisible();
    expect(
      await preview(page)
        .locator('[data-agent-native-layer-name="Copy Source"]')
        .count(),
    ).toBe(2);

    const beforeEscape = await indexHtml(page, designId);
    await selectCanvasNode(page, "copy-source");
    const sourceForEscape = (await node(page, "copy-source").boundingBox())!;
    await page.mouse.move(
      sourceForEscape.x + sourceForEscape.width / 2,
      sourceForEscape.y + sourceForEscape.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceForEscape.x + 5, sourceForEscape.y + 4, {
      steps: 2,
    });
    await page.keyboard.down("Alt");
    await page.mouse.move(target.x + 80, target.y + 40, { steps: 12 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => indexHtml(page, designId)).toBe(beforeEscape);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("late Alt free drag waits for post-key movement before duplicating", async ({
  page,
}) => {
  const designId = await newDesign(page, COPY_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "copy-source");
    const sourceBefore = (await node(page, "copy-source").boundingBox())!;
    const target = await previewPoint(page, 560, 300);

    await page.mouse.move(
      sourceBefore.x + sourceBefore.width / 2,
      sourceBefore.y + sourceBefore.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceBefore.x + 5, sourceBefore.y + 4, { steps: 2 });
    await page.mouse.move(target.x, target.y, { steps: 18 });
    await page.waitForTimeout(120);
    const heldSource = await runtimeState(page, "copy-source");

    const beforeAltDocument = await indexHtml(page, designId);
    await page.keyboard.down("Alt");
    expect(await visibleDuplicateState(page)).toHaveLength(0);
    expect(await indexHtml(page, designId)).toBe(beforeAltDocument);
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect
      .poll(() =>
        indexHtml(page, designId).then((html) =>
          htmlNodeCount(html, "Copy Source"),
        ),
      )
      .toBe(1);
    await openEditor(page, designId);
    expect(
      await preview(page)
        .locator('[data-agent-native-layer-name="Copy Source"]')
        .count(),
    ).toBe(1);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("late Alt flow reorder duplicates without moving the source and Escape is byte-identical", async ({
  page,
}) => {
  const designId = await newDesign(page, CONTROL_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "control-child");
    const sourceBefore = (await node(page, "control-child").boundingBox())!;
    const sourceStateBefore = await runtimeState(page, "control-child");
    const targetPeer = (await node(page, "control-target-peer").boundingBox())!;
    const start = {
      x: sourceBefore.x + sourceBefore.width / 2,
      y: sourceBefore.y + sourceBefore.height / 2,
    };
    const destination = {
      x: targetPeer.x + targetPeer.width / 2,
      y: targetPeer.y + targetPeer.height / 2,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 5, start.y + 4, { steps: 2 });
    await page.keyboard.down("Alt");
    await page.mouse.move(destination.x, destination.y, { steps: 18 });
    await page.waitForTimeout(120);

    const heldSource = await runtimeState(page, "control-child");
    const heldClones = await visibleDuplicateState(page);
    expect(heldSource).toMatchObject({
      parent: "control-row",
      position: "static",
      left: expect.closeTo(sourceStateBefore.left, 2),
      top: expect.closeTo(sourceStateBefore.top, 2),
    });
    expect(heldClones).toHaveLength(1);
    expect(heldClones[0]).toMatchObject({
      name: "Control Child",
      visible: true,
    });
    expect(heldClones[0].id).not.toBe("control-child");
    const heldCloneBox = await preview(page)
      .locator("[data-agent-native-clone-root]")
      .boundingBox();
    expect(heldCloneBox).not.toBeNull();
    expect(
      Math.abs(heldCloneBox!.x + heldCloneBox!.width / 2 - destination.x),
    ).toBeLessThan(1);
    expect(
      Math.abs(heldCloneBox!.y + heldCloneBox!.height / 2 - destination.y),
    ).toBeLessThan(1);
    expect(await visibleInsertionGuides(page)).not.toHaveLength(0);

    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(() => indexHtml(page, designId))
      .toMatch(/data-agent-native-node-id="control-child"/);
    await expect
      .poll(() =>
        indexHtml(page, designId).then((html) =>
          htmlNodeCount(html, "Control Child"),
        ),
      )
      .toBe(2);

    await openEditor(page, designId);
    expect(
      await preview(page)
        .locator('[data-agent-native-layer-name="Control Child"]')
        .count(),
    ).toBe(2);

    const beforeEscape = await indexHtml(page, designId);
    await selectCanvasNode(page, "control-child");
    const sourceForEscape = (await node(page, "control-child").boundingBox())!;
    const targetForEscape = (await node(
      page,
      "control-target-peer",
    ).boundingBox())!;
    await page.mouse.move(
      sourceForEscape.x + sourceForEscape.width / 2,
      sourceForEscape.y + sourceForEscape.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceForEscape.x + 5, sourceForEscape.y + 4, {
      steps: 2,
    });
    await page.keyboard.down("Alt");
    await page.mouse.move(
      targetForEscape.x + targetForEscape.width / 2,
      targetForEscape.y + targetForEscape.height / 2,
      { steps: 18 },
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => indexHtml(page, designId)).toBe(beforeEscape);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("late Alt grid reorder clears authored placement on the duplicate", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_FLOW_ALT_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "grid-flow-source");
    const source = (await node(page, "grid-flow-source").boundingBox())!;
    const peer = (await node(page, "grid-flow-peer").boundingBox())!;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const destination = {
      x: peer.x + peer.width / 2,
      y: peer.y + peer.height / 2,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 5, start.y + 4, { steps: 2 });
    await page.keyboard.down("Alt");
    await page.mouse.move(destination.x, destination.y, { steps: 18 });
    await page.waitForTimeout(120);

    const held = await preview(page)
      .locator('[data-agent-native-clone-root="true"]')
      .evaluate((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          gridColumn: node.style.gridColumn,
          gridRow: node.style.gridRow,
          left: rect.left,
          top: rect.top,
        };
      });
    expect(held).toMatchObject({ gridColumn: "auto", gridRow: "auto" });

    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(() =>
        indexHtml(page, designId).then((html) =>
          htmlNodeCount(html, "Grid Flow Source"),
        ),
      )
      .toBe(2);
    await openEditor(page, designId);
    const placements = await preview(page)
      .locator('[data-agent-native-layer-name="Grid Flow Source"]')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const node = element as HTMLElement;
          return {
            gridColumn: node.style.gridColumn,
            gridRow: node.style.gridRow,
          };
        }),
      );
    expect(placements).toEqual(
      expect.arrayContaining([
        { gridColumn: "1", gridRow: "1" },
        { gridColumn: "auto", gridRow: "auto" },
      ]),
    );
  } finally {
    await deleteDesign(page, designId);
  }
});

test("Alt before movement threshold does not duplicate a flow child click", async ({
  page,
}) => {
  const designId = await newDesign(page, CONTROL_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "control-child");
    const before = await indexHtml(page, designId);
    const source = (await node(page, "control-child").boundingBox())!;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down("Alt");
    await page.waitForTimeout(80);
    expect(await visibleDuplicateState(page)).toHaveLength(0);
    await page.keyboard.up("Alt");
    await page.mouse.up();

    await expect.poll(() => indexHtml(page, designId)).toBe(before);
    expect(await visibleDuplicateState(page)).toHaveLength(0);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("releasing Meta before the drop restores normal flow ownership", async ({
  page,
}) => {
  const designId = await newDesign(page, META_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "meta-child");
    const source = (await node(page, "meta-child").boundingBox())!;
    const peer = (await node(page, "meta-peer").boundingBox())!;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const background = await previewPoint(page, 500, 320);
    const destination = {
      x: peer.x + peer.width * 0.25,
      y: peer.y + peer.height / 2,
    };

    await page.keyboard.down("Meta");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 6, { steps: 5 });
    await page.mouse.move(background.x, background.y, { steps: 18 });
    const freeHeld = await runtimeState(page, "meta-child");
    expect(freeHeld.transform).not.toBe("none");
    await page.keyboard.up("Meta");
    await page.mouse.move(destination.x, destination.y, { steps: 18 });
    await expect.poll(() => visibleInsertionGuides(page)).not.toHaveLength(0);
    await page.mouse.up();

    await expect
      .poll(() => indexHtml(page, designId))
      .toMatch(
        /data-agent-native-node-id="meta-row"[\s\S]*data-agent-native-node-id="meta-child"/,
      );
    await openEditor(page, designId);
    const state = await runtimeState(page, "meta-child");
    expect(state).toMatchObject({
      parent: "meta-row",
      position: "static",
    });
    expect(state.style).not.toMatch(/position:\s*absolute/i);
  } finally {
    await deleteDesign(page, designId);
  }
});

test.describe("Command oversized flow insertion", () => {
  for (const timing of ["before-pointerdown", "after-threshold"] as const) {
    test(`Meta/Command ${timing} enables normal-flow insertion`, async ({
      page,
    }) => {
      const designId = await newDesign(page, COMMAND_FIXTURE);
      try {
        await openEditor(page, designId);
        await selectCanvasNode(page, "command-source");
        const source = (await node(page, "command-source").boundingBox())!;
        const target = (await node(page, "command-peer").boundingBox())!;
        const start = {
          x: source.x + source.width / 2,
          y: source.y + source.height / 2,
        };
        const destination = {
          x: target.x + target.width / 2,
          y: target.y + target.height / 2,
        };
        if (timing === "before-pointerdown") await page.keyboard.down("Meta");
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 5, start.y + 4, { steps: 2 });
        if (timing === "after-threshold") await page.keyboard.down("Meta");
        await page.mouse.move(destination.x, destination.y, { steps: 18 });
        await expect
          .poll(() => visibleInsertionGuides(page))
          .not.toHaveLength(0);
        await page.mouse.up();
        await page.keyboard.up("Meta");

        await expect
          .poll(() => indexHtml(page, designId), {
            message: `oversized Command ${timing} drop did not persist`,
          })
          .toMatch(
            /data-agent-native-node-id="command-target-row"[\s\S]*data-agent-native-node-id="command-source"/,
          );
        await openEditor(page, designId);
        const state = await runtimeState(page, "command-source");
        expect(state).toMatchObject({
          parent: "command-target-row",
          position: "static",
        });
        expect(state.style).not.toMatch(/position:\s*absolute/i);
        expect(state.name).toBe("Command Source");
        await openEditor(page, designId);
        expect(await runtimeState(page, "command-source")).toMatchObject({
          parent: "command-target-row",
          position: "static",
        });
      } finally {
        await deleteDesign(page, designId);
      }
    });
  }
});
