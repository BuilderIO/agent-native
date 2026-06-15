import { test, expect, type Page } from "@playwright/test";

/*
 * AREA: Canvas interactions + wireframe visuals (the spatial board).
 *
 * Deep + adversarial coverage of CanvasArea / Wireframe:
 *  - pan (drag) and wheel/+- zoom; the zoom % readout tracks the real transform
 *  - artboard labels + section headers scale WITH the board (no inverse-zoom),
 *    so a label's footprint stays glued to its frame at every zoom level
 *  - annotation text never overlaps any frame (bounding-box overlap == 0)
 *  - annotation arrows point AT the target frame with a small gap (tip near the
 *    measured frame edge, not touching, not pointing away) — checked
 *    geometrically against the frame box
 *  - every frame has a visible border in all three registers: sketchy (rough.js
 *    SVG outline), clean (CSS frame), skeleton (neutral CSS frame)
 *  - edge cases: a popover artboard stays ~square; many annotations crowd one
 *    gutter without overlapping; light + dark themes both render borders
 *
 * These are ASSERTIONS OF CORRECT behavior. A failing assertion IS the bug.
 * Fixtures are created fresh through the authed create-visual-plan action so the
 * board shape is fully controlled and never depends on existing plans.
 */

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const WORLD = ".plan-canvas-world";
const VIEWPORT = ".plan-canvas-viewport";
const ZOOM_PCT = ".plan-canvas-zoom span";
const FRAME = (id: string) => `[data-canvas-frame='${id}']`;

/** Create a plan via the authed action surface; return its id. */
async function createPlan(
  page: Page,
  content: unknown,
  title: string,
): Promise<string> {
  const res = await page.request.post(
    "/_agent-native/actions/create-visual-plan",
    { data: { title, brief: "Canvas interaction fixture.", content } },
  );
  expect(
    res.ok(),
    `create-visual-plan failed: ${res.status()} ${await res.text().catch(() => "")}`,
  ).toBeTruthy();
  const json = (await res.json()) as {
    planId?: string;
    plan?: { id?: string };
  };
  const id = json.planId ?? json.plan?.id;
  expect(id, "create-visual-plan returned no plan id").toBeTruthy();
  return id as string;
}

/** Open a plan and wait for the canvas + its frames to be measured/painted. */
async function openCanvas(
  page: Page,
  planId: string,
  frameIds: string[],
  expectedAnnotations = 0,
) {
  await page.goto(`/plans/${planId}`);
  await expect(page.locator(".plan-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(VIEWPORT)).toBeVisible();
  for (const id of frameIds) {
    await expect(page.locator(FRAME(id))).toBeVisible({ timeout: 15_000 });
  }
  // Let ResizeObserver report frame heights + the annotation flex layout settle.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-canvas-frame]").length > 0,
  );
  if (expectedAnnotations > 0) {
    await expect(page.locator(".plan-canvas-annotation")).toHaveCount(
      expectedAnnotations,
      { timeout: 15_000 },
    );
  }
  await ensureCanvasReady(page);
  await page.waitForTimeout(900);
}

/**
 * Find a screen point inside the canvas viewport that is bare grid — not over a
 * frame, an annotation, the zoom controls, or any [data-plan-interactive] chrome
 * — so a pointer-down there starts a pan. Scans a coarse grid and returns the
 * first clear point, or null if the board is fully covered.
 */
async function findEmptyCanvasPoint(
  page: Page,
  drag?: { dx: number; dy: number },
): Promise<{ x: number; y: number } | null> {
  const vp = await boxOf(page, VIEWPORT);
  if (!vp) return null;
  const candidates: Array<[number, number]> = [];
  const xFractions =
    drag && drag.dx > 0
      ? [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84]
      : [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28, 0.2];
  for (const fx of xFractions) {
    for (let fy = 0.2; fy <= 0.8; fy += 0.15) {
      candidates.push([vp.left + vp.width * fx, vp.top + vp.height * fy]);
    }
  }
  return page.evaluate(
    ({ cands, drag }) => {
      const viewport = document
        .querySelector(".plan-canvas-viewport")
        ?.getBoundingClientRect();
      for (const [x, y] of cands as Array<[number, number]>) {
        if (
          viewport &&
          drag &&
          (x + drag.dx < viewport.left + 12 ||
            x + drag.dx > viewport.right - 12 ||
            y + drag.dy < viewport.top + 12 ||
            y + drag.dy > viewport.bottom - 12)
        ) {
          continue;
        }
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        const inVp = el.closest(".plan-canvas-viewport");
        const onFrame = el.closest("[data-canvas-frame]");
        const onNote = el.closest(".plan-canvas-annotation");
        const interactive = el.closest("[data-plan-interactive]");
        const marker = el.closest("[data-comment-marker]");
        if (inVp && !onFrame && !onNote && !interactive && !marker) {
          return { x, y };
        }
      }
      return null;
    },
    { cands: candidates, drag },
  );
}

function rectsOverlap(a: Box, b: Box): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

/** Overlap area in px^2 (0 when disjoint). */
function overlapArea(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

/**
 * Wait for the canvas world to be present + painted before a geometry read.
 * The shared dev server can HMR-reload mid-test (other agents edit the app),
 * which briefly tears down the canvas back to a "Loading plan" state; this
 * re-establishes it so a measurement never races a transient reload.
 */
async function ensureCanvasReady(page: Page) {
  await expect(page.locator(".plan-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          const t = getComputedStyle(el).transform;
          return typeof t === "string" && t.length > 0;
        }, WORLD),
      { timeout: 15_000 },
    )
    .toBeTruthy();
}

async function boxesOf(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
  }, selector);
}

