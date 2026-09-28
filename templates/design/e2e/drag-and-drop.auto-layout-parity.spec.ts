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

const VERTICAL_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="vertical" data-agent-native-layer-name="Vertical"
    style="position:absolute;left:60px;top:80px;width:320px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="v1" data-agent-native-layer-name="V1" style="width:180px;height:48px;background:#6366f1">V1</div>
    <div data-agent-native-node-id="v2" data-agent-native-layer-name="V2" style="width:180px;height:48px;background:#a855f7">V2</div>
    <div data-agent-native-node-id="v3" data-agent-native-layer-name="V3" style="width:180px;height:48px;background:#ec4899">V3</div>
  </section>
</body></html>`;

const WRAP_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap"
    style="position:absolute;left:60px;top:80px;width:256px;height:190px;padding:16px;display:flex;flex-direction:row;flex-wrap:wrap;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="w1" data-agent-native-layer-name="W1" style="flex:0 0 104px;height:48px;background:#6366f1">W1</div>
    <div data-agent-native-node-id="w2" data-agent-native-layer-name="W2" style="flex:0 0 104px;height:48px;background:#a855f7">W2</div>
    <div data-agent-native-node-id="w3" data-agent-native-layer-name="W3" style="flex:0 0 104px;height:48px;background:#ec4899">W3</div>
  </section>
</body></html>`;

const GRID_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="grid-source" data-agent-native-layer-name="Grid Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="grid" data-agent-native-layer-name="Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:72px;gap:12px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="g1" data-agent-native-layer-name="G1" style="min-width:0;background:#6366f1">G1</div>
    <div data-agent-native-node-id="g2" data-agent-native-layer-name="G2" style="min-width:0;background:#a855f7">G2</div>
    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="min-width:0;background:#ec4899">G3</div>
    <div data-agent-native-node-id="g4" data-agent-native-layer-name="G4" style="min-width:0;background:#f59e0b">G4</div>
  </section>
</body></html>`;

const NEST_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="nest-source" data-agent-native-layer-name="Nest Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="nest-row" data-agent-native-layer-name="Nest Row"
    style="position:absolute;left:360px;top:80px;width:300px;padding:12px;display:flex;gap:12px;background:#1f2937">
    <section data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested Frame"
      data-an-primitive="frame" style="width:180px;height:100px;background:#374151"></section>
  </section>
</body></html>`;

const META_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="meta-row" data-agent-native-layer-name="Meta Row"
    style="position:absolute;left:60px;top:80px;width:300px;height:100px;padding:16px;display:flex;flex-direction:row;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="meta-child" data-agent-native-layer-name="Meta Child" style="width:100px;height:48px;background:#6366f1">Child</div>
    <div data-agent-native-node-id="meta-peer" data-agent-native-layer-name="Meta Peer" style="width:100px;height:48px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

const IGNORE_AUTO_LAYOUT = process.platform === "darwin" ? "Control" : "S";

const OVERSIZED_PLAIN_DROP_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="oversized-source" data-agent-native-layer-name="Oversized Source"
    style="position:absolute;left:500px;top:300px;width:500px;height:110px;background:#ea580c">Source</div>
  <section data-agent-native-node-id="plain-target" data-agent-native-layer-name="Empty Flow"
    style="position:absolute;left:80px;top:70px;width:360px;height:180px;display:flex;flex-direction:row;background:#374151"></section>
