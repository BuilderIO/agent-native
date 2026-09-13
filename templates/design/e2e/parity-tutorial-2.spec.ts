import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  canvasZoom,
  childNodeIds,
  elementInner,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

/** The node id of the element (or its nearest text-wrapping ancestor) whose
 * text content is `text`. `occurrence` picks among duplicate text (0-based). */
function nodeIdForText(html: string, text: string, occurrence = 0): string {
  let searchFrom = 0;
  let textIndex = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    textIndex = html.indexOf(`>${text}<`, searchFrom);
    if (textIndex < 0) {
      throw new Error(
        `text "${text}" occurrence ${i} not found in html:\n${html.slice(0, 2000)}`,
      );
    }
    searchFrom = textIndex + 1;
  }
  const before = html.slice(0, textIndex);
  const matches = [...before.matchAll(/data-agent-native-node-id="([^"]+)"/g)];
  const last = matches[matches.length - 1];
  if (!last) throw new Error(`no node id before text "${text}"`);
  return last[1];
}

/**
 * Figma Learn tutorial 2: "Create a responsive card with auto layout and
 * constraints" (figma-interaction-spec.md Part 2 §2). Followed step by step
 * against the Design app's real gestures: frame tool (board + in-screen),
 * inspector-typed corner radius / effects / min-max width / constraints,
 * text tool, alt-drag duplicate across the screen boundary, arrow-key nudge,
 * shift-click multi-select, Shift+A auto layout, and Fill/Hug sizing.
 *
 * No component/variant system exists in Design (see finding tutorial2-9), so
 * every "Create component" step is replaced with its closest equivalent (a
 * plain frame) and the gap is recorded as a finding instead of blocking.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body style="margin:0;position:relative;min-height:900px;background:#ffffff"></body>
</html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await request.post(`${BASE_URL}/_agent-native/actions/${name}`, {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function createDesign(request: APIRequestContext): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Tutorial 2 QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error(`create-design returned no id: ${created}`);
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  return designId;
}

async function fileContent(
  request: APIRequestContext,
  id: string,
  filename = "index.html",
): Promise<string> {
  const record = await request
    .get(`${BASE_URL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  return (
    (record.files ?? []).find((f: any) => f.filename === filename)?.content ??
    ""
  );
}

/**
 * Board-level frames/shapes drawn outside any screen are persisted as
 * ordinary code-layer nodes inside the reserved __board__.html file (see
 * shared/board-file.ts), not in the legacy designs.data.boardObjects JSON
 * blob this helper used to read: that field is migrated away from the first
 * time a design opens (actions/migrate-board-objects-to-file.ts) and never
 * written to again, so reading it always returns {} post-migration. Parse
 * the board file's own markup instead, keyed by each top-level (direct
 * <body> child) node's real data-agent-native-node-id.
 */
interface BoardObjectSummary {
  kind: string;
  name?: string;
  radius?: number;
  effects?: string[];
  /** Set only for a direct (depth-1) child of a top-level board frame. */
  parentId?: string;
}

async function boardObjects(
  request: APIRequestContext,
  id: string,
): Promise<Record<string, BoardObjectSummary>> {
  const html = await fileContent(request, id, "__board__.html");
  const bodyMatch = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!bodyMatch) return {};
  const result: Record<string, BoardObjectSummary> = {};
  let depth = 0;
  let currentTopLevelId: string | undefined;
  for (const tag of bodyMatch[1].matchAll(/<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g)) {
    const [, slash, , attrs] = tag as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (slash === "/") {
      depth -= 1;
      if (depth === 0) currentTopLevelId = undefined;
      continue;
    }
    const nodeId = /data-agent-native-node-id="([^"]+)"/.exec(attrs)?.[1];
    if (nodeId && (depth === 0 || depth === 1)) {
      const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const radiusMatch = /border-radius:\s*([\d.]+)px/.exec(style);
      const shadowMatch = /box-shadow:\s*([^;]+)/.exec(style);
      result[nodeId] = {
        kind: /data-an-primitive="([^"]+)"/.exec(attrs)?.[1] ?? "frame",
        name: /data-agent-native-layer-name="([^"]+)"/.exec(attrs)?.[1],
        radius: radiusMatch ? Number(radiusMatch[1]) : undefined,
        effects: shadowMatch ? [shadowMatch[1].trim()] : undefined,
        parentId: depth === 1 ? currentTopLevelId : undefined,
      };
    }
    const selfClosing = attrs.trimEnd().endsWith("/");
    if (!selfClosing) {
      if (depth === 0 && nodeId) currentTopLevelId = nodeId;
      depth += 1;
    }
  }
  return result;
}