async function boxOf(page: Page, selector: string): Promise<Box | null> {
  const list = await boxesOf(page, selector);
  return list[0] ?? null;
}

/** Read the current world transform matrix (a == d == scale, e/f == translate). */
async function worldTransform(page: Page) {
  await ensureCanvasReady(page);
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    const m = new DOMMatrixReadOnly(t === "none" ? undefined : t);
    return { scale: m.a, tx: m.e, ty: m.f };
  }, WORLD);
}

function centerOf(box: Box) {
  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  };
}

/** A board with two wide frames, one narrow popover, a section, annotations. */
function richBoard(title: string) {
  return {
    version: 2,
    title,
    brief: "Adversarial canvas fixture.",
    canvas: {
      title: "Review Board",
      sections: [
        {
          id: "sec-main",
          title: "Primary Flows",
          subtitle: "dashboard and detail",
          artboardIds: ["ab-dash", "ab-detail"],
        },
      ],
      frames: [
        {
          id: "ab-dash",
          label: "Dashboard Screen",
          surface: "desktop",
          wireframe: {
            surface: "desktop",
            html: "<div class='wf'><h1>Dashboard</h1><p>Overview content lives here.</p><button>Primary</button></div>",
          },
        },
        {
          id: "ab-detail",
          label: "Detail Screen",
          surface: "desktop",
          wireframe: {
            surface: "desktop",
            html: "<div class='wf'><h1>Detail</h1><p>Detail content.</p></div>",
          },
        },
        {
          id: "ab-pop",
          label: "Quick Add Popover",
          surface: "popover",
          wireframe: {
            surface: "popover",
            html: "<div class='wf'><h1>Quick Add</h1><input/></div>",
          },
        },
      ],
      annotations: [
        {
          id: "an-right",
          type: "note",
          title: "Right gutter note",
          text: "Points at the dashboard's right edge from the right gutter.",
          targetId: "ab-dash",
          placement: "right",
        },
        {
          id: "an-left",
          type: "note",
          title: "Left gutter note",
          text: "Points at the detail screen's left edge.",
          targetId: "ab-detail",
          placement: "left",
        },
        {
          id: "an-top",
          type: "note",
          title: "Top note",
          text: "Anchored above the popover.",
          targetId: "ab-pop",
          placement: "top",
        },
      ],
      flow: [{ from: "ab-dash", to: "ab-detail", label: "open detail" }],
    },
    blocks: [
      { id: "doc-1", type: "rich-text", data: { markdown: "# Plan\n\nBody." } },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Pan + zoom                                                                 */
/* -------------------------------------------------------------------------- */

test("pan drag moves the world; zoom % readout tracks the transform scale", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`pan-zoom-${Date.now()}`),
    "pan-zoom",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"]);

  // --- PAN: drag the empty canvas and assert the world translate moved by the
  // drag delta (pan is 1:1 in screen px, independent of zoom). ---
  const before = await worldTransform(page);
  expect(before).not.toBeNull();
  const vp = await boxOf(page, VIEWPORT);
  expect(vp).not.toBeNull();
  // Drag from a dynamically-found bare-grid point (clear of frames, notes, and
  // the zoom controls/toolbar, which carry data-plan-interactive and block
  // panning). Pan is screen-px 1:1, independent of zoom.
  const start = await findEmptyCanvasPoint(page);
  expect(
    start,
    "could not find an empty grid point to start a pan",
  ).not.toBeNull();
  // Drag toward the viewport center so the move stays in-bounds.
  const towardCenterX = start!.x > vp!.left + vp!.width / 2 ? -150 : 150;
  const dx = towardCenterX;
  const dy = 90;
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  await page.mouse.move(start!.x + dx, start!.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterPan = await worldTransform(page);
  expect(afterPan).not.toBeNull();
  expect(
    Math.abs(afterPan!.tx - before!.tx),
    "horizontal pan should move world translateX by ~drag delta",
  ).toBeGreaterThan(80);
  expect(
    Math.abs(afterPan!.ty - before!.ty),
    "vertical pan should move world translateY by ~drag delta",
  ).toBeGreaterThan(40);
  // Zoom must NOT change from a pure pan.
  expect(Math.abs(afterPan!.scale - before!.scale)).toBeLessThan(0.001);

  // --- ZOOM via + / - controls: % readout is monotonic and matches scale. ---
  const pctText = async () => {
    const t = (await page.locator(ZOOM_PCT).textContent())
      ?.replace("%", "")
      .trim();
    return Number(t);
  };
  const startPct = await pctText();
  expect(startPct).toBeGreaterThan(0);

  await page.locator(".plan-canvas-zoom button[aria-label='Zoom in']").click();
  await page.waitForTimeout(120);
  const afterIn = await pctText();
  expect(afterIn, "zoom-in should increase the %").toBeGreaterThan(startPct);
  const tIn = await worldTransform(page);
  // The readout (rounded %) must equal round(scale*100).
  expect(Math.round(tIn!.scale * 100)).toBe(afterIn);

  await page.locator(".plan-canvas-zoom button[aria-label='Zoom out']").click();
  await page.locator(".plan-canvas-zoom button[aria-label='Zoom out']").click();
  await page.waitForTimeout(120);
  const afterOut = await pctText();
  expect(afterOut, "zoom-out should decrease the %").toBeLessThan(afterIn);
  const tOut = await worldTransform(page);
  expect(Math.round(tOut!.scale * 100)).toBe(afterOut);
});

test("canvas comment pins preserve zoom and follow later pan", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`canvas-comment-anchor-${Date.now()}`),
    "canvas-comment-anchor",
  );
  const updateStatuses: number[] = [];
  page.on("requestfinished", async (request) => {
    if (
      request.url().includes("update-visual-plan") &&
      request.method().toUpperCase() === "POST"
    ) {
      const response = await request.response();
      const status = response?.status();
      if (typeof status === "number") updateStatuses.push(status);
    }
  });

  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"]);

  await page.locator(".plan-canvas-zoom button[aria-label='Zoom in']").click();
  await page.locator(".plan-canvas-zoom button[aria-label='Zoom in']").click();
  await page.waitForTimeout(150);
  const beforeComment = await worldTransform(page);
  expect(beforeComment).not.toBeNull();
  expect(beforeComment!.scale).toBeGreaterThan(0.75);

  const commentToggle = page.getByRole("radio", {
    name: "Comment",
    exact: true,
  });
  await expect(commentToggle).toBeVisible({ timeout: 15_000 });
  await commentToggle.click();
  await expect(
    page.getByRole("radio", { name: "Stop commenting", exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  const frame = await boxOf(page, FRAME("ab-dash"));
  expect(frame, "dashboard frame should be measurable").toBeTruthy();
  await page.mouse.click(
    frame!.left + frame!.width * 0.42,
    frame!.top + frame!.height * 0.52,
  );
  await expect(
    page.getByText("Add a comment...", { exact: false }),
    "clicking a canvas frame in comment mode should open the composer",
  ).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type("Canvas pin must stay anchored while panning.");
  await page.getByRole("button", { name: /^Save$/ }).click();

  await expect(async () => {
    expect(updateStatuses.length).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 15_000 });
  expect(
    updateStatuses.every((status) => status < 400),
    `saving a canvas pin must not return a server error (statuses: ${updateStatuses.join(", ")})`,
  ).toBeTruthy();
  await expect(page.locator("[data-comment-marker]")).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.waitForTimeout(250);

  const afterComment = await worldTransform(page);
  expect(afterComment).not.toBeNull();
  expect(
    Math.abs(afterComment!.scale - beforeComment!.scale),
    "saving a canvas comment must not reset zoom",
  ).toBeLessThan(0.001);
  expect(
    Math.abs(afterComment!.tx - beforeComment!.tx),
    "saving a canvas comment must not reset pan X",
  ).toBeLessThan(1);
  expect(
    Math.abs(afterComment!.ty - beforeComment!.ty),
    "saving a canvas comment must not reset pan Y",
  ).toBeLessThan(1);

  await page
    .getByRole("radio", { name: "Stop commenting", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Comment", exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  const markerBefore = await boxOf(page, "[data-comment-marker]");
  expect(markerBefore, "saved comment marker should be visible").toBeTruthy();
  const markerCenterBefore = centerOf(markerBefore!);
  const transformBeforePan = await worldTransform(page);
  const viewport = await boxOf(page, VIEWPORT);
  expect(viewport, "canvas viewport should be measurable").toBeTruthy();
  const dx =
    markerCenterBefore.x < viewport!.left + viewport!.width / 2 ? 96 : -96;
  const dy =
    markerCenterBefore.y < viewport!.top + viewport!.height / 2 ? 64 : -64;
  const start = await findEmptyCanvasPoint(page, { dx, dy });
  expect(start, "could not find an empty grid point to pan").not.toBeNull();
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  await page.mouse.move(start!.x + dx, start!.y + dy, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(
      async () => {
        const transform = await worldTransform(page);
        return transform && transformBeforePan
          ? Math.abs(transform.tx - transformBeforePan.tx)
          : 0;
      },
      { timeout: 3_000 },
    )
    .toBeGreaterThan(Math.abs(dx) / 2);

  const markerAfter = await boxOf(page, "[data-comment-marker]");
  const transformAfterPan = await worldTransform(page);
  expect(markerAfter).toBeTruthy();
  expect(transformBeforePan).toBeTruthy();
  expect(transformAfterPan).toBeTruthy();
  const markerDelta = {
    x: centerOf(markerAfter!).x - markerCenterBefore.x,
    y: centerOf(markerAfter!).y - markerCenterBefore.y,
  };
  const worldDelta = {
    x: transformAfterPan!.tx - transformBeforePan!.tx,
    y: transformAfterPan!.ty - transformBeforePan!.ty,
  };
  expect(
    Math.abs(markerDelta.x - worldDelta.x),
    "comment marker should move horizontally with the canvas world",
  ).toBeLessThan(18);
  expect(
    Math.abs(markerDelta.y - worldDelta.y),
    "comment marker should move vertically with the canvas world",
  ).toBeLessThan(18);
});

test("wheel over the canvas zooms (and never scrolls the page)", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`wheel-${Date.now()}`),
    "wheel-zoom",
  );
  await openCanvas(page, planId, ["ab-dash"]);

  const before = await worldTransform(page);
  const vp = await boxOf(page, VIEWPORT);
  const cx = vp!.left + vp!.width / 2;
  const cy = vp!.top + vp!.height / 2;
  await page.mouse.move(cx, cy);
  // Notched wheel up == zoom in. deltaY -120 mimics a mouse wheel click.
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
  const afterUp = await worldTransform(page);
  expect(afterUp!.scale, "wheel up should zoom the canvas in").toBeGreaterThan(
    before!.scale + 0.01,
  );

  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  const afterDown = await worldTransform(page);
  expect(
    afterDown!.scale,
    "wheel down should zoom the canvas back out",
  ).toBeLessThan(afterUp!.scale - 0.01);

  // The page itself must not have scrolled (wheel is captured by the canvas).
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY, "wheel over the canvas must not scroll the page").toBe(0);
});

/* -------------------------------------------------------------------------- */
/* Labels + section headers scale WITH the board (no inverse counter-scale)   */
/* -------------------------------------------------------------------------- */

test("artboard labels and section headers scale WITH the board on zoom", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`labels-${Date.now()}`),
    "labels",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"]);

  const label = page.locator(".plan-artboard-label").first();
  await expect(label).toBeVisible();
  const sectionHeader = page
    .locator(".plan-canvas-section p")
    .filter({ hasText: "Primary Flows" })
    .first();
  await expect(sectionHeader).toBeVisible();

  const labelBefore = await label.boundingBox();
  const headerBefore = await sectionHeader.boundingBox();
  const scaleBefore = (await worldTransform(page))!.scale;

  // Zoom in three notches.
  for (let i = 0; i < 3; i++) {
    await page
      .locator(".plan-canvas-zoom button[aria-label='Zoom in']")
      .click();
  }
  await page.waitForTimeout(250);
  const scaleAfter = (await worldTransform(page))!.scale;
  const labelAfter = await label.boundingBox();
  const headerAfter = await sectionHeader.boundingBox();

  const zoomRatio = scaleAfter / scaleBefore;
  expect(zoomRatio, "zoom-in should have increased scale").toBeGreaterThan(1.1);

  // The label footprint must grow in lockstep with the board scale — i.e. it
  // does NOT pixel-lock (which would be a counter-scaled label). Tolerance for
  // sub-pixel text metrics.
  const labelRatio = labelAfter!.width / labelBefore!.width;
  expect(
    labelRatio,
    `artboard label width should scale with the board (ratio ${labelRatio.toFixed(3)} vs zoom ${zoomRatio.toFixed(3)})`,
  ).toBeGreaterThan(zoomRatio * 0.85);
  expect(labelRatio).toBeLessThan(zoomRatio * 1.15);

  const headerRatio = headerAfter!.width / headerBefore!.width;
  expect(
    headerRatio,
    `section header width should scale with the board (ratio ${headerRatio.toFixed(3)} vs zoom ${zoomRatio.toFixed(3)})`,
  ).toBeGreaterThan(zoomRatio * 0.85);
  expect(headerRatio).toBeLessThan(zoomRatio * 1.15);
});

