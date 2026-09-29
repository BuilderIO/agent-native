import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

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

test.describe("URL-backed live auto-layout probe", () => {
  let rootPath = "";
  let devServer: Server | null = null;
  let bridge: DesignConnectBridge | null = null;
  let targetUrl = "";
  let baseURL = "";
  let designId = "";
  let focusDesignId = "";

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

  test.beforeAll(async ({ request }, workerInfo) => {
    baseURL = workerInfo.project.use.baseURL as string;
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "url-autolayout-local-"));
    const source = `<!doctype html><html><head><style>
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
      <div id="group-grid" data-source-id="group-grid" data-agent-native-node-id="group-grid" data-source-file="index.html" data-source-line="1" data-source-column="5"><div id="group-occupied" data-source-id="group-occupied" data-agent-native-node-id="group-occupied" data-agent-native-layer-name="Occupied" data-source-file="index.html" data-source-line="1" data-source-column="8" data-group-card style="grid-column:3 / 5;grid-row:2">Occupied</div><div id="group-a" data-source-id="group-a" data-agent-native-node-id="group-a" data-agent-native-layer-name="Group A" data-source-file="index.html" data-source-line="1" data-source-column="6" data-group-card style="grid-column:1;grid-row:1">A</div><div id="group-b" data-source-id="group-b" data-agent-native-node-id="group-b" data-agent-native-layer-name="Group B" data-source-file="index.html" data-source-line="1" data-source-column="7" data-group-card style="grid-column:2;grid-row:1">B</div></div>
      <button type="button">Keep focus in app</button>
      <script>window.__runStartupFocus = () => { const input = document.querySelector("#startup-search"); window.parent.postMessage({ type: "fixture-autofocus-started" }, "*"); requestAnimationFrame(() => { input?.focus({ preventScroll: true }); const focused = document.activeElement === input; document.body.dataset.autofocusReady = "true"; window.parent.postMessage({ type: "fixture-autofocus-complete", focused }, "*"); }); }; setTimeout(() => window.__runStartupFocus?.(), location.pathname === "/settings" ? 8500 : 250);</script>
    </main></body></html>`;
    fs.writeFileSync(path.join(rootPath, "index.html"), source);
    devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(rootPath, "index.html"), "utf8"));
    });
    const devPort = await listen(devServer);
    targetUrl = `http://127.0.0.1:${devPort}`; // e2e-harness-ignore - the probe owns an ephemeral loopback app server.
    const portProbe = http.createServer();
    const bridgePort = await listen(portProbe);
    await closeServer(portProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    const opened = await postAction(request, "open-visual-edit", {
      title: "URL auto-layout local probe",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: false,
    });
    designId = opened.designId;
    const focusDesign = await postAction(request, "open-visual-edit", {
      title: "URL multi-screen autofocus probe",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      connectionId: opened.connectionId,
      bridgeToken: opened.bridgeToken,
      rootPath,
      routeManifest: manifest,
      paths: ["/", "/settings"],
      navigate: false,
      publicReadOnly: false,
    });
    focusDesignId = focusDesign.designId;
    if (
      focusDesign.connectionId !== opened.connectionId ||
      focusDesign.bridgeToken !== opened.bridgeToken
    ) {
      throw new Error("multi-screen focus probe did not reuse its bridge");
    }
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
  });

  test.afterAll(async ({ request }) => {
    if (designId)
      await postAction(request, "delete-design", { id: designId }).catch(
        () => undefined,
      );
    if (focusDesignId)
      await postAction(request, "delete-design", { id: focusDesignId }).catch(
        () => undefined,
      );
    await closeServer(bridge?.server ?? null);
    await closeServer(devServer);
    if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("reclaims canvas focus after delayed autofocus so space-pan works", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      type FocusReport = {
        type: string;
        sourceIndex: number;
        focusSafe?: boolean;
      };
      const reports: FocusReport[] = [];
      Object.defineProperty(window, "__canvasFocusReports", {
        value: reports,
        configurable: false,
      });
      const keys: Array<{ code: string; target: string }> = [];
      Object.defineProperty(window, "__canvasKeyReports", {
        value: keys,
        configurable: false,
      });
      const focusEvents: Array<{ type: string; active: string }> = [];
      Object.defineProperty(window, "__canvasWindowFocusEvents", {
        value: focusEvents,
        configurable: false,
      });
      const recordFocus = (type: string) => {
        const active = document.activeElement;
        focusEvents.push({
          type,
          active:
            active instanceof HTMLElement
              ? `${active.tagName}#${active.id}`
              : (active?.nodeName ?? "none"),
        });
      };
      window.addEventListener("blur", () => recordFocus("blur"));
      document.addEventListener("focusin", () => recordFocus("focusin"));
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.code === "Space") {
            const target = event.target;
            keys.push({
              code: event.code,
              target:
                target instanceof HTMLElement
                  ? `${target.tagName}#${target.id}`
                  : target instanceof Node
                    ? target.nodeName
                    : "none",
            });
          }
        },
        false,
      );
      window.addEventListener("message", (event) => {
        const data = event.data as {
          type?: unknown;
          focusSafe?: unknown;
          focused?: unknown;
        } | null;
        if (
          typeof data?.type !== "string" ||
          (data.type !== "agent-native:canvas-focus-state" &&
            data.type !== "agent-native:editor-chrome-ready" &&
            data.type !== "agent-native:canvas-tab-navigation" &&
            data.type !== "fixture-autofocus-started" &&
            data.type !== "fixture-autofocus-complete")
        ) {
          return;
        }
        const sourceIndex = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        ).findIndex((iframe) => iframe.contentWindow === event.source);
        reports.push({
          type: data.type,
          sourceIndex,
          ...(typeof data.focusSafe === "boolean"
            ? { focusSafe: data.focusSafe }
            : {}),
          ...(typeof data.focused === "boolean"
            ? { focused: data.focused }
            : {}),
        });
      });
    });
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await localNetworkCdp.detach();
    await page.goto(
      `${baseURL}/visual-edit/${focusDesignId}?editorView=overview&embedChrome=1`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    await expect(liveFrames).toHaveCount(2);
    const iframe = liveFrames.first();
    const frame = iframe.contentFrame();
    const settingsFrame = liveFrames.nth(1).contentFrame();
    const settingsBody = settingsFrame.locator("body");
    await expect(
      frame.locator('[data-agent-native-node-id="flow-root"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      frame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached({ timeout: 15_000 });
    await expect(settingsFrame.locator("#startup-search")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      settingsFrame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached({ timeout: 15_000 });
    const emptyPoint = await page.evaluate(() => {
      const surface = document
        .querySelector("[data-multi-screen-canvas-surface]")
        ?.getBoundingClientRect();
      const frames = Array.from(
        document.querySelectorAll<HTMLElement>("[data-screen-shell]"),
      ).map((element) => element.getBoundingClientRect());
      const previewFrames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ),
      ).map((element) => element.getBoundingClientRect());
      if (!surface) return null;
      for (let y = surface.bottom - 24; y > surface.top + 24; y -= 24) {
        for (let x = surface.right - 24; x > surface.left + 24; x -= 24) {
          const outside = (frame: DOMRect) =>
            x < frame.left ||
            x > frame.right ||
            y < frame.top ||
            y > frame.bottom;
          if (frames.every(outside) && previewFrames.every(outside)) {
            const target = document.elementFromPoint(x, y);
            if (
              target?.closest("[data-multi-screen-canvas-surface]") &&
              !target.closest("iframe[data-design-preview-iframe]")
            ) {
              return { x, y };
            }
          }
        }
      }
      return null;
    });
    if (!emptyPoint) throw new Error("no empty point on the canvas surface");
    const expectCanvasFocus = (timeout = 15_000) =>
      expect
        .poll(
          () =>
            page.evaluate(() => {
              const active = document.activeElement;
              const canvas = document.querySelector(
                "[data-multi-screen-canvas-surface]",
              );
              return (
                active instanceof HTMLElement &&
                canvas?.contains(active) &&
                active.tagName !== "IFRAME" &&
                active.tabIndex === -1
              );
            }),
          { timeout },
        )
        .toBe(true);
    await expectCanvasFocus();
    await expect(settingsBody).toHaveAttribute("data-autofocus-ready", "true");
    const autofocusResultIndex = () =>
      page.evaluate(() => {
        const reports = (
          window as Window & {
            __canvasFocusReports?: Array<{
              type: string;
              sourceIndex: number;
              focused?: boolean;
            }>;
          }
        ).__canvasFocusReports;
        return (
          reports?.findIndex(
            (report) =>
              report.type === "fixture-autofocus-complete" &&
              report.sourceIndex === 1 &&
              report.focused === true,
          ) ?? -1
        );
      });
    const latestSettingsFocusSafety = () =>
      page.evaluate(() => {
        const reports = (
          window as Window & {
            __canvasFocusReports?: Array<{
              type: string;
              sourceIndex: number;
              focusSafe?: boolean;
            }>;
          }
        ).__canvasFocusReports?.filter(
          (report) =>
            report.type === "agent-native:canvas-focus-state" &&
            report.sourceIndex === 1,
        );
        return reports?.[reports.length - 1]?.focusSafe ?? null;
      });
    await expect.poll(autofocusResultIndex).toBeGreaterThanOrEqual(0);
    const getAutofocusMarkerIndex = () =>
      page.evaluate(() => {
        const reports = (
          window as Window & {
            __canvasFocusReports?: Array<{
              type: string;
              sourceIndex: number;
              focusSafe?: boolean;
            }>;
          }
        ).__canvasFocusReports;
        return (
          reports?.findIndex(
            (report) =>
              report.type === "fixture-autofocus-started" &&
              report.sourceIndex === 1,
          ) ?? -1
        );
      });
    await expect.poll(getAutofocusMarkerIndex).toBeGreaterThanOrEqual(0);
    const autofocusMarkerIndex = await getAutofocusMarkerIndex();
    expect(autofocusMarkerIndex).toBeGreaterThanOrEqual(0);
    await expect
      .poll(() =>
        page.evaluate((markerIndex) => {
          const reports = (
            window as Window & {
              __canvasFocusReports?: Array<{
                type: string;
                sourceIndex: number;
                focusSafe?: boolean;
              }>;
            }
          ).__canvasFocusReports;
          return reports
            ?.slice(markerIndex + 1)
            .some(
              (report) =>
                report.type === "agent-native:canvas-focus-state" &&
                report.sourceIndex === 1 &&
                report.focusSafe === true,
            );
        }, autofocusMarkerIndex),
      )
      .toBe(true);
    await expectCanvasFocus();
    await expect.poll(latestSettingsFocusSafety).toBe(true);
    await page.mouse.move(emptyPoint.x, emptyPoint.y);
    const panFrame = page.locator("[data-screen-shell]").first();
    const canvasSurface = page.locator("[data-multi-screen-canvas-surface]");
    const beforePan = await panFrame.boundingBox();
    if (!beforePan) throw new Error("overview frame has no bounding box");
    await page.keyboard.down("Space");
    const panDebug = await page.evaluate(() => ({
      cursor: getComputedStyle(
        document.querySelector("[data-multi-screen-canvas-surface]")!,
      ).cursor,
      active:
        document.activeElement instanceof HTMLElement
          ? `${document.activeElement.tagName}#${document.activeElement.id}`
          : (document.activeElement?.nodeName ?? "none"),
      keys: (
        window as Window & {
          __canvasKeyReports?: Array<{ code: string; target: string }>;
        }
      ).__canvasKeyReports,
      reports: (
        window as Window & {
          __canvasFocusReports?: Array<{
            sourceIndex: number;
            focusSafe: boolean;
          }>;
        }
      ).__canvasFocusReports?.slice(-12),
      blurEvents: (
        window as Window & {
          __canvasWindowFocusEvents?: Array<{
            type: string;
            active: string;
          }>;
        }
      ).__canvasWindowFocusEvents,
    }));
    await expect(canvasSurface, JSON.stringify(panDebug)).toHaveCSS(
      "cursor",
      "grab",
    );
    await page.mouse.down();
    await expect(canvasSurface).toHaveCSS("cursor", "grabbing");
    await page.mouse.move(emptyPoint.x + 72, emptyPoint.y + 48, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await expect
      .poll(async () => {
        const after = await panFrame.boundingBox();
        return after
          ? Math.abs(after.x - beforePan.x) + Math.abs(after.y - beforePan.y)
          : 0;
      })
      .toBeGreaterThan(30);

    const focusFrame = liveFrames.nth(1).contentFrame();
    const readOrder = () =>
      focusFrame
        .locator(
          '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
        )
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-agent-native-node-id"),
          ),
        );
    const source = focusFrame.locator('[data-agent-native-node-id="v1"]');
    const target = focusFrame.locator('[data-agent-native-node-id="v3"]');
    const sourceBounds = await source.boundingBox();
    const targetBounds = await target.boundingBox();
    if (!sourceBounds || !targetBounds) {
      throw new Error("live focus probe drag targets have no bounds");
    }
    const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      sourceBounds.x + sourceBounds.width / 2,
      sourceBounds.y + sourceBounds.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await expect
      .poll(() =>
        focusFrame
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => getComputedStyle(element).display !== "none"),
      )
      .toBe(true);
    await page.mouse.move(
      sourceBounds.x + sourceBounds.width / 2,
      sourceBounds.y + sourceBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBounds.x + sourceBounds.width / 2 + 10,
      sourceBounds.y + sourceBounds.height / 2 + 6,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height * 0.85,
      { steps: 20 },
    );
    await page.mouse.up();
    await expect
      .poll(readOrder, { timeout: 5_000 })
      .toEqual(["v2", "v3", "v1"]);
    await expectCanvasFocus();
    const settingsFocusReportCount = () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __canvasFocusReports?: Array<{
                type: string;
                sourceIndex: number;
              }>;
            }
          ).__canvasFocusReports?.filter(
            (report) =>
              report.type === "agent-native:canvas-focus-state" &&
              report.sourceIndex === 1,
          ).length ?? 0,
      );
    const previousSettingsFocusReportCount = await settingsFocusReportCount();
    await settingsFrame.locator("body").evaluate((body) => {
      const testWindow = window as Window & {
        __runStartupFocus?: () => void;
      };
      testWindow.__runStartupFocus?.();
    });
    await expect
      .poll(settingsFocusReportCount)
      .toBeGreaterThan(previousSettingsFocusReportCount);
    await expect.poll(latestSettingsFocusSafety).toBe(true);
    await expectCanvasFocus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(readOrder, { timeout: 5_000 })
      .toEqual(["v1", "v2", "v3"]);
  });

  test("keeps a user-focused live input in Interact mode", async ({ page }) => {
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await localNetworkCdp.detach();
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    const shell = page.locator("[data-screen-shell]").first();
    const interact = shell.locator("[data-frame-full-view]");
    await expect(interact).toBeVisible({ timeout: 90_000 });
    await interact.click();
    await expect(shell).toHaveAttribute("data-screen-interact-mode", "true");

    const frame = page.locator("iframe[data-design-preview-iframe]").first();
    const liveDocument = frame.contentFrame();
    const shield = liveDocument.locator(
      '[data-agent-native-edit-overlay="shield"]',
    );
    await expect(shield).toHaveCSS("pointer-events", "none", {
      timeout: 5_000,
    });
    const input = liveDocument.locator("#startup-search");
    await expect(input).toBeVisible({ timeout: 30_000 });
    const bounds = await input.boundingBox();
    if (!bounds) throw new Error("Interact input has no bounding box");
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement ===
            document.querySelector("iframe[data-design-preview-iframe]"),
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
    page,
  }) => {
    await page.addInitScript(() => {
      type FocusReport = {
        type: string;
        sourceIndex: number;
        focusSafe?: boolean;
      };
      const reports: FocusReport[] = [];
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
        const sourceIndex = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        ).findIndex((iframe) => iframe.contentWindow === event.source);
        reports.push({
          type: data.type,
          sourceIndex,
          ...(typeof data.focusSafe === "boolean"
            ? { focusSafe: data.focusSafe }
            : {}),
        });
      });
    });
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await localNetworkCdp.detach();
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    const firstInput = liveFrames
      .first()
      .contentFrame()
      .locator("#startup-search");
    await expect(firstInput).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          const canvas = document.querySelector(
            "[data-multi-screen-canvas-surface]",
          );
          return (
            active instanceof HTMLElement &&
            Boolean(canvas?.contains(active)) &&
            active.tagName !== "IFRAME" &&
            active.tabIndex === -1
          );
        }),
      )
      .toBe(true);

    let tabbedFrameIndex = -1;
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("Tab");
      tabbedFrameIndex = await liveFrames.evaluateAll((frames) =>
        frames.indexOf(document.activeElement as HTMLIFrameElement),
      );
      if (tabbedFrameIndex >= 0) break;
    }
    expect(
      tabbedFrameIndex,
      "Tab should move focus into the live preview",
    ).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(200);
    const tabFocusState = await page.evaluate(() => {
      const frames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ),
      );
      const active = document.activeElement;
      return {
        active:
          active instanceof HTMLElement
            ? `${active.tagName}#${active.id}`
            : (active?.nodeName ?? "none"),
        activeFrameIndex:
          active instanceof HTMLIFrameElement ? frames.indexOf(active) : -1,
        reports: (
          window as Window & {
            __canvasFocusReports?: Array<{
              type: string;
              sourceIndex: number;
              focusSafe?: boolean;
            }>;
          }
        ).__canvasFocusReports?.slice(-12),
      };
    });
    expect(
      tabFocusState.activeFrameIndex,
      `the live preview should retain focus after Tab enters it: ${JSON.stringify(tabFocusState)}`,
    ).toBe(tabbedFrameIndex);
    const frame = liveFrames.nth(tabbedFrameIndex).contentFrame();
    const input = frame.locator("#startup-search");
    await expect(input).toBeFocused();
    await page.waitForTimeout(200);
    await expect(input).toBeFocused();
    await page.keyboard.type("tab-focused");
    await expect(input).toHaveValue("tab-focused");
    await expect(input).toBeFocused();
    const latestFocusSafety = () =>
      page.evaluate((sourceIndex) => {
        const reports = (
          window as Window & {
            __canvasFocusReports?: Array<{
              sourceIndex: number;
              focusSafe: boolean;
            }>;
          }
        ).__canvasFocusReports;
        const matchingReports = reports?.filter(
          (report) => report.sourceIndex === sourceIndex,
        );
        return matchingReports?.[matchingReports.length - 1]?.focusSafe;
      }, tabbedFrameIndex);
    const requestFocusSafety = () =>
      liveFrames.evaluateAll((frames, sourceIndex) => {
        const frame = frames[sourceIndex] as HTMLIFrameElement | undefined;
        frame?.contentWindow?.postMessage(
          { type: "agent-native:canvas-focus-state-probe" },
          "*",
        );
      }, tabbedFrameIndex);
    await requestFocusSafety();
    await expect.poll(latestFocusSafety).toBe(false);
    const settingsInput = frame.locator("#settings-search");
    await page.keyboard.press("Tab");
    await expect(settingsInput).toBeFocused();
    await requestFocusSafety();
    await expect.poll(latestFocusSafety).toBe(false);

    const expectCanvasFocus = () =>
      expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            const canvas = document.querySelector(
              "[data-multi-screen-canvas-surface]",
            );
            return (
              active instanceof HTMLElement &&
              active.tagName !== "IFRAME" &&
              active.tabIndex === -1 &&
              Boolean(canvas?.contains(active))
            );
          }),
        )
        .toBe(true);
    const iframeSrcBeforeRouteChange = await liveFrames
      .nth(tabbedFrameIndex)
      .getAttribute("src");
    const frameBody = frame.locator("body");
    await frameBody.evaluate(() => {
      history.pushState({}, "", "?focus-route-change");
    });
    await expect
      .poll(() => frameBody.evaluate(() => window.location.search))
      .toBe("?focus-route-change");
    await expect(liveFrames.nth(tabbedFrameIndex)).toHaveAttribute(
      "src",
      iframeSrcBeforeRouteChange ?? "",
    );
    await expect(settingsInput).toBeFocused();

    await frame.locator("body").evaluate(() => window.location.reload());
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expectCanvasFocus();

    let focusedFrameIndex = -1;
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("Tab");
      focusedFrameIndex = await liveFrames.evaluateAll((frames) =>
        frames.indexOf(document.activeElement as HTMLIFrameElement),
      );
      if (focusedFrameIndex >= 0) break;
    }
    expect(
      focusedFrameIndex,
      "Tab should enter the live preview",
    ).toBeGreaterThanOrEqual(0);
    const focusedFrameBounds = await liveFrames
      .nth(focusedFrameIndex)
      .boundingBox();
    if (!focusedFrameBounds) throw new Error("focused preview has no bounds");
    await page.mouse.move(
      focusedFrameBounds.x + focusedFrameBounds.width / 2,
      focusedFrameBounds.y + focusedFrameBounds.height / 2,
    );
    await expectCanvasFocus();
  });

  test("keeps Tab focus when a sibling preview reports safe", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const reports: Array<{
        type: string;
        sourceIndex: number;
        focusSafe?: boolean;
      }> = [];
      Object.defineProperty(window, "__canvasFocusReports", {
        value: reports,
      });
      window.addEventListener("message", (event) => {
        const data = event.data as {
          type?: unknown;
          focusSafe?: unknown;
        } | null;
        if (
          typeof data?.type === "string" &&
          (data.type === "agent-native:canvas-tab-navigation" ||
            data.type === "agent-native:canvas-focus-state" ||
            data.type === "agent-native:editor-chrome-ready")
        ) {
          const sourceIndex = Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            ),
          ).findIndex((iframe) => iframe.contentWindow === event.source);
          reports.push({
            type: data.type,
            sourceIndex,
            ...(typeof data.focusSafe === "boolean"
              ? { focusSafe: data.focusSafe }
              : {}),
          });
        }
      });
    });
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await localNetworkCdp.detach();
    await page.goto(
      `${baseURL}/visual-edit/${focusDesignId}?editorView=overview&embedChrome=1`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    await expect(liveFrames).toHaveCount(2);
    for (const liveFrame of await liveFrames.all()) {
      await expect(liveFrame.contentFrame().locator("body")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        liveFrame.contentFrame().locator("#startup-search"),
      ).toBeVisible({ timeout: 30_000 });
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          const canvasFocused =
            active instanceof HTMLElement &&
            Boolean(
              document
                .querySelector("[data-multi-screen-canvas-surface]")
                ?.contains(active),
            ) &&
            active.tagName !== "IFRAME" &&
            active.tabIndex === -1;
          const frames = Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            ),
          );
          const reports = (
            window as Window & {
              __canvasFocusReports?: Array<{
                type: string;
                sourceIndex: number;
                focusSafe?: boolean;
              }>;
            }
          ).__canvasFocusReports;
          return canvasFocused
            ? "canvas"
            : JSON.stringify({
                active:
                  active instanceof HTMLElement
                    ? `${active.tagName}#${active.id}`
                    : active?.nodeName,
                activeFrameIndex:
                  active instanceof HTMLIFrameElement
                    ? frames.indexOf(active)
                    : -1,
                focusReports: reports?.slice(-8),
              });
        }),
      )
      .toBe("canvas");

    let firstFrameIndex = -1;
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("Tab");
      firstFrameIndex = await liveFrames.evaluateAll((frames) =>
        frames.indexOf(document.activeElement as HTMLIFrameElement),
      );
      if (firstFrameIndex >= 0) break;
    }
    expect(
      firstFrameIndex,
      "Tab should enter a live preview",
    ).toBeGreaterThanOrEqual(0);

    const siblingFrameIndex = 1 - firstFrameIndex;
    const previousReportCount = await page.evaluate(
      () =>
        (
          window as Window & {
            __canvasFocusReports?: Array<unknown>;
          }
        ).__canvasFocusReports?.length ?? 0,
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
          ({ previousReportCount, siblingFrameIndex }) => {
            const reports = (
              window as Window & {
                __canvasFocusReports?: Array<{
                  type: string;
                  sourceIndex: number;
                  focusSafe?: boolean;
                }>;
              }
            ).__canvasFocusReports;
            return Boolean(
              reports
                ?.slice(previousReportCount)
                .some(
                  (report) =>
                    report.type === "agent-native:canvas-focus-state" &&
                    report.sourceIndex === siblingFrameIndex &&
                    report.focusSafe === true,
                ),
            );
          },
          { previousReportCount, siblingFrameIndex },
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        liveFrames.evaluateAll((frames) =>
          frames.indexOf(document.activeElement as HTMLIFrameElement),
        ),
      )
      .toBe(firstFrameIndex);

    const firstInput = liveFrames
      .nth(firstFrameIndex)
      .contentFrame()
      .locator("#startup-search");
    const firstSettingsInput = liveFrames
      .nth(firstFrameIndex)
      .contentFrame()
      .locator("#settings-search");
    const firstButton = liveFrames
      .nth(firstFrameIndex)
      .contentFrame()
      .getByRole("button", { name: "Keep focus in app" });
    await firstInput.focus();
    await page.keyboard.press("Tab");
    await expect(firstSettingsInput).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstButton).toBeFocused();
    let tabbedToSibling = false;
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("Tab");
      const activeFrameIndex = await liveFrames.evaluateAll((frames) =>
        frames.indexOf(document.activeElement as HTMLIFrameElement),
      );
      if (activeFrameIndex === siblingFrameIndex) {
        tabbedToSibling = true;
        break;
      }
    }
    expect(
      tabbedToSibling,
      "Tab should move from one live preview into its sibling preview",
    ).toBe(true);
    await liveFrames
      .nth(siblingFrameIndex)
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        window.parent.postMessage(
          { type: "agent-native:canvas-focus-state-probe" },
          "*",
        );
      });
    await expect
      .poll(() =>
        liveFrames.evaluateAll((frames) =>
          frames.indexOf(document.activeElement as HTMLIFrameElement),
        ),
      )
      .toBe(siblingFrameIndex);

    const siblingBody = liveFrames
      .nth(siblingFrameIndex)
      .contentFrame()
      .locator("body");
    await siblingBody.evaluate(() => {
      history.pushState({}, "", "?focus-safe-route-change");
    });
    await expect
      .poll(() => siblingBody.evaluate(() => window.location.search))
      .toBe("?focus-safe-route-change");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          const canvas = document.querySelector(
            "[data-multi-screen-canvas-surface]",
          );
          return (
            active instanceof HTMLElement &&
            active.tabIndex === -1 &&
            active.tagName !== "IFRAME" &&
            Boolean(canvas?.contains(active))
          );
        }),
      )
      .toBe(true);
  });

  test("opens signed-out capability and inspects URL-backed frames", async ({
    page,
  }) => {
    page.on("console", (message) => {
      if (
        message.text().includes("dnd:") ||
        message.text().includes("URL probe chat")
      ) {
        console.log("URL probe console", message.text());
      }
    });
    page.on("pageerror", (error) =>
      console.log("URL probe page error", error.message),
    );
    page.on("requestfailed", (request) =>
      console.log(
        "URL probe request failed",
        request.url(),
        request.failure()?.errorText,
      ),
    );
    page.on("request", (request) => {
      if (
        /\/actions\/(read-local-file|write-local-file|request-localhost-write-consent)/.test(
          request.url(),
        )
      ) {
        console.log(
          "URL probe action request",
          request.method(),
          request.url(),
        );
      }
    });
    page.on("response", (response) => {
      if (
        /\/actions\/(read-local-file|write-local-file|request-localhost-write-consent)/.test(
          response.url(),
        )
      ) {
        console.log(
          "URL probe action response",
          response.status(),
          response.url(),
        );
      }
    });
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await expect(page.locator("[data-design-editor]")).toBeVisible({
        timeout: 90_000,
      });
    } catch (error) {
      console.log(
        "URL probe editor timeout",
        JSON.stringify({
          url: page.url(),
          title: await page.title(),
          body: (await page.locator("body").innerText()).slice(0, 1000),
        }),
      );
      throw error;
    }
    await page.evaluate(() => {
      window.__DND_DEBUG = true;
      (
        window as typeof window & { __urlProbeMessages?: unknown[] }
      ).__urlProbeMessages = [];
      window.addEventListener("message", (event) => {
        const type = event.data?.type;
        if (typeof type === "string" && type.includes("structure")) {
          (
            window as typeof window & { __urlProbeMessages?: unknown[] }
          ).__urlProbeMessages?.push({ type, data: event.data });
        }
      });
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
    console.log(
      "URL probe webmcp",
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __agentNativeWebMcpStatus?: unknown;
            }
          ).__agentNativeWebMcpStatus,
      ),
    );
    console.log(
      "URL probe frames",
      await page.locator("iframe[data-design-preview-iframe]").count(),
    );
    console.log(
      "URL probe iframe urls",
      await page
        .locator("iframe[data-design-preview-iframe]")
        .evaluateAll((frames) =>
          frames.map((frame) => frame.getAttribute("src")),
        ),
    );
    console.log(
      "URL probe tools",
      JSON.stringify(
        await page.evaluate(async () => {
          const tools = await (
            window as typeof window & {
              __agentNativeWebMcp?: {
                tools: () => Promise<Array<{ name?: string }> | undefined>;
              };
            }
          ).__agentNativeWebMcp?.tools();
          return tools?.filter((tool: { name?: string }) =>
            [
              "get-visual-edit-prompt",
              "read-local-file",
              "request-localhost-write-consent",
              "write-local-file",
            ].includes(tool.name ?? ""),
          );
        }),
      ),
    );
    console.log(
      "URL probe prompt",
      JSON.stringify(await call("get-visual-edit-prompt")),
    );
    const initialFrame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    console.log(
      "URL probe ids",
      await initialFrame.locator("[data-source-id]").evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute("data-source-id"),
          text: el.textContent,
          rect: el.getBoundingClientRect().toJSON(),
        })),
      ),
    );
    const designDump = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
      .then((response) => response.json());
    const sourceMetadata = JSON.parse(designDump.data) as {
      sourceType?: string;
      connectionId?: string;
      screenMetadata?: Record<string, { sourceType?: string }>;
    };
    expect(sourceMetadata.sourceType).toBe("localhost");
    const screenId = Object.keys(sourceMetadata.screenMetadata ?? {})[0];
    expect(screenId).toBeTruthy();
    expect(sourceMetadata.screenMetadata?.[screenId!]?.sourceType).toBe(
      "localhost",
    );
    const connectionId = sourceMetadata.connectionId;
    expect(connectionId).toBeTruthy();
    console.log(
      "URL probe source metadata",
      JSON.stringify({
        data: designDump.data,
        files: (designDump.files ?? []).map(
          (file: { id?: string; filename?: string; content?: string }) => ({
            id: file.id,
            filename: file.filename,
            content: file.content?.slice(0, 120),
          }),
        ),
      }),
    );

    const order = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .contentFrame()
        .locator(
          '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
        )
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-agent-native-node-id")),
        );
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const source = frame.locator('[data-agent-native-node-id="v1"]');
    const target = frame.locator('[data-agent-native-node-id="v3"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox)
      throw new Error("URL probe drag boxes missing");
    const diskBeforeDrag = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
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
    const pendingEditCount = async () =>
      (await visualEditState()).pendingEditCount;
    const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await expect
      .poll(() =>
        frame
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => getComputedStyle(element).display !== "none"),
      )
      .toBe(true);
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2 + 6,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height * 0.85,
      { steps: 20 },
    );
    await expect
      .poll(() =>
        frame
          .locator("[data-agent-native-insertion-guide]")
          .evaluateAll((guides) =>
            guides.some((guide) => {
              const rect = guide.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                getComputedStyle(guide).display !== "none"
              );
            }),
          ),
      )
      .toBe(true);
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          const canvas = document.querySelector(
            "[data-multi-screen-canvas-surface]",
          );
          return (
            active instanceof HTMLElement &&
            active.tagName !== "IFRAME" &&
            active.tabIndex === -1 &&
            Boolean(canvas?.contains(active))
          );
        }),
      )
      .toBe(true);
    console.log(
      "URL probe structure messages",
      JSON.stringify(
        await page.evaluate(
          () =>
            (window as typeof window & { __urlProbeMessages?: unknown[] })
              .__urlProbeMessages,
        ),
      ),
    );
    await expect.poll(order, { timeout: 5_000 }).toEqual(["v2", "v3", "v1"]);
    console.log("URL probe order after drag", await order());
    await expect.poll(pendingEditCount, { timeout: 5_000 }).toBeGreaterThan(0);
    const promptAfterDrag = await call("get-visual-edit-prompt");
    expect(promptAfterDrag).toMatchObject({ result: { status: "ready" } });
    expect(await pendingEditCount()).toBeGreaterThan(0);
    console.log("URL probe prompt after drag", JSON.stringify(promptAfterDrag));
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );
    console.log("URL probe source on disk changed", false);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(order, { timeout: 10_000 }).toEqual(["v1", "v2", "v3"]);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(order, { timeout: 10_000 }).toEqual(["v2", "v3", "v1"]);
    await expect
      .poll(visualEditState, { timeout: 10_000 })
      .toMatchObject({ status: "ready" });
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBeGreaterThan(0);

    const unloadGuarded = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(unloadGuarded).toBe(true);
    console.log("URL probe pending unload guard", unloadGuarded);

    const applyUpdates = page.getByRole("button", {
      name: "Apply design updates",
      exact: true,
    });
    await expect(applyUpdates).toBeVisible({ timeout: 10_000 });
    console.log(
      "URL probe chat frame state",
      await page.evaluate(() => ({
        parentIsSelf: window.parent === window,
        frameElement: Boolean(window.frameElement),
        search: window.location.search,
      })),
    );
    await page.evaluate(() => {
      const state = window as typeof window & {
        __urlProbeHandoff?: {
          submitMessageId: string;
          tabId?: string;
          message?: string;
          context?: string;
        };
      };
      window.addEventListener("message", (event) => {
        const payload = event.data;
        if (payload?.type) {
          console.log("URL probe chat message", payload.type);
        }
        const submitMessageId = payload?.data?.submitMessageId;
        if (
          payload?.type !== "agentNative.submitChat" ||
          typeof submitMessageId !== "string"
        ) {
          return;
        }
        state.__urlProbeHandoff = {
          submitMessageId,
          tabId:
            typeof payload.data.tabId === "string"
              ? payload.data.tabId
              : undefined,
          message:
            typeof payload.data.message === "string"
              ? payload.data.message
              : undefined,
          context:
            typeof payload.data.context === "string"
              ? payload.data.context
              : undefined,
        };
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitResult", {
            detail: { submitMessageId, delivered: true },
          }),
        );
      });
    });
    await applyUpdates.click();
    console.log("URL probe started Apply design updates handoff");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.body.innerText.includes("Verifying source and runtime"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    console.log(
      "URL probe apply state after 1s",
      await page.evaluate(() => ({
        toolbar: document.querySelector(
          "[data-design-pending-visual-style-toolbar]",
        )?.textContent,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
          (dialog) => ({
            text: dialog.textContent,
            hidden: (dialog as HTMLElement).hidden,
          }),
        ),
        body: document.body.innerText.includes("Verifying source and runtime"),
      })),
    );
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as typeof window & { __urlProbeHandoff?: unknown })
                .__urlProbeHandoff,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const sourceHandoff = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __urlProbeHandoff?: {
              submitMessageId?: string;
              message?: string;
              context?: string;
            };
          }
        ).__urlProbeHandoff,
    );
    expect(sourceHandoff?.submitMessageId).toBeTruthy();
    expect(sourceHandoff?.message).toContain("source");
    expect(sourceHandoff?.context).toContain("index.html");
    expect(sourceHandoff?.context).toContain('"sourceId": "v1"');
    expect(sourceHandoff?.context).toContain('"anchorSourceId": "v3"');
    expect(sourceHandoff?.context).toContain('"dropMode": "flow-insert"');
    console.log("URL probe source handoff acknowledged", sourceHandoff);

    const readResult = (await call("read-local-file", {
      designId,
      connectionId,
      path: "index.html",
    })) as {
      result?: { content?: string; versionHash?: string };
    };
    const sourceVersionHash = readResult.result?.versionHash;
    expect(sourceVersionHash).toMatch(/^[a-f0-9]{64}$/i);
    const sourceCardPattern = (id: string) =>
      new RegExp(`<div id="${id}"[^>]*>V${id.slice(1)}</div>`);
    const sourceV1 = diskBeforeDrag.match(sourceCardPattern("v1"))?.[0];
    expect(sourceV1).toBeTruthy();
    const sourceWithoutV1 = diskBeforeDrag.replace(sourceV1!, "");
    const sourceV3 = sourceWithoutV1.match(sourceCardPattern("v3"))?.[0];
    expect(sourceV3).toBeTruthy();
    const reorderedSource = sourceWithoutV1.replace(
      sourceV3!,
      `${sourceV3}${sourceV1}`,
    );
    expect(
      [...reorderedSource.matchAll(/\sid="(v[123])"/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["v2", "v3", "v1"]);

    const consentRequest = (await call("request-localhost-write-consent", {
      designId,
      connectionId,
      files: ["index.html"],
    })) as {
      ok: boolean;
      result?: { surfaced?: boolean; alreadyGranted?: boolean };
    };
    console.log(
      "URL probe write consent request",
      JSON.stringify(consentRequest),
    );
    const consent = page.getByRole("dialog", { name: "Allow file writes" });
    expect(consentRequest).toMatchObject({
      ok: true,
      result: { surfaced: true },
    });
    await expect(consent).toBeVisible({ timeout: 10_000 });
    await consent.getByRole("button", { name: "Allow writes" }).click();
    // The dialog handler awaits the server-side grant action before it closes,
    // while Playwright's click only waits for the synchronous React handler.
    // Wait for the close so the following bridge write cannot race the grant.
    await expect(consent).toBeHidden({ timeout: 10_000 });
    console.log("URL probe granted write consent");
    const writeResult = await call("write-local-file", {
      designId,
      connectionId,
      relPath: "index.html",
      content: reorderedSource,
      expectedVersionHash: sourceVersionHash,
      requireExpectedVersionHash: true,
    });
    console.log("URL probe source write result", JSON.stringify(writeResult));
    expect(writeResult).toMatchObject({ ok: true });

    const diskAfterApply = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
    );
    expect(diskAfterApply).toBe(reorderedSource);
    console.log(
      "URL probe source order after bridge write",
      [...diskAfterApply.matchAll(/\sid="(v[123])"/g)].map((match) => match[1]),
    );
    await expect
      .poll(
        async () => {
          const result = (await call("get-visual-edit-prompt")) as {
            result?: { pendingEditCount?: number };
          };
          return result.result?.pendingEditCount ?? -1;
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    console.log("URL probe pending source verification cleared");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const readReloadedOrder = async () => {
      try {
        return await page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator(
            '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
          )
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-agent-native-node-id")),
          );
      } catch (error) {
        if (error instanceof Error && /Frame was detached/.test(error.message))
          return null;
        throw error;
      }
    };
    await expect
      .poll(readReloadedOrder, { timeout: 15_000 })
      .toEqual(["v2", "v3", "v1"]);
    console.log("URL probe order after reload", await readReloadedOrder());
    console.log(
      "URL probe prompt after reload",
      JSON.stringify(await call("get-visual-edit-prompt")),
    );
  });

  test("holds a URL-backed grouped grid drag as one pending Apply unit", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
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
    const designDump = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
      .then((response) => response.json());
    const sourceMetadata = JSON.parse(designDump.data) as {
      connectionId?: string;
    };
    const connectionId = sourceMetadata.connectionId;
    expect(connectionId).toBeTruthy();
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const iframe = page.locator("iframe[data-design-preview-iframe]").first();
    const groupA = frame.locator('[data-agent-native-node-id="group-a"]');
    const groupB = frame.locator('[data-agent-native-node-id="group-b"]');
    const occupied = frame.locator(
      '[data-agent-native-node-id="group-occupied"]',
    );
    await expect(groupA).toBeVisible({ timeout: 15_000 });
    await expect(
      frame.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1, { timeout: 30_000 });
    const iframeSrcBeforeDrag = await iframe.getAttribute("src");
    await iframe.evaluate((element) => {
      element.setAttribute("data-iframe-identity-regression", "stable");
    });
    let componentDetailsRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/actions/get-component-details")
      ) {
        componentDetailsRequests += 1;
      }
    });
    const diskBeforeDrag = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
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
    const pendingEditCount = async () =>
      (await visualEditState()).pendingEditCount;
    const gridPlacement = () =>
      frame.locator("[data-group-card]").evaluateAll((els) =>
        Object.fromEntries(
          els.map((el) => {
            const style = getComputedStyle(el);
            return [
              el.id,
              {
                columnStart: style.gridColumnStart,
                columnEnd: style.gridColumnEnd,
                rowStart: style.gridRowStart,
                rowEnd: style.gridRowEnd,
              },
            ];
          }),
        ),
      );
    const gridOrder = () =>
      frame.locator("[data-group-card]").evaluateAll((els) =>
        els
          .map((el) => {
            const style = getComputedStyle(el);
            return {
              id: el.id,
              row: Number.parseInt(style.gridRowStart, 10),
              column: Number.parseInt(style.gridColumnStart, 10),
            };
          })
          .sort((a, b) => a.row - b.row || a.column - b.column)
          .map((entry) => entry.id),
      );
    const gridPlacementBeforeDrag = await gridPlacement();
    const gridOrderBeforeDrag = await gridOrder();
    const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
    const groupABox = await groupA.boundingBox();
    const groupBBox = await groupB.boundingBox();
    const targetBox = await occupied.boundingBox();
    if (!groupABox || !groupBBox || !targetBox)
      throw new Error("Grouped URL probe selection boxes missing");
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await page.waitForTimeout(600);
    await page.keyboard.down("Shift");
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      groupBBox.x + groupBBox.width / 2,
      groupBBox.y + groupBBox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await page.keyboard.up("Shift");
    const selectedRows = page.locator(
      '[role="treeitem"][aria-selected="true"]',
    );
    await expect
      .poll(async () => await selectedRows.allTextContents(), {
        timeout: 5_000,
      })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("Group A"),
          expect.stringContaining("Group B"),
        ]),
      );
    await page.waitForTimeout(500);
    expect(componentDetailsRequests).toBe(0);
    await expect(iframe).toHaveAttribute(
      "data-iframe-identity-regression",
      "stable",
    );
    await expect(iframe).toHaveAttribute("src", iframeSrcBeforeDrag ?? "");
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
    const heldGuides = await frame
      .locator("[data-agent-native-insertion-guide]")
      .evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    await expect(iframe).toHaveAttribute(
      "data-iframe-identity-regression",
      "stable",
    );
    await expect(iframe).toHaveAttribute("src", iframeSrcBeforeDrag ?? "");
    expect(
      heldGuides.some(
        (guide) =>
          guide.width > 0 && guide.height > 0 && guide.display !== "none",
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(process.cwd(), "../../.tmp/url-grouped-held.png"),
      fullPage: true,
    });
    await page.mouse.up();
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBe(1);
    const prompt = (await call("get-visual-edit-prompt")) as {
      result?: { prompt?: string; status?: string };
    };
    expect(prompt).toMatchObject({ result: { status: "ready" } });
    expect(prompt.result?.prompt).toContain('"transactionId"');
    expect(prompt.result?.prompt).toContain("group-a");
    expect(prompt.result?.prompt).toContain("group-b");
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );

    const runtimeStyles = Object.fromEntries(
      await frame
        .locator("[data-group-card]")
        .evaluateAll((els) =>
          els.map((el) => [el.id, el.getAttribute("style") ?? ""]),
        ),
    );
    const runtimeGroupOrder = await frame
      .locator("[data-group-card]")
      .evaluateAll((els) => els.map((el) => el.id));
    const gridPlacementAfterDrag = await gridPlacement();
    const gridOrderAfterDrag = await gridOrder();

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(gridPlacement, { timeout: 10_000 })
      .toEqual(gridPlacementBeforeDrag);
    await expect
      .poll(gridOrder, { timeout: 10_000 })
      .toEqual(gridOrderBeforeDrag);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(gridPlacement, { timeout: 10_000 })
      .toEqual(gridPlacementAfterDrag);
    await expect
      .poll(gridOrder, { timeout: 10_000 })
      .toEqual(gridOrderAfterDrag);
    await expect
      .poll(visualEditState, { timeout: 10_000 })
      .toMatchObject({ status: "ready" });
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBeGreaterThan(0);
    let sourceWriteCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/webmcp/actions/write-local-file")
      ) {
        sourceWriteCount += 1;
      }
    });
    await page.evaluate(() => {
      const state = window as typeof window & {
        __groupedUrlProbeHandoff?: { context?: string; message?: string };
      };
      window.addEventListener("message", (event) => {
        const payload = event.data;
        const submitMessageId = payload?.data?.submitMessageId;
        if (
          payload?.type !== "agentNative.submitChat" ||
          typeof submitMessageId !== "string"
        ) {
          return;
        }
        state.__groupedUrlProbeHandoff = {
          context:
            typeof payload.data.context === "string"
              ? payload.data.context
              : undefined,
          message:
            typeof payload.data.message === "string"
              ? payload.data.message
              : undefined,
        };
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitResult", {
            detail: { submitMessageId, delivered: true },
          }),
        );
      });
    });
    const applyUpdates = page.getByRole("button", {
      name: "Apply design updates",
      exact: true,
    });
    await expect(applyUpdates).toBeVisible({ timeout: 10_000 });
    await applyUpdates.click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.body.innerText.includes("Verifying source and runtime"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as typeof window & { __groupedUrlProbeHandoff?: unknown })
                .__groupedUrlProbeHandoff,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const groupedHandoff = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __groupedUrlProbeHandoff?: {
              context?: string;
              message?: string;
            };
          }
        ).__groupedUrlProbeHandoff,
    );
    expect(groupedHandoff?.message).toContain("source");
    expect(groupedHandoff?.context).toContain('"sourceId": "group-a"');
    expect(groupedHandoff?.context).toContain('"sourceId": "group-b"');
    expect(groupedHandoff?.context).toContain('"transactionId"');

    const readResult = (await call("read-local-file", {
      designId,
      connectionId,
      path: "index.html",
    })) as { result?: { content?: string; versionHash?: string } };
    const sourceVersionHash = readResult.result?.versionHash;
    expect(sourceVersionHash).toMatch(/^[a-f0-9]{64}$/i);
    const sourceWithRuntimeStyles = Object.entries(runtimeStyles).reduce(
      (html, [id, style]) =>
        html.replace(
          new RegExp(`(<div id="${id}"[^>]*style=")[^"]*(")`),
          `$1${style}$2`,
        ),
      diskBeforeDrag,
    );
    const groupCardPattern =
      /<div id="group-(?:a|b|occupied)"[^>]*>[^<]*<\/div>/g;
    const groupCards = [...sourceWithRuntimeStyles.matchAll(groupCardPattern)];
    expect(groupCards).toHaveLength(3);
    const cardsById = Object.fromEntries(
      groupCards.map((match) => {
        const card = match[0];
        const id = card.match(/id="([^"]+)"/)?.[1];
        if (!id) throw new Error("Grouped source card is missing its id");
        return [id, card];
      }),
    );
    let groupCardIndex = 0;
    const sourceWithRuntimeState = sourceWithRuntimeStyles.replace(
      groupCardPattern,
      () => cardsById[runtimeGroupOrder[groupCardIndex++]]!,
    );
    expect(sourceWithRuntimeState).not.toBe(diskBeforeDrag);
    const consentRequest = (await call("request-localhost-write-consent", {
      designId,
      connectionId,
      files: ["index.html"],
    })) as {
      ok: boolean;
      result?: { surfaced?: boolean; alreadyGranted?: boolean };
    };
    const consent = page.getByRole("dialog", { name: "Allow file writes" });
    expect(consentRequest).toMatchObject({ ok: true });
    if (consentRequest.result?.surfaced) {
      await expect(consent).toBeVisible({ timeout: 10_000 });
      await consent.getByRole("button", { name: "Allow writes" }).click();
      await expect(consent).toBeHidden({ timeout: 10_000 });
    } else {
      expect(consentRequest.result?.alreadyGranted).toBe(true);
    }
    const writeResult = await call("write-local-file", {
      designId,
      connectionId,
      relPath: "index.html",
      content: sourceWithRuntimeState,
      expectedVersionHash: sourceVersionHash,
      requireExpectedVersionHash: true,
    });
    expect(writeResult).toMatchObject({ ok: true });
    expect(sourceWriteCount).toBe(1);
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      sourceWithRuntimeState,
    );
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 30_000 },
      )
      .toBe(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const reloadedFrame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    await expect
      .poll(
        () =>
          reloadedFrame
            .locator("[data-group-card]")
            .evaluateAll((els) =>
              Object.fromEntries(
                els.map((el) => [el.id, el.getAttribute("style") ?? ""]),
              ),
            ),
        { timeout: 15_000 },
      )
      .toEqual(runtimeStyles);
    await page.screenshot({
      path: path.resolve(
        process.cwd(),
        "../../.tmp/url-grouped-after-reload.png",
      ),
      fullPage: true,
    });
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 10_000 },
      )
      .toBe(0);
  });
});
