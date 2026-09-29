import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type APIRequestContext,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  cdpScreenshot,
  gotoEditor,
  resetPersistedCanvasState,
} from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
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
  <div data-agent-native-node-id="board-copy-source" data-agent-native-layer-name="Board copy source" data-an-primitive="frame"
       style="position:absolute;left:-100px;top:220px;width:60px;height:30px;box-sizing:border-box;background:#22c55e"></div>
</body></html>`;

let baseURL = BASE_URL;
let designId = "";
let activeScreenId = "";
let inactiveScreenId = "";
let activeScreenFilename = "";
let inactiveScreenFilename = "";
let rootPath = "";
let screenPath = "";
let persistedCopyHtml = "";
let devServer: Server | null = null;
let bridge: DesignConnectBridge | null = null;

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
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function fileContent(
  request: APIRequestContext,
  filename: string,
): Promise<string> {
  const response = await request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const record = await response.json();
  return (
    (record.files ?? []).find(
      (file: { filename?: string }) => file.filename === filename,
    )?.content ?? ""
  );
}

function screenFrame(page: Page, screenId: string) {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
}

async function screenContentFrame(
  page: Page,
  screenId: string,
): Promise<Frame> {
  const handle = await screenFrame(page, screenId).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`screen frame ${screenId} is not ready`);
  return frame;
}

function boardFrame(page: Page) {
  return page.locator("[data-board-surface-layer] iframe").first();
}

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function displayedFrameContentBox(
  iframe: Locator,
  frame: Frame,
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const [iframeBox, localBox, viewport] = await Promise.all([
    iframe.boundingBox(),
    locator.evaluate((element) => element.getBoundingClientRect().toJSON()),
    frame.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
  ]);
  if (!iframeBox) throw new Error("preview iframe has no rendered box");
  return {
    x: iframeBox.x + (localBox.x / viewport.width) * iframeBox.width,
    y: iframeBox.y + (localBox.y / viewport.height) * iframeBox.height,
    width: (localBox.width / viewport.width) * iframeBox.width,
    height: (localBox.height / viewport.height) * iframeBox.height,
  };
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeAll(async ({ request }, workerInfo) => {
  baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "design-parity-url-"));
  screenPath = path.join(rootPath, "index.html");
  fs.writeFileSync(screenPath, SCREEN_HTML);

  devServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      req.url === "/inactive"
        ? fs
            .readFileSync(screenPath, "utf8")
            .replace(
              "</body>",
              `${URL_DROP_TARGET_HTML}${persistedCopyHtml}</body>`,
            )
        : fs.readFileSync(screenPath, "utf8"),
    );
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
    title: `URL drag parity ${Date.now()}`,
    devServerUrl: manifest.devServerUrl,
    bridgeUrl: manifest.bridgeUrl,
    rootPath,
    routeManifest: manifest,
    routes: [
      {
        path: "/",
        title: "Active URL",
        width: 800,
        height: 600,
        x: 0,
        y: 0,
      },
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
  designId = opened.designId;
  activeScreenId = opened.screens?.[0]?.id ?? "";
  inactiveScreenId = opened.screens?.[1]?.id ?? "";
  activeScreenFilename = opened.screens?.[0]?.filename ?? "";
  inactiveScreenFilename = opened.screens?.[1]?.filename ?? "";
  if (
    !designId ||
    !activeScreenId ||
    !inactiveScreenId ||
    !activeScreenFilename ||
    !inactiveScreenFilename ||
    !opened.bridgeToken ||
    !opened.previewToken
  ) {
    throw new Error(`open-visual-edit returned incomplete data: ${opened}`);
  }
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardId = board.id ?? board.data?.id;
  if (!boardId) throw new Error("create-file returned no board id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: boardId },
      {
        op: "set",
        path: ["screenMetadata", boardId],
        value: { sourceType: "inline", width: 1800, height: 900 },
      },
    ],
  });
  bridge = await startDesignConnectBridge(manifest, {
    bridgeToken: opened.bridgeToken,
    previewToken: opened.previewToken,
    allowedOrigins: [new URL(baseURL).origin],
  });
});

test.afterAll(async ({ request }) => {
  if (designId)
    await action(request, "delete-design", { id: designId }).catch(() => {});
  await closeServer(bridge?.server ?? null);
  await closeServer(devServer);
  if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
});

test("URL screen selection is replaced after choosing another screen", async ({
  page,
}) => {
  await resetPersistedCanvasState(page);
  await page.goto(
    appPath(
      `/design/${designId}?view=overview&screen=${encodeURIComponent(activeScreenId)}`,
    ),
    { waitUntil: "domcontentloaded" },
  );
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(screenFrame(page, activeScreenId)).toBeVisible();
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible();

  await page
    .locator(`[data-frame-id="${inactiveScreenId}"] [data-frame-label]`)
    .dispatchEvent("click");

  await expect(page).toHaveURL(
    new RegExp(`screen=${encodeURIComponent(inactiveScreenId)}(?:&|$)`),
  );
});

test("URL-backed nested drops stay pending and root-frame Option-drag duplicates", async ({
  page,
}, testInfo) => {
  await gotoEditor(page, designId);
  await expect(screenFrame(page, activeScreenId)).toBeVisible();
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible();

  const activeFrame = await screenContentFrame(page, activeScreenId);
  const inactiveFrame = await screenContentFrame(page, inactiveScreenId);
  const boardContentFrame = boardFrame(page).contentFrame();
  expect(await inactiveFrame.evaluate(() => window.location.href)).toContain(
    "/inactive",
  );
  const boardSource = boardContentFrame.locator(
    '[data-agent-native-node-id="board-source"]',
  );
  const boardCopySource = boardContentFrame.locator(
    '[data-agent-native-node-id="board-copy-source"]',
  );
  const inactiveTarget = inactiveFrame.locator(
    '[data-agent-native-node-id="nested-frame"]',
  );
  const inactiveAnchor = inactiveFrame.locator(
    '[data-agent-native-node-id="nested-anchor"]',
  );
  const inactiveChildren = inactiveFrame.locator(
    '[data-agent-native-node-id="nested-frame"] > [data-agent-native-node-id]',
  );

  await expect(boardSource).toBeVisible({ timeout: 30_000 });
  await expect(boardCopySource).toBeVisible({ timeout: 30_000 });
  await expect(inactiveTarget).toBeVisible({ timeout: 30_000 });
  await expect(inactiveChildren).toHaveCount(1);
  const inactiveRouteBefore = await fileContent(
    page.request,
    inactiveScreenFilename,
  );
  const activeRouteBefore = await fileContent(
    page.request,
    activeScreenFilename,
  );
  expect(inactiveRouteBefore).toMatch(/^https?:\/\//);
  expect(activeRouteBefore).toMatch(/^https?:\/\//);

  const boardSourceBox = (await boardSource.boundingBox())!;
  const inactiveTargetBox = (await inactiveAnchor.boundingBox())!;
  const firstDropPoint = {
    x: inactiveTargetBox.x + inactiveTargetBox.width / 2 + 18,
    y: inactiveTargetBox.y + inactiveTargetBox.height / 2 + 11,
  };
  await page.mouse.move(boardSourceBox.x + 18, boardSourceBox.y + 11);
  await page.mouse.down();
  await expect(inactiveChildren).toHaveCount(1);
  await page.mouse.move(boardSourceBox.x + 24, boardSourceBox.y + 14, {
    steps: 2,
  });
  await page.mouse.move(firstDropPoint.x, firstDropPoint.y, { steps: 12 });
  await page.mouse.move(firstDropPoint.x, firstDropPoint.y, { steps: 12 });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await page.mouse.up();

  const inactiveBoardClone = inactiveFrame.locator(
    '[data-agent-native-layer-name="Board source"]',
  );
  await expect(inactiveBoardClone).toHaveCount(1, { timeout: 20_000 });
  await expect(boardSource).toHaveCount(1);
  await expect
    .poll(() => fileContent(page.request, inactiveScreenFilename), {
      timeout: 10_000,
    })
    .toBe(inactiveRouteBefore);

  const boardCopyBox = (await boardCopySource.boundingBox())!;
  const secondAnchorBox = (await inactiveAnchor.boundingBox())!;
  const secondDropPoint = {
    x: secondAnchorBox.x + secondAnchorBox.width / 2 + 30,
    y: secondAnchorBox.y + secondAnchorBox.height / 2 + 15,
  };
  await page.mouse.click(
    boardCopyBox.x + boardCopyBox.width / 2,
    boardCopyBox.y + boardCopyBox.height / 2,
  );
  const dragSurface = page.locator(
    "[data-board-object-selection-box] [data-frame-drag-surface]",
  );
  await expect(dragSurface).toBeVisible();
  const dragBox = (await dragSurface.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.down();
  await page.keyboard.up("Alt");
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 6,
    dragBox.y + dragBox.height / 2 + 3,
    { steps: 2 },
  );
  await page.mouse.move(secondDropPoint.x, secondDropPoint.y, { steps: 12 });
  await page.mouse.move(secondDropPoint.x, secondDropPoint.y, { steps: 12 });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await page.mouse.up();

  const inactiveBoardCopyClone = inactiveFrame.locator(
    '[data-agent-native-layer-name="Board copy source"]',
  );
  await expect(inactiveBoardCopyClone).toHaveCount(1, { timeout: 20_000 });
  await expect(boardCopySource).toHaveCount(1);
  await expect
    .poll(() => fileContent(page.request, inactiveScreenFilename), {
      timeout: 10_000,
    })
    .toBe(inactiveRouteBefore);

  const rootFrame = activeFrame.locator(
    '[data-agent-native-node-id="root-frame"]',
  );
  const rootBefore = await displayedFrameContentBox(
    screenFrame(page, activeScreenId),
    activeFrame,
    rootFrame,
  );
  await page.mouse.click(
    rootBefore.x + rootBefore.width / 2,
    rootBefore.y + rootBefore.height / 2,
  );
  await expect(
    activeFrame.locator('[data-agent-native-edit-overlay="selection"]'),
  ).toBeVisible();

  const rootStart = center(rootBefore);
  await physicalRootDrag(page, rootStart);

  const activeRootNodes = activeFrame.locator(
    '[data-agent-native-layer-name="Root frame"]',
  );
  await expect(activeRootNodes).toHaveCount(2, { timeout: 20_000 });
  const rootState = await activeFrame.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-agent-native-layer-name="Root frame"]',
      ),
    );
    const selection = document.querySelector<HTMLElement>(
      '[data-agent-native-edit-overlay="selection"]',
    );
    return {
      nodes: nodes.map((node) => ({
        id: node.getAttribute("data-agent-native-node-id"),
        rect: node.getBoundingClientRect().toJSON(),
      })),
      selectionRect: selection?.getBoundingClientRect().toJSON(),
    };
  });
  const original = rootState.nodes.find((node) => node.id === "root-frame");
  const clone = rootState.nodes.find((node) => node.id !== "root-frame");
  expect(original).toBeTruthy();
  expect(clone?.id).toMatch(/^an-copy-/);
  expect(clone!.rect.x).toBeGreaterThan(original!.rect.x);
  expect(rootState.selectionRect).toMatchObject({
    x: clone!.rect.x,
    y: clone!.rect.y,
    width: clone!.rect.width,
    height: clone!.rect.height,
  });
  await expect
    .poll(() => fileContent(page.request, activeScreenFilename), {
      timeout: 10_000,
    })
    .toBe(activeRouteBefore);

  const screenshotPath = testInfo.outputPath("url-drag-parity.png");
  await cdpScreenshot(page, screenshotPath);
  await test.info().attach("url-drag-parity.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

test("URL-backed Option-drag preserves identity and appearance across reload", async ({
  page,
}) => {
  persistedCopyHtml = "";
  await gotoEditor(page, designId);
  await expect(screenFrame(page, activeScreenId)).toBeVisible();
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible();

  const activeFrame = await screenContentFrame(page, activeScreenId);
  const inactiveFrame = await screenContentFrame(page, inactiveScreenId);
  const source = activeFrame.locator(
    '[data-agent-native-node-id="root-frame"]',
  );
  const targetAnchor = inactiveFrame.locator(
    '[data-agent-native-node-id="url-drop-target"]',
  );
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect(targetAnchor).toBeVisible({ timeout: 30_000 });
  const destinationNodes = inactiveFrame.locator("[data-agent-native-node-id]");
  const destinationIdsBefore = await destinationNodes.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-agent-native-node-id"),
    ),
  );
  const sourceAppearance = await source.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      width: style.width,
      height: style.height,
    };
  });

  const sourceBefore = await displayedFrameContentBox(
    screenFrame(page, activeScreenId),
    activeFrame,
    source,
  );
  const targetAnchorBox = await displayedFrameContentBox(
    screenFrame(page, inactiveScreenId),
    inactiveFrame,
    targetAnchor,
  );
  const start = center(sourceBefore);
  const drop = center(targetAnchorBox);
  drop.x += 18;
  drop.y += 11;

  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 4, { steps: 2 });
  await page.mouse.move(drop.x, drop.y, { steps: 24 });
  await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await expect(source).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(destinationNodes).toHaveCount(destinationIdsBefore.length + 1, {
    timeout: 20_000,
  });
  const destinationIdsAfter = await destinationNodes.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-agent-native-node-id"),
    ),
  );
  const copyId = destinationIdsAfter.find(
    (id): id is string => Boolean(id) && !destinationIdsBefore.includes(id),
  );
  expect(copyId).toMatch(/^(?:an-copy-|copy-)/);
  await expect(
    inactiveFrame.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("background-color", sourceAppearance.backgroundColor);
  await expect(
    inactiveFrame.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("width", sourceAppearance.width);
  await expect(
    inactiveFrame.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("height", sourceAppearance.height);
  await expect(source).toHaveCount(1);

  const copyHtml = await inactiveFrame
    .locator(`[data-agent-native-node-id="${copyId}"]`)
    .evaluate((element) => element.outerHTML);
  persistedCopyHtml = `    ${copyHtml}\n`;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(screenFrame(page, activeScreenId)).toBeVisible({
    timeout: 30_000,
  });
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible({
    timeout: 30_000,
  });
  const reloadedActive = await screenContentFrame(page, activeScreenId);
  await expect(
    reloadedActive.locator('[data-agent-native-node-id="root-frame"]'),
  ).toHaveCount(1);
  const reloadedInactive = await screenContentFrame(page, inactiveScreenId);
  await expect(
    reloadedInactive.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCount(1);
  await expect(
    reloadedInactive.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("background-color", sourceAppearance.backgroundColor);
  await expect(
    reloadedInactive.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("width", sourceAppearance.width);
  await expect(
    reloadedInactive.locator(`[data-agent-native-node-id="${copyId}"]`),
  ).toHaveCSS("height", sourceAppearance.height);
});

test("URL-backed Option-drag preserves appearance without CSS Typed OM", async ({
  page,
}, testInfo) => {
  persistedCopyHtml = "";
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "computedStyleMap", {
      configurable: true,
      value: undefined,
    });
  });
  await gotoEditor(page, designId);
  await expect(screenFrame(page, activeScreenId)).toBeVisible();
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible();

  const activeFrame = await screenContentFrame(page, activeScreenId);
  const inactiveFrame = await screenContentFrame(page, inactiveScreenId);
  const source = activeFrame.locator(
    '[data-agent-native-node-id="nested-anchor"]',
  );
  const targetAnchor = inactiveFrame.locator(
    '[data-agent-native-node-id="nested-anchor"]',
  );
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect(targetAnchor).toBeVisible({ timeout: 30_000 });
  const destinationNodes = inactiveFrame.locator("[data-agent-native-node-id]");
  const destinationIdsBefore = await destinationNodes.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-agent-native-node-id"),
    ),
  );
  const activeRouteBefore = await fileContent(
    page.request,
    activeScreenFilename,
  );
  const inactiveRouteBefore = await fileContent(
    page.request,
    inactiveScreenFilename,
  );

  const sourceBefore = await displayedFrameContentBox(
    screenFrame(page, activeScreenId),
    activeFrame,
    source,
  );
  const targetBox = await displayedFrameContentBox(
    screenFrame(page, inactiveScreenId),
    inactiveFrame,
    targetAnchor,
  );
  const start = center(sourceBefore);
  const drop = center(targetBox);
  drop.x += 18;
  drop.y += 11;

  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 4, { steps: 2 });
  await page.mouse.move(drop.x, drop.y, { steps: 24 });
  await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await expect(source).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(destinationNodes).toHaveCount(destinationIdsBefore.length + 1, {
    timeout: 20_000,
  });
  const destinationIdsAfter = await destinationNodes.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-agent-native-node-id"),
    ),
  );
  const copyId = destinationIdsAfter.find(
    (id): id is string => Boolean(id) && !destinationIdsBefore.includes(id),
  );
  expect(copyId).toMatch(/^(?:an-copy-|copy-)/);
  const copy = inactiveFrame.locator(`[data-agent-native-node-id="${copyId}"]`);
  await expect(copy).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(copy).toHaveCSS("width", "80px");
  await expect(copy).toHaveCSS("height", "40px");
  await expect(source).toHaveCount(1);
  await expect
    .poll(() => fileContent(page.request, activeScreenFilename))
    .toBe(activeRouteBefore);
  await expect
    .poll(() => fileContent(page.request, inactiveScreenFilename))
    .toBe(inactiveRouteBefore);

  persistedCopyHtml = `    ${await copy.evaluate((element) => element.outerHTML)}\n`;
  expect(persistedCopyHtml).toContain(`data-agent-native-node-id="${copyId}"`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(screenFrame(page, activeScreenId)).toBeVisible({
    timeout: 30_000,
  });
  await expect(screenFrame(page, inactiveScreenId)).toBeVisible({
    timeout: 30_000,
  });
  const reloadedInactive = await screenContentFrame(page, inactiveScreenId);
  const reloadedCopy = reloadedInactive.locator(
    `[data-agent-native-node-id="${copyId}"]`,
  );
  await expect(reloadedCopy).toHaveCount(1);
  await expect(reloadedCopy).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(reloadedCopy).toHaveCSS("width", "80px");
  await expect(reloadedCopy).toHaveCSS("height", "40px");

  const screenshotPath = testInfo.outputPath("url-drop-without-typed-om.png");
  await cdpScreenshot(page, screenshotPath);
  await test.info().attach("url-drop-without-typed-om.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

async function physicalRootDrag(page: Page, start: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 3, { steps: 2 });
  const activeFrame = page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${activeScreenId}"]`,
    )
    .contentFrame();
  await expect(
    activeFrame.locator("[data-agent-native-transform-badge]"),
  ).toHaveText("Duplicate layer");
  await page.mouse.move(start.x + 45, start.y + 20, { steps: 8 });
  await expect(
    activeFrame.locator("[data-agent-native-transform-badge]"),
  ).toHaveText("Duplicate layer");
  await page.mouse.move(start.x + 110, start.y + 55, { steps: 12 });
  await expect(
    activeFrame.locator("[data-agent-native-transform-badge]"),
  ).toHaveText("Duplicate layer");
  await page.mouse.up();
  await page.keyboard.up("Alt");
}