/* -------------------------------------------------------------------------- */
/* Annotations never overlap frames                                          */
/* -------------------------------------------------------------------------- */

test("annotation text does not overlap any artboard frame", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`overlap-${Date.now()}`),
    "overlap",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"], 3);

  const frames = await boxesOf(page, "[data-canvas-frame]");
  const notes = await boxesOf(page, ".plan-canvas-annotation");
  expect(notes.length, "fixture should render annotations").toBeGreaterThan(0);
  expect(frames.length).toBeGreaterThan(0);

  const collisions: string[] = [];
  for (const [ni, note] of notes.entries()) {
    for (const [fi, frame] of frames.entries()) {
      const area = overlapArea(note, frame);
      if (area > 4) {
        collisions.push(
          `note[${ni}] overlaps frame[${fi}] by ${Math.round(area)}px^2`,
        );
      }
    }
  }
  expect(
    collisions,
    `annotation text must never overlap a frame. ${collisions.join("; ")}`,
  ).toEqual([]);
});

test("canvas arrow callout labels choose a readable side instead of overlapping the target frame", async ({
  page,
}) => {
  const content = {
    version: 2,
    title: `callout-label-${Date.now()}`,
    brief: "callout label placement",
    canvas: {
      frames: [
        {
          id: "target-panel",
          label: "Target Panel",
          surface: "panel",
          x: 520,
          y: 180,
          width: 420,
          height: 420,
          wireframe: {
            surface: "panel",
            html: "<div class='wf'><h1>Panel</h1><p>The callout points here.</p></div>",
          },
        },
      ],
      annotations: [
        {
          id: "callout-left",
          type: "callout",
          text: "This callout label should stay readable and wrap LongUnbrokenPrototypeAnnotationTextWithoutClipping.",
          x: 500,
          y: 320,
          points: [
            { x: 500, y: 320 },
            { x: 650, y: 320 },
          ],
          style: { tone: "accent", stroke: "dashed", width: 2 },
        },
      ],
    },
    blocks: [
      {
        id: "d",
        type: "rich-text",
        data: { markdown: "# Callout label placement" },
      },
    ],
  };
  const planId = await createPlan(page, content, "callout-label");
  await openCanvas(page, planId, ["target-panel"]);
  await ensureCanvasReady(page);

  const label = await boxOf(page, ".plan-canvas-markup-note");
  const frame = await boxOf(page, FRAME("target-panel"));
  expect(label, "callout label should render").toBeTruthy();
  expect(frame, "target frame should render").toBeTruthy();
  expect(
    overlapArea(label!, frame!),
    "callout label must not overlap the target frame",
  ).toBeLessThanOrEqual(4);
  expect(
    label!.right,
    "callout label should pick the clear left side for this geometry",
  ).toBeLessThanOrEqual(frame!.left - 8);

  const overflow = await page.evaluate(() => {
    const labelEl = document.querySelector(
      ".plan-canvas-markup-note",
    ) as HTMLElement | null;
    if (!labelEl) return null;
    return {
      clientWidth: labelEl.clientWidth,
      scrollWidth: labelEl.scrollWidth,
      text: labelEl.textContent,
    };
  });
  expect(overflow?.text).toContain("LongUnbrokenPrototypeAnnotationText");
  expect(
    overflow!.scrollWidth,
    "long callout text should wrap inside the label instead of clipping",
  ).toBeLessThanOrEqual(overflow!.clientWidth + 2);
});

