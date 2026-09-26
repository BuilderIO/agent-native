import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  setBaseURL,
  MOD,
  newDesign,
  geom,
  node,
  openEditor,
  selectViaTree,
  dragBy,
  activeOverlays,
  toolbar,
} from "./drag-and-drop.shared";
import { appPath } from "./helpers";


test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});


const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SCREEN_W = 1280;
const SCREEN_H = 900;
const SCREEN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Board move</title></head>
  <body style="margin:0;min-height:${SCREEN_H}px;background:#0f1115;color:#fff"></body>
</html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await request.post(`${BASE_URL}/_agent-native/actions/${name}`, {
    data: input,
  });
  if (!res.ok())
    throw new Error(`${name}: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function createFrameDesign(
  request: APIRequestContext,
  frames: { x: number; y: number }[],
) {
  const created = await action(request, "create-design", {
    title: `Move parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: i === 0 ? "index.html" : `screen-${i + 1}.html`,
      content: SCREEN_HTML,
      fileType: "html",
    });
    fileIds.push(file.id ?? file.data?.id);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, i) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: SCREEN_W, height: SCREEN_H },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: {
          x: frames[i]!.x,
          y: frames[i]!.y,
          width: SCREEN_W,
          height: SCREEN_H,
          z: i,
        },
      },
    ]),
  });
  return { designId, fileIds };
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  const firstCard = page.locator("[data-screen-card]").first();
  await expect(firstCard).toBeVisible();
  let lastBox: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await firstCard.boundingBox();
        const stable =
          box !== null &&
          lastBox !== null &&
          Math.abs(box.x - lastBox.x) < 1 &&
          Math.abs(box.y - lastBox.y) < 1;
        lastBox = box;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function canvasScale(page: Page): Promise<number> {
  const card = (await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox())!;
  return card.width / SCREEN_W;
}

async function visibleCentre(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const view = page.viewportSize()!;
  return {
    x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
    y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
  };
}

async function frameOffsets(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll<HTMLElement>("[data-frame-id]")).map(
        (n) => [
          n.getAttribute("data-frame-id")!,
          {
            left: Number.parseFloat(n.style.left),
            top: Number.parseFloat(n.style.top),
          },
        ],
      ),
    ),
  );
}

async function selectFrame(page: Page, index: number) {
  await page.locator("[data-frame-label]").nth(index).click();
  await expect(page.locator("[data-frame-drag-surface]")).toBeVisible();
}

async function zoomOut(page: Page, times = 4) {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(`${MOD}+-`);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
}


test("in-screen: a drag moves the element by exactly the pointer delta at the current zoom", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await zoomOut(page, 1);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  await dragBy(page, (await node(page, "box-a").boundingBox())!, 300, 150, {
    settle: false,
  });
  await expect
    .poll(async () => (await geom(page, id, "box-a")).left)
    .not.toBe(before.left);
  const after = await geom(page, id, "box-a");
  const contentDx = after.left - before.left;
  const contentDy = after.top - before.top;
  expect(
    [contentDx / 300, contentDy / 150],
    `at a zoomed-out canvas, requested a (300,150) content-px move; got (${contentDx},${contentDy}) — the pointer delta was not applied 1:1 in content space`,
  ).toEqual([expect.closeTo(1, 0.15), expect.closeTo(1, 0.15)]);
});

