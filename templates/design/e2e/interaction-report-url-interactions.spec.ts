import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
} from "@agent-native/core/testing";
import {
  type APIRequestContext,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

import { appPath, gotoEditor, resetPersistedCanvasState } from "./helpers";
import { expect, test as railsTest } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>URL nested drop</title></head>
<body style="margin:0;position:relative;display:flex;align-items:flex-start;gap:20px;width:800px;height:600px;background:#fff">
  <div data-agent-native-node-id="root-frame" data-agent-native-layer-name="Root frame" data-an-primitive="frame"
       style="position:relative;width:80px;height:50px;box-sizing:border-box;background:#f97316"></div>
  <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
       style="position:absolute;left:180px;top:120px;width:320px;height:240px;box-sizing:border-box;background:#bfdbfe;padding:16px">
    <div data-agent-native-node-id="nested-anchor" data-agent-native-layer-name="Existing child"
       style="position:absolute;left:16px;top:16px;width:80px;height:40px;background:#2563eb;color:#000;font-family:Arial;font-size:16px;line-height:normal;letter-spacing:normal;text-align:left;visibility:visible"></div>
  </div>
</body></html>`;
const URL_DROP_TARGET_HTML = `  <div data-agent-native-node-id="url-drop-target" data-agent-native-layer-name="URL drop target"
       style="position:absolute;left:520px;top:120px;width:120px;height:60px;background:#22c55e"></div>\n`;
const BOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>URL drop board</title></head>
<body style="margin:0;position:relative;width:1800px;height:900px;overflow:visible;background:transparent">
  <div data-agent-native-node-id="board-source" data-agent-native-layer-name="Board source" data-an-primitive="frame"
       style="position:absolute;left:-200px;top:140px;width:60px;height:30px;box-sizing:border-box;background:#f97316"></div>
</body></html>`;

type UrlScreen = { id: string; filename: string };
type UrlDesign = {
  id: string;
  active: UrlScreen;
  inactive: UrlScreen;
  /** Stands in for a coding agent applying the handoff: the /inactive route serves this markup from now on. */
  applyToInactiveSource: (html: string) => void;
};
type Rect = { x: number; y: number; width: number; height: number };

const cleanups: ((request: APIRequestContext) => Promise<void>)[] = [];

// Each test owns its design, dev server and bridge. Cleanup waits for afterAll so the editor page is
// gone first; closing the bridge under a live page is reported as an app failure by the rails fixture.
const test = railsTest.extend<{ urlDesign: UrlDesign }>({
  urlDesign: async ({ page }, use) => {
    await use(await openUrlDesign(page.request));
  },
});

test.use({ viewport: { width: 1600, height: 1000 } });

test.afterAll(async ({ request }) => {
  for (const cleanup of cleanups.splice(0)) await cleanup(request);
});

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function openUrlDesign(request: APIRequestContext): Promise<UrlDesign> {
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "design-interaction-url-"),
  );
  fs.writeFileSync(path.join(rootPath, "index.html"), SCREEN_HTML);
  let appliedInactiveHtml = "";
  const devServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const html =
      requestUrl.pathname === "/inactive"
        ? SCREEN_HTML.replace(
            "</body>",
            `${URL_DROP_TARGET_HTML}${appliedInactiveHtml}</body>`,
          )
        : SCREEN_HTML;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  const devPort = await listen(devServer);
  const bridgePortServer = http.createServer();
  const bridgePort = await listen(bridgePortServer);
  await closeServer(bridgePortServer);

  const manifest = await prepareDesignConnectManifest({
    root: rootPath,
    url: `http://127.0.0.1:${devPort}`, // e2e-harness-ignore ephemeral test server port
    port: bridgePort,
  });
  const opened = await action(request, "open-visual-edit", {
    title: `URL drag interaction ${Date.now()}`,
    devServerUrl: manifest.devServerUrl,
    bridgeUrl: manifest.bridgeUrl,
    rootPath,
    routeManifest: manifest,
    routes: [
      { path: "/", title: "Active URL", width: 800, height: 600, x: 0, y: 0 },
      {
        path: "/inactive",
        title: "Inactive URL",
        width: 800,
        height: 600,
        x: 960,
        y: 0,
      },
    ],
    navigate: false,
    publicReadOnly: false,
  });
  const [active, inactive] = opened.screens ?? [];
  if (
    !opened.designId ||
    !active?.id ||
    !inactive?.id ||
    !opened.bridgeToken ||
    !opened.previewToken
  ) {
    throw new Error(
      `open-visual-edit returned incomplete data: ${JSON.stringify(opened)}`,
    );
  }
  const board = await action(request, "create-file", {
    designId: opened.designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardId = board.id ?? board.data?.id;
  if (!boardId) throw new Error("create-file returned no board id");
  await action(request, "update-design", {
    id: opened.designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: boardId },
      {
        op: "set",
        path: ["screenMetadata", boardId],
        value: { sourceType: "inline", width: 1800, height: 900 },
      },
    ],
  });
  const bridge = await startDesignConnectBridge(manifest, {
    bridgeToken: opened.bridgeToken,
    previewToken: opened.previewToken,
    allowedOrigins: [new URL(appPath("/")).origin],
  });
  cleanups.push(async (cleanupRequest) => {
    await action(cleanupRequest, "delete-design", {
      id: opened.designId,
    }).catch(() => {});
    await closeServer(bridge.server);
    await closeServer(devServer);
    fs.rmSync(rootPath, { recursive: true, force: true });
  });
  return {
    id: opened.designId,
    active: { id: active.id, filename: active.filename },
    inactive: { id: inactive.id, filename: inactive.filename },
    applyToInactiveSource: (html) => {
      appliedInactiveHtml = `    ${html}\n`;
    },
  };
}