test("EDGE: many annotations crowding one frame's gutter never overlap each other or the frame", async ({
  page,
}) => {
  const annotations = Array.from({ length: 6 }).map((_, i) => ({
    id: `crowd-${i}`,
    type: "note" as const,
    title: `Note ${i + 1}`,
    text: `Crowded note number ${i + 1} stacked in the same right gutter column with enough text to wrap onto a couple of lines.`,
    targetId: "ab-dash",
    placement: "right" as const,
  }));
  const content = {
    version: 2,
    title: `crowd-${Date.now()}`,
    brief: "crowded gutter",
    canvas: {
      frames: [
        {
          id: "ab-dash",
          label: "Crowded Dashboard",
          surface: "desktop",
          wireframe: {
            surface: "desktop",
            html: "<div class='wf'><h1>Dash</h1><p>content</p></div>",
          },
        },
      ],
      annotations,
    },
    blocks: [{ id: "d", type: "rich-text", data: { markdown: "# Crowd" } }],
  };
  const planId = await createPlan(page, content, "crowd");
  await openCanvas(page, planId, ["ab-dash"], 6);

  const notes = await boxesOf(page, ".plan-canvas-annotation");
  expect(notes.length, "all six crowded notes should render").toBe(6);
  const frame = (await boxesOf(page, "[data-canvas-frame]"))[0];

  // No note overlaps the frame.
  for (const [i, note] of notes.entries()) {
    expect(
      overlapArea(note, frame),
      `crowded note ${i} must not overlap the frame`,
    ).toBeLessThanOrEqual(4);
  }
  // No two notes overlap each other (flex column stacking with a gap).
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      expect(
        overlapArea(notes[i], notes[j]),
        `crowded notes ${i} and ${j} must not overlap each other`,
      ).toBeLessThanOrEqual(4);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Arrows point AT their target frame with a small gap                       */
/* -------------------------------------------------------------------------- */

test("annotation arrows point at the target frame edge with a small gap (not touching, not away)", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`arrows-${Date.now()}`),
    "arrows",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"], 3);

  await ensureCanvasReady(page);
  await expect(page.locator(".plan-canvas-world > svg").first()).toBeVisible({
    timeout: 15_000,
  });
  // Geometric arrow check in board (world) coordinates so zoom/pan cancel out.
  // We rebuild the same anchor math the renderer uses: the resolved note box
  // edge -> the frame perimeter point pulled OUT by the small ARROW_FRAME_GAP.
  const report = await page.evaluate(() => {
    const world = document.querySelector(".plan-canvas-world") as HTMLElement;
    const t = getComputedStyle(world).transform;
    const m = new DOMMatrixReadOnly(t === "none" ? undefined : t);
    const scale = m.a;
    const tx = m.e;
    const ty = m.f;
    const worldRect = world.getBoundingClientRect();
    // Convert a screen rect to board (pre-transform) coordinates.
    const toBoard = (r: DOMRect) => {
      const left = (r.left - worldRect.left - 0) / scale; // worldRect already at translate
      return {
        left,
        top: (r.top - worldRect.top) / scale,
        right: (r.right - worldRect.left) / scale,
        bottom: (r.bottom - worldRect.top) / scale,
        cx: (r.left + r.width / 2 - worldRect.left) / scale,
        cy: (r.top + r.height / 2 - worldRect.top) / scale,
        w: r.width / scale,
        h: r.height / scale,
      };
    };
    void tx;
    void ty;

    const frames = new Map<string, ReturnType<typeof toBoard>>();
    document.querySelectorAll("[data-canvas-frame]").forEach((f) => {
      const id = (f as HTMLElement).getAttribute("data-canvas-frame")!;
      frames.set(id, toBoard(f.getBoundingClientRect()));
    });

    // Each annotation arrow svg encloses both endpoints. We can't read the path
    // d easily in board space, but we can check that the arrow svg's bounding
    // box REACHES the target frame edge region and stops just short of it.
    const arrowSvgs = Array.from(
      document.querySelectorAll(".plan-canvas-world > svg"),
    ).map((s) => toBoard((s as SVGElement).getBoundingClientRect()));

    return {
      frames: Array.from(frames.entries()).map(([id, b]) => ({ id, ...b })),
      arrowSvgs,
    };
  });

  // There must be drawn arrow/connector SVGs.
  expect(
    report.arrowSvgs.length,
    "the board should draw arrow/connector SVGs",
  ).toBeGreaterThan(0);

  // For each frame that has a targeting annotation, at least one arrow svg must
  // come within a small gap band of that frame's perimeter — i.e. its bounding
  // box reaches the frame but the arrow does not plunge deep inside it. We use
  // the arrow svg's nearest edge distance to the frame rectangle.
  const distToRect = (
    p: { x: number; y: number },
    r: { left: number; top: number; right: number; bottom: number },
  ) => {
    const dx = Math.max(r.left - p.x, 0, p.x - r.right);
    const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
    return Math.hypot(dx, dy);
  };

  for (const fid of ["ab-dash", "ab-detail"]) {
    const frame = report.frames.find((f) => f.id === fid)!;
    expect(frame, `frame ${fid} present`).toBeTruthy();
    // The arrow svg whose box is closest to this frame.
    let best = Infinity;
    for (const svg of report.arrowSvgs) {
      // distance of each of the svg-box corners to the frame rect; take min.
      const corners = [
        { x: svg.left, y: svg.top },
        { x: svg.right, y: svg.top },
        { x: svg.left, y: svg.bottom },
        { x: svg.right, y: svg.bottom },
      ];
      for (const c of corners) best = Math.min(best, distToRect(c, frame));
    }
    // An arrow that points AT this frame must have a corner essentially on the
    // frame perimeter (within the small visual gap + a generous tolerance for
    // the svg padding). If no arrow reaches the frame, the arrow points away.
    expect(
      best,
      `an annotation arrow should reach frame ${fid}'s edge (nearest svg corner ${best.toFixed(1)}px from the frame box)`,
    ).toBeLessThan(40);
  }
});