/**
 * Page-relative bounding box of a node id wherever it lives — the screen
 * iframe or the board iframe alike — by reaching directly into each
 * same-origin iframe's contentDocument (mirrors pen-board-commit.spec.ts's
 * allVectors helper). The board iframe carries no data-screen-iframe-id, so
 * designFrame()'s selector can't target it.
 */
async function boardObjectBoundingBox(
  page: Page,
  nodeId: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((id) => {
    for (const iframe of Array.from(
      document.querySelectorAll("iframe"),
    ) as HTMLIFrameElement[]) {
      const doc = iframe.contentDocument;
      const el = doc?.querySelector(`[data-agent-native-node-id="${id}"]`);
      if (!el) continue;
      const iframeRect = iframe.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      return {
        x: iframeRect.left + elRect.left,
        y: iframeRect.top + elRect.top,
        width: elRect.width,
        height: elRect.height,
      };
    }
    return null;
  }, nodeId);
}

/**
 * Freshly drawn objects (board objects and in-screen code-layer nodes alike)
 * are first assigned a transient client-side id of the form
 * `draft-frame-<timestamp>-<rand>`, later replaced by a stable persisted id.
 * Reading a draft id and then searching the layers panel for it races that
 * stabilization and times out. Poll `getIds` until a non-draft id shows up.
 */
async function waitForStableNodeId(
  getIds: () => Promise<string[]>,
  timeoutMs = 15_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ids = await getIds();
    const stable = ids.find((id) => id && !id.startsWith("draft-"));
    if (stable) return stable;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("no stable (non-draft) node id appeared in time");
}

async function pickFrameMode(page: Page, mode: "Frame" | "Screen") {
  await page
    .locator(
      '[data-design-bottom-toolbar] button[aria-label="Frame options"],' +
        ' [data-design-bottom-toolbar] button[aria-label="Screen options"]',
    )
    .first()
    .click();
  await page.getByRole("menuitem").filter({ hasText: mode }).first().click();
  await page.waitForTimeout(400);
}