test("overview: dragging a screen frame moves it by exactly the pointer delta at the current zoom", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createFrameDesign(request, [
    { x: 0, y: 0 },
    { x: 3000, y: 3000 },
  ]);
  try {
    await openOverview(page, designId, 2);
    await page.keyboard.press(`${MOD}+-`);
    await page.keyboard.press(`${MOD}+-`);
    await page.waitForTimeout(300);
    await selectFrame(page, 1);
    const scale = await canvasScale(page);
    const before = await frameOffsets(page);
    const start = await visibleCentre(
      page,
      page.locator("[data-frame-drag-surface]"),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 240, start.y + 120, { steps: 20 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(800);
    const after = await frameOffsets(page);
    const dx = after[fileIds[1]!]!.left - before[fileIds[1]!]!.left;
    const dy = after[fileIds[1]!]!.top - before[fileIds[1]!]!.top;
    const expectedDx = 240 / scale;
    const expectedDy = 120 / scale;
    expect(
      [dx / expectedDx, dy / expectedDy],
      `at canvas scale ${scale.toFixed(3)}, expected canvas delta ~(${expectedDx.toFixed(1)},${expectedDy.toFixed(1)}), got (${dx},${dy})`,
    ).toEqual([expect.closeTo(1, 0.15), expect.closeTo(1, 0.15)]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("overview: Shift+drag constrains a screen frame move to one axis", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createFrameDesign(request, [
    { x: 0, y: 0 },
    { x: 3000, y: 3000 },
  ]);
  try {
    await openOverview(page, designId, 2);
    await selectFrame(page, 1);
    const before = await frameOffsets(page);
    const start = await visibleCentre(
      page,
      page.locator("[data-frame-drag-surface]"),
    );
    await page.keyboard.down("Shift");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 260, start.y + 20, { steps: 20 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForTimeout(800);
    const after = await frameOffsets(page);
    const dx = after[fileIds[1]!]!.left - before[fileIds[1]!]!.left;
    expect(dx, "the free axis should still have moved").toBeGreaterThan(60);
    expect(
      after[fileIds[1]!]!.top,
      `Shift+drag was mostly horizontal but top changed ${before[fileIds[1]!]!.top} -> ${after[fileIds[1]!]!.top}`,
    ).toBe(before[fileIds[1]!]!.top);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("in-screen: Escape mid-drag cancels the move and restores the exact original position", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  await dragBy(page, (await node(page, "box-a").boundingBox())!, 200, 100, {
    cancel: true,
  });
  const after = await geom(page, id, "box-a");
  if (after.left !== before.left || after.top !== before.top) {
    const trace = await page
      .evaluate(() => (window as any).__designTrace?.dump?.())
      .catch(() => undefined);
    console.log(
      "designTrace after failed Escape-cancel:",
      JSON.stringify(trace)?.slice(0, 2000),
    );
  }
  expect(
    [after.left, after.top],
    `Escape mid-drag must restore the start position (${before.left},${before.top}); got (${after.left},${after.top})`,
  ).toEqual([before.left, before.top]);
});

test("in-screen: Escape after a completed drag does NOT revert it (host focus and iframe focus)", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  const beforeA = await geom(page, id, "box-a");
  const boxA = (await node(page, "box-a").boundingBox())!;
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boxA.x + boxA.width / 2 + 200,
    boxA.y + boxA.height / 2 + 100,
    { steps: 16 },
  );
  await page.waitForTimeout(350);
  await page.mouse.up();
  await page.waitForTimeout(50);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterA = await geom(page, id, "box-a");
  expect(
    [afterA.left, afterA.top],
    `iframe-focus Escape after release must not revert Box A from (${afterA.left},${afterA.top}) back to (${beforeA.left},${beforeA.top})`,
  ).not.toEqual([beforeA.left, beforeA.top]);

  await selectViaTree(page, "Box B");
  const beforeB = await geom(page, id, "box-b");
  const boxB = (await node(page, "box-b").boundingBox())!;
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boxB.x + boxB.width / 2 + 200,
    boxB.y + boxB.height / 2 + 100,
    { steps: 16 },
  );
  await page.waitForTimeout(350);
  await page.mouse.up();
  await toolbar(page).locator('button[aria-label="Move"]').click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterB = await geom(page, id, "box-b");
  expect(
    [afterB.left, afterB.top],
    `host-focus Escape after release must not revert Box B from (${afterB.left},${afterB.top}) back to (${beforeB.left},${beforeB.top})`,
  ).not.toEqual([beforeB.left, beforeB.top]);
});

test("in-screen drag: a delayed cancel for gesture A does not cancel gesture B once B has started", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  const beforeA = await geom(page, id, "box-a");
  const boxA = (await node(page, "box-a").boundingBox())!;
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boxA.x + boxA.width / 2 + 200,
    boxA.y + boxA.height / 2 + 100,
    { steps: 16 },
  );
  await page.waitForTimeout(350);
  const stalePressedAt = await page.evaluate(() => Date.now());
  await page.mouse.up();
  await expect
    .poll(() => geom(page, id, "box-a"), {
      timeout: 15_000,
      message: "gesture A must have moved and committed",
    })
    .not.toEqual(beforeA);
  const afterA = await geom(page, id, "box-a");

  await selectViaTree(page, "Box B");
  const beforeB = await geom(page, id, "box-b");
  const boxB = (await node(page, "box-b").boundingBox())!;
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boxB.x + boxB.width / 2 + 200,
    boxB.y + boxB.height / 2 + 100,
    { steps: 16 },
  );
  await page.waitForTimeout(350);

  await page.evaluate((pressedAt) => {
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt },
          "*",
        );
      });
  }, stalePressedAt);
  await page.waitForTimeout(100);

  await page.mouse.up();
  await expect
    .poll(() => geom(page, id, "box-b"), {
      timeout: 15_000,
      message:
        "B must have moved and committed; A's stale cancel must not have cancelled B",
    })
    .not.toEqual(beforeB);
  const afterAFinal = await geom(page, id, "box-a");
  expect(
    afterAFinal,
    "A must remain exactly where its own drag committed it",
  ).toEqual(afterA);
});