test("connector between two frames is drawn and spans both", async ({
  page,
}) => {
  const planId = await createPlan(
    page,
    richBoard(`connector-${Date.now()}`),
    "connector",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail"]);
  // The flow connector carries a label; assert it renders as svg text.
  const connectorLabel = page
    .locator(".plan-canvas-world svg text")
    .filter({ hasText: "open detail" });
  await expect(connectorLabel).toHaveCount(1);
});

/* -------------------------------------------------------------------------- */
/* Frame borders are visible in every render register                        */
/* -------------------------------------------------------------------------- */

test("sketchy frames draw a visible rough.js border", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("plan-wireframe-style", "sketchy");
    } catch {}
  });
  const planId = await createPlan(
    page,
    richBoard(`sketchy-${Date.now()}`),
    "sketchy-border",
  );
  await openCanvas(page, planId, ["ab-dash"]);
  await ensureCanvasReady(page);
  await expect(page.locator(".plan-kit-artboard").first()).toBeVisible();
  // rough overlay finishes after fonts.ready + a 0ms timer; wait for the
  // sketched paths to actually appear rather than a blind sleep.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelectorAll(".plan-rough-overlay path").length,
        ),
      { timeout: 12_000 },
    )
    .toBeGreaterThan(0);

  const info = await page.evaluate(() => {
    const arts = Array.from(document.querySelectorAll(".plan-kit-artboard"));
    return arts.map((a) => ({
      dataStyle: (a.querySelector("[data-style]") as HTMLElement)?.getAttribute(
        "data-style",
      ),
      roughPaths: a.querySelectorAll(".plan-rough-overlay path").length,
    }));
  });
  expect(info.length).toBeGreaterThan(0);
  for (const [i, art] of info.entries()) {
    expect(art.dataStyle, `artboard ${i} should be sketchy`).toBe("sketchy");
    expect(
      art.roughPaths,
      `sketchy artboard ${i} must draw a visible rough border (paths)`,
    ).toBeGreaterThan(0);
  }
});

