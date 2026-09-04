import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, enterDirectMode, expandAllLayers } from "./helpers";

/**
 * Figma-parity smart guides on the two surfaces that move an object: dragging
 * a screen on the overview canvas, and dragging an absolutely positioned
 * element inside a screen. Both prove the gesture landed (committed geometry)
 * before asserting the guide chrome, so a drag that silently no-ops fails.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SCREEN_W = 1280;
const SCREEN_H = 900;

test.use({ viewport: { width: 1600, height: 1000 } });
const OFFSET_ORIGIN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Offset origin</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
    <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage" data-an-primitive="frame"
         style="position:absolute;left:300px;top:60px;width:600px;height:700px">
      <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
           style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" data-an-primitive="rectangle"
           style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    </div>
  </body>
</html>`;

const SCREEN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Snap guides</title></head>
  <body style="margin:0;min-height:${SCREEN_H}px;background:#0f1115;color:#fff">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
         style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
         style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="box-c" data-agent-native-layer-name="Box C"
         style="position:absolute;left:30px;top:620px;width:120px;height:80px;background:#f59e0b"></div>
  </body>
</html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  request: APIRequestContext,
  frames: { x: number; y: number }[],
) {
  const created = await action(request, "create-design", {
    title: `Snap guides QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content: SCREEN_HTML,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, index) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: SCREEN_W, height: SCREEN_H },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: {
          x: frames[index]!.x,
          y: frames[index]!.y,
          width: SCREEN_W,
          height: SCREEN_H,
          z: index,
        },
      },
    ]),
  });
  return { designId, fileIds };
}

/** One unpositioned screen, which is what the single-screen editor opens on;
 *  the overview tests below place their frames explicitly instead. */
async function createSingleScreenDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Snap guides QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  return designId as string;
}

async function createOffsetOriginDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Offset origin QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: OFFSET_ORIGIN_HTML,
    fileType: "html",
  });
  return designId as string;
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible();
  await page.waitForTimeout(1500);
}

/** Screen px per canvas px, so a drag can be expressed in canvas units. */
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

/** Frame positions in canvas units, keyed by file id. */
async function frameOffsets(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll<HTMLElement>("[data-frame-id]")).map(
        (node) => [
          node.getAttribute("data-frame-id")!,
          {
            left: Number.parseFloat(node.style.left),
            top: Number.parseFloat(node.style.top),
          },
        ],
      ),
    ),
  );
}

async function guideBoxes(page: Page, kind: "alignment" | "spacing") {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
      (node) => {
        const rect = node.getBoundingClientRect();
        const painted = node.children[0] ?? node;
        return {
          width: rect.width,
          height: rect.height,
          paint: getComputedStyle(painted).backgroundColor,
        };
      },
    );
  }, `[data-canvas-guide="${kind}"]`);
}

/** A guide whose colour resolves to nothing has the right geometry and is
 *  still invisible — the exact shape of the --destructive bug. */
function isPainted(paint: string): boolean {
  return paint !== "" && !/rgba\(0, 0, 0, 0\)|transparent/.test(paint);
}

async function selectFrame(page: Page, index: number) {
  await page.locator("[data-frame-label]").nth(index).click();
  await expect(page.locator("[data-frame-drag-surface]")).toBeVisible();
}

