import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

/**
 * Figma parity — Pan/Zoom (spec §14). Mouse-driven cases prove plain wheel
 * pan, shift+wheel horizontal pan, cmd/ctrl+wheel zoom-at-cursor,
 * middle-mouse drag pan, space+drag pan, and that panning never selects/moves
 * elements. The final regression covers toolbar and keyboard zoom racing a
 * fit command while the readout tracks the real canvas scale.
 *
 * See templates/design/.claude/skills/design-editor-architecture/SKILL.md
 * ("prove the gesture, not just the outcome") and
 * .../scratchpad/arch-map.md §1 (MultiScreenCanvas.tsx beginPan :3927,
 * wheel :7470-7567; DesignCanvas.tsx EMBEDDED_WHEEL_BRIDGE_SCRIPT).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pan zoom</title></head>
<body style="margin:0;min-height:900px;background:#101418;color:#fff">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
  <button data-agent-native-node-id="cta" style="position:absolute;left:40px;top:160px;width:160px;height:48px">Click me</button>
</main></body></html>`;

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

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Pan zoom QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 1280, height: 900, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

/** The world layer's own transform: `{x, y}` translate plus scale. */
async function worldTransform(
  page: Page,
): Promise<{ x: number; y: number; scale: number } | null> {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    if (!world) return null;
    const transform = getComputedStyle(world).transform;
    if (!transform || transform === "none") return { x: 0, y: 0, scale: 1 };
    const m = new DOMMatrixReadOnly(transform);
    return { x: m.e, y: m.f, scale: m.a };
  });
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(async () => page.locator("[data-screen-shell]").count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  // The initial zoom-to-fit is a CSS transition with no completion event —
  // poll the world transform until two consecutive reads agree.
  let last: { x: number; y: number; scale: number } | null = null;
  await expect
    .poll(
      async () => {
        const t = await worldTransform(page);
        const stable =
          t !== null &&
          last !== null &&
          Math.abs(t.x - last.x) < 0.5 &&
          Math.abs(t.y - last.y) < 0.5 &&
          Math.abs(t.scale - last.scale) < 0.005;
        last = t;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Centre of the live screen preview content — where gestures were reported
 *  jumpy/swallowed vs. the empty canvas. */
async function screenContentPoint(page: Page) {
  const box = await page.locator("[data-screen-card]").first().boundingBox();
  if (!box) throw new Error("no screen card rendered");
  return {
    x: box.x + Math.min(box.width, 400) / 2,
    y: box.y + Math.min(box.height, 400) / 2,
  };
}

/** A point definitely off every screen card but still over the canvas
 *  surface — below the card, never under the left layers panel or the right
 *  inspector rail (which, at 1600px viewport width, leaves less gap to the
 *  card's right than a fixed +150px offset assumed). */
async function emptyCanvasPoint(page: Page) {
  const box = await page.locator("[data-screen-card]").first().boundingBox();
  if (!box) throw new Error("no screen card rendered");
  return { x: box.x + box.width / 2, y: box.y + box.height + 100 };
}

function selectedLayerRowCount(page: Page) {
  return page.locator('[role="treeitem"][aria-selected="true"]').count();
}

/** The toolbar zoom readout button, e.g. "100%". */
function zoomReadout(page: Page) {
  return page.getByRole("button", { name: /^\d+%$/ }).first();
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("plain wheel pans vertically by the wheel delta", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    const before = await worldTransform(page);
    expect(before).not.toBeNull();

    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(400);

    const after = await worldTransform(page);
    expect(after).not.toBeNull();
    // A wheel scroll of +120 (down) pans content up: the world's y
    // translate must move, x must not, and scale must be unchanged.
    expect(after!.y).not.toBeCloseTo(before!.y, 0);
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.scale).toBeCloseTo(before!.scale, 3);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("plain wheel pans vertically starting over screen content, not just empty canvas", async ({
  page,
  request,
}) => {
  // Logan: "middle-mouse pan is jumpy when it starts over content" — the
  // sibling report for wheel-pan is that a gesture beginning over an
  // iframe's live content must reach the host at all, not be swallowed.
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    const before = await worldTransform(page);

    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(400);

    const after = await worldTransform(page);
    expect(after!.y).not.toBeCloseTo(before!.y, 0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("shift+wheel pans horizontally", async ({ page, request }) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    const before = await worldTransform(page);

    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 120);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(400);

    const after = await worldTransform(page);
    expect(after!.x).not.toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.scale).toBeCloseTo(before!.scale, 3);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("cmd/ctrl+wheel zooms around the cursor: the point under the cursor stays fixed", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    const before = await worldTransform(page);
    expect(before).not.toBeNull();

    // Canvas-space coordinate under the cursor before zooming, computed from
    // the world transform: canvasPoint = (screenPoint - translate) / scale.
    const canvasPointBefore = {
      x: (point.x - before!.x) / before!.scale,
      y: (point.y - before!.y) / before!.scale,
    };

    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);

    const after = await worldTransform(page);
    expect(after!.scale).toBeGreaterThan(before!.scale);

    // Reproject the SAME canvas point through the new transform: it must
    // still land under the cursor (within a couple of px of rounding).
    const reprojected = {
      x: canvasPointBefore.x * after!.scale + after!.x,
      y: canvasPointBefore.y * after!.scale + after!.y,
    };
    expect(reprojected.x).toBeCloseTo(point.x, -0.3);
    expect(reprojected.y).toBeCloseTo(point.y, -0.3);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("middle-mouse drag pans smoothly with 1:1 deltas over empty canvas", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const start = await emptyCanvasPoint(page);
    const before = await worldTransform(page);
    expect(before).not.toBeNull();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    const dx = 137;
    const dy = -64;
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(300);

    const after = await worldTransform(page);
    expect(after).not.toBeNull();
    // 1:1: the world must translate by exactly the pointer delta (scale
    // unchanged, within a rounding pixel), not some fraction/multiple of it.
    expect(Math.abs(after!.x - before!.x - dx)).toBeLessThan(2);
    expect(Math.abs(after!.y - before!.y - dy)).toBeLessThan(2);
    expect(after!.scale).toBeCloseTo(before!.scale, 3);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("middle-mouse drag pans smoothly with 1:1 deltas starting over screen content", async ({
  page,
  request,
}) => {
  // This is the exact Logan repro: "jumpy when starting over content".
  // PR #4827 claims fixed — verify with real 1:1 deltas, not just "some pan
  // happened".
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const start = await screenContentPoint(page);
    const before = await worldTransform(page);
    expect(before).not.toBeNull();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    const dx = -91;
    const dy = 55;
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(300);

    const after = await worldTransform(page);
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x - dx)).toBeLessThan(2);
    expect(Math.abs(after!.y - before!.y - dy)).toBeLessThan(2);
    expect(after!.scale).toBeCloseTo(before!.scale, 3);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("space+drag pans the canvas", async ({ page, request }) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const start = await emptyCanvasPoint(page);
    const before = await worldTransform(page);
    expect(before).not.toBeNull();

    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Space");
    await page.mouse.down({ button: "left" });
    const dx = 80;
    const dy = 40;
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
    await page.mouse.up({ button: "left" });
    await page.keyboard.up("Space");
    await page.waitForTimeout(300);

    const after = await worldTransform(page);
    expect(after!.x - before!.x).toBeCloseTo(dx, 0);
    expect(after!.y - before!.y).toBeCloseTo(dy, 0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("panning never selects or moves an element under the drag path", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    // Drag the middle mouse button directly across the CTA button's screen
    // position — a left-drag through the same path would select/move it.
    const box = await page.locator("[data-screen-card]").first().boundingBox();
    if (!box) throw new Error("no screen card");
    const start = { x: box.x + 60, y: box.y + 200 };
    const end = { x: box.x + 260, y: box.y + 200 };

    expect(await selectedLayerRowCount(page)).toBe(0);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(300);

    expect(await selectedLayerRowCount(page)).toBe(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("the zoom level readout updates after a cmd/ctrl+wheel zoom", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    const readout = zoomReadout(page);
    await expect(readout).toBeVisible();
    const before = (await readout.textContent())?.trim();
    expect(before).toMatch(/^\d+%$/);

    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);

    await expect
      .poll(async () => (await readout.textContent())?.trim())
      .not.toBe(before);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("toolbar and keyboard zoom updates survive a pending fit without refresh", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const readout = zoomReadout(page);
    const before = await worldTransform(page);
    const beforeScale = before?.scale ?? null;
    const beforeLabel = (await readout.textContent())?.trim();
    expect(beforeScale).not.toBeNull();
    expect(beforeLabel).toMatch(/^\d+%$/);

    // Shift+1 schedules the camera command; the keyboard zoom must win before
    // the command's debounced commit can write its fit camera back.
    await page.keyboard.press("Shift+1");
    await page.keyboard.press(`${MOD}+=`);
    await expect
      .poll(async () => (await worldTransform(page))?.scale ?? null, {
        timeout: 2_000,
      })
      .toBeGreaterThan(beforeScale!);
    const afterKeyboardScale = (await worldTransform(page))?.scale ?? null;
    const afterKeyboardLabel = (await readout.textContent())?.trim();
    expect(afterKeyboardScale).toBeGreaterThan(beforeScale!);
    expect(afterKeyboardLabel).not.toBe(beforeLabel);

    // The toolbar uses the same controlled path. Verify its visible transform
    // and readout update without reloading the editor.
    await readout.click();
    await page.getByRole("menuitem", { name: "Zoom out" }).click();
    await expect
      .poll(async () => (await worldTransform(page))?.scale ?? null, {
        timeout: 2_000,
      })
      .toBeLessThan(afterKeyboardScale!);
    await expect
      .poll(async () => (await readout.textContent())?.trim(), {
        timeout: 2_000,
      })
      .not.toBe(afterKeyboardLabel);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a wheel pan burst over screen content does not log a scroll Intervention", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  const interventions: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/intervention/i.test(text)) interventions.push(text);
  });
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 60);
    await page.waitForTimeout(400);

    expect(interventions).toEqual([]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