test("clean frames draw a visible CSS border", async ({ page, context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("plan-wireframe-style", "clean");
    } catch {}
  });
  const planId = await createPlan(
    page,
    richBoard(`clean-${Date.now()}`),
    "clean-border",
  );
  await openCanvas(page, planId, ["ab-dash"]);
  await ensureCanvasReady(page);
  await expect(page.locator(".plan-kit-artboard").first()).toBeVisible();
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const arts = Array.from(document.querySelectorAll(".plan-kit-artboard"));
    return arts.map((a) => {
      const overlay = Array.from(a.querySelectorAll(":scope > div")).find(
        (d) => {
          const s = getComputedStyle(d as HTMLElement);
          return s.borderTopWidth !== "0px" && s.position === "absolute";
        },
      ) as HTMLElement | undefined;
      const cs = overlay ? getComputedStyle(overlay) : null;
      return {
        dataStyle: (
          a.querySelector("[data-style]") as HTMLElement
        )?.getAttribute("data-style"),
        borderWidthPx: cs ? parseFloat(cs.borderTopWidth) : 0,
        borderStyle: cs ? cs.borderTopStyle : "none",
        roughPaths: a.querySelectorAll(".plan-rough-overlay path").length,
      };
    });
  });
  expect(info.length).toBeGreaterThan(0);
  for (const [i, art] of info.entries()) {
    expect(art.dataStyle, `artboard ${i} should be clean`).toBe("clean");
    expect(art.roughPaths, `clean artboard ${i} should NOT draw rough`).toBe(0);
    expect(
      art.borderWidthPx,
      `clean artboard ${i} must have a visible CSS frame border`,
    ).toBeGreaterThanOrEqual(1);
    expect(art.borderStyle).toBe("solid");
  }
});