</body></html>`;

function preview(page: Page): Locator {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator("body");
}

async function insertionGuideKind(
  page: Page,
): Promise<"inside" | "line" | null> {
  return preview(page).evaluate(() => {
    const guide = Array.from(
      document.documentElement.querySelectorAll<HTMLElement>(
        "[data-agent-native-insertion-guide]",
      ),
    ).find((candidate) => {
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    if (!guide) return null;
    const rect = guide.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return parseFloat(getComputedStyle(guide).borderTopWidth) > 0
      ? "inside"
      : "line";
  });
}

async function heldNestedDropState(
  page: Page,
  sourceId: string,
  targetId: string,
) {
  const source = node(page, sourceId);
  const target = node(page, targetId);
  const [sourceState, targetState, guide] = await Promise.all([
    source.evaluate((element) => {
      return {
        id: element.getAttribute("data-agent-native-node-id"),
        parentId:
          element.parentElement?.getAttribute("data-agent-native-node-id") ??
          (element.parentElement?.tagName === "BODY" ? "BODY" : null),
      };
    }),
    target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute("data-agent-native-node-id"),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      };
    }),
    preview(page).evaluate(() => {
      const guide = Array.from(
        document.documentElement.querySelectorAll<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        ),
      ).find((candidate) => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return style.display !== "none" && rect.width > 0 && rect.height > 0;
      });
      if (!guide) return null;
      const rect = guide.getBoundingClientRect();
      const style = getComputedStyle(guide);
      return {
        display: style.display,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        kind:
          parseFloat(style.borderTopWidth) > 0 ? ("inside" as const) : "line",
      };
    }),
  ]);
  return {
    sourceId: sourceState.id,
    sourceParentId: sourceState.parentId,
    targetId: targetState.id,
    targetRect: targetState.rect,
    guide,
  };
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
  const selected = tree.locator(
    '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
  );
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveText(layerName);
  expect(await selected.getAttribute("data-layer-node-id")).toBeTruthy();
}

async function dragCanvasNode(
  page: Page,
  designId: string,
  sourceId: string,
  target: { x: number; y: number },
  feedback?: "inside" | "line" | "ghost",
  modifier?: "Meta" | "Control",
  onHeld?: () => Promise<void>,
): Promise<void> {
  const beforeHtml = await indexHtml(page, designId);
  const source = (await node(page, sourceId).boundingBox())!;
  const start = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  let mouseHeld = false;
  let modifierHeld = false;
  try {
    if (modifier) {
      modifierHeld = true;
      await page.keyboard.down(modifier);
    }
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    mouseHeld = true;
    await page.mouse.move(start.x + 10, start.y + 6, { steps: 5 });
    await page.mouse.move(target.x, target.y, { steps: 20 });
    if (feedback === "line" || feedback === "inside") {
      await expect
        .poll(() => insertionGuideKind(page), {
          timeout: 5_000,
          message: `no ${feedback} guide while dragging ${sourceId}`,
        })
        .toBe(feedback);
    }
    if (feedback === "ghost") {
      await expect
        .poll(
          () =>
            node(page, sourceId).evaluate(
              (element) => getComputedStyle(element).transform !== "none",
            ),
          { timeout: 5_000, message: `no drag ghost for ${sourceId}` },
        )
        .toBe(true);
    }
    if (onHeld) await onHeld();
    await page.mouse.up();
    mouseHeld = false;
    await expect
      .poll(() => indexHtml(page, designId), {
        timeout: 5_000,
        message: `dragging ${sourceId} did not persist a source update`,
      })
      .not.toBe(beforeHtml);
  } finally {
    if (mouseHeld) {
      try {
        await page.mouse.up();
      } catch {
        // Preserve the original drag assertion if cleanup also fails.
      }
    }
    if (modifierHeld) {
      try {
        await page.keyboard.up(modifier!);
      } catch {
        // Preserve the original drag assertion if cleanup also fails.
      }
    }
  }
}

async function deleteDesign(page: Page, designId: string): Promise<void> {
  await postAction(page, "delete-design", { id: designId }).catch(() => {});
}

test("physical vertical auto-layout reorder keeps parent, order, and geometry", async ({
  page,
}) => {
  const designId = await newDesign(page, VERTICAL_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "v1");
    const v3 = (await node(page, "v3").boundingBox())!;
    await dragCanvasNode(
      page,
      designId,
      "v1",
      {
        x: v3.x + v3.width / 2,
        y: v3.y + v3.height * 0.8,
      },
      "line",
      undefined,
      async () => {
        const held = await preview(page).evaluate(() => {
          const parent = document.querySelector(
            '[data-agent-native-node-id="vertical"]',
          );
          const source = document.querySelector(
            '[data-agent-native-node-id="v1"]',
          ) as HTMLElement | null;
          const target = document.querySelector(
            '[data-agent-native-node-id="v3"]',
          ) as HTMLElement | null;
          const guide = Array.from(
            document.documentElement.querySelectorAll<HTMLElement>(
              "[data-agent-native-insertion-guide]",
            ),
          ).find((candidate) => {
            const style = getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            return (
              style.display !== "none" && rect.width > 0 && rect.height > 0
            );
          });
          const guideRect = guide?.getBoundingClientRect();
          const targetRect = target?.getBoundingClientRect();
          return {
            order: parent
              ? Array.from(parent.children).map((child) =>
                  child.getAttribute("data-agent-native-node-id"),
                )
              : [],
            sourceParent: source?.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            guideDisplay: guide ? getComputedStyle(guide).display : "none",
            guideWidth: guideRect?.width ?? 0,
            guideHeight: guideRect?.height ?? 0,
            guideTop: guideRect?.top ?? 0,
            targetTop: targetRect?.top ?? 0,
            targetBottom: targetRect?.bottom ?? 0,
            siblingTransforms: ["v2", "v3"].map((id) => {
              const element = document.querySelector(
                `[data-agent-native-node-id="${id}"]`,
              );
              return element ? getComputedStyle(element).transform : "none";
            }),
          };
        });
        expect(held.order).toEqual(["v1", "v2", "v3"]);
        expect(held.sourceParent).toBe("vertical");
        expect(held.guideDisplay).toBe("block");
        expect(held.guideWidth).toBeGreaterThan(0);
        expect(held.guideHeight).toBeGreaterThan(0);
        expect(held.guideTop).toBeGreaterThanOrEqual(held.targetTop);
        expect(held.guideTop).toBeLessThanOrEqual(held.targetBottom + 8);
        expect(
          held.siblingTransforms.some((transform) => transform !== "none"),
        ).toBe(true);
      },
    );

    await openEditor(page, designId);
    const html = await indexHtml(page, designId);
    expect(html.indexOf("v3")).toBeLessThan(html.indexOf("v1"));
    const state = await preview(page).evaluate(() => {
      const parent = document.querySelector(
        '[data-agent-native-node-id="vertical"]',
      );
      const child = document.querySelector(
        '[data-agent-native-node-id="v1"]',
      ) as HTMLElement | null;
      const rect = child?.getBoundingClientRect();
      return {
        parent: child?.parentElement?.getAttribute("data-agent-native-node-id"),
        position: child ? getComputedStyle(child).position : null,
        width: rect?.width ?? 0,
        parentContains: !!parent && !!child && parent.contains(child),
      };
    });
    expect(state).toMatchObject({
      parent: "vertical",
      position: "static",
      parentContains: true,
    });
    expect(state.width).toBeGreaterThan(0);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("physical wrap auto-layout reorder moves a wrapped child between rows", async ({
  page,
}) => {
  const designId = await newDesign(page, WRAP_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "w3");
    const w1 = (await node(page, "w1").boundingBox())!;
    await dragCanvasNode(
      page,
      designId,
      "w3",
      { x: w1.x + 4, y: w1.y + w1.height / 2 },
      "line",
    );

    await openEditor(page, designId);
    const html = await indexHtml(page, designId);
    expect(html.indexOf("w3")).toBeLessThan(html.indexOf("w1"));
    const state = await preview(page).evaluate(() => {
      const parent = document.querySelector(
        '[data-agent-native-node-id="wrap"]',
      );
      const child = document.querySelector(
        '[data-agent-native-node-id="w3"]',
      ) as HTMLElement | null;
      return {
        parent: child?.parentElement?.getAttribute("data-agent-native-node-id"),
        position: child ? getComputedStyle(child).position : null,
        parentContains: !!parent && !!child && parent.contains(child),
      };
    });
    expect(state).toEqual({
      parent: "wrap",
      position: "static",
      parentContains: true,
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("physical grid drop resolves the pointer row and persists flow placement", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "grid-source");
    const g3 = (await node(page, "g3").boundingBox())!;
    await dragCanvasNode(
      page,
      designId,
      "grid-source",
      { x: g3.x + 4, y: g3.y + g3.height / 2 },
      "line",
    );

    await openEditor(page, designId);
    const html = await indexHtml(page, designId);
    expect(html.indexOf("g2")).toBeLessThan(html.indexOf("grid-source"));
    expect(html.indexOf("grid-source")).toBeLessThan(html.indexOf("g3"));
    const state = await preview(page).evaluate(() => {
      const parent = document.querySelector(
        '[data-agent-native-node-id="grid"]',
      );
      const child = document.querySelector(
        '[data-agent-native-node-id="grid-source"]',
      ) as HTMLElement | null;
      const rect = child?.getBoundingClientRect();
      return {
        parent: child?.parentElement?.getAttribute("data-agent-native-node-id"),
        position: child ? getComputedStyle(child).position : null,
        left: rect?.left ?? 0,
        top: rect?.top ?? 0,
        parentContains: !!parent && !!child && parent.contains(child),
      };
    });
    expect(state).toMatchObject({
      parent: "grid",
      position: "static",
      parentContains: true,
    });
    expect(state.left).toBeGreaterThan(0);
    expect(state.top).toBeGreaterThan(0);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("physical drop into a nested frame in a regular flex row still nests", async ({
  page,
}) => {
  const designId = await newDesign(page, NEST_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "nest-source");
    const frame = (await node(page, "nested-frame").boundingBox())!;
    const start = (await node(page, "nest-source").boundingBox())!;
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      start.x + start.width / 2 + 10,
      start.y + start.height / 2 + 6,
      { steps: 5 },
    );
    await page.mouse.move(
      frame.x + frame.width / 2,
      frame.y + frame.height / 2,
      { steps: 20 },
    );
    await expect
      .poll(() => heldNestedDropState(page, "nest-source", "nested-frame"), {
        timeout: 5_000,
        message: "nested drop guide did not settle",
      })
      .toMatchObject({
        sourceId: "nest-source",
        targetId: "nested-frame",
        guide: { display: "block", kind: "inside" },
      });
    const held = await heldNestedDropState(page, "nest-source", "nested-frame");
    expect(held.sourceParentId).not.toBe("nested-frame");
    expect(held.targetRect.width).toBeGreaterThan(0);
    expect(held.targetRect.height).toBeGreaterThan(0);
    if (!held.guide) throw new Error("nested drop guide disappeared");
    expect(held.guide.left).toBeLessThanOrEqual(held.targetRect.left + 2);
    expect(held.guide.top).toBeLessThanOrEqual(held.targetRect.top + 2);
    expect(held.guide.left + held.guide.width).toBeGreaterThanOrEqual(
      held.targetRect.left + held.targetRect.width - 2,
    );
    expect(held.guide.top + held.guide.height).toBeGreaterThanOrEqual(
      held.targetRect.top + held.targetRect.height - 2,
    );
    await page.mouse.up();
    await expect
      .poll(
        () =>
          indexHtml(page, designId).then((html) =>
            /data-agent-native-node-id="nested-frame"[\s\S]*data-agent-native-node-id="nest-source"/.test(
              html,
            ),
          ),
        {
          timeout: 5_000,
          message: "nested frame drop did not persist the new parent",
        },
      )
      .toBe(true);

    await openEditor(page, designId);
    const state = await preview(page).evaluate(() => {
      const source = document.querySelector(
        '[data-agent-native-node-id="nest-source"]',
      ) as HTMLElement | null;
      return {
        parent: source?.parentElement?.getAttribute(
          "data-agent-native-node-id",
        ),
        position: source ? getComputedStyle(source).position : null,
      };
    });
    expect(state).toEqual({
      parent: "nested-frame",
      position: "static",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("physical oversized free layer stays beside an empty auto-layout target", async ({
  page,
}) => {
  const designId = await newDesign(page, OVERSIZED_PLAIN_DROP_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "oversized-source");
    const sourceBefore = (await node(page, "oversized-source").boundingBox())!;
    const target = (await node(page, "plain-target").boundingBox())!;
    expect(sourceBefore.width).toBeGreaterThan(target.width);
    await page.mouse.move(
      sourceBefore.x + sourceBefore.width / 2,
      sourceBefore.y + sourceBefore.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceBefore.x + 12, sourceBefore.y + 8, {
      steps: 5,
    });
    await page.mouse.move(
      target.x + target.width * 0.75,
      target.y + target.height / 2,
      { steps: 24 },
    );
    await expect
      .poll(() => insertionGuideKind(page), {
        timeout: 5_000,
        message: "oversized source must resolve a sibling line, not inside",
      })
      .toBe("line");
    await page.mouse.up();

    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toMatch(
        /data-agent-native-node-id="plain-target"[\s\S]*data-agent-native-node-id="oversized-source"/,
      );
    await openEditor(page, designId);
    const state = await preview(page).evaluate(() => {
      const source = document.querySelector(
        '[data-agent-native-node-id="oversized-source"]',
      ) as HTMLElement | null;
      const target = document.querySelector(
        '[data-agent-native-node-id="plain-target"]',
      );
      return {
        sourceParent:
          source?.parentElement?.tagName === "BODY"
            ? "BODY"
            : source?.parentElement?.getAttribute("data-agent-native-node-id"),
        targetContains: !!target && !!source && target.contains(source),
        position: source ? getComputedStyle(source).position : null,
      };
    });
    expect(state).toEqual({
      sourceParent: "BODY",
      targetContains: false,
      position: "static",
    });
    expect(state.sourceParent).not.toBe("flow");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("physical command-drag overrides auto-layout resistance", async ({
  page,
}) => {
  const designId = await newDesign(page, META_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectCanvasNode(page, "meta-child");
    const source = (await node(page, "meta-child").boundingBox())!;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    await preview(page).focus();
    let mouseHeld = false;
    await page.keyboard.down(IGNORE_AUTO_LAYOUT);
    try {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      mouseHeld = true;
      await page.mouse.move(start.x + 10, start.y + 6, { steps: 5 });
      await page.mouse.move(start.x + 460, start.y + 220, { steps: 20 });
      await expect
        .poll(() =>
          preview(page).evaluate(() => {
            const element = document.documentElement.querySelector<HTMLElement>(
              "[data-agent-native-transform-badge]",
            );
            return Boolean(
              element &&
              getComputedStyle(element).display !== "none" &&
              element.textContent === "Move layer",
            );
          }),
        )
        .toBe(true);
      await page.mouse.up();
      mouseHeld = false;
    } finally {
      if (mouseHeld) {
        try {
          await page.mouse.up();
        } catch {
          // Preserve the original drag assertion if cleanup also fails.
        }
      }
      await page.keyboard.up(IGNORE_AUTO_LAYOUT);
    }
    await expect
      .poll(
        () =>
          indexHtml(page, designId).then((html) =>
            /data-agent-native-node-id="meta-child"[^>]*style="[^"]*position:\s*absolute/i.test(
              html,
            ),
          ),
        {
          timeout: 5_000,
          message: "Meta-drag did not persist free placement",
        },
      )
      .toBe(true);

    await openEditor(page, designId);
    const html = await indexHtml(page, designId);
    const state = await preview(page).evaluate(() => {
      const child = document.querySelector(
        '[data-agent-native-node-id="meta-child"]',
      ) as HTMLElement | null;
      const row = document.querySelector(
        '[data-agent-native-node-id="meta-row"]',
      );
      const parent = child?.parentElement ?? null;
      return {
        parent:
          parent?.tagName === "BODY"
            ? "BODY"
            : (parent?.getAttribute("data-agent-native-node-id") ??
              parent?.tagName),
        position: child ? getComputedStyle(child).position : null,
        rowContains: !!row && !!child && row.contains(child),
        left: child?.getBoundingClientRect().left ?? 0,
        top: child?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(html).toContain('data-agent-native-node-id="meta-child"');
    expect(state.parent).toBe("BODY");
    expect(state.position).toBe("absolute");
    expect(state.rowContains).toBe(false);
    expect(state.left).toBeGreaterThan(0);
    expect(state.top).toBeGreaterThan(0);
  } finally {
    await deleteDesign(page, designId);
  }
});