async function savedFile(
  request: APIRequestContext,
  designId: string,
  filename: string,
): Promise<string> {
  const response = await request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  expect(response.ok(), `get-design ${response.status()}`).toBe(true);
  const record = await response.json();
  return (
    (record.files ?? []).find(
      (file: { filename?: string }) => file.filename === filename,
    )?.content ?? ""
  );
}

/** The durable handoff a URL screen's edits are published to; the route file itself is never written. */
async function pendingHandoff(request: APIRequestContext, designId: string) {
  const response = await request.get(
    appPath(
      `/_agent-native/actions/get-visual-edit-pending?designId=${encodeURIComponent(designId)}`,
    ),
  );
  expect(response.ok(), `get-visual-edit-pending ${response.status()}`).toBe(
    true,
  );
  const { status, pendingEditCount } = await response.json();
  return { status, pendingEditCount };
}

function screenIframe(page: Page, screenId: string): Locator {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
}

function screenContent(page: Page, screenId: string): FrameLocator {
  return page.frameLocator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
}

/** Page coordinates of a point given in a screen's design pixels. */
async function screenPoint(
  page: Page,
  screenId: string,
  designX: number,
  designY: number,
) {
  const box = await screenIframe(page, screenId).boundingBox();
  if (!box) throw new Error(`screen ${screenId} has no box`);
  const width = await screenContent(page, screenId)
    .locator("html")
    .evaluate((element) => element.clientWidth);
  const scale = box.width / width;
  return { x: box.x + designX * scale, y: box.y + designY * scale };
}

/** Parent id, the ids of the parent's children in order, and the node's box in design px. */
async function placement(node: Locator) {
  return node.evaluate((element) => {
    const id = (el: Element) =>
      el === el.ownerDocument.body
        ? "BODY"
        : el.getAttribute("data-agent-native-node-id");
    const parent = element.parentElement!;
    const r = element.getBoundingClientRect();
    return {
      parent: id(parent),
      siblings: Array.from(parent.children)
        .filter((child) => child.hasAttribute("data-agent-native-node-id"))
        .map(id),
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
    };
  });
}