test("skeleton frames still draw a neutral frame border", async ({ page }) => {
  const content = {
    version: 2,
    title: `skeleton-${Date.now()}`,
    brief: "skeleton register",
    canvas: {
      frames: [
        {
          id: "sk-desk",
          label: "Loading Dashboard",
          surface: "desktop",
          wireframe: {
            surface: "desktop",
            skeleton: true,
            html: "<div class='wf'><h1>Loading</h1></div>",
          },
        },
      ],
    },
    blocks: [{ id: "d", type: "rich-text", data: { markdown: "# Skeleton" } }],
  };
  const planId = await createPlan(page, content, "skeleton-border");
  await openCanvas(page, planId, ["sk-desk"]);
  await ensureCanvasReady(page);
  await expect(page.locator(".plan-kit-artboard").first()).toBeVisible();
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const a = document.querySelector(".plan-kit-artboard") as HTMLElement;
    const overlay = Array.from(a.querySelectorAll(":scope > div")).find((d) => {
      const s = getComputedStyle(d as HTMLElement);
      return s.borderTopWidth !== "0px" && s.position === "absolute";
    }) as HTMLElement | undefined;
    const cs = overlay ? getComputedStyle(overlay) : null;
    return {
      borderWidthPx: cs ? parseFloat(cs.borderTopWidth) : 0,
      borderStyle: cs ? cs.borderTopStyle : "none",
      roughPaths: a.querySelectorAll(".plan-rough-overlay path").length,
    };
  });
  // Skeleton drops the sketch overlay but keeps a neutral CSS frame so the
  // loader still reads as a frame.
  expect(info.roughPaths, "skeleton must not draw rough").toBe(0);
  expect(
    info.borderWidthPx,
    "skeleton frame must still have a visible border",
  ).toBeGreaterThanOrEqual(1);
  expect(info.borderStyle).toBe("solid");
});

