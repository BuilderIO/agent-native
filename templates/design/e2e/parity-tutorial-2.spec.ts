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
  const file = (record.files ?? []).find((f: any) => f.filename === filename);
  if (typeof file?.content !== "string") {
    throw new Error(`${filename} has no content`);
  }
  return file.content;
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
      const scale = iframe.clientWidth
        ? iframeRect.width / iframe.clientWidth
        : 1;
      return {
        x: iframeRect.left + elRect.left * scale,
        y: iframeRect.top + elRect.top * scale,
        width: elRect.width * scale,
        height: elRect.height * scale,
      };
    }
    return null;
  }, nodeId);
}

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

async function typeCanvasTextOnce(
  page: Page,
  request: APIRequestContext,
  designId: string,
  pageX: number,
  pageY: number,
  text: string,
): Promise<void> {
  const textToolButton = page.locator(
    '[data-design-bottom-toolbar] button[aria-label="Text"]',
  );
  await textToolButton.click();
  await expect(textToolButton).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(pageX, pageY);
  await page.waitForFunction(
    () => {
      for (const iframe of Array.from(
        document.querySelectorAll("iframe"),
      ) as HTMLIFrameElement[]) {
        const doc = iframe.contentDocument;
        if (doc?.activeElement?.getAttribute("contenteditable") === "true") {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 8_000 },
  );
  await page.waitForTimeout(150);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () => (await fileContent(request, designId)).includes(`>${text}<`),
      { timeout: 10_000 },
    )
    .toBe(true);
}

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

function layerRowById(page: Page, nodeId: string) {
  return layerTree(page).locator(
    `[data-layer-row-button][data-layer-node-id="${nodeId}"]`,
  );
}

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
    const frameLayerNodeId = await selectedLayerNodeId(page);

    await renameLayerRowById(page, frameLayerNodeId, "play-button");
    await expect
      .poll(async () => (await boardObjects(request, designId))[frameId]?.name)
      .toBe("play-button");

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
    const frameBox = await boardObjectBoundingBox(page, frameId);
    expect(frameBox, "no bounding box for the drawn frame").toBeTruthy();

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

  test("step 3-4 (crossing the screen boundary): in-screen Frame tool draws album-art; alt-drag duplicates the board frame into it; Shift+Arrow nudges the copy", async ({
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
    const albumArtLayerNodeId = await selectedLayerNodeId(page);
    await expandAllLayers(page);
    await renameLayerRowById(page, albumArtLayerNodeId, "album-art");

    const sourceId = await drawBoardShapeAndWaitStable(
      page,
      request,
      designId,
      "Frame",
      60,
    );
    const sourceBox = await boardObjectBoundingBox(page, sourceId);
    expect(sourceBox, "no bounding box for the source frame").toBeTruthy();

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

    const boardAfter = await boardObjects(request, designId);
    expect(
      Object.keys(boardAfter),
      "alt-drag must leave the original board frame in place",
    ).toContain(sourceId);

    const newChildId = albumArtChildren[albumArtChildren.length - 1];
    const newChildLayerNodeId = await selectedLayerNodeId(page);
    await expandAllLayers(page);
    await selectLayerRowById(page, newChildLayerNodeId);
    await focusCanvas(page);
    const beforeNudgeMatch = new RegExp(
      `data-agent-native-node-id="${newChildId}"[^>]*style="([^"]*)"`,
    ).exec(html);
    expect(
      beforeNudgeMatch?.[1],
      "dropped copy must have persisted authored style before nudge",
    ).toBeTruthy();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expect
      .poll(
        async () => {
          const currentHtml = await fileContent(request, designId);
          const currentMatch = new RegExp(
            `data-agent-native-node-id="${newChildId}"[^>]*style="([^"]*)"`,
          ).exec(currentHtml);
          return (
            typeof currentMatch?.[1] === "string" &&
            currentMatch[1] !== beforeNudgeMatch?.[1]
          );
        },
        {
          timeout: 15_000,
          message: "Shift+Arrow nudge must persist before the assertion",
        },
      )
      .toBe(true);
    const htmlAfterNudge = await fileContent(request, designId);
    const afterNudgeMatch = new RegExp(
      `data-agent-native-node-id="${newChildId}"[^>]*style="([^"]*)"`,
    ).exec(htmlAfterNudge);
    expect(
      afterNudgeMatch?.[1],
      "Shift+Arrow nudge should change the dropped copy's authored position",
    ).not.toBe(beforeNudgeMatch?.[1]);
  });

  test("steps 7-8: text tool + duplicate, shift-click multi-select, Shift+A wraps title/creator into a 'metadata' auto-layout frame with gap 4", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await gotoEditor(page, designId);
    {
      let last: string | null = null;
      await expect
        .poll(
          async () => {
            const b = await screenBox(page);
            const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}`;
            const stable = key === last;
            last = key;
            return stable;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }

    const box = await screenBox(page);
    const titleClickY = Math.min(260, box.height / box.scale - 40);
    await typeCanvasTextOnce(
      page,
      request,
      designId,
      box.x + 60 * box.scale,
      box.y + titleClickY * box.scale,
      "title",
    );

    let html = await fileContent(request, designId);
    const titleId = nodeIdForText(html, "title");
    const titleLayerNodeId = await selectedLayerNodeId(page);

    await expandAllLayers(page);
    await selectLayerRowById(page, titleLayerNodeId);
    await focusCanvas(page);
    await page.keyboard.press(`${PRIMARY}+d`);
    await page.waitForTimeout(500);
    const duplicateLayerNodeId = await selectedLayerNodeId(page);
    html = await fileContent(request, designId);
    const titleCount = (html.match(/>title</g) ?? []).length;
    expect(titleCount, "Cmd+D must duplicate the title text node").toBe(2);
    const duplicateId = nodeIdForText(html, "title", 1);
    expect(duplicateId).not.toBe(titleId);

    await expandAllLayers(page);
    await selectLayerRowById(page, titleLayerNodeId);
    await selectLayerRowById(page, duplicateLayerNodeId, {
      modifiers: ["Shift"],
    });

    await focusCanvas(page);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(800);

    html = await fileContent(request, designId);
    expect(
      html,
      `Shift+A on two selected text layers must wrap them in a new auto-layout frame:\n${html.slice(0, 4000)}`,
    ).toMatch(/data-an-primitive="frame"/);
    const metadataId = await selectedLayerNodeId(page);

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

    await drawInScreenFrame(page, { x: 40, y: 30 }, { x: 220, y: 120 });
    const albumArtId = await selectedLayerNodeId(page);
    let html = await fileContent(request, designId);
    await expandAllLayers(page);
    await renameLayerRowById(page, albumArtId, "album-art");

    const box = await screenBox(page);
    await typeCanvasTextOnce(
      page,
      request,
      designId,
      box.x + box.width / 2,
      box.y + box.height - 20,
      "metatext",
    );
    const metaTextLayerNodeId = await selectedLayerNodeId(page);
    html = await fileContent(request, designId);

    await expandAllLayers(page);
    await selectLayerRowById(page, albumArtId!);
    await selectLayerRowById(page, metaTextLayerNodeId, {
      modifiers: ["Shift"],
    });
    await focusCanvas(page);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(800);

    html = await fileContent(request, designId);
    const frameCount = (html.match(/data-an-primitive="frame"/g) ?? []).length;
    expect(
      frameCount,
      "Shift+A over album-art + metatext must add exactly one new wrapping frame",
    ).toBeGreaterThanOrEqual(2);
    const cardId = await selectedLayerNodeId(page);

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
      "Fill sizing on album-art should author stretch/auto sizing rather than a fixed px width",
    ).toMatch(
      /(?:flex(-grow)?:\s*1|width:\s*(?:100%|auto)[\s\S]*align-self:\s*stretch)/,
    );

    await expandAllLayers(page);
    await selectLayerRowById(page, cardId!);
    const widthCaret = page
      .locator('button[aria-label*="sizing mode" i], button[aria-label^="W "]')
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

  test("Cmd+Opt+K creates a native component from the selected frame", async ({
    page,
    request,
  }) => {
    designId = await createDesign(request);
    await gotoEditor(page, designId);
    await drawInScreenFrame(page, { x: 40, y: 60 }, { x: 200, y: 160 });
    await expect
      .poll(async () =>
        (await fileContent(request, designId)).includes(
          'data-an-primitive="frame"',
        ),
      )
      .toBe(true);
    await expandAllLayers(page);
    await focusCanvas(page);
    await page.keyboard.press(`${PRIMARY}+Alt+k`);
    await expect
      .poll(async () => fileContent(request, designId))
      .toMatch(/data-agent-native-component="[^"]+"/);
    const after = await fileContent(request, designId);
    expect(after).toMatch(/data-agent-native-component-id="[^"]+"/);
  });
});
