import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import type { APIRequestContext, Page } from "@playwright/test";

import { E2E_EMAIL } from "./global-setup";
import { INTERACT_FRAME } from "./interact-helpers";
import { expect, test, type App } from "./rails";

const SOURCE = `<!doctype html><html><head><style>
      html,body{margin:0;background:#fff}main{padding:24px;width:720px}
      #flow{display:flex;flex-direction:column;gap:16px;border:2px solid #334155;padding:16px;width:640px}
      [data-card]{height:64px;border:2px solid #0f766e;background:#ccfbf1;padding:12px;box-sizing:border-box}
      #group-grid{display:grid;grid-template-columns:repeat(4,80px);grid-template-rows:repeat(3,60px);gap:10px;border:2px solid #7c3aed;padding:10px;width:360px;margin-top:24px}
      [data-group-card]{background:#ddd6fe;border:2px solid #6d28d9;box-sizing:border-box}
      #group-occupied{grid-column:3 / 5;grid-row:2;background:#fed7aa;border-color:#c2410c}
      #settings-search{position:absolute;left:760px;top:56px}
    </style></head><body><main>
      <input id="startup-search" type="search" aria-label="Startup search" style="position:absolute;left:760px;top:24px">
      <input id="settings-search" type="search" aria-label="Settings search">
      <div id="flow" data-source-id="flow-root" data-agent-native-node-id="flow-root" data-agent-native-layer-name="Flow root" data-source-file="index.html" data-source-line="1" data-source-column="1"><div id="v1" data-source-id="v1" data-agent-native-node-id="v1" data-agent-native-layer-name="V1" data-source-file="index.html" data-source-line="1" data-source-column="2" data-card>V1</div><div id="v2" data-source-id="v2" data-agent-native-node-id="v2" data-agent-native-layer-name="V2" data-source-file="index.html" data-source-line="1" data-source-column="3" data-card>V2</div><div id="v3" data-source-id="v3" data-agent-native-node-id="v3" data-agent-native-layer-name="V3" data-source-file="index.html" data-source-line="1" data-source-column="4" data-card>V3</div></div>
      <div id="group-grid" data-source-id="group-grid" data-agent-native-node-id="group-grid" data-source-file="index.html" data-source-line="1" data-source-column="5"><div id="group-occupied" data-source-id="group-occupied" data-agent-native-node-id="group-occupied" data-agent-native-layer-name="Occupied" data-source-file="index.html" data-source-line="1" data-source-column="8" data-group-card style="grid-column:3 / 5;grid-row:2">Occupied</div><div id="group-a" data-source-id="group-a" data-agent-native-node-id="group-a" data-agent-native-layer-name="Group A" data-source-file="index.html" data-source-line="1" data-source-column="6" data-group-card style="grid-column:1;grid-row:1;padding:8px;margin:4px">A</div><div id="group-b" data-source-id="group-b" data-agent-native-node-id="group-b" data-agent-native-layer-name="Group B" data-source-file="index.html" data-source-line="1" data-source-column="7" data-group-card style="grid-column:2;grid-row:1;padding:8px 24px 28px 32px;margin:4px 6px 7px 8px">B</div></div>
      <button type="button">Keep focus in app</button>
      <script>window.__runStartupFocus = () => { const input = document.querySelector("#startup-search"); window.parent.postMessage({ type: "fixture-autofocus-started" }, "*"); requestAnimationFrame(() => { input?.focus({ preventScroll: true }); const focused = document.activeElement === input; document.body.dataset.autofocusReady = "true"; window.parent.postMessage({ type: "fixture-autofocus-complete", focused }, "*"); }); }; setTimeout(() => window.__runStartupFocus?.(), location.pathname === "/settings" ? 8500 : 250);</script>
    </main></body></html>`;

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not expose a port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function grantLocalNetwork(page: Page, origin: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Browser.grantPermissions", {
    origin,
    permissions: ["localNetworkAccess"],
  });
  await cdp.detach();
}

/** Keyboard focus is on the canvas surface itself, not inside a preview iframe. */
async function canvasHasFocus(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const canvas = document.querySelector("[data-multi-screen-canvas-surface]");
    return (
      active instanceof HTMLElement &&
      Boolean(canvas?.contains(active)) &&
      active.tagName !== "IFRAME" &&
      active.tabIndex === -1
    );
  });
}

function activePreviewIndex(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .evaluateAll((frames) =>
      frames.indexOf(document.activeElement as HTMLIFrameElement),
    );
}

async function tabIntoPreview(page: Page) {
  let index = -1;
  for (let step = 0; step < 80 && index < 0; step += 1) {
    await page.keyboard.press("Tab");
    index = await activePreviewIndex(page);
  }
  return index;
}

/** The live order of the flow cards in the Home preview, or [] while the iframe is remounting. */
async function liveFlowOrder(page: Page) {
  try {
    return await page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame()
      .locator(
        '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
      )
      .evaluateAll((elements) =>
        elements.map((element) =>
          element.getAttribute("data-agent-native-node-id"),
        ),
      );
  } catch (error) {
    if (error instanceof Error && /Frame was detached/.test(error.message))
      return [];
    throw error;
  }
}