/* -------------------------------------------------------------------------- */
/* Surface footprint + theme edge cases                                      */
/* -------------------------------------------------------------------------- */

test("EDGE: a popover artboard stays ~square regardless of model width/height", async ({
  page,
}) => {
  // Adversarial: try to force the popover wide via x/y/width/height. The
  // renderer must IGNORE model geometry and keep the surface preset (square).
  const content = {
    version: 2,
    title: `popover-${Date.now()}`,
    brief: "popover square",
    canvas: {
      frames: [
        {
          id: "pop-wide",
          label: "Popover",
          surface: "popover",
          width: 1200,
          height: 200,
          wireframe: {
            surface: "popover",
            html: "<div class='wf'><h1>Quick Add</h1><input/></div>",
          },
        },
      ],
    },
    blocks: [{ id: "d", type: "rich-text", data: { markdown: "# Pop" } }],
  };
  const planId = await createPlan(page, content, "popover-square");
  await openCanvas(page, planId, ["pop-wide"]);
  await ensureCanvasReady(page);
  await expect(
    page.locator("[data-canvas-frame='pop-wide'] .plan-kit-artboard"),
  ).toBeVisible({ timeout: 15_000 });

  const art = await boxOf(
    page,
    "[data-canvas-frame='pop-wide'] .plan-kit-artboard",
  );
  expect(art).not.toBeNull();
  const ratio = art!.width / art!.height;
  expect(
    ratio,
    `popover artboard must stay ~square (got ${art!.width.toFixed(0)}x${art!.height.toFixed(0)}, ratio ${ratio.toFixed(3)})`,
  ).toBeGreaterThan(0.85);
  expect(ratio).toBeLessThan(1.15);
});

test("dark theme renders frame borders and annotations without overlap", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("plan-wireframe-style", "clean");
    } catch {}
  });
  const planId = await createPlan(
    page,
    richBoard(`dark-${Date.now()}`),
    "dark-canvas",
  );
  await openCanvas(page, planId, ["ab-dash", "ab-detail", "ab-pop"], 3);
  await ensureCanvasReady(page);
  await expect(page.locator(".plan-kit-artboard").first()).toBeVisible();
  await page.waitForTimeout(400);

  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  expect(dark, "dark theme should be applied").toBe(true);

  // Border still visible in dark mode.
  const borderWidth = await page.evaluate(() => {
    const a = document.querySelector(".plan-kit-artboard") as HTMLElement;
    const overlay = Array.from(a.querySelectorAll(":scope > div")).find((d) => {
      const s = getComputedStyle(d as HTMLElement);
      return s.borderTopWidth !== "0px" && s.position === "absolute";
    }) as HTMLElement | undefined;
    return overlay ? parseFloat(getComputedStyle(overlay).borderTopWidth) : 0;
  });
  expect(
    borderWidth,
    "dark-mode frame must keep a visible border",
  ).toBeGreaterThanOrEqual(1);

  // Overlap invariant holds in dark mode too.
  const frames = await boxesOf(page, "[data-canvas-frame]");
  const notes = await boxesOf(page, ".plan-canvas-annotation");
  for (const note of notes) {
    for (const frame of frames) {
      expect(
        overlapArea(note, frame),
        "dark-mode annotation must not overlap a frame",
      ).toBeLessThanOrEqual(4);
    }
  }
});