/** At 50% zoom one page pixel is two design pixels, so a released drop can round by that much. */
function expectNear(actual: Rect, expected: Rect) {
  const drift = Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height),
  );
  expect(
    drift,
    `rendered ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(2);
}

async function dragWithGuide(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { duplicate }: { duplicate: boolean },
) {
  await page.mouse.move(from.x, from.y);
  if (duplicate) await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await page.mouse.up();
  if (duplicate) await page.keyboard.up("Alt");
}

test("clicking another URL screen's label moves the selection to that screen", async ({
  app,
  page,
  urlDesign,
}) => {
  await resetPersistedCanvasState(page);
  await page.goto(
    appPath(
      `/design/${urlDesign.id}?view=overview&screen=${encodeURIComponent(urlDesign.active.id)}`,
    ),
    { waitUntil: "domcontentloaded" },
  );
  await expect(screenIframe(page, urlDesign.active.id)).toBeVisible({
    timeout: 30_000,
  });
  await expect(screenIframe(page, urlDesign.inactive.id)).toBeVisible();
  await expect.poll(() => app.selectedLayers()).toEqual(["Localhost home"]);
  const inactiveLabel = page.locator(
    `[data-frame-id="${urlDesign.inactive.id}"] [data-frame-label]`,
  );
  await page.keyboard.press("Shift+1");

  await inactiveLabel.click();

  await expect(page).toHaveURL(
    new RegExp(
      `[?&]screen=${encodeURIComponent(urlDesign.inactive.id)}(?:&|$)`,
    ),
  );
  await expect.poll(() => app.selectedLayers()).toEqual(["Localhost inactive"]);
});

// fixme: product bug: The dropped copy lands in the inactive URL screen's body flex row (parent BODY, between root-frame and nested-frame, rendered top-left
test.fixme("a board layer dropped on a URL screen's nested frame lands inside it at the drop point as a pending edit", async ({
  page,
  urlDesign,
}) => {
  await gotoEditor(page, urlDesign.id);
  const inactive = screenContent(page, urlDesign.inactive.id);
  const boardSource = page
    .frameLocator("[data-board-surface-layer] iframe")
    .locator('[data-agent-native-node-id="board-source"]');
  await expect(boardSource).toBeVisible({ timeout: 30_000 });
  await expect(
    inactive.locator('[data-agent-native-node-id="nested-frame"]'),
  ).toBeVisible({ timeout: 30_000 });
  const inactiveRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.inactive.filename,
  );
  const boardBefore = await savedFile(
    page.request,
    urlDesign.id,
    "__board__.html",
  );
  expect(inactiveRoute).toMatch(/^https?:\/\/.*\/inactive$/);
  expect(await pendingHandoff(page.request, urlDesign.id)).toEqual({
    status: "empty",
    pendingEditCount: 0,
  });

  const grab = await boardSource.boundingBox();
  await dragWithGuide(
    page,
    { x: grab!.x + grab!.width / 2, y: grab!.y + grab!.height / 2 },
    await screenPoint(page, urlDesign.inactive.id, 330, 235),
    { duplicate: false },
  );

  const dropped = inactive.locator(
    '[data-agent-native-layer-name="Board source"]',
  );
  await expect(dropped).toHaveCount(1, { timeout: 20_000 });
  await expect(boardSource).toHaveCount(1);
  await expect
    .poll(() => pendingHandoff(page.request, urlDesign.id), { timeout: 10_000 })
    .toEqual({ status: "ready", pendingEditCount: 1 });
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.inactive.filename),
  ).toBe(inactiveRoute);
  expect(await savedFile(page.request, urlDesign.id, "__board__.html")).toBe(
    boardBefore,
  );
  const droppedId = await dropped.getAttribute("data-agent-native-node-id");
  const landed = await placement(dropped);
  expect({ parent: landed.parent, siblings: landed.siblings }).toEqual({
    parent: "nested-frame",
    siblings: ["nested-anchor", droppedId],
  });
  expectNear(landed.rect, { x: 300, y: 220, width: 60, height: 30 });
});

test("Option-dragging a frame inside a URL screen duplicates it after the original, selects the copy, and leaves the route unwritten", async ({
  page,
  urlDesign,
}) => {
  await gotoEditor(page, urlDesign.id);
  const active = screenContent(page, urlDesign.active.id);
  const root = active.locator('[data-agent-native-node-id="root-frame"]');
  const selection = active.locator(
    '[data-agent-native-edit-overlay="selection"]',
  );
  await expect(root).toBeVisible({ timeout: 30_000 });
  const activeRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.active.filename,
  );
  expect(activeRoute).toMatch(/^https?:\/\/[^/]+\/?$/);
  const start = await screenPoint(page, urlDesign.active.id, 40, 25);
  await page.mouse.click(start.x, start.y);
  await expect(selection).toBeVisible();
  expect(await placement(root)).toEqual({
    parent: "BODY",
    siblings: ["root-frame", "nested-frame"],
    rect: { x: 0, y: 0, width: 80, height: 50 },
  });

  const badge = active.locator("[data-agent-native-transform-badge]");
  const to = await screenPoint(page, urlDesign.active.id, 260, 135);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 3, { steps: 2 });
  await expect(badge).toHaveText("Duplicate layer");
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(badge).toHaveText("Duplicate layer");
  await page.mouse.up();
  await page.keyboard.up("Alt");

  const rootFrames = active.locator(
    '[data-agent-native-layer-name="Root frame"]',
  );
  await expect(rootFrames).toHaveCount(2, { timeout: 20_000 });
  const copyId = await active
    .locator(
      '[data-agent-native-layer-name="Root frame"]:not([data-agent-native-node-id="root-frame"])',
    )
    .getAttribute("data-agent-native-node-id");
  expect(copyId).toMatch(/^an-copy-/);
  const copy = active.locator(`[data-agent-native-node-id="${copyId}"]`);
  expect(await placement(copy)).toEqual({
    parent: "BODY",
    siblings: ["root-frame", copyId, "nested-frame"],
    rect: { x: 100, y: 0, width: 80, height: 50 },
  });
  expect((await placement(root)).rect).toEqual({
    x: 0,
    y: 0,
    width: 80,
    height: 50,
  });
  await expect(copy).toHaveCSS("background-color", "rgb(249, 115, 22)");
  expect(
    await selection.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round);
    }),
  ).toEqual([100, 0, 80, 50]);
  await expect
    .poll(() => pendingHandoff(page.request, urlDesign.id), { timeout: 10_000 })
    .toEqual({ status: "ready", pendingEditCount: 1 });
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.active.filename),
  ).toBe(activeRoute);
});

test("Option-dragging a frame from one URL screen into another copies it into the target's flow, and the applied source reloads with exactly one copy", async ({
  page,
  urlDesign,
}) => {
  await gotoEditor(page, urlDesign.id);
  const active = screenContent(page, urlDesign.active.id);
  const inactive = screenContent(page, urlDesign.inactive.id);
  const source = active.locator('[data-agent-native-node-id="root-frame"]');
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect(
    inactive.locator('[data-agent-native-node-id="url-drop-target"]'),
  ).toBeVisible({ timeout: 30_000 });
  const activeRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.active.filename,
  );
  const inactiveRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.inactive.filename,
  );
  const inactiveRootFrames = inactive.locator(
    '[data-agent-native-layer-name="Root frame"]',
  );
  await expect(inactiveRootFrames).toHaveCount(1);

  await dragWithGuide(
    page,
    await screenPoint(page, urlDesign.active.id, 40, 25),
    await screenPoint(page, urlDesign.inactive.id, 600, 150),
    { duplicate: true },
  );

  await expect(inactiveRootFrames).toHaveCount(2, { timeout: 20_000 });
  const copyId = await inactive
    .locator(
      '[data-agent-native-layer-name="Root frame"]:not([data-agent-native-node-id="root-frame"])',
    )
    .getAttribute("data-agent-native-node-id");
  expect(copyId).toMatch(/^(?:an-copy-|copy-)/);
  const copy = inactive.locator(`[data-agent-native-node-id="${copyId}"]`);
  expect(await placement(copy)).toEqual({
    parent: "BODY",
    siblings: ["root-frame", "nested-frame", "url-drop-target", copyId],
    rect: { x: 100, y: 0, width: 80, height: 50 },
  });
  await expect(copy).toHaveCSS("background-color", "rgb(249, 115, 22)");
  expect(await placement(source)).toEqual({
    parent: "BODY",
    siblings: ["root-frame", "nested-frame"],
    rect: { x: 0, y: 0, width: 80, height: 50 },
  });
  await expect
    .poll(() => pendingHandoff(page.request, urlDesign.id), { timeout: 10_000 })
    .toEqual({ status: "ready", pendingEditCount: 1 });
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.active.filename),
  ).toBe(activeRoute);
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.inactive.filename),
  ).toBe(inactiveRoute);

  urlDesign.applyToInactiveSource(
    await copy.evaluate((element) => element.outerHTML),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(screenIframe(page, urlDesign.inactive.id)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    inactive.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(inactiveRootFrames).toHaveCount(2);
  const reloaded = inactive.locator(`[data-agent-native-node-id="${copyId}"]`);
  expect((await placement(reloaded)).rect).toEqual({
    x: 100,
    y: 0,
    width: 80,
    height: 50,
  });
  await expect(reloaded).toHaveCSS("background-color", "rgb(249, 115, 22)");
});

// fixme: product bug: Same defect as :347: the copy is placed in the target body's flex row (parent BODY, after root-frame) rather than in Nested frame at the
test.fixme("without CSS Typed OM, Option-dragging a layer into another URL screen's nested frame copies its exact appearance to the drop point", async ({
  page,
  urlDesign,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "computedStyleMap", {
      configurable: true,
      value: undefined,
    });
  });
  await gotoEditor(page, urlDesign.id);
  const active = screenContent(page, urlDesign.active.id);
  const inactive = screenContent(page, urlDesign.inactive.id);
  const source = active.locator('[data-agent-native-node-id="nested-anchor"]');
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect(
    inactive.locator('[data-agent-native-node-id="nested-anchor"]'),
  ).toBeVisible({ timeout: 30_000 });
  const activeRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.active.filename,
  );
  const inactiveRoute = await savedFile(
    page.request,
    urlDesign.id,
    urlDesign.inactive.filename,
  );
  const children = inactive.locator(
    '[data-agent-native-layer-name="Existing child"]',
  );
  await expect(children).toHaveCount(1);

  await dragWithGuide(
    page,
    await screenPoint(page, urlDesign.active.id, 236, 156),
    await screenPoint(page, urlDesign.inactive.id, 300, 240),
    { duplicate: true },
  );

  await expect(children).toHaveCount(2, { timeout: 20_000 });
  const copyId = await inactive
    .locator(
      '[data-agent-native-layer-name="Existing child"]:not([data-agent-native-node-id="nested-anchor"])',
    )
    .getAttribute("data-agent-native-node-id");
  expect(copyId).toMatch(/^(?:an-copy-|copy-)/);
  const copy = inactive.locator(`[data-agent-native-node-id="${copyId}"]`);
  await expect(copy).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(copy).toHaveCSS("width", "80px");
  await expect(copy).toHaveCSS("height", "40px");
  expect(await placement(source)).toEqual({
    parent: "nested-frame",
    siblings: ["nested-anchor"],
    rect: { x: 196, y: 136, width: 80, height: 40 },
  });
  await expect
    .poll(() => pendingHandoff(page.request, urlDesign.id), { timeout: 10_000 })
    .toEqual({ status: "ready", pendingEditCount: 1 });
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.active.filename),
  ).toBe(activeRoute);
  expect(
    await savedFile(page.request, urlDesign.id, urlDesign.inactive.filename),
  ).toBe(inactiveRoute);
  const landed = await placement(copy);
  expect({ parent: landed.parent, siblings: landed.siblings }).toEqual({
    parent: "nested-frame",
    siblings: ["nested-anchor", copyId],
  });
  expectNear(landed.rect, { x: 260, y: 220, width: 80, height: 40 });
});