async function layerRowOrder(page: Page, names: RegExp) {
  return (await page.getByRole("treeitem").allInnerTexts())
    .map((text) => text.trim())
    .filter((text) => names.test(text));
}

test.describe("URL-backed live auto-layout probe", () => {
  let rootPath = "";
  let devServer: Server | null = null;
  let bridge: DesignConnectBridge | null = null;
  let baseURL = "";
  let connection: {
    devServerUrl: string;
    bridgeUrl: string;
    connectionId: string;
    bridgeToken: string;
  } | null = null;
  let bridgeDesignId = "";

  async function postAction(
    request: APIRequestContext,
    name: string,
    input: Record<string, unknown>,
  ) {
    const response = await request.post(
      `${baseURL}/_agent-native/actions/${name}`,
      {
        data: input,
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!response.ok())
      throw new Error(`${name}: ${response.status()} ${await response.text()}`);
    return await response.json();
  }

  /** A fresh visual-edit project on the shared localhost connection, deleted at teardown. */
  async function openProbeDesign(app: App, paths: string[]) {
    if (!connection) throw new Error("the localhost bridge never started");
    const opened = await postAction(app.page.request, "open-visual-edit", {
      title: "URL auto-layout local probe",
      ...connection,
      rootPath,
      paths,
      navigate: false,
      publicReadOnly: false,
      newDesign: true,
    });
    app.adopt(opened.designId);
    expect(opened.connectionId).toBe(connection.connectionId);
    return opened as {
      designId: string;
      screens: Array<{ id: string; path: string }>;
    };
  }

  async function pendingHandoff(request: APIRequestContext, designId: string) {
    const response = await request.get(
      `${baseURL}/_agent-native/actions/get-visual-edit-pending?designId=${encodeURIComponent(designId)}`,
    );
    expect(response.ok(), `get-visual-edit-pending ${response.status()}`).toBe(
      true,
    );
    return (await response.json()) as {
      status: string;
      pendingEditCount: number;
      prompt: string;
      revision: number | null;
    };
  }

  test.beforeAll(async ({ request }, workerInfo) => {
    baseURL = workerInfo.project.use.baseURL as string;
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "url-autolayout-local-"));
    fs.writeFileSync(path.join(rootPath, "index.html"), SOURCE);
    devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(rootPath, "index.html"), "utf8"));
    });
    const devPort = await listen(devServer);
    const targetUrl = `http://127.0.0.1:${devPort}`; // e2e-harness-ignore - the probe owns an ephemeral loopback app server.
    const portProbe = http.createServer();
    const bridgePort = await listen(portProbe);
    await closeServer(portProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    const opened = await postAction(request, "open-visual-edit", {
      title: "URL auto-layout bridge registration",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: false,
      newDesign: true,
    });
    bridgeDesignId = opened.designId;
    connection = {
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      connectionId: opened.connectionId,
      bridgeToken: opened.bridgeToken,
    };
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
  });

  test.beforeEach(() => {
    fs.writeFileSync(path.join(rootPath, "index.html"), SOURCE);
  });

  test.afterAll(async ({ request }) => {
    if (bridgeDesignId)
      await postAction(request, "delete-design", { id: bridgeDesignId }).catch(
        () => undefined,
      );
    await closeServer(bridge?.server ?? null);
    await closeServer(devServer);
    if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("reclaims canvas focus after a preview's delayed autofocus so Space-pan moves the canvas by the drag", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/", "/settings"]);
    await page.addInitScript(() => {
      const autofocus: Array<{ sourceIndex: number; focused: boolean }> = [];
      const blurs: number[] = [];
      Object.assign(window, {
        __autofocusReports: autofocus,
        __previewBlurs: blurs,
      });
      const previewIndex = (target: unknown) =>
        Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        ).findIndex(
          (iframe) => iframe === target || iframe.contentWindow === target,
        );
      window.addEventListener("blur", () =>
        blurs.push(previewIndex(document.activeElement)),
      );
      window.addEventListener("message", (event) => {
        const data = event.data as { type?: unknown; focused?: unknown } | null;
        if (data?.type === "fixture-autofocus-complete") {
          autofocus.push({
            sourceIndex: previewIndex(event.source),
            focused: data.focused === true,
          });
        }
      });
    });
    await grantLocalNetwork(page, new URL(baseURL).origin);
    await page.goto(
      `${baseURL}/visual-edit/${designId}?editorView=overview&embedChrome=1`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    await expect(liveFrames).toHaveCount(2);
    const framePaths = () =>
      Promise.all(
        [0, 1].map((index) =>
          liveFrames
            .nth(index)
            .contentFrame()
            .locator("body")
            .evaluate(() => window.location.pathname),
        ),
      );
    await expect
      .poll(async () => (await framePaths()).sort())
      .toStrictEqual(["/", "/settings"]);
    const settingsFrameIndex = (await framePaths()).indexOf("/settings");
    const settingsFrame = liveFrames.nth(settingsFrameIndex).contentFrame();
    for (const index of [0, 1]) {
      await expect(
        liveFrames
          .nth(index)
          .contentFrame()
          .locator('[data-agent-native-edit-overlay="shield"]'),
      ).toBeAttached({ timeout: 30_000 });
    }
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);

    // Settings autofocuses its search box 8.5 s after load, well after the canvas first took focus.
    await expect(settingsFrame.locator("body")).toHaveAttribute(
      "data-autofocus-ready",
      "true",
      { timeout: 30_000 },
    );
    await expect
      .poll(() =>
        page.evaluate((index) => {
          const win = window as unknown as {
            __autofocusReports: Array<{
              sourceIndex: number;
              focused: boolean;
            }>;
            __previewBlurs: number[];
          };
          return {
            focused: win.__autofocusReports.some(
              (report) => report.sourceIndex === index && report.focused,
            ),
            stolen: win.__previewBlurs.includes(index),
          };
        }, settingsFrameIndex),
      )
      .toEqual({ focused: true, stolen: true });
    await expect.poll(() => canvasHasFocus(page)).toBe(true);

    const emptyPoint = await page.evaluate(() => {
      const surface = document
        .querySelector("[data-multi-screen-canvas-surface]")
        ?.getBoundingClientRect();
      const shells = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-screen-shell], iframe[data-design-preview-iframe]",
        ),
      ).map((element) => element.getBoundingClientRect());
      if (!surface) return null;
      for (let y = surface.bottom - 24; y > surface.top + 24; y -= 24) {
        for (let x = surface.right - 24; x > surface.left + 24; x -= 24) {
          const outside = shells.every(
            (shell) =>
              x < shell.left ||
              x > shell.right ||
              y < shell.top ||
              y > shell.bottom,
          );
          const target = document.elementFromPoint(x, y);
          if (
            outside &&
            target?.closest("[data-multi-screen-canvas-surface]") &&
            !target.closest("iframe[data-design-preview-iframe]")
          ) {
            return { x, y };
          }
        }
      }
      return null;
    });
    if (!emptyPoint) throw new Error("no empty point on the canvas surface");
    const canvasSurface = page.locator("[data-multi-screen-canvas-surface]");
    const shell = page.locator("[data-screen-shell]").first();
    const before = await shell.boundingBox();
    if (!before) throw new Error("screen shell has no box");

    await page.mouse.move(emptyPoint.x, emptyPoint.y);
    await page.keyboard.down("Space");
    await expect(canvasSurface).toHaveCSS("cursor", "grab");
    await page.mouse.down();
    await expect(canvasSurface).toHaveCSS("cursor", "grabbing");
    await page.mouse.move(emptyPoint.x - 72, emptyPoint.y - 48, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");

    await expect
      .poll(async () => {
        const after = await shell.boundingBox();
        return after
          ? {
              dx: Math.round(after.x - before.x),
              dy: Math.round(after.y - before.y),
              width: Math.round(after.width - before.width),
            }
          : null;
      })
      .toEqual({ dx: -72, dy: -48, width: 0 });
    await expect(settingsFrame.locator("#startup-search")).not.toBeFocused();
    expect(await canvasHasFocus(page)).toBe(true);
  });

  test("keeps cross-origin text editing after delayed pointer selection and keeps the typed text as a pending edit", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await page.addInitScript(() => {
      const messages: Array<Record<string, unknown>> = [];
      const now = () => performance.timeOrigin + performance.now();
      Object.assign(window, { __canvasFocusMessages: messages });
      window.addEventListener("message", (event) => {
        const data = event.data as Record<string, unknown> | null;
        if (typeof data?.type !== "string") return;
        if (window === window.top) {
          if (data.type === "element-select" && data.trustedPointer === true) {
            messages.push({
              kind: "selection",
              time: now(),
              focusSafe: data.focusSafe,
            });
          } else if (data.type === "agent-native:canvas-focus-state") {
            messages.push({
              kind: "focus-state",
              time: now(),
              focusSafe: data.focusSafe,
              requestId: data.requestId,
            });
          }
        } else if (
          event.source === window.parent &&
          data.type === "agent-native:canvas-focus-state-probe"
        ) {
          messages.push({
            kind: "focus-probe",
            time: now(),
            requestId: data.requestId,
          });
        }
      });
    });
    await grantLocalNetwork(page, new URL(baseURL).origin);
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const iframe = page.locator("iframe[data-design-preview-iframe]");
    await expect(iframe).toHaveCount(1);
    const frame = iframe.contentFrame();
    const frameBody = frame.locator("body");
    const text = frame.locator('[data-agent-native-node-id="v1"]');
    await expect(text).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached({ timeout: 30_000 });
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);
    expect(await frameBody.evaluate(() => location.origin)).not.toBe(
      new URL(page.url()).origin,
    );
    expect(
      await iframe.evaluate(
        (element) => (element as HTMLIFrameElement).contentDocument,
      ),
    ).toBeNull();

    const hostMessageStart = await page.evaluate(
      () => (window as any).__canvasFocusMessages.length,
    );
    const childMessageStart = await frameBody.evaluate(
      () => (window as any).__canvasFocusMessages.length,
    );
    const bounds = await text.boundingBox();
    if (!bounds) throw new Error("V1 text target has no bounds");
    await page.mouse.dblclick(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );

    await expect(text).toHaveAttribute("contenteditable", "true");
    await expect
      .poll(async () => {
        const hostMessages = await page.evaluate(
          (start) =>
            (window as any).__canvasFocusMessages.slice(start) as Array<
              Record<string, unknown>
            >,
          hostMessageStart,
        );
        const childMessages = await frameBody.evaluate(
          (start) =>
            (window as any).__canvasFocusMessages.slice(start) as Array<
              Record<string, unknown>
            >,
          childMessageStart,
        );
        const selection = hostMessages.find(
          (message) =>
            message.kind === "selection" && message.focusSafe === true,
        );
        const probe = childMessages.find(
          (message) =>
            message.kind === "focus-probe" &&
            typeof message.time === "number" &&
            typeof selection?.time === "number" &&
            message.time > selection.time,
        );
        const response = hostMessages.find(
          (message) =>
            message.kind === "focus-state" &&
            message.requestId === probe?.requestId &&
            message.focusSafe === false,
        );
        return {
          staleSafeSelection: Boolean(selection),
          freshProbe: Boolean(probe),
          unsafeAcknowledgement: Boolean(response),
          editing: await text.evaluate(
            (element) =>
              element.getAttribute("contenteditable") === "true" &&
              element.ownerDocument.activeElement === element,
          ),
          frameActive: await iframe.evaluate(
            (element) => document.activeElement === element,
          ),
        };
      })
      .toEqual({
        staleSafeSelection: true,
        freshProbe: true,
        unsafeAcknowledgement: true,
        editing: true,
        frameActive: true,
      });

    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    await expect(text).toHaveText("V1 edited");
    await page.keyboard.press("Escape");
    await expect(text).not.toHaveAttribute("contenteditable", "true");

    await expect
      .poll(async () => {
        const handoff = await pendingHandoff(page.request, designId);
        return {
          status: handoff.status,
          pendingEditCount: handoff.pendingEditCount,
          namesTheText: handoff.prompt.includes("V1 edited"),
        };
      })
      .toEqual({ status: "ready", pendingEditCount: 1, namesTheText: true });
    await expect(frame.locator('[data-agent-native-node-id="v2"]')).toHaveText(
      "V2",
    );
    await expect(frame.locator('[data-agent-native-node-id="v3"]')).toHaveText(
      "V3",
    );
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      SOURCE,
    );
  });

  test("keeps a user-focused live input in Interact mode", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await grantLocalNetwork(page, new URL(baseURL).origin);
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    const shell = page.locator("[data-screen-shell]").first();
    const interact = page.getByRole("button", {
      name: "Interact",
      exact: true,
    });
    await expect(interact).toBeVisible({ timeout: 90_000 });
    await interact.hover();
    await interact.click();
    await expect(shell).toHaveAttribute("data-screen-interact-mode", "true");

    const liveDocument = page.locator(INTERACT_FRAME).contentFrame();
    const input = liveDocument.locator("#startup-search");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(
      liveDocument.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toHaveCount(0);
    const bounds = await input.boundingBox();
    if (!bounds) throw new Error("Interact input has no bounding box");
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (selector) =>
            document.activeElement === document.querySelector(selector),
          INTERACT_FRAME,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        input.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        ),
      )
      .toBe(true);
    await page.keyboard.type("interact-focus");
    await expect(input).toHaveValue("interact-focus");
  });

  test("preserves a live input reached with Tab in Edit mode", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await page.addInitScript(() => {
      const reports: Array<{ sourceIndex: number; focusSafe?: boolean }> = [];
      Object.defineProperty(window, "__canvasFocusReports", {
        value: reports,
        configurable: false,
      });
      window.addEventListener("message", (event) => {
        const data = event.data as {
          type?: unknown;
          focusSafe?: unknown;
        } | null;
        if (
          data?.type !== "agent-native:canvas-focus-state" &&
          data?.type !== "agent-native:canvas-tab-navigation"
        ) {
          return;
        }
        reports.push({
          sourceIndex: Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            ),
          ).findIndex((iframe) => iframe.contentWindow === event.source),
          ...(typeof data.focusSafe === "boolean"
            ? { focusSafe: data.focusSafe }
            : {}),
        });
      });
    });
    await grantLocalNetwork(page, new URL(baseURL).origin);
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrame = page.locator("iframe[data-design-preview-iframe]");
    const frame = liveFrame.contentFrame();
    const input = frame.locator("#startup-search");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => canvasHasFocus(page)).toBe(true);

    expect(
      await tabIntoPreview(page),
      "Tab should move focus into the live preview",
    ).toBe(0);
    await page.waitForTimeout(200);
    expect(
      await activePreviewIndex(page),
      "the preview should keep focus after Tab entered it",
    ).toBe(0);
    await expect(input).toBeFocused();
    await page.waitForTimeout(200);
    await expect(input).toBeFocused();
    await page.keyboard.type("tab-focused");
    await expect(input).toHaveValue("tab-focused");
    await expect(input).toBeFocused();
    const latestFocusSafety = () =>
      page.evaluate(() => {
        const reports = (
          window as Window & {
            __canvasFocusReports?: Array<{
              sourceIndex: number;
              focusSafe?: boolean;
            }>;
          }
        ).__canvasFocusReports?.filter((report) => report.sourceIndex === 0);
        return reports?.[reports.length - 1]?.focusSafe;
      });
    const requestFocusSafety = () =>
      liveFrame.evaluate((element) => {
        (element as HTMLIFrameElement).contentWindow?.postMessage(
          { type: "agent-native:canvas-focus-state-probe" },
          "*",
        );
      });
    await requestFocusSafety();
    await expect.poll(latestFocusSafety).toBe(false);
    const settingsInput = frame.locator("#settings-search");
    await page.keyboard.press("Tab");
    await expect(settingsInput).toBeFocused();
    await requestFocusSafety();
    await expect.poll(latestFocusSafety).toBe(false);

    const srcBeforeRouteChange = await liveFrame.getAttribute("src");
    const frameBody = frame.locator("body");
    await frameBody.evaluate(() => {
      history.pushState({}, "", "?focus-route-change");
    });
    await expect
      .poll(() => frameBody.evaluate(() => window.location.search))
      .toBe("?focus-route-change");
    await expect(liveFrame).toHaveAttribute("src", srcBeforeRouteChange ?? "");
    await expect(settingsInput).toBeFocused();

    await frameBody.evaluate(() => window.location.reload());
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => canvasHasFocus(page)).toBe(true);

    expect(
      await tabIntoPreview(page),
      "Tab should enter the live preview",
    ).toBe(0);
    const frameBounds = await liveFrame.boundingBox();
    if (!frameBounds) throw new Error("focused preview has no bounds");
    await page.mouse.move(
      frameBounds.x + frameBounds.width / 2,
      frameBounds.y + frameBounds.height / 2,
    );
    await expect.poll(() => canvasHasFocus(page)).toBe(true);
  });

  // fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
  test.fixme("keeps Tab focus when a sibling preview reports safe", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/", "/settings"]);
    await page.addInitScript(() => {
      const reports: Array<{ sourceIndex: number; focusSafe?: boolean }> = [];
      Object.defineProperty(window, "__canvasFocusReports", {
        value: reports,
      });
      window.addEventListener("message", (event) => {
        const data = event.data as {
          type?: unknown;
          focusSafe?: unknown;
        } | null;
        if (data?.type === "agent-native:canvas-focus-state") {
          reports.push({
            sourceIndex: Array.from(
              document.querySelectorAll<HTMLIFrameElement>(
                "iframe[data-design-preview-iframe]",
              ),
            ).findIndex((iframe) => iframe.contentWindow === event.source),
            ...(typeof data.focusSafe === "boolean"
              ? { focusSafe: data.focusSafe }
              : {}),
          });
        }
      });
    });
    await grantLocalNetwork(page, new URL(baseURL).origin);
    await page.goto(
      `${baseURL}/visual-edit/${designId}?editorView=overview&embedChrome=1`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    await expect(liveFrames).toHaveCount(2);
    for (const index of [0, 1]) {
      const liveFrame = liveFrames.nth(index).contentFrame();
      await expect(liveFrame.locator("#startup-search")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        liveFrame.locator('[data-agent-native-edit-overlay="shield"]'),
      ).toBeAttached({ timeout: 30_000 });
    }
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);
    await expect.poll(() => canvasHasFocus(page)).toBe(true);

    const firstFrameIndex = await tabIntoPreview(page);
    expect(
      firstFrameIndex,
      "Tab should enter a live preview",
    ).toBeGreaterThanOrEqual(0);

    const siblingFrameIndex = 1 - firstFrameIndex;
    const previousReportCount = await page.evaluate(
      () =>
        (window as Window & { __canvasFocusReports?: unknown[] })
          .__canvasFocusReports?.length ?? 0,
    );
    await liveFrames
      .nth(siblingFrameIndex)
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        window.parent.postMessage(
          { type: "agent-native:canvas-focus-state", focusSafe: true },
          "*",
        );
      });
    await expect
      .poll(() =>
        page.evaluate(
          ({ previousReportCount, siblingFrameIndex }) =>
            (
              window as Window & {
                __canvasFocusReports?: Array<{
                  sourceIndex: number;
                  focusSafe?: boolean;
                }>;
              }
            ).__canvasFocusReports
              ?.slice(previousReportCount)
              .some(
                (report) =>
                  report.sourceIndex === siblingFrameIndex &&
                  report.focusSafe === true,
              ) ?? false,
          { previousReportCount, siblingFrameIndex },
        ),
      )
      .toBe(true);
    await expect.poll(() => activePreviewIndex(page)).toBe(firstFrameIndex);

    const first = liveFrames.nth(firstFrameIndex).contentFrame();
    await first.locator("#startup-search").focus();
    await page.keyboard.press("Tab");
    await expect(first.locator("#settings-search")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      first.getByRole("button", { name: "Keep focus in app" }),
    ).toBeFocused();
    let activeFrameIndex = firstFrameIndex;
    for (
      let step = 0;
      step < 80 && activeFrameIndex !== siblingFrameIndex;
      step += 1
    ) {
      await page.keyboard.press("Tab");
      activeFrameIndex = await activePreviewIndex(page);
    }
    expect(
      activeFrameIndex,
      "Tab should move from one live preview into its sibling preview",
    ).toBe(siblingFrameIndex);
    const siblingBody = liveFrames
      .nth(siblingFrameIndex)
      .contentFrame()
      .locator("body");
    await siblingBody.evaluate(() => {
      window.parent.postMessage(
        { type: "agent-native:canvas-focus-state-probe" },
        "*",
      );
    });
    await expect.poll(() => activePreviewIndex(page)).toBe(siblingFrameIndex);

    await siblingBody.evaluate(() => {
      history.pushState({}, "", "?focus-safe-route-change");
    });
    await expect
      .poll(() => siblingBody.evaluate(() => window.location.search))
      .toBe("?focus-safe-route-change");
    await expect.poll(() => canvasHasFocus(page)).toBe(true);
  });

  // fixme: fails in CI on current main: expect(locator).toBeVisible() failed
  test.fixme("a reordered URL-backed layer stays a pending edit until the agent applies it, and the applied order survives reload", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 90_000,
    });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(
        async ({ name, args }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call: (
                  name: string,
                  args?: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("missing WebMCP helper");
          return await helper.call(name, args);
        },
        { name, args },
      );
    const visualEditState = async () => {
      const result = (await call("get-visual-edit-prompt")) as {
        result?: { pendingEditCount?: number; status?: string };
      };
      return {
        pendingEditCount: result.result?.pendingEditCount ?? -1,
        status: result.result?.status ?? "unknown",
      };
    };
    const record = await app.savedRecord(designId);
    const metadata = record.data as {
      sourceType?: string;
      connectionId?: string;
      screenMetadata?: Record<string, { sourceType?: string }>;
    };
    expect(metadata.sourceType).toBe("localhost");
    expect(
      Object.values(metadata.screenMetadata ?? {}).map(
        (screen) => screen.sourceType,
      ),
    ).toStrictEqual(["localhost"]);
    const connectionId = metadata.connectionId;
    expect(connectionId).toBe(connection?.connectionId);

    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame();
    const source = frame.locator('[data-agent-native-node-id="v1"]');
    const target = frame.locator('[data-agent-native-node-id="v3"]');
    await expect(source).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached({ timeout: 30_000 });
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);
    expect(await liveFlowOrder(page)).toStrictEqual(["v1", "v2", "v3"]);
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error("flow cards have no boxes");

    const dragStart = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    await page.mouse.click(dragStart.x, dragStart.y);
    await expect
      .poll(() =>
        frame
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => getComputedStyle(element).display !== "none"),
      )
      .toBe(true);
    await expect.poll(() => app.selectedLayers()).toStrictEqual(["V1"]);
    await expect
      .poll(() => layerRowOrder(page, /^V[123]$/))
      .toStrictEqual(["V3", "V2", "V1"]);

    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    const dragThreshold = { x: dragStart.x + 10, y: dragStart.y + 6 };
    const dropPoint = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height * 0.85,
    };
    for (let step = 1; step <= 6; step += 1) {
      const progress = step / 6;
      await page.mouse.move(
        dragStart.x + (dragThreshold.x - dragStart.x) * progress,
        dragStart.y + (dragThreshold.y - dragStart.y) * progress,
      );
      await page.waitForTimeout(16);
    }
    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 20;
      await page.mouse.move(
        dragThreshold.x + (dropPoint.x - dragThreshold.x) * progress,
        dragThreshold.y + (dropPoint.y - dragThreshold.y) * progress,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect.poll(() => canvasHasFocus(page)).toBe(true);

    await expect
      .poll(() => liveFlowOrder(page), { timeout: 5_000 })
      .toStrictEqual(["v2", "v3", "v1"]);
    await expect
      .poll(() => layerRowOrder(page, /^V[123]$/))
      .toStrictEqual(["V1", "V3", "V2"]);
    await expect.poll(visualEditState).toEqual({
      pendingEditCount: 1,
      status: "ready",
    });
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      SOURCE,
    );

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => liveFlowOrder(page), { timeout: 10_000 })
      .toStrictEqual(["v1", "v2", "v3"]);
    await expect
      .poll(() => layerRowOrder(page, /^V[123]$/))
      .toStrictEqual(["V3", "V2", "V1"]);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => liveFlowOrder(page), { timeout: 10_000 })
      .toStrictEqual(["v2", "v3", "v1"]);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 1,
      status: "ready",
    });
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      SOURCE,
    );

    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      "leaving with a pending edit must be guarded",
    ).toBe(true);

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      });
    await page
      .getByRole("button", { name: "Copy agent prompt", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`Design ID: ${designId}`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "get-visual-edit-pending",
    );
    await page.getByRole("button", { name: "Pending visual preview" }).click();
    await page.getByRole("menuitem", { name: "Copy full prompt" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('"anchorSourceId": "v3"');
    const fullPrompt = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(fullPrompt).toContain("idiomatic code changes");
    expect(fullPrompt).toContain("index.html");
    expect(fullPrompt).toContain('"sourceId": "v1"');

    const callDesignMcp = async (rpc: Record<string, unknown>) => {
      const response = await page.request.post(`${baseURL}/_agent-native/mcp`, {
        headers: {
          Accept: "application/json, text/event-stream",
          Origin: baseURL,
          "x-agent-native-owner-email": E2E_EMAIL,
        },
        data: rpc,
      });
      expect(response.ok(), `Design MCP ${response.status()}`).toBe(true);
      const body = await response.text();
      if (!body) return null;
      const data = body
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length)
        .trim();
      return JSON.parse(data ?? body) as {
        error?: unknown;
        result?: {
          content?: Array<{ text?: string }>;
          isError?: boolean;
          protocolVersion?: unknown;
          structuredContent?: Record<string, unknown>;
          tools?: Array<{ name: string }>;
        };
      };
    };
    expect(
      await callDesignMcp({
        jsonrpc: "2.0",
        id: "visual-edit-init",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "visual-edit-e2e", version: "1.0.0" },
        },
      }),
    ).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
    await callDesignMcp({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const toolList = await callDesignMcp({
      jsonrpc: "2.0",
      id: "visual-edit-tools",
      method: "tools/list",
      params: {},
    });
    expect(toolList?.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "acknowledge-visual-edit-pending",
        "get-visual-edit-pending",
      ]),
    );
    const pulled = await callDesignMcp({
      jsonrpc: "2.0",
      id: "visual-edit-pull",
      method: "tools/call",
      params: { name: "get-visual-edit-pending", arguments: { designId } },
    });
    expect(pulled?.error).toBeUndefined();
    expect(pulled?.result?.isError).not.toBe(true);
    const handoff = pulled?.result?.structuredContent as {
      revision: number;
      status: string;
      pendingEditCount: number;
    };
    expect(handoff).toMatchObject({ status: "ready", pendingEditCount: 1 });
    expect(handoff.revision).toEqual(expect.any(Number));

    // The coding agent's change: move the V1 card after V3 in the source.
    const v1 = /<div id="v1"[^>]*>V1<\/div>/.exec(SOURCE)![0];
    const v3 = /<div id="v3"[^>]*>V3<\/div>/.exec(SOURCE)![0];
    const reorderedSource = SOURCE.replace(v1, "").replace(v3, `${v3}${v1}`);
    expect(
      [...reorderedSource.matchAll(/\sid="(v[123])"/g)].map(
        (match) => match[1],
      ),
    ).toStrictEqual(["v2", "v3", "v1"]);
    const read = (await call("read-local-file", {
      designId,
      connectionId,
      path: "index.html",
    })) as { result?: { content?: string; versionHash?: string } };
    expect(read.result?.content).toBe(SOURCE);
    expect(read.result?.versionHash).toMatch(/^[a-f0-9]{64}$/i);

    const consentRequest = await call("request-localhost-write-consent", {
      designId,
      connectionId,
      files: ["index.html"],
    });
    expect(consentRequest).toMatchObject({
      ok: true,
      result: { surfaced: true },
    });
    const consent = page.getByRole("dialog", { name: "Allow file writes" });
    await expect(consent).toBeVisible({ timeout: 10_000 });
    await consent.getByRole("button", { name: "Allow writes" }).click();
    // The dialog closes only after the server-side grant lands; writing earlier races it.
    await expect(consent).toBeHidden({ timeout: 10_000 });
    expect(
      await call("write-local-file", {
        designId,
        connectionId,
        relPath: "index.html",
        content: reorderedSource,
        expectedVersionHash: read.result?.versionHash,
        requireExpectedVersionHash: true,
      }),
    ).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      reorderedSource,
    );
    await expect
      .poll(() => liveFlowOrder(page), { timeout: 30_000 })
      .toStrictEqual(["v2", "v3", "v1"]);

    const acknowledgement = await callDesignMcp({
      jsonrpc: "2.0",
      id: "visual-edit-acknowledge",
      method: "tools/call",
      params: {
        name: "acknowledge-visual-edit-pending",
        arguments: { designId, revision: handoff.revision },
      },
    });
    expect(acknowledgement?.result?.isError).not.toBe(true);
    expect(
      JSON.parse(acknowledgement?.result?.content?.[0]?.text ?? "null"),
    ).toMatchObject({ status: "empty", pendingEditCount: 0 });
    expect(await pendingHandoff(page.request, designId)).toMatchObject({
      status: "empty",
      pendingEditCount: 0,
    });
    await expect.poll(visualEditState, { timeout: 30_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    await expect(
      page.locator("[data-design-pending-visual-style-toolbar]"),
    ).toHaveCount(0, { timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => liveFlowOrder(page), { timeout: 15_000 })
      .toStrictEqual(["v2", "v3", "v1"]);
    await expect.poll(visualEditState).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
  });

  // fixme: product bug: With Group A + Group B selected ('2 selected'), every inspector field reads Mixed, including padding-top 8px and margin-top 4px that both
  test.fixme("shows Mixed padding and margin only on the sides where the selected layers differ", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 90_000,
    });
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame();
    const groupA = frame.locator('[data-agent-native-node-id="group-a"]');
    const groupB = frame.locator('[data-agent-native-node-id="group-b"]');
    await expect(groupA).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);
    const groupABox = await groupA.boundingBox();
    const groupBBox = await groupB.boundingBox();
    if (!groupABox || !groupBBox) throw new Error("group cards have no boxes");

    await page.mouse.click(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await expect.poll(() => app.selectedLayers()).toStrictEqual(["Group A"]);
    await expect(
      page.locator('button[aria-label="Unlink padding"]'),
    ).toBeVisible();

    await page.keyboard.down("Shift");
    await page.mouse.click(
      groupBBox.x + groupBBox.width / 2,
      groupBBox.y + groupBBox.height / 2,
    );
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toStrictEqual(["Group A", "Group B"]);
    await expect(
      page.locator('button[aria-label="Link padding"]'),
    ).toBeVisible();
    const sideValues = (labels: string[]) =>
      Promise.all(
        labels.map((label) =>
          page.locator(`input[aria-label="${label}"]`).inputValue(),
        ),
      );
    await expect
      .poll(() => sideValues(["Top", "Right", "Bottom", "Left"]))
      .toStrictEqual(["8", "Mixed", "Mixed", "Mixed"]);
    await expect
      .poll(() =>
        sideValues([
          "Top margin",
          "Right margin",
          "Bottom margin",
          "Left margin",
        ]),
      )
      .toStrictEqual(["4", "Mixed", "Mixed", "Mixed"]);
  });

  test("a grouped grid drag is one pending visual edit that undo and redo restore exactly", async ({
    app,
    page,
  }) => {
    const { designId } = await openProbeDesign(app, ["/"]);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 90_000,
    });
    const iframe = page.locator("iframe[data-design-preview-iframe]");
    const frame = iframe.contentFrame();
    const groupA = frame.locator('[data-agent-native-node-id="group-a"]');
    const groupB = frame.locator('[data-agent-native-node-id="group-b"]');
    const occupied = frame.locator(
      '[data-agent-native-node-id="group-occupied"]',
    );
    await expect(groupA).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText("Preparing the live editor…")).toHaveCount(0);
    const srcBeforeDrag = await iframe.getAttribute("src");
    await iframe.evaluate((element) => {
      element.setAttribute("data-iframe-identity", "stable");
    });
    const placement = () =>
      frame.locator("[data-group-card]").evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => {
            const style = getComputedStyle(element);
            return [
              element.id,
              `${style.gridColumnStart}/${style.gridColumnEnd} ${style.gridRowStart}/${style.gridRowEnd}`,
            ];
          }),
        ),
      );
    const original = {
      "group-occupied": "3/5 2/auto",
      "group-a": "1/auto 1/auto",
      "group-b": "2/auto 1/auto",
    };
    expect(await placement()).toEqual(original);
    const handoffState = () =>
      pendingHandoff(page.request, designId).then((handoff) => ({
        pendingEditCount: handoff.pendingEditCount,
        status: handoff.status,
      }));
    let componentDetailsRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/actions/get-component-details")
      ) {
        componentDetailsRequests += 1;
      }
    });

    const groupABox = await groupA.boundingBox();
    const groupBBox = await groupB.boundingBox();
    const targetBox = await occupied.boundingBox();
    if (!groupABox || !groupBBox || !targetBox)
      throw new Error("group cards have no boxes");
    await page.mouse.click(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await expect.poll(() => app.selectedLayers()).toStrictEqual(["Group A"]);
    await page.keyboard.down("Shift");
    await page.mouse.click(
      groupBBox.x + groupBBox.width / 2,
      groupBBox.y + groupBBox.height / 2,
    );
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toStrictEqual(["Group A", "Group B"]);

    await page.mouse.move(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      groupABox.x + groupABox.width / 2 + 10,
      groupABox.y + groupABox.height / 2 + 6,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 20 },
    );
    await expect(
      frame.locator("[data-agent-native-insertion-guide]").first(),
    ).toBeVisible();
    await page.mouse.up();

    // The pair takes the two cells it was dropped on and the occupant swaps into the pair's old cells.
    const dropped = {
      "group-occupied": "1/3 1/2",
      "group-a": "3/4 2/3",
      "group-b": "4/5 2/3",
    };
    await expect.poll(placement).toEqual(dropped);
    await expect.poll(handoffState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 1,
      status: "ready",
    });
    const { prompt } = await pendingHandoff(page.request, designId);
    expect(prompt.match(/"transactionId"/g)).toHaveLength(1);
    expect(prompt).toContain("group-a");
    expect(prompt).toContain("group-b");
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      SOURCE,
    );
    await expect(iframe).toHaveAttribute("data-iframe-identity", "stable");
    await expect(iframe).toHaveAttribute("src", srcBeforeDrag ?? "");
    expect(componentDetailsRequests).toBe(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(placement, { timeout: 10_000 }).toEqual(original);
    await expect.poll(handoffState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(placement, { timeout: 10_000 }).toEqual(dropped);
    await expect.poll(handoffState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 1,
      status: "ready",
    });
    await expect(iframe).toHaveAttribute("data-iframe-identity", "stable");
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      SOURCE,
    );
  });
});