test("dragging a screen into line draws a guide through every screen it aligns with", async ({
  page,
  request,
}) => {
  // Two screens share a left edge; the third is dragged onto that edge from
  // far away. All three are the same width, so its left, centre and right all
  // land on a shared coordinate at once.
  const { designId, fileIds } = await createDesign(request, [
    { x: 0, y: 0 },
    { x: 0, y: 1200 },
    { x: 2600, y: 2400 },
  ]);
  try {
    await openOverview(page, designId, 3);
    await selectFrame(page, 2);
    const scale = await canvasScale(page);
    const before = await frameOffsets(page);

    const start = await visibleCentre(
      page,
      page.locator("[data-frame-drag-surface]"),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 2600 * scale, start.y, { steps: 24 });
    await page.waitForTimeout(400);

    const verticalGuides = (await guideBoxes(page, "alignment")).filter(
      (box) => box.height > box.width,
    );
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const after = await frameOffsets(page);
    expect(
      after[fileIds[2]!]!.left,
      "the dragged screen never snapped onto the shared left edge",
    ).toBeCloseTo(before[fileIds[0]!]!.left, 1);
    expect(
      verticalGuides.length,
      "equal-width screens sharing a left edge also share a centre and a right " +
        "edge, so Figma lights up every matching line, not just the closest one",
    ).toBeGreaterThan(1);
    expect(
      verticalGuides.every((box) => isPainted(box.paint)),
      `guides drew but painted nothing: ${verticalGuides.map((b) => b.paint).join(", ")}`,
    ).toBe(true);
    expect(
      Math.max(...verticalGuides.map((box) => box.height)),
    ).toBeGreaterThan(3000 * scale);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("dragging a screen near an existing gap snaps the spacing to match it", async ({
  page,
  request,
}) => {
  // A and B sit 320 canvas px apart. C is dragged to roughly — not exactly —
  // that same distance from B, and should land on it exactly.
  const { designId, fileIds } = await createDesign(request, [
    { x: 0, y: 0 },
    { x: 1600, y: 0 },
    { x: 3400, y: 0 },
  ]);
  try {
    await openOverview(page, designId, 3);
    await selectFrame(page, 2);
    const scale = await canvasScale(page);
    const before = await frameOffsets(page);

    const start = await visibleCentre(
      page,
      page.locator("[data-frame-drag-surface]"),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // 3400 -> 3204: four canvas px short of the 320 gap A and B already have.
    await page.mouse.move(start.x - 196 * scale, start.y, { steps: 20 });
    await page.waitForTimeout(400);

    const spacingMarks = await guideBoxes(page, "spacing");
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const after = await frameOffsets(page);
    const rhythm = before[fileIds[1]!]!.left - before[fileIds[0]!]!.left;
    expect(
      after[fileIds[2]!]!.left - after[fileIds[1]!]!.left,
      "the dragged screen should have snapped to the gap A and B already have",
    ).toBeCloseTo(rhythm, 1);
    expect(
      spacingMarks.length,
      "Figma marks both the new gap and the gap it matched",
    ).toBeGreaterThanOrEqual(2);
    expect(
      spacingMarks.every((mark) => isPainted(mark.paint)),
      `spacing marks drew but painted nothing: ${spacingMarks.map((m) => m.paint).join(", ")}`,
    ).toBe(true);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

/**
 * In-screen drags are driven by pointer/mouse events dispatched inside the
 * iframe document rather than page.mouse: the host scales and overlays the
 * preview, so a top-level gesture lands on canvas chrome instead of the
 * bridge's own shield. The bridge listens on its document, so this exercises
 * the real shipped drag path.
 */
async function screenFrameWithNode(page: Page, nodeId: string) {
  const iframes = page.locator("iframe[data-design-preview-iframe]");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const count = await iframes.count();
    for (let index = 0; index < count; index += 1) {
      const frame = iframes.nth(index).contentFrame();
      const hit = await frame
        .locator(`[data-agent-native-node-id="${nodeId}"]`)
        .count()
        .catch(() => 0);
      if (hit > 0) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no preview iframe rendered ${nodeId}`);
}

async function dragInsideScreen(
  page: Page,
  nodeId: string,
  contentDx: number,
  contentDy: number,
) {
  const frame = await screenFrameWithNode(page, nodeId);
  return frame.locator("body").evaluate(
    (_body, { nodeId: id, contentDx, contentDy }) => {
      const box = document.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!box) {
        throw new Error(
          `${id} is not in this frame; it holds: ` +
            Array.from(document.querySelectorAll("[data-agent-native-node-id]"))
              .map((node) => node.getAttribute("data-agent-native-node-id"))
              .join(",") +
            ` | body children: ${document.body.children.length}`,
        );
      }
      const rect = box.getBoundingClientRect();
      // Measured, not assumed: dispatching a client delta of D moves the
      // element D * lineScale content px, so a content-space target must be
      // divided by it. A review flagged this as an identity conversion; the
      // "snaps to the 100px gap" test lands 9px short without the division.
      const lineScale =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--agent-native-editor-chrome-line-scale",
          ),
        ) || 1;
      const dx = contentDx / lineScale;
      const dy = contentDy / lineScale;
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
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      fire("down", cx, cy);
      fire("move", cx + Math.sign(dx) * 8, cy + Math.sign(dy) * 8);
      fire("move", cx + dx, cy + dy);

      const layer = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="snap-guide"]',
      );
      const constraints = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="constraint-guide"]',
      );
      const sizeBadge = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="size-badge"]',
      );
      const snapshot = {
        left: box.style.left,
        top: box.style.top,
        guidesVisible: layer ? layer.style.display !== "none" : false,
        guideNodes: layer ? layer.children.length : 0,
        // Node count is blind to a guide painted with an undefined custom
        // property: right geometry, transparent, invisible on screen.
        guidePaint: layer?.children[0]
          ? getComputedStyle(layer.children[0]).backgroundColor
          : "",
        // A distance readout is a guide node carrying a number.
        distanceLabels: layer
          ? Array.from(layer.children).filter(
              (node) => (node.textContent ?? "").length > 0,
            ).length
          : 0,
        constraintLines:
          constraints && constraints.style.display !== "none"
            ? constraints.children.length
            : 0,
        sizeBadge:
          sizeBadge && sizeBadge.style.display !== "none"
            ? (sizeBadge.textContent ?? "")
            : "",
      };
      fire("up", cx + dx, cy + dy);
      return snapshot;
    },
    { nodeId, contentDx, contentDy },
  );
}

async function openScreenEditor(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('button[aria-label="Move"]')
    .first()
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  // No blind settle: expandAllLayers waits for the first layer row, which
  // the editor cannot render before it has parsed the document.
  await expandAllLayers(page);
  await screenFrameWithNode(page, "box-a");
  await page.getByRole("treeitem").filter({ hasText: "Box A" }).first().click();
  await page.waitForTimeout(1600);
}

test("dragging an element inside a screen lights up every edge it lines up with", async ({
  page,
  request,
}) => {
  const designId = await createSingleScreenDesign(request);
  try {
    await openScreenEditor(page, designId);
    const result = await dragInsideScreen(page, "box-a", 0, 32);

    expect(result.top, "the element never moved").not.toBe("280px");
    expect(result.guidesVisible).toBe(true);
    expect(
      result.guideNodes,
      "the two boxes are the same width and share a left edge, so their " +
        "centres and right edges line up too — Figma draws all three",
    ).toBeGreaterThan(1);
    expect(
      isPainted(result.guidePaint),
      `guide drew but painted "${result.guidePaint}" — --destructive is not ` +
        "forwarded into the screen iframe, so it resolves to transparent",
    ).toBe(true);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("dragging an element near an existing gap snaps the spacing to match it", async ({
  page,
  request,
}) => {
  // Box B -> Box C already sit 100px apart. Box A is dragged to roughly, not
  // exactly, that same distance above Box B.
  const designId = await createSingleScreenDesign(request);
  try {
    await openScreenEditor(page, designId);
    // Box A starts at top 280; -19 puts its bottom 99px above Box B, one px
    // short of the 100px gap Box B and Box C already have.
    const result = await dragInsideScreen(page, "box-a", 0, -19);

    expect(result.top, "the element never moved").not.toBe("280px");
    expect(
      Number.parseFloat(result.top),
      "Box A should have snapped to the 100px gap Box B and Box C already have",
    ).toBeCloseTo(260, 0);
    expect(result.guideNodes).toBeGreaterThan(1);
    expect(result.guidesVisible).toBe(true);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("dragging an element shows its constraint lines and pixel size, Figma-style", async ({
  page,
  request,
}) => {
  const designId = await createSingleScreenDesign(request);
  try {
    await openScreenEditor(page, designId);
    const result = await dragInsideScreen(page, "box-a", 0, 32);

    expect(result.top, "the element never moved").not.toBe("280px");
    expect(
      result.sizeBadge,
      "Figma pins the dragged object's dimensions under it",
    ).toBe("120 × 80");
    expect(
      result.constraintLines,
      "Box A is pinned top-left, so a dashed line runs to each of those frame edges",
    ).toBe(2);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("dragging an element shows how far it is from its nearest neighbour", async ({
  page,
  request,
}) => {
  const designId = await createSingleScreenDesign(request);
  try {
    await openScreenEditor(page, designId);
    // Box A ends up ~130px above Box B: no shared edge, no matching gap, so
    // the only reason to draw anything is proximity itself.
    const result = await dragInsideScreen(page, "box-a", 0, 30);

    expect(result.top, "the element never moved").not.toBe("280px");
    expect(
      result.distanceLabels,
      "Figma only prints a gap that matches another one; we print the nearest " +
        "neighbour's distance so the user can see closeness while dragging",
    ).toBeGreaterThan(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a lone element far from anything stays quiet", async ({
  page,
  request,
}) => {
  const designId = await createSingleScreenDesign(request);
  try {
    await openScreenEditor(page, designId);
    // Box C sits 620px down; dragging Box A up and away leaves every
    // neighbour outside the proximity range.
    const result = await dragInsideScreen(page, "box-a", 0, -240);

    expect(result.top, "the element never moved").not.toBe("280px");
    expect(
      result.distanceLabels,
      "a measurement stretched across empty canvas is noise, not feedback",
    ).toBe(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