test("overview: Escape mid-drag cancels a screen-frame drag and restores its original position", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createFrameDesign(request, [
    { x: 0, y: 0 },
    { x: 3000, y: 3000 },
  ]);
  try {
    await openOverview(page, designId, 2);
    await selectFrame(page, 1);
    const before = await frameOffsets(page);
    const start = await visibleCentre(
      page,
      page.locator("[data-frame-drag-surface]"),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 240, start.y + 120, { steps: 20 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(800);
    const after = await frameOffsets(page);
    expect(
      [after[fileIds[1]!]!.left, after[fileIds[1]!]!.top],
      `Escape mid-drag must restore the original frame position (${before[fileIds[1]!]!.left},${before[fileIds[1]!]!.top}); got (${after[fileIds[1]!]!.left},${after[fileIds[1]!]!.top})`,
    ).toEqual([before[fileIds[1]!]!.left, before[fileIds[1]!]!.top]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("in-screen: smart guides disappear once the drop commits", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const a = (await node(page, "box-a").boundingBox())!;
  const b = (await node(page, "box-b").boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, b.y - a.height, { steps: 18 });
  await page.waitForTimeout(900);
  const duringDrag = (await activeOverlays(page)).filter((k) =>
    /snap-guide|measurement/.test(k),
  ).length;
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await activeOverlays(page)).filter((k) =>
          /snap-guide|measurement/.test(k),
        ).length,
      { timeout: 10_000 },
    )
    .toBe(0);
  const afterDrop = (await activeOverlays(page)).filter((k) =>
    /snap-guide|measurement/.test(k),
  ).length;
  expect(
    duringDrag,
    "the drag itself never produced a guide to test disappearance of",
  ).toBeGreaterThan(0);
  expect(
    afterDrop,
    `guide overlays stayed painted after mouseup (count=${afterDrop}); Figma clears them on drop`,
  ).toBe(0);
});

async function dragContentPx(
  page: Page,
  nodeId: string,
  contentDx: number,
  contentDy: number,
): Promise<{ left: string; top: string }> {
  const frame = page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
  return frame.locator("body").evaluate(
    (_body, { nodeId: id, contentDx, contentDy }) => {
      const box = document.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!box) throw new Error(`${id} not found in this frame`);
      const dx = contentDx;
      const dy = contentDy;
      const rect = box.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const fire = (kind: "down" | "move" | "up", x: number, y: number) => {
        const init = {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: kind === "up" ? 0 : 1,
          pointerId: 1,
          isPrimary: true,
          pointerType: "mouse",
        };
        const target = document.elementFromPoint(x, y) ?? document.body;
        target.dispatchEvent(new PointerEvent(`pointer${kind}`, init));
        target.dispatchEvent(
          new MouseEvent(
            kind === "down"
              ? "mousedown"
              : kind === "move"
                ? "mousemove"
                : "mouseup",
            init,
          ),
        );
      };
      const prime = 3.5;
      fire("down", cx, cy);
      fire(
        "move",
        cx + Math.sign(dx || 1) * prime,
        cy + Math.sign(dy || 1) * prime,
      );
      fire("move", cx + dx, cy + dy);
      fire("up", cx + dx, cy + dy);
      return { left: box.style.left, top: box.style.top };
    },
    { nodeId, contentDx, contentDy },
  );
}

test("in-screen: an offset inside the snap threshold lands exactly on the aligned edge", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  const result = await dragContentPx(page, "box-a", 3, 40);
  expect(result.top, "the element never moved").not.toBe(`${before.top}px`);
  expect(
    result.left,
    `a 3px-off nudge should have snapped back onto the shared left edge (30px); landed at ${result.left}`,
  ).toBe("30px");
});

test("in-screen: an offset beyond the snap threshold does not jump onto a distant edge", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  const result = await dragContentPx(page, "box-a", 60, 40);
  const landedLeft = Number.parseFloat(result.left);
  expect(result.top, "the element never moved").not.toBe(`${before.top}px`);
  expect(
    Math.abs(landedLeft - (before.left + 60)),
    `dropped 60px off the aligned edge but landed at left=${result.left} — snapped past the documented 6px threshold onto a distant edge`,
  ).toBeLessThanOrEqual(5);
});

test("in-screen: arrow-nudge after a drag continues from the dropped position", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  await dragBy(page, (await node(page, "box-a").boundingBox())!, 90, 55, {
    settle: false,
  });
  await expect
    .poll(async () => (await geom(page, id, "box-a")).left)
    .not.toBe(before.left);
  const dropped = await geom(page, id, "box-a");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const nudged = await geom(page, id, "box-a");
  expect(
    nudged.top,
    "a horizontal nudge should not move the vertical axis the drag already set",
  ).toBe(dropped.top);
  expect(
    nudged.left,
    `arrow-nudge should continue from the dropped left (${dropped.left}), not the pre-drag left (${before.left})`,
  ).toBe(dropped.left + 1);
});

test("in-screen: one plain drag is exactly one undo step", async ({ page }) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  await dragBy(page, (await node(page, "box-a").boundingBox())!, 150, 90, {
    settle: false,
  });
  await expect
    .poll(async () => (await geom(page, id, "box-a")).left)
    .not.toBe(before.left);
  const dropped = await geom(page, id, "box-a");
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(700);
  const undone = await geom(page, id, "box-a");
  expect(
    [undone.left, undone.top],
    `one Cmd/Ctrl+Z after one drag (dropped at ${dropped.left},${dropped.top}) should fully restore the pre-drag position (${before.left},${before.top}); got (${undone.left},${undone.top})`,
  ).toEqual([before.left, before.top]);
});