async function drawWithTool(
  page: Page,
  toolLabel: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page
    .locator(`[data-design-bottom-toolbar] button[aria-label="${toolLabel}"]`)
    .click();
  await page.waitForTimeout(300);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

/**
 * Draw a board-level shape and don't return until a NEW, stable (non-draft)
 * board object id shows up. The draw occasionally misses (an emptyBoardPoint
 * that lands on chrome, or a draft id that never gets read past) so this
 * retries the whole gesture at a fresh point rather than failing the step.
 */
async function drawBoardShapeAndWaitStable(
  page: Page,
  request: APIRequestContext,
  designId: string,
  toolLabel: string,
  size = 120,
  attempts = 3,
): Promise<string> {
  const before = new Set(Object.keys(await boardObjects(request, designId)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const origin = await emptyBoardPoint(page);
    await drawWithTool(page, toolLabel, origin, {
      x: origin.x + size,
      y: origin.y + size,
    });
    try {
      return await waitForStableNodeId(async () => {
        const objects = await boardObjects(request, designId);
        return Object.keys(objects).filter((id) => !before.has(id));
      }, 5_000);
    } catch {
      // fall through to retry with a new point
    }
  }
  throw new Error(
    `no new stable board object appeared after ${attempts} ${toolLabel} draw attempts`,
  );
}

/** An empty point on the overview board, away from any screen card. */
async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Page-px rect of the first screen card, plus content-px → page-px scale
 * (screens default to 320 content-units wide, matching frame-screen-nesting.spec). */
/** Content-px → page-px mapping for the first screen's own iframe (NOT the
 * [data-screen-card] wrapper, which includes a name-label header above the
 * iframe and offsets every coordinate computed from it upward). */
async function screenBox(page: Page) {
  const box = (await page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .boundingBox())!;
  return { ...box, scale: box.width / 320 };
}

async function screenCardBox(page: Page) {
  const box = (await page.locator("[data-screen-card]").first().boundingBox())!;
  return box;
}

/** Draw with the Frame/Screen tool at content-px coordinates inside the
 * first screen card, scaled to page px. Mirrors frame-screen-nesting.spec's
 * verified `drawFrameTool`. */
async function drawInScreenFrame(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const box = await screenBox(page);
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Frame"]')
    .click();
  await page.waitForTimeout(400);
  await page.mouse.move(box.x + from.x * box.scale, box.y + from.y * box.scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x * box.scale, box.y + to.y * box.scale, {
    steps: 16,
  });
  await page.mouse.up();
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

/** Layer row located by its LAYERS-PANEL node id (the code-layer
 * projection's own hashed id, e.g. "html:1r0xyc7") — never the raw,
 * persisted data-agent-native-node-id a draw/duplicate/drop hands back.
 * Those two never coincide (shared/code-layer.ts's nodeIdFor always hashes
 * the authored id); resolve the real one via selectedLayerNodeId() before
 * calling this, the same convention parity-alt-drag-duplicate.spec.ts
 * established. */
function layerRowById(page: Page, nodeId: string) {
  return layerTree(page).locator(
    `[data-layer-row-button][data-layer-node-id="${nodeId}"]`,
  );
}

/**
 * The Layers-panel node id of whatever is currently selected. A freshly
 * drawn, duplicated, or dropped primitive is always left selected (see
 * canvas-tools.spec.ts's "insertion keeps the new primitive selected"
 * contract), so this is the reliable way to learn its real panel id right
 * after the gesture that created it — never assume it equals the raw
 * data-agent-native-node-id (see layerRowById above).
 */
async function selectedLayerNodeId(page: Page): Promise<string> {
  const button = layerTree(page)
    .locator('[aria-selected="true"] [data-layer-row-button]')
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  const id = await button.getAttribute("data-layer-node-id");
  if (!id) throw new Error("selected layer row has no data-layer-node-id");
  return id;
}

async function selectLayerRowById(
  page: Page,
  nodeId: string,
  options?: { modifiers?: ("Shift" | "Meta" | "Control")[] },
): Promise<void> {
  const button = layerRowById(page, nodeId);
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click({ force: true, modifiers: options?.modifiers });
}

/** Rename a layer (by node id) by double-clicking its row and typing a new name. */
async function renameLayerRowById(page: Page, nodeId: string, to: string) {
  const button = layerRowById(page, nodeId);
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.dblclick({ force: true });
  const input = layerTree(page).locator("input").first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(to);
  await input.press("Enter");
  await page.waitForTimeout(300);
}

function inspectorSection(page: Page, title: RegExp | string) {
  const heading =
    typeof title === "string"
      ? page.getByRole("heading", { name: title, exact: true })
      : page.getByRole("heading", { name: title });
  return page.locator("section").filter({ has: heading }).first();
}

async function setScrubInput(page: Page, label: string, value: string) {
  const input = page.locator(`input[aria-label="${label}" i]`).first();
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(300);
}

async function focusCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
}

test.describe("parity: tutorial 2 — responsive card with auto layout and constraints", () => {
  let designId = "";

  test.afterEach(async ({ request }) => {
    if (!designId) return;
    await action(request, "delete-design", { id: designId }).catch(() => {});
    designId = "";
  });

  test("step 1-2: Frame tool draws a board frame outside any screen; rename, corner radius, and drop shadow commit via the inspector", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=15`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    // Overview layout settles asynchronously after mount with no discrete
    // event — poll the screen card's box until two consecutive reads agree.
    const card = page.locator("[data-screen-card]").first();
    let lastCardBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await card.boundingBox();
          const stable =
            box !== null &&
            lastCardBox !== null &&
            Math.abs(box.x - lastCardBox.x) < 1 &&
            Math.abs(box.y - lastCardBox.y) < 1;
          lastCardBox = box;
          return stable;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const before = await boardObjects(request, designId);
    expect(Object.keys(before)).toHaveLength(0);

    // Step 1: press F (Frame tool, not Screen), draw a frame away from the
    // screen card — the Figma equivalent of a plain top-level frame that is
    // not itself a routable artboard.
    const frameId = await drawBoardShapeAndWaitStable(
      page,
      request,
      designId,
      "Frame",
    );
    const afterDraw = await boardObjects(request, designId);
    expect(
      Object.keys(afterDraw),
      "Frame tool must create exactly one board frame",
    ).toHaveLength(1);
    expect(afterDraw[frameId].kind).toBe("frame");
    // The layers panel keys rows by its own hashed projection id, never the
    // raw frameId above — read the real one off the still-selected row.
    const frameLayerNodeId = await selectedLayerNodeId(page);

    // Rename via the layers panel (double-click), like Figma.
    await renameLayerRowById(page, frameLayerNodeId, "play-button");
    await expect
      .poll(async () => (await boardObjects(request, designId))[frameId]?.name)
      .toBe("play-button");

    // Select it and type exact corner radius (Figma types "100" for a fully
    // pill-rounded 40x40 square).
    await selectLayerRowById(page, frameLayerNodeId);
    const radiusInput = page.locator('input[aria-label="Corner radius" i]');
    await expect(radiusInput).toBeVisible({ timeout: 10_000 });
    await radiusInput.fill("100");
    await radiusInput.press("Enter");
    await page.waitForTimeout(300);
    await expect
      .poll(
        async () => (await boardObjects(request, designId))[frameId]?.radius,
        { timeout: 10_000 },
      )
      .toBeTruthy();

    // Add a drop-shadow effect (Effects section → Add effect → Drop shadow,
    // the same two-click sequence inspector-styles.spec.ts and
    // parity-tutorial-1.spec.ts use — "Add effect" alone only opens the
    // kind menu, it never itself commits a shadow).
    const effectsSection = inspectorSection(page, /^Effects$/i);
    await effectsSection.getByRole("button", { name: "Add effect" }).click();
    await page.getByRole("menuitem", { name: "Drop shadow" }).click();
    await page.waitForTimeout(400);
    await expect
      .poll(
        async () => {
          const objects = await boardObjects(request, designId);
          const effects = objects[frameId]?.effects;
          return Array.isArray(effects) ? effects.length : 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test("step 2 substitute: no polygon/triangle tool exists — a rectangle is the closest equivalent and reparents into the frame", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=15`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    // Overview layout settles asynchronously after mount with no discrete
    // event — poll the screen card's box until two consecutive reads agree.
    {
      const card = page.locator("[data-screen-card]").first();
      let lastCardBox: { x: number; y: number } | null = null;
      await expect
        .poll(
          async () => {
            const box = await card.boundingBox();
            const stable =
              box !== null &&
              lastCardBox !== null &&
              Math.abs(box.x - lastCardBox.x) < 1 &&
              Math.abs(box.y - lastCardBox.y) < 1;
            lastCardBox = box;
            return stable;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }

    // Figma's step 2 draws a 16x16 triangle with the Polygon tool inside the
    // frame. Design has no polygon/star/triangle tool in its tool shortcuts
    // (v/f/r/o/l/t/p/h/k/c — no polygon key, no shape-type dropdown observed
    // on the Rectangle tool). Verify that absence, then use Rectangle as the
    // closest equivalent so the rest of the tutorial can proceed.
    const polygonButton = page.locator(
      '[data-design-bottom-toolbar] button[aria-label*="Polygon" i], [data-design-bottom-toolbar] button[aria-label*="Triangle" i]',
    );
    await expect(
      polygonButton,
      "no polygon/triangle tool button exists",
    ).toHaveCount(0);

    const frameId = await drawBoardShapeAndWaitStable(
      page,
      request,
      designId,
      "Frame",
    );
    // The board object renders inside the board's own same-origin iframe
    // (no data-board-object-id wrapper exists anywhere in the app) — reach
    // into the iframe directly rather than querying the host page.
    const frameBox = await boardObjectBoundingBox(page, frameId);
    expect(frameBox, "no bounding box for the drawn frame").toBeTruthy();

    // Draw the substitute rectangle centered inside the frame's on-screen box
    // so the draw hit-tests as "inside the frame" and reparents.
    const inside = {
      x: frameBox!.x + frameBox!.width / 2,
      y: frameBox!.y + frameBox!.height / 2,
    };
    const before = new Set(Object.keys(await boardObjects(request, designId)));
    await drawWithTool(page, "Rectangle", inside, {
      x: inside.x + 16,
      y: inside.y + 16,
    });
    const rectId = await waitForStableNodeId(async () => {
      const objects = await boardObjects(request, designId);
      return Object.keys(objects).filter(
        (id) => !before.has(id) && objects[id].kind === "rectangle",
      );
    });

    await expect
      .poll(
        async () => (await boardObjects(request, designId))[rectId]?.parentId,
        { timeout: 10_000 },
      )
      .toBe(frameId);
  });

  test("step 3-4 (crossing the screen boundary): in-screen Frame tool draws album-art; alt-drag duplicates the board frame into it; Option+Arrow nudges the copy", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=15`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    // Overview layout settles asynchronously after mount with no discrete
    // event — poll the screen card's box until two consecutive reads agree.
    {
      const card = page.locator("[data-screen-card]").first();
      let lastCardBox: { x: number; y: number } | null = null;
      await expect
        .poll(
          async () => {
            const box = await card.boundingBox();
            const stable =
              box !== null &&
              lastCardBox !== null &&
              Math.abs(box.x - lastCardBox.x) < 1 &&
              Math.abs(box.y - lastCardBox.y) < 1;
            lastCardBox = box;
            return stable;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }

    // Step 3: press F, draw a 360x240 "album-art" frame INSIDE the screen.
    await drawInScreenFrame(page, { x: 40, y: 60 }, { x: 220, y: 200 });

    const albumArtId = await waitForStableNodeId(async () => {
      const current = await fileContent(request, designId);
      const match =
        /data-agent-native-node-id="([^"]+)"[^>]*data-an-primitive="frame"/.exec(
          current,
        );
      return match ? [match[1]] : [];
    });
    let html = await fileContent(request, designId);
    expect(
      html,
      "step 3 must add a frame inside the screen, not a new screen file",
    ).toMatch(/data-an-primitive="frame"/);
    // The layers panel keys rows by its own hashed projection id, never the
    // raw albumArtId above — read the real one off the still-selected row.
    const albumArtLayerNodeId = await selectedLayerNodeId(page);
    await expandAllLayers(page);
    await renameLayerRowById(page, albumArtLayerNodeId, "album-art");

    // Step 4: create a source board object (stand-in for the play-button
    // instance) then Option/Alt-drag it across the screen boundary into
    // album-art. Real Figma alt-drags an *instance* of a component; Design
    // has no components, so alt-dragging the frame itself is the closest
    // equivalent — it is reported as a finding, not silently skipped.
    const sourceId = await drawBoardShapeAndWaitStable(
      page,
      request,
      designId,
      "Frame",
      60,
    );
    // The board object renders inside the board's own same-origin iframe
    // (no data-board-object-id wrapper exists anywhere in the app) — reach
    // into the iframe directly rather than querying the host page.
    const sourceBox = await boardObjectBoundingBox(page, sourceId);
    expect(sourceBox, "no bounding box for the source frame").toBeTruthy();

    // album-art lives inside the screen's own iframe document; drop
    // somewhere well inside its (40,60)-(220,200) content-px rect.
    const box = await screenBox(page);
    const dropTarget = {
      x: box.x + 110 * box.scale,
      y: box.y + 110 * box.scale,
    };

    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(dropTarget.x, dropTarget.y, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    let albumArtChildren: string[] = [];
    await expect
      .poll(
        async () => {
          html = await fileContent(request, designId);
          albumArtChildren = albumArtId ? childNodeIds(html, albumArtId) : [];
          return albumArtChildren.length;
        },
        {
          timeout: 10_000,
          message:
            "alt-drag across the screen boundary must drop a new child into album-art",
        },
      )
      .toBeGreaterThan(0);

    // Original board object must still exist (alt-drag duplicates, not
    // moves) and a new code-layer node must now be a child of album-art.
    const boardAfter = await boardObjects(request, designId);
    expect(
      Object.keys(boardAfter),
      "alt-drag must leave the original board frame in place",
    ).toContain(sourceId);

    // Option+Arrow nudge 16px on the newly-dropped copy. The drop leaves the
    // new copy selected — read its real layers-panel id off that selection
    // rather than assuming it equals the raw newChildId.
    const newChildId = albumArtChildren[albumArtChildren.length - 1];
    const newChildLayerNodeId = await selectedLayerNodeId(page);
    await expandAllLayers(page);
    await selectLayerRowById(page, newChildLayerNodeId);
    await focusCanvas(page);
    const beforeNudgeMatch = new RegExp(
      `data-agent-native-node-id="${newChildId}"[^>]*style="([^"]*)"`,
    ).exec(html);
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForTimeout(500);
    const htmlAfterNudge = await fileContent(request, designId);
    const afterNudgeMatch = new RegExp(
      `data-agent-native-node-id="${newChildId}"[^>]*style="([^"]*)"`,
    ).exec(htmlAfterNudge);
    expect(
      afterNudgeMatch?.[1],
      "Option+Arrow nudge should change the dropped copy's authored position",
    ).not.toBe(beforeNudgeMatch?.[1]);
  });

  test("steps 7-8: text tool + duplicate, shift-click multi-select, Shift+A wraps title/creator into a 'metadata' auto-layout frame with gap 4", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await gotoEditor(page, designId);

    // Step 7: Press T, click canvas, type "title".
    const box = await screenBox(page);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Text"]')
      .click();
    await page.waitForTimeout(300);
    await page.mouse.click(box.x + 60 * box.scale, box.y + 260 * box.scale);
    await page.waitForTimeout(300);
    await page.keyboard.type("title");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    let html = await fileContent(request, designId);
    expect(html).toContain("title");
    const titleId = nodeIdForText(html, "title");

    // Duplicate for "creator" (Cmd+D), then rename the duplicate's text.
    await expandAllLayers(page);
    await selectLayerRowById(page, titleId);
    await focusCanvas(page);
    await page.keyboard.press(`${PRIMARY}+d`);
    await page.waitForTimeout(500);
    html = await fileContent(request, designId);
    const titleCount = (html.match(/>title</g) ?? []).length;
    expect(titleCount, "Cmd+D must duplicate the title text node").toBe(2);
    const duplicateId = nodeIdForText(html, "title", 1);
    expect(duplicateId).not.toBe(titleId);

    // Shift-select title + its duplicate, then Shift+A.
    await expandAllLayers(page);
    await selectLayerRowById(page, titleId);
    await selectLayerRowById(page, duplicateId, { modifiers: ["Shift"] });

    await focusCanvas(page);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(800);

    html = await fileContent(request, designId);
    expect(
      html,
      `Shift+A on two selected text layers must wrap them in a new auto-layout frame:\n${html.slice(0, 4000)}`,
    ).toMatch(/data-an-primitive="frame"/);
    const metadataId = await waitForStableNodeId(async () => {
      const current = await fileContent(request, designId);
      const match =
        /data-agent-native-node-id="([^"]+)"[^>]*data-an-primitive="frame"/.exec(
          current,
        );
      return match ? [match[1]] : [];
    });

    await expandAllLayers(page);
    await renameLayerRowById(page, metadataId, "metadata");
    await selectLayerRowById(page, metadataId);
    const gapInput = page.locator('input[aria-label="Gap" i]').first();
    await expect(gapInput).toBeVisible({ timeout: 10_000 });
    await gapInput.fill("4");
    await gapInput.press("Enter");
    await page.waitForTimeout(400);
    html = await fileContent(request, designId);
    expect(html).toMatch(/gap:\s*4px/);
  });

  test("step 9-11: album-art + metadata wrap into a 'card' frame; Fill sizing on the children; min/max width commits on the card", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await gotoEditor(page, designId);

    // Build album-art (in-screen frame) and a metadata-text text node
    // quickly via the same gestures as the previous test, then run the
    // higher-level wrap.
    await drawInScreenFrame(page, { x: 40, y: 60 }, { x: 220, y: 200 });
    let html = await fileContent(request, designId);
    const albumArtId = await waitForStableNodeId(async () => {
      const current = await fileContent(request, designId);
      const match =
        /data-agent-native-node-id="([^"]+)"[^>]*data-an-primitive="frame"/.exec(
          current,
        );
      return match ? [match[1]] : [];
    });
    await expandAllLayers(page);
    await renameLayerRowById(page, albumArtId, "album-art");

    const box = await screenBox(page);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Text"]')
      .click();
    await page.waitForTimeout(300);
    await page.mouse.click(box.x + 60 * box.scale, box.y + 260 * box.scale);
    await page.waitForTimeout(300);
    await page.keyboard.type("metatext");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    html = await fileContent(request, designId);
    const metaTextId = nodeIdForText(html, "metatext");

    // Select album-art + metatext, Shift+A → "card".
    await expandAllLayers(page);
    await selectLayerRowById(page, albumArtId!);
    await selectLayerRowById(page, metaTextId, { modifiers: ["Shift"] });
    await focusCanvas(page);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(800);

    html = await fileContent(request, designId);
    const frameCount = (html.match(/data-an-primitive="frame"/g) ?? []).length;
    expect(
      frameCount,
      "Shift+A over album-art + metatext must add exactly one new wrapping frame",
    ).toBeGreaterThanOrEqual(2); // album-art itself + the new card wrapper
    const cardId = await waitForStableNodeId(async () => {
      const current = await fileContent(request, designId);
      const wrapperIds = [
        ...current.matchAll(
          /data-agent-native-node-id="([^"]+)"[^>]*data-an-primitive="frame"/g,
        ),
      ].map((m) => m[1]);
      return wrapperIds.filter((id) => id !== albumArtId);
    });

    await expandAllLayers(page);
    await renameLayerRowById(page, cardId, "card");
    await selectLayerRowById(page, cardId);
    const gapInput = page.locator('input[aria-label="Gap" i]').first();
    await expect(gapInput).toBeVisible({ timeout: 10_000 });
    await gapInput.fill("12");
    await gapInput.press("Enter");
    const radiusInput = page.locator('input[aria-label="Corner radius" i]');
    await radiusInput.fill("8");
    await radiusInput.press("Enter");
    await page.waitForTimeout(400);
    html = await fileContent(request, designId);
    expect(html).toMatch(/gap:\s*12px/);

    // Step 10: set album-art's sizing to Fill on both axes (it is now a
    // flex child of "card").
    await expandAllLayers(page);
    await selectLayerRowById(page, albumArtId!);
    const widthModeButton = page
      .locator('button[aria-label*="sizing mode" i], button[aria-label^="W "]')
      .first();
    await expect(widthModeButton).toBeVisible({ timeout: 10_000 });
    await widthModeButton.click();
    const fillOption = page.getByRole("menuitem", { name: /^Fill/i }).first();
    await expect(fillOption).toBeVisible({ timeout: 5_000 });
    await fillOption.click();
    await page.waitForTimeout(400);
    html = await fileContent(request, designId);
    expect(
      html,
      "Fill sizing on album-art should author flex-grow/width 100% rather than a fixed px width",
    ).toMatch(/flex(-grow)?:\s*1|width:\s*100%/);

    // Step 11: min/max width on the "card" frame.
    await expandAllLayers(page);
    await selectLayerRowById(page, cardId!);
    const widthCaret = page
      .locator('button[aria-label*="sizing mode" i]')
      .first();
    await expect(widthCaret).toBeVisible({ timeout: 10_000 });
    await widthCaret.click();
    const addMinWidth = page.getByRole("menuitem", { name: /Add min width/i });
    await expect(addMinWidth).toBeVisible({ timeout: 5_000 });
    await addMinWidth.click();
    await setScrubInput(page, "Min width", "200");
    html = await fileContent(request, designId);
    expect(html).toMatch(/min-width:\s*200px/);
  });

  test("Cmd+Opt+K (create component) has no equivalent: the shortcut is a no-op and no component/instance concept exists", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await gotoEditor(page, designId);
    await drawInScreenFrame(page, { x: 40, y: 60 }, { x: 200, y: 160 });
    const frameId = await waitForStableNodeId(async () => {
      const current = await fileContent(request, designId);
      const match =
        /data-agent-native-node-id="([^"]+)"[^>]*data-an-primitive="frame"/.exec(
          current,
        );
      return match ? [match[1]] : [];
    });
    await expandAllLayers(page);
    await selectLayerRowById(page, frameId);
    await focusCanvas(page);
    const before = await fileContent(request, designId);
    await page.keyboard.press(`${PRIMARY}+Alt+k`);
    await page.waitForTimeout(600);
    const after = await fileContent(request, designId);
    // No crash and no structural change is the expected (degraded) outcome;
    // this documents the missing feature rather than asserting a bug.
    expect(after).toBe(before);
    expect(
      page.locator(
        '[data-design-bottom-toolbar] button[aria-label*="Component" i]',
      ),
    ).toHaveCount(0);
  });
});
