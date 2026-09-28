import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
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
  type Frame,
  type FrameLocator,
  type Locator,
} from "@playwright/test";

import { expandAllLayers, installBridge } from "./helpers";

type CrossScreenDropSample = {
  at: number;
  present: boolean;
  visible: boolean;
  parentId: string | null;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: string;
  visibility: string;
};

const redactDiagnostic = (value: string) =>
  value
    .replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/g, "$1?[redacted]")
    .replace(/\b[A-Fa-f0-9]{64}\b/g, "[redacted]")
    .slice(0, 400);

async function physicalFrameElementBox(
  frame: FrameLocator,
  iframe: Locator,
  selector: string,
) {
  const [frameBox, nativeBox] = await Promise.all([
    iframe.boundingBox(),
    frame.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
      };
    }),
  ]);
  if (!frameBox) throw new Error(`missing iframe box for ${selector}`);
  const scaleX = frameBox.width / nativeBox.viewportWidth;
  const scaleY = frameBox.height / nativeBox.viewportHeight;
  return {
    x: frameBox.x + nativeBox.x * scaleX,
    y: frameBox.y + nativeBox.y * scaleY,
    width: nativeBox.width * scaleX,
    height: nativeBox.height * scaleY,
  };
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

test("React URL-backed drag/drop emits semantic handoff and survives coding-agent HMR", async ({
  page,
  request,
}, workerInfo) => {
  const baseURL = workerInfo.project.use.baseURL as string;
  const componentDetailsRequests: string[] = [];
  const dragDebugMessages: string[] = [];
  const failedBridgeRequests: string[] = [];
  const bridgeResponses: string[] = [];
  const previewCredentialResponses: string[] = [];
  const clientErrors: string[] = [];
  const collaborationSnapshotRequests: string[] = [];
  page.on("request", (request) => {
    const actionPath = new URL(request.url()).pathname.split("/");
    const action = actionPath[actionPath.length - 1];
    if (
      action === "reserve-visual-edit-snapshot" ||
      action === "publish-visual-edit-snapshot"
    ) {
      collaborationSnapshotRequests.push(action);
    }
  });
  page.on("console", (message) => {
    if (message.text().includes("[dnd")) {
      dragDebugMessages.push(message.text());
    }
    if (message.text().includes("live-edit bridge registration failed")) {
      failedBridgeRequests.push(`browser console: ${message.text()}`);
    }
    if (message.type() === "error") {
      clientErrors.push(redactDiagnostic(message.text()));
    }
  });
  page.on("pageerror", (error) =>
    clientErrors.push(redactDiagnostic(error.message)),
  );
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin === baseURL) return;
    failedBridgeRequests.push(
      `${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/live-edit-bridge")) {
      bridgeResponses.push(`${response.status()} ${url.origin}${url.pathname}`);
    }
    if (url.pathname.endsWith("/actions/refresh-localhost-preview-token")) {
      void response
        .json()
        .then((payload: unknown) => {
          const credentials =
            payload && typeof payload === "object"
              ? (payload as Record<string, unknown>)
              : {};
          const connections =
            credentials.connections &&
            typeof credentials.connections === "object"
              ? (credentials.connections as Record<
                  string,
                  Record<string, unknown>
                >)
              : {};
          previewCredentialResponses.push(
            `${response.status()} ${url.pathname} keys=${Object.keys(credentials).sort().join(",")} connection-keys=${Object.keys(connections).join(",")} nested-registration=${Object.values(connections).some((entry) => Boolean(entry.liveEditRegistrationCapability))} nested-live-edit=${Object.values(connections).some((entry) => Boolean(entry.liveEditCapability))}`,
          );
        })
        .catch(() => {
          previewCredentialResponses.push(
            `${response.status()} ${url.pathname} body-unreadable`,
          );
        });
    }
  });
  await page.addInitScript(() => {
    const win = window as Window & { __physicalInputTrace?: unknown[] };
    win.__physicalInputTrace = [];
    for (const type of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
    ]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          win.__physicalInputTrace?.push({
            type,
            target:
              target instanceof Element ? target.outerHTML.slice(0, 120) : null,
            metaKey: (event as MouseEvent).metaKey,
            ctrlKey: (event as MouseEvent).ctrlKey,
            defaultPrevented: event.defaultPrevented,
          });
        },
        true,
      );
    }
    const messageTrace: unknown[] = [];
    (
      window as Window & { __physicalMessageTrace?: unknown[] }
    ).__physicalMessageTrace = messageTrace;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (
        !data ||
        ![
          "agent-native:cross-screen-drag",
          "agent-native:hit-test",
          "agent-native:hit-test-result",
          "style-change",
          "agent-native:visual-structure-change",
          "agent-native:visual-structure-ack",
          "agent-native:runtime-reloading",
          "runtime-structure-insert-applied",
          "runtime-structure-insert-rejected",
          "runtime-structure-rollback-result",
          "runtime-element-deleted",
        ].includes(data.type)
      ) {
        return;
      }
      messageTrace.push({
        type: data.type,
        at: Date.now(),
        origin: event.origin,
        phase: data.phase,
        x: data.x,
        y: data.y,
        screenId: data.screenId,
        sourceId: data.sourceId,
        selector: data.selector,
        property: data.property,
        value: data.value,
        nodeId: data.nodeId,
        correlationId: data.correlationId,
        requestId: data.requestId,
        transactionId: data.transactionId,
        applied: data.applied,
        reason: data.reason,
        anchorNodeId: data.anchorNodeId,
        placement: data.placement,
      });
      if (messageTrace.length > 50) messageTrace.shift();
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/actions/get-component-details")) {
      componentDetailsRequests.push(request.url());
    }
  });
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-url-react-"),
  );
  const fixtureNodeModules = path.join(rootPath, "node_modules");
  fs.mkdirSync(fixtureNodeModules);
  for (const packageName of ["react", "react-dom", "react-router", "vite"]) {
    fs.symlinkSync(
      path.resolve(process.cwd(), "node_modules", packageName),
      path.join(fixtureNodeModules, packageName),
      "dir",
    );
  }
  fs.mkdirSync(path.join(rootPath, "src"));
  fs.writeFileSync(
    path.join(rootPath, "index.html"),
    '<!doctype html><html><head><title>React URL physical proof</title></head><body><main id="root"></main><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/main.tsx"),
    'import { hydrateRoot } from "react-dom/client"; import { BrowserRouter } from "react-router"; import { App } from "./App"; let appRoot = hydrateRoot(document, <BrowserRouter><App /></BrowserRouter>); (window as typeof window & { __forceReactDocumentRemount?: () => void }).__forceReactDocumentRemount = () => { appRoot.unmount(); appRoot = hydrateRoot(document, <BrowserRouter><App /></BrowserRouter>); };',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/App.tsx"),
    `import { useState } from "react"; import { useLocation, useNavigate } from "react-router";\nconst initialCards = [{ id: "v1", label: "V1" }, { id: "v2", label: "V2" }, { id: "v3", label: "V3" }];\nexport function App() { const [cards] = useState(initialCards); const location = useLocation(); const navigate = useNavigate(); const prefix = new URLSearchParams(location.search).has("screen") ? "dest-" : ""; return <html><head><title>React URL physical proof</title></head><body><main id="root" style={{ padding: 24, width: 720, position: "relative" }}><button type="button" onClick={() => navigate("/next")}>Go to next route</button><p data-route-label>{location.pathname === "/next" ? "Next route" : "Home route"}</p><div id={prefix + "flow"} data-source-id={prefix + "flow-root"} data-agent-native-node-id={prefix + "flow-root"} style={{ display: "flex", flexDirection: "column", gap: 16, border: "2px solid #334155", padding: 16, width: 640 }}>{cards.map((card) => <div key={card.id} id={prefix + card.id} data-source-id={prefix + card.id} data-agent-native-node-id={prefix + card.id} style={{ height: 64, border: "2px solid #0f766e", padding: 12 }}>{card.label}</div>)}</div></main><div id={prefix + "freeform"} data-source-id={prefix + "freeform"} data-agent-native-node-id={prefix + "freeform"} style={{ position: "absolute", left: 40, top: 420, width: 120, height: 70, border: "2px solid #be123c", background: "#fda4af", padding: 8 }}>Freeform</div></body></html>; }`,
  );
  const targetPort = await freePort();
  const targetUrl = `http://127.0.0.1:${targetPort}`; // e2e-harness-ignore: allocated live Vite port
  let bridge: DesignConnectBridge | null = null;
  let opened: {
    designId: string;
    bridgeToken: string;
    previewToken: string;
  } | null = null;
  let vite: ReturnType<typeof spawn> | null = null;
  let post:
    | ((
        name: string,
        input: Record<string, unknown>,
      ) => Promise<{
        designId: string;
        bridgeToken: string;
        previewToken: string;
      }>)
    | null = null;
  try {
    fs.writeFileSync(
      path.join(rootPath, "vite.config.ts"),
      `import { defineConfig } from "vite"; export default defineConfig({ server: { host: "127.0.0.1", port: ${targetPort}, strictPort: true, hmr: { host: "127.0.0.1", port: ${targetPort} } } });`,
    );
    const viteProcess = spawn(
      process.execPath,
      [
        path.resolve(
          path.dirname(createRequire(import.meta.url).resolve("vite")),
          "../../bin/vite.js",
        ),
        "--host",
        "127.0.0.1",
        "--port",
        String(targetPort),
        "--strictPort",
        "--force",
      ],
      { cwd: rootPath, stdio: ["ignore", "pipe", "pipe"] },
    );
    let viteError = "";
    vite = viteProcess;
    viteProcess.stderr?.on("data", (chunk) => {
      viteError += String(chunk);
    });
    await expect
      .poll(
        async () => {
          if (viteProcess.exitCode !== null)
            throw new Error(
              `Vite exited with ${viteProcess.exitCode}: ${viteError}`,
            );
          return (await fetch(targetUrl).catch(() => null))?.ok ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    post = async (name: string, input: Record<string, unknown>) => {
      const response = await request.post(
        `${baseURL}/_agent-native/actions/${name}`,
        { data: input },
      );
      if (!response.ok())
        throw new Error(
          `${name}: ${response.status()} ${await response.text()}`,
        );
      return (await response.json()) as {
        designId: string;
        bridgeToken: string;
        previewToken: string;
      };
    };
    const bridgePort = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    opened = await post("open-visual-edit", {
      title: "React URL physical proof",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      routes: [
        { path: "/", url: targetUrl, title: "Library" },
        {
          path: "/",
          url: `${targetUrl}/?screen=settings`,
          title: "Settings",
        },
      ],
      navigate: false,
      publicReadOnly: true,
    });
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
    await expect
      .poll(
        async () =>
          (await fetch(`${manifest.bridgeUrl}/health`).catch(() => null))?.ok ??
          false,
        { timeout: 15_000 },
      )
      .toBe(true);
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await page.goto(
      `${baseURL}/visual-edit/${opened.designId}?editorView=overview&zoom=31`,
      { waitUntil: "domcontentloaded" },
    );
    try {
      await expect(page.locator("[data-design-editor]")).toBeVisible({
        timeout: 45_000,
      });
    } catch (error) {
      const pageState = await page
        .evaluate(() => ({
          title: document.title,
          bodyText: document.body.innerText.slice(0, 600),
        }))
        .catch(() => ({ title: "unavailable", bodyText: "unavailable" }));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; url=${redactDiagnostic(page.url())}; title=${redactDiagnostic(pageState.title)}; body=${redactDiagnostic(pageState.bodyText)}; client-errors=${clientErrors.slice(-12).join(" | ")}; bridge=${bridgeResponses.join(" | ")}; registration=${failedBridgeRequests.slice(-8).join(" | ")}`,
      );
    }
    const allowLocalAccess = page.getByRole("button", {
      name: "Allow local access",
    });
    if (await allowLocalAccess.isVisible().catch(() => false)) {
      const promptGeometry: {
        box: Awaited<ReturnType<typeof allowLocalAccess.boundingBox>>;
      } = { box: null };
      await expect
        .poll(async () => {
          if (!(await allowLocalAccess.isVisible().catch(() => false))) {
            promptGeometry.box = null;
            return "dismissed";
          }
          promptGeometry.box = await allowLocalAccess
            .boundingBox()
            .catch(() => null);
          return promptGeometry.box ? "ready" : "transitioning";
        })
        .not.toBe("transitioning");
      const promptStillVisible = await allowLocalAccess
        .isVisible()
        .catch(() => false);
      const promptBox = promptStillVisible
        ? await allowLocalAccess.boundingBox().catch(() => null)
        : null;
      if (promptBox) {
        await page.mouse.click(
          promptBox.x + promptBox.width / 2,
          promptBox.y + promptBox.height / 2,
        );
      }
    }
    const call = (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(
        async ({ name, args }) =>
          await (
            window as typeof window & {
              __agentNativeWebMcp: {
                call: (
                  name: string,
                  args?: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp.call(name, args),
        { name, args },
      );
    const liveFrames = page.locator("iframe[data-design-preview-iframe]");
    try {
      await expect(liveFrames).toHaveCount(2);
    } catch (error) {
      const pendingStates = await page
        .locator("text=Preparing live editor")
        .allTextContents();
      const connectionErrors = await page
        .locator("text=Live editing is waiting for a connection")
        .allTextContents();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; bridge=${bridgeResponses.join(" | ")}; credential=${previewCredentialResponses.join(" | ")}; failed=${failedBridgeRequests.join(" | ")}; client-errors=${clientErrors.slice(-8).join(" | ")}; preparing=${pendingStates.length}; connection-errors=${connectionErrors.length}`,
      );
    }
    const liveFrameIds = await liveFrames.evaluateAll((iframes) =>
      iframes.map((iframe) => iframe.dataset.screenIframeId ?? ""),
    );
    if (liveFrameIds.some((id) => !id) || new Set(liveFrameIds).size !== 2) {
      throw new Error(
        `expected unique stable screen ids on both live iframe elements: ${JSON.stringify(liveFrameIds)}`,
      );
    }
    const iframeForScreen = (screenId: string) =>
      page.locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      );
    const candidateFrames = liveFrameIds.map((screenId) =>
      page.frameLocator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      ),
    );
    try {
      await expect
        .poll(async () =>
          Promise.all(
            candidateFrames.map((candidate) =>
              candidate
                .locator("html")
                .evaluate((html) =>
                  Number.parseFloat(
                    getComputedStyle(html).getPropertyValue(
                      "--agent-native-editor-chrome-scale-x",
                    ),
                  ),
                ),
            ),
          ).then((scales) =>
            scales.every(
              (scale) =>
                Number.isFinite(scale) && Math.abs(scale - 1 / 0.31) < 0.1,
            ),
          ),
        )
        .toBe(true);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; bridge=${bridgeResponses.join(" | ")}; failed=${failedBridgeRequests.join(" | ")}; credentials=${previewCredentialResponses.join(" | ")}; client-errors=${clientErrors.slice(-8).join(" | ")}`,
      );
    }
    const frameAssignment = async () => {
      const nodeCounts = await Promise.all(
        candidateFrames.map(async (candidate) =>
          Promise.all([
            candidate
              .locator('[data-agent-native-node-id="flow-root"]')
              .count(),
            candidate
              .locator('[data-agent-native-node-id="dest-flow-root"]')
              .count(),
          ]),
        ),
      );
      const sourceFrameIndex = nodeCounts.findIndex(
        ([sourceCount, destinationCount]) =>
          sourceCount > 0 && destinationCount === 0,
      );
      const destinationFrameIndex = nodeCounts.findIndex(
        ([sourceCount, destinationCount]) =>
          destinationCount > 0 && sourceCount === 0,
      );
      return sourceFrameIndex >= 0 && destinationFrameIndex >= 0
        ? ([sourceFrameIndex, destinationFrameIndex] as const)
        : null;
    };
    const resolvedFrameAssignment: {
      value: readonly [number, number] | null;
    } = {
      value: null,
    };
    await expect
      .poll(
        async () => {
          resolvedFrameAssignment.value = await frameAssignment();
          return resolvedFrameAssignment.value !== null;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const frameIndices = resolvedFrameAssignment.value;
    if (!frameIndices)
      throw new Error("could not identify both live React frames");
    const [sourceFrameIndex, destinationFrameIndex] = frameIndices;
    const frame = candidateFrames[sourceFrameIndex];
    const destinationFrame = candidateFrames[destinationFrameIndex];
    const initialLiveFrameState = await liveFrames.evaluateAll((iframes) =>
      iframes.map((iframe) => {
        const src = iframe.getAttribute("src");
        const parsedSrc = src ? new URL(src, location.href) : null;
        return {
          screenId: iframe.dataset.screenIframeId ?? null,
          sourceType: iframe.dataset.designSourceType ?? null,
          srcPath: parsedSrc?.pathname ?? null,
          srcHost: parsedSrc?.host ?? null,
          hasSrcDoc: iframe.hasAttribute("srcdoc"),
        };
      }),
    );
    expect(
      initialLiveFrameState.map((state) => state.sourceType),
      "the physical test must operate on URL-backed localhost screens: " +
        JSON.stringify(initialLiveFrameState),
    ).toEqual(["localhost", "localhost"]);
    await Promise.all(
      candidateFrames.map((candidate) =>
        candidate.locator("body").evaluate(() => {
          const messages: Array<Record<string, unknown>> = [];
          (
            window as Window & {
              __incomingPreviewMessages?: Array<Record<string, unknown>>;
            }
          ).__incomingPreviewMessages = messages;
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (data && typeof data === "object") {
              messages.push({
                ...(data as Record<string, unknown>),
                receivedAt: Date.now(),
              });
            }
          });
        }),
      ),
    );
    const physicalBox = (
      frameLocator: FrameLocator,
      index: number,
      selector: string,
    ) =>
      physicalFrameElementBox(
        frameLocator,
        iframeForScreen(liveFrameIds[index]!),
        selector,
      );
    await frame
      .locator('[data-agent-native-node-id="flow-root"]')
      .waitFor({ state: "visible" });
    await destinationFrame
      .locator('[data-agent-native-node-id="dest-flow-root"]')
      .waitFor({ state: "visible" });
    for (const candidate of [frame, destinationFrame]) {
      await expect(
        candidate.locator("script[data-agent-native-editor-chrome-bridge]"),
      ).toHaveAttribute("type", "module", { timeout: 15_000 });
    }
    await page.keyboard.press("Shift+1");
    let previousCanvasBoxes = "";
    await expect
      .poll(
        async () => {
          const boxes = await Promise.all(
            [
              { candidate: frame, nodeId: "flow-root" },
              { candidate: destinationFrame, nodeId: "dest-flow-root" },
            ].map(async ({ candidate, nodeId }) => {
              const node = candidate.locator(
                `[data-agent-native-node-id="${nodeId}"]`,
              );
              const box = await node.boundingBox();
              return box ? `${box.x},${box.y},${box.width},${box.height}` : "";
            }),
          );
          const current = boxes.join("|");
          const stable =
            boxes.every(Boolean) && current === previousCanvasBoxes;
          previousCanvasBoxes = current;
          return stable;
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    const editOpacityInFrame = async (
      targetFrame: FrameLocator,
      frameIndex: number,
      nodeSelector: string,
      percent: number,
    ) => {
      const box = await physicalBox(targetFrame, frameIndex, nodeSelector);
      if (!box) throw new Error(`missing opacity target ${nodeSelector}`);
      const sourceId = nodeSelector.match(
        /data-agent-native-node-id="([^"]+)"/,
      )?.[1];
      if (!sourceId) throw new Error(`missing node id in ${nodeSelector}`);
      await targetFrame.locator("body").evaluate(() => {
        (
          window as Window & {
            __incomingPreviewMessages?: Array<Record<string, unknown>>;
          }
        ).__incomingPreviewMessages?.splice(0);
      });
      await page.evaluate(() => ((window as any).__bridge = []));
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        (id) =>
          [...((window as any).__bridge ?? [])].some(
            (message: any) =>
              message.type === "element-select" &&
              (message.payload?.sourceId === id ||
                message.payload?.selector?.includes(
                  `[data-agent-native-node-id="${id}"]`,
                )),
          ),
        sourceId,
        { timeout: 3_000 },
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect
        .poll(() =>
          page.locator('[role="treeitem"][aria-selected="true"]').count(),
        )
        .toBeGreaterThan(0);
      const selectedLayerParts = sourceId.split("-");
      const selectedLayerName =
        selectedLayerParts[selectedLayerParts.length - 1]!.toUpperCase();
      const selectedLayerRow = page
        .locator('[role="treeitem"][aria-selected="true"]')
        .filter({ hasText: selectedLayerName });
      await expect(selectedLayerRow).toBeVisible();
      await expect
        .poll(() =>
          targetFrame.locator("body").evaluate(
            (_, selector) =>
              (
                window as Window & {
                  __incomingPreviewMessages?: Array<{
                    type?: string;
                    selectorGroups?: string[][];
                  }>;
                }
              ).__incomingPreviewMessages?.some(
                (message) =>
                  message.type === "select-elements" &&
                  message.selectorGroups?.some((group) =>
                    group.some((candidate) => candidate.includes(selector)),
                  ),
              ),
            nodeSelector,
          ),
        )
        .toBe(true);
      const appearance = page
        .getByRole("heading", { name: "Appearance", exact: true })
        .locator("xpath=ancestor::section");
      const opacity = appearance.getByRole("textbox", {
        name: "Opacity",
        exact: true,
      });
      await expect(opacity).toHaveValue("100%");
      await opacity.fill(String(percent));
      await opacity.evaluate((input) => {
        const win = window as Window & { __visualStyleEnterAt?: number };
        input.addEventListener(
          "keydown",
          (event) => {
            if (event instanceof KeyboardEvent && event.key === "Enter") {
              win.__visualStyleEnterAt = Date.now();
            }
          },
          { capture: true, once: true },
        );
      });
      await opacity.press("Enter");
      const editStartedAt = await page.evaluate(
        () =>
          (window as Window & { __visualStyleEnterAt?: number })
            .__visualStyleEnterAt ?? Date.now(),
      );
      const expectedOpacity = String(percent / 100);
      try {
        await expect
          .poll(
            () =>
              targetFrame
                .locator(nodeSelector)
                .evaluate((element) => getComputedStyle(element).opacity),
            { timeout: 2_000 },
          )
          .toBe(expectedOpacity);
      } catch {
        const targetIframeId = await liveFrames
          .nth(frameIndex)
          .getAttribute("data-screen-iframe-id");
        const [targetDiagnostics, frameMessages, hostSelections] =
          await Promise.all([
            targetFrame.locator("body").evaluate(
              (_, selector) => ({
                frameUrl: location.href,
                actualOpacity: getComputedStyle(
                  document.querySelector(selector)!,
                ).opacity,
                messages:
                  (
                    window as Window & {
                      __physicalMessageTrace?: Array<Record<string, unknown>>;
                    }
                  ).__physicalMessageTrace?.slice(-20) ?? [],
              }),
              nodeSelector,
            ),
            Promise.all(
              [frame, destinationFrame].map((candidate) =>
                candidate.locator("body").evaluate(() => ({
                  frameUrl: location.href,
                  messages:
                    (
                      window as Window & {
                        __incomingPreviewMessages?: Array<
                          Record<string, unknown>
                        >;
                      }
                    ).__incomingPreviewMessages?.slice(-20) ?? [],
                })),
              ),
            ),
            page.evaluate(() =>
              ((window as any).__bridge ?? [])
                .filter((message: any) => message.type === "element-select")
                .slice(-5),
            ),
          ]);
        throw new Error(
          `inspector opacity edit did not reach ${nodeSelector}: targetIframeId=${targetIframeId}; target=${JSON.stringify(targetDiagnostics)}; allFrames=${JSON.stringify(frameMessages)}; selections=${JSON.stringify(hostSelections)}`,
        );
      }
      const readMessages = (candidate: FrameLocator) =>
        candidate.locator("body").evaluate(
          () =>
            (
              window as Window & {
                __incomingPreviewMessages?: Array<{
                  type?: string;
                  property?: string;
                  value?: string;
                  receivedAt?: number;
                }>;
              }
            ).__incomingPreviewMessages ?? [],
        );
      const otherFrame = targetFrame === frame ? destinationFrame : frame;
      const [targetMessages, otherMessages] = await Promise.all([
        readMessages(targetFrame),
        readMessages(otherFrame),
      ]);
      const matchingMessages = targetMessages.filter(
        (message) =>
          message.type === "style-change" &&
          message.property === "opacity" &&
          message.value === expectedOpacity &&
          (message.receivedAt ?? 0) >= editStartedAt,
      );
      expect(
        matchingMessages,
        `opacity ${percent}% did not reach target iframe; target=${JSON.stringify(targetMessages.slice(-20))}; other=${JSON.stringify(otherMessages.slice(-20))}`,
      ).not.toHaveLength(0);
      expect(
        otherMessages.filter(
          (message) =>
            message.type === "style-change" &&
            message.property === "opacity" &&
            message.value === expectedOpacity &&
            (message.receivedAt ?? 0) >= editStartedAt,
        ),
        "style-change was also sent to the other screen",
      ).toHaveLength(0);
      const receivedAt =
        matchingMessages[matchingMessages.length - 1]?.receivedAt;
      expect(
        receivedAt,
        "style-change message had no receive timestamp",
      ).toBeDefined();
      const deliveryMs = receivedAt! - editStartedAt;
      expect(
        deliveryMs,
        `style-change delivery to screen ${liveFrameIds[frameIndex]} took ${deliveryMs}ms`,
      ).toBeLessThanOrEqual(400);
    };

    await installBridge(page);
    await editOpacityInFrame(
      destinationFrame,
      destinationFrameIndex,
      '[data-agent-native-node-id="dest-v1"]',
      50,
    );
    await expect
      .poll(() =>
        frame
          .locator('[data-agent-native-node-id="v1"]')
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");
    await page.evaluate(() => ((window as any).__bridge = []));
    await editOpacityInFrame(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v1"]',
      25,
    );
    await expect
      .poll(() =>
        destinationFrame
          .locator('[data-agent-native-node-id="dest-v1"]')
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("0.5");

    const crossSource = frame.locator('[data-agent-native-node-id="v2"]');
    const crossTarget = destinationFrame.locator(
      '[data-agent-native-node-id="dest-v3"]',
    );
    const movedTarget = destinationFrame.locator(
      '[data-agent-native-node-id="dest-v2"]',
    );
    await installBridge(page);
    await page.evaluate(() => ((window as any).__bridge = []));
    const crossModifier = process.platform === "darwin" ? "Meta" : "Control";
    const crossSourceBoxBeforeSelection = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v2"]',
    );
    if (!crossSourceBoxBeforeSelection)
      throw new Error("missing two-screen live drag source geometry");
    const crossSourceInitialLocation = await frame
      .locator('[data-agent-native-node-id="v2"]')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        return {
          parentId: parent?.getAttribute("data-agent-native-node-id") ?? null,
          index: parent ? [...parent.children].indexOf(element) : -1,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    await page.locator("body").evaluate(() => {
      const win = window as Window & { __hostInputTrace?: unknown[] };
      win.__hostInputTrace = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
      ]) {
        window.addEventListener(
          type,
          (event) => {
            const target = event.target;
            win.__hostInputTrace?.push({
              type,
              target:
                target instanceof Element
                  ? target.outerHTML.slice(0, 160)
                  : null,
              x: (event as MouseEvent).clientX,
              y: (event as MouseEvent).clientY,
              metaKey: (event as MouseEvent).metaKey,
              ctrlKey: (event as MouseEvent).ctrlKey,
              defaultPrevented: event.defaultPrevented,
            });
          },
          true,
        );
      }
    });
    await frame.locator("body").evaluate(() => {
      const win = window as Window & { __physicalInputTrace?: unknown[] };
      win.__physicalInputTrace = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
      ]) {
        document.addEventListener(
          type,
          (event) => {
            const target = event.target;
            win.__physicalInputTrace?.push({
              type,
              target:
                target instanceof Element
                  ? target.outerHTML.slice(0, 120)
                  : null,
              metaKey: (event as MouseEvent).metaKey,
              ctrlKey: (event as MouseEvent).ctrlKey,
              defaultPrevented: event.defaultPrevented,
            });
          },
          true,
        );
      }
    });
    await page.keyboard.down(crossModifier);
    await page.mouse.click(
      crossSourceBoxBeforeSelection.x + crossSourceBoxBeforeSelection.width / 2,
      crossSourceBoxBeforeSelection.y +
        crossSourceBoxBeforeSelection.height / 2,
    );
    await page.keyboard.up(crossModifier);
    const crossSelectionHandle = await page
      .waitForFunction(
        () =>
          [...((window as any).__bridge ?? [])]
            .reverse()
            .find(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.selector?.includes(
                  '[data-agent-native-node-id="v2"]',
                ),
            ) ?? null,
        undefined,
        { timeout: 3_000 },
      )
      .catch(async () => {
        const frameDiagnostics = await frame.locator("body").evaluate(() => {
          const target = document.querySelector(
            '[data-agent-native-node-id="v2"]',
          );
          const rect = target?.getBoundingClientRect();
          const hit = rect
            ? document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              )
            : null;
          const shield = document.querySelector(
            '[data-agent-native-edit-overlay="shield"]',
          );
          const bridgeScript = document.querySelector(
            "script[data-agent-native-editor-chrome-bridge]",
          );
          return {
            url: location.href,
            targetRect: rect && [rect.x, rect.y, rect.width, rect.height],
            hit: hit?.outerHTML.slice(0, 180),
            inputTrace: (
              window as Window & { __physicalInputTrace?: unknown[] }
            ).__physicalInputTrace,
            bridgeSource: bridgeScript?.textContent?.match(
              /var readOnly = (true|false)/,
            )?.[0],
            bridgeReady: document.documentElement.getAttribute(
              "data-agent-native-editor-chrome-ready",
            ),
            shield: shield
              ? {
                  display: getComputedStyle(shield).display,
                  pointerEvents: getComputedStyle(shield).pointerEvents,
                  rect: (() => {
                    const value = shield.getBoundingClientRect();
                    return [value.x, value.y, value.width, value.height];
                  })(),
                }
              : null,
          };
        });
        const messages = await page.evaluate(
          () => (window as any).__bridge ?? [],
        );
        const hostDiagnostics = await page.evaluate(
          ({ x, y }) => ({
            viewport: { width: innerWidth, height: innerHeight },
            sourceBox: { x, y },
            topHitStack: document
              .elementsFromPoint(x, y)
              .slice(0, 6)
              .map((el) => el.outerHTML.slice(0, 160)),
            iframeRects: [
              ...document.querySelectorAll(
                "iframe[data-design-preview-iframe]",
              ),
            ].map((iframe) => {
              const rect = iframe.getBoundingClientRect();
              return [rect.x, rect.y, rect.width, rect.height];
            }),
            inputTrace: (window as Window & { __hostInputTrace?: unknown[] })
              .__hostInputTrace,
          }),
          {
            x:
              crossSourceBoxBeforeSelection.x +
              crossSourceBoxBeforeSelection.width / 2,
            y:
              crossSourceBoxBeforeSelection.y +
              crossSourceBoxBeforeSelection.height / 2,
          },
        );
        throw new Error(
          `V2 did not report a physical selection; frame=${JSON.stringify(frameDiagnostics)}; host=${JSON.stringify(hostDiagnostics)}; messages=${JSON.stringify(messages.slice(-8))}`,
        );
      });
    expect((await crossSelectionHandle.jsonValue()).payload.sourceId).toBe(
      "v2",
    );
    const crossSourceBox = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v2"]',
    );
    const crossTargetBox = await physicalBox(
      destinationFrame,
      destinationFrameIndex,
      '[data-agent-native-node-id="dest-v3"]',
    );
    if (!crossSourceBox || !crossTargetBox)
      throw new Error("missing two-screen live drag geometry after selection");
    const sourceIframeHandle = await page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${liveFrameIds[sourceFrameIndex]}"]`,
      )
      .elementHandle();
    const destinationIframeHandle = await page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${liveFrameIds[destinationFrameIndex]}"]`,
      )
      .elementHandle();
    const sourceBrowserFrame = await sourceIframeHandle?.contentFrame();
    const destinationBrowserFrame =
      await destinationIframeHandle?.contentFrame();
    const crossFrameNavigations: Array<{
      at: number;
      frame: string;
      url: string;
    }> = [];
    const onCrossFrameNavigated = (navigated: Frame) => {
      if (navigated !== page.mainFrame()) {
        crossFrameNavigations.push({
          at: Date.now(),
          frame:
            navigated === sourceBrowserFrame
              ? "source"
              : navigated === destinationBrowserFrame
                ? "destination"
                : "other",
          url: navigated.url(),
        });
      }
    };
    await page.evaluate(() => {
      const trace: Array<Record<string, unknown>> = [];
      (window as any).__physicalCrossDropReleaseAt = null;
      const record = (iframe: HTMLIFrameElement, action: string) => {
        trace.push({
          at: Date.now(),
          releaseDeltaMs:
            (window as any).__physicalCrossDropReleaseAt === null
              ? null
              : Date.now() - (window as any).__physicalCrossDropReleaseAt,
          action,
          screenId: iframe.dataset.screenIframeId,
          src: iframe.getAttribute("src"),
          srcDoc: iframe.getAttribute("srcdoc")?.slice(0, 100),
          sourceType: iframe.dataset.designSourceType,
          title: iframe.title,
          className: iframe.className,
          parent: iframe.parentElement
            ? {
                tag: iframe.parentElement.tagName,
                id: iframe.parentElement.id || null,
                className: iframe.parentElement.className,
                dataScreenId:
                  iframe.parentElement.getAttribute("data-screen-id"),
                dataScreenFrame: iframe.parentElement.getAttribute(
                  "data-screen-iframe-id",
                ),
              }
            : null,
          connected: iframe.isConnected,
        });
      };
      const inspect = (node: Node, action: string) => {
        if (!(node instanceof Element)) return;
        if (
          node instanceof HTMLIFrameElement &&
          node.matches("[data-design-preview-iframe]")
        ) {
          record(node, action);
        }
        node
          .querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          )
          .forEach((iframe) => record(iframe, action));
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === "attributes" &&
            mutation.target instanceof HTMLIFrameElement
          ) {
            record(mutation.target, `attribute:${mutation.attributeName}`);
          }
          mutation.removedNodes.forEach((node) => inspect(node, "removed"));
          mutation.addedNodes.forEach((node) => inspect(node, "added"));
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["src", "srcdoc", "data-screen-iframe-id"],
        childList: true,
        subtree: true,
      });
      (window as any).__physicalIframeLifecycle = { trace, observer };
    });
    page.on("framenavigated", onCrossFrameNavigated);
    await page.mouse.move(
      crossSourceBox.x + crossSourceBox.width / 2,
      crossSourceBox.y + crossSourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      crossSourceBox.x + crossSourceBox.width / 2 + 12,
      crossSourceBox.y + crossSourceBox.height / 2,
      { steps: 6 },
    );
    await page.mouse.move(
      crossTargetBox.x + crossTargetBox.width / 2,
      crossTargetBox.y + crossTargetBox.height / 2,
      { steps: 24 },
    );
    const dragDiagnostics = await page.evaluate(
      ({ x, y }) => ({
        viewport: { width: innerWidth, height: innerHeight },
        pointer: { x, y },
        frames: [
          ...document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        ].map((iframe) => {
          const rect = iframe.getBoundingClientRect();
          return {
            id: iframe.getAttribute("data-screen-iframe-id"),
            rect: [rect.x, rect.y, rect.width, rect.height],
            pointerEvents: getComputedStyle(iframe).pointerEvents,
          };
        }),
        targetStack: document
          .elementsFromPoint(x, y)
          .slice(0, 5)
          .map((element) => element.outerHTML.slice(0, 120)),
        ghost: document
          .querySelector("[data-cross-screen-drag-ghost]")
          ?.getAttribute("style"),
        guide: document
          .querySelector("[data-cross-screen-drop-guide]")
          ?.getAttribute("style"),
      }),
      {
        x: crossTargetBox.x + crossTargetBox.width / 2,
        y: crossTargetBox.y + crossTargetBox.height / 2,
      },
    );
    const sourceMessages = await frame
      .locator("body")
      .evaluate(
        () =>
          (window as Window & { __physicalMessageTrace?: unknown[] })
            .__physicalMessageTrace ?? [],
      );
    const destinationMessages = await destinationFrame
      .locator("body")
      .evaluate(
        () =>
          (window as Window & { __physicalMessageTrace?: unknown[] })
            .__physicalMessageTrace ?? [],
      );
    await expect(
      page.locator("[data-cross-screen-drop-guide]"),
      `drag guide missing; host=${JSON.stringify(dragDiagnostics)}; source=${JSON.stringify(sourceMessages)}; destination=${JSON.stringify(destinationMessages)}; DnD trace: ${dragDebugMessages.slice(-15).join(" | ")}; bridge failures: ${failedBridgeRequests.slice(-10).join(" | ")}`,
    ).toBeVisible({ timeout: 5_000 });
    const startCrossDropTrace = async (targetFrame: Frame, nodeId: string) =>
      targetFrame.evaluate((id) => {
        const trace = {
          instanceId: crypto.randomUUID(),
          startedAt: Date.now(),
          releasedAt: null as number | null,
          insertions: [] as Array<{
            at: number;
            phase: string;
            present: boolean;
            parentId: string | null;
          }>,
          mutations: [] as Array<{
            at: number;
            action: "added" | "removed";
            parentId: string | null;
            connected: boolean;
          }>,
          samples: [] as Array<{
            at: number;
            present: boolean;
            parentId: string | null;
            index: number;
            x: number;
            y: number;
            width: number;
            height: number;
            opacity: string;
            visibility: string;
            visible: boolean;
          }>,
        };
        (
          window as typeof window & { __crossScreenDropTrace?: typeof trace }
        ).__crossScreenDropTrace = trace;
        const recordRelease = (releasedAt: number) => {
          trace.releasedAt ??= releasedAt;
        };
        const onReleaseMessage = (event: MessageEvent) => {
          if (
            event.data?.type === "__physical-cross-screen-drop-release" &&
            typeof event.data.releasedAt === "number"
          ) {
            recordRelease(event.data.releasedAt);
          }
        };
        const onMouseUp = (event: MouseEvent) => {
          if (event.isTrusted && event.button === 0) recordRelease(Date.now());
        };
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type !== "runtime-structure-insert") return;
          const snapshot = (phase: string) => {
            const element = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            trace.insertions.push({
              at: Date.now(),
              phase,
              present: Boolean(element),
              parentId:
                element?.parentElement?.getAttribute(
                  "data-agent-native-node-id",
                ) ?? null,
            });
          };
          snapshot("message");
          queueMicrotask(() => snapshot("microtask"));
          requestAnimationFrame(() => snapshot("animation-frame"));
        });
        window.addEventListener("message", onReleaseMessage);
        window.addEventListener("mouseup", onMouseUp, true);
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const [action, nodes] of [
              ["removed", record.removedNodes],
              ["added", record.addedNodes],
            ] as const) {
              for (const node of nodes) {
                if (!(node instanceof Element)) continue;
                const candidates = [
                  node,
                  ...node.querySelectorAll("[data-agent-native-node-id]"),
                ];
                for (const candidate of candidates) {
                  if (
                    candidate.getAttribute("data-agent-native-node-id") !== id
                  ) {
                    continue;
                  }
                  const parent =
                    candidate.parentElement ??
                    (record.target instanceof Element ? record.target : null);
                  trace.mutations.push({
                    at:
                      trace.releasedAt === null
                        ? -1
                        : Date.now() - trace.releasedAt,
                    action,
                    parentId:
                      parent?.getAttribute("data-agent-native-node-id") ?? null,
                    connected: candidate.isConnected,
                  });
                }
              }
            }
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
        const sample = () => {
          const element = document.querySelector<HTMLElement>(
            `[data-agent-native-node-id="${id}"]`,
          );
          const parent = element?.parentElement;
          const rect = element?.getBoundingClientRect();
          const style = element ? getComputedStyle(element) : null;
          trace.samples.push({
            at: trace.releasedAt === null ? -1 : Date.now() - trace.releasedAt,
            present: Boolean(element),
            parentId: parent?.getAttribute("data-agent-native-node-id") ?? null,
            index:
              parent && element ? [...parent.children].indexOf(element) : -1,
            x: rect?.x ?? -1,
            y: rect?.y ?? -1,
            width: rect?.width ?? -1,
            height: rect?.height ?? -1,
            opacity: style?.opacity ?? "",
            visibility: style?.visibility ?? "",
            visible: Boolean(
              element &&
              style &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) > 0,
            ),
          });
          const awaitingRelease =
            trace.releasedAt === null && Date.now() - trace.startedAt < 5_000;
          const inStabilityWindow =
            trace.releasedAt !== null && Date.now() - trace.releasedAt < 3_100;
          if (awaitingRelease || inStabilityWindow) {
            requestAnimationFrame(sample);
          } else {
            window.removeEventListener("message", onReleaseMessage);
            window.removeEventListener("mouseup", onMouseUp, true);
            observer.disconnect();
          }
        };
        requestAnimationFrame(sample);
      }, nodeId);
    await Promise.all([
      startCrossDropTrace(sourceBrowserFrame!, "v2"),
      startCrossDropTrace(destinationBrowserFrame!, "v2"),
    ]);
    await page.mouse.up();
    const releasedAt = Date.now();
    await page.evaluate((timestamp) => {
      (window as any).__physicalCrossDropReleaseAt = timestamp;
      for (const iframe of document.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      )) {
        iframe.contentWindow?.postMessage(
          {
            type: "__physical-cross-screen-drop-release",
            releasedAt: timestamp,
          },
          "*",
        );
      }
    }, releasedAt);
    await expect
      .poll(async () =>
        Promise.all(
          [frame, destinationFrame].map((targetFrame) =>
            targetFrame.locator("body").evaluate(
              () =>
                (
                  window as typeof window & {
                    __crossScreenDropTrace?: { releasedAt: number | null };
                  }
                ).__crossScreenDropTrace?.releasedAt ?? null,
            ),
          ),
        ),
      )
      .toEqual([expect.any(Number), expect.any(Number)]);
    await expect.poll(() => crossSource.count(), { timeout: 5_000 }).toBe(0);
    await expect(crossTarget).toHaveCount(1, { timeout: 5_000 });
    await expect(movedTarget).toHaveCount(1, { timeout: 5_000 });
    await expect
      .poll(
        () =>
          destinationFrame
            .locator(
              '[data-agent-native-node-id="dest-flow-root"] > [data-agent-native-node-id]',
            )
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute("data-agent-native-node-id")),
            ),
        { timeout: 5_000 },
      )
      .toEqual(["dest-v1", "dest-v2", "v2", "dest-v3"]);
    await expect
      .poll(
        async () => {
          const sampleTimes = await Promise.all(
            [sourceBrowserFrame!, destinationBrowserFrame!].map((targetFrame) =>
              targetFrame.evaluate(() =>
                Math.max(
                  -1,
                  ...(
                    (
                      window as typeof window & {
                        __crossScreenDropTrace?: {
                          samples: CrossScreenDropSample[];
                        };
                      }
                    ).__crossScreenDropTrace?.samples ?? []
                  ).map((sample) => sample.at),
                ),
              ),
            ),
          );
          return sampleTimes.every((at) => at >= 3_000);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    const [sourceDropSamples, destinationDropSamples] = await Promise.all(
      [sourceBrowserFrame!, destinationBrowserFrame!].map((targetFrame) =>
        targetFrame.evaluate(
          () =>
            (
              window as typeof window & {
                __crossScreenDropTrace?: {
                  samples: CrossScreenDropSample[];
                };
              }
            ).__crossScreenDropTrace?.samples ?? [],
        ),
      ),
    );
    const destinationMutations = await destinationBrowserFrame!.evaluate(
      () =>
        (
          window as Window & {
            __crossScreenDropTrace?: { mutations: unknown[] };
          }
        ).__crossScreenDropTrace?.mutations ?? [],
    );
    const hostMessageTrace = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __physicalMessageTrace?: Array<{
              type?: string;
              at?: number;
              origin?: string;
            }>;
          }
        ).__physicalMessageTrace ?? [],
    );
    const iframeLifecycleTrace = await page.evaluate(
      () => (window as any).__physicalIframeLifecycle?.trace ?? [],
    );
    const settledLiveFrameState = await liveFrames.evaluateAll((iframes) =>
      iframes.map((iframe) => ({
        screenId: iframe.dataset.screenIframeId ?? null,
        sourceType: iframe.dataset.designSourceType ?? null,
        srcPath: iframe.getAttribute("src")
          ? new URL(iframe.getAttribute("src")!, location.href).pathname
          : null,
        hasSrcDoc: iframe.hasAttribute("srcdoc"),
      })),
    );
    const destinationRuntimeEvidence = await destinationBrowserFrame!.evaluate(
      () => ({
        trace:
          (
            window as Window & {
              __crossScreenDropTrace?: {
                instanceId: string;
                insertions: unknown[];
              };
            }
          ).__crossScreenDropTrace ?? null,
        url: location.href,
        v2Candidates: [...document.querySelectorAll("*")]
          .filter((element) => element.textContent?.trim() === "V2")
          .map((element) => ({
            tag: element.tagName,
            nodeId: element.getAttribute("data-agent-native-node-id"),
            sourceId: element.getAttribute("data-source-id"),
            parentId:
              element.parentElement?.getAttribute(
                "data-agent-native-node-id",
              ) ?? null,
            connected: element.isConnected,
          })),
        incomingMessages:
          (
            window as Window & {
              __incomingPreviewMessages?: Array<Record<string, unknown>>;
            }
          ).__incomingPreviewMessages?.slice(-30) ?? [],
      }),
    );
    page.off("framenavigated", onCrossFrameNavigated);
    const sourcePostReleaseSamples = sourceDropSamples.filter(
      (sample) => sample.at >= 0,
    );
    const destinationPostReleaseSamples = destinationDropSamples.filter(
      (sample) => sample.at >= 0,
    );
    const firstDestinationInsertIndex = destinationPostReleaseSamples.findIndex(
      (sample) => sample.present,
    );
    const firstDestinationInsert =
      firstDestinationInsertIndex >= 0
        ? destinationPostReleaseSamples[firstDestinationInsertIndex]
        : null;
    const destinationAfterInsertSamples =
      firstDestinationInsertIndex >= 0
        ? destinationPostReleaseSamples.slice(firstDestinationInsertIndex)
        : [];
    const initialDestinationPlacement = destinationAfterInsertSamples[0];
    const destinationBadSampleIndex = destinationAfterInsertSamples.findIndex(
      (sample) =>
        !sample.present ||
        !sample.visible ||
        sample.parentId !== "dest-flow-root" ||
        !initialDestinationPlacement ||
        sample.index !== initialDestinationPlacement.index ||
        Math.abs(sample.x - initialDestinationPlacement.x) > 0.5 ||
        Math.abs(sample.y - initialDestinationPlacement.y) > 0.5 ||
        Math.abs(sample.width - initialDestinationPlacement.width) > 0.5 ||
        Math.abs(sample.height - initialDestinationPlacement.height) > 0.5,
    );
    const destinationFailureEvidence =
      destinationBadSampleIndex < 0
        ? "destination stayed at its first inserted position"
        : JSON.stringify({
            before:
              destinationAfterInsertSamples[destinationBadSampleIndex - 1] ??
              null,
            firstInvalid:
              destinationAfterInsertSamples[destinationBadSampleIndex],
            after:
              destinationAfterInsertSamples[destinationBadSampleIndex + 1] ??
              null,
            laterValidCount: destinationAfterInsertSamples
              .slice(destinationBadSampleIndex + 1)
              .filter(
                (sample) =>
                  sample.present &&
                  sample.visible &&
                  sample.parentId === "dest-flow-root",
              ).length,
            firstPresent: firstDestinationInsert,
            presentParentIds: [
              ...new Set(
                destinationAfterInsertSamples
                  .filter((sample) => sample.present)
                  .map((sample) => sample.parentId),
              ),
            ],
            lastSample:
              destinationAfterInsertSamples[
                destinationAfterInsertSamples.length - 1
              ] ?? null,
            mutations: destinationMutations,
            sourceAfterRelease: {
              total: sourcePostReleaseSamples.length,
              present: sourcePostReleaseSamples.filter(
                (sample) => sample.present,
              ).length,
              visible: sourcePostReleaseSamples.filter(
                (sample) => sample.visible,
              ).length,
              first:
                sourcePostReleaseSamples.find((sample) => sample.present) ??
                null,
              last:
                sourcePostReleaseSamples[sourcePostReleaseSamples.length - 1] ??
                null,
              atOriginalLocation: sourcePostReleaseSamples.filter((sample) => {
                return (
                  sample.present &&
                  sample.parentId === crossSourceInitialLocation.parentId &&
                  sample.index === crossSourceInitialLocation.index &&
                  Math.abs(sample.x - crossSourceInitialLocation.x) < 1 &&
                  Math.abs(sample.y - crossSourceInitialLocation.y) < 1 &&
                  Math.abs(sample.width - crossSourceInitialLocation.width) <
                    1 &&
                  Math.abs(sample.height - crossSourceInitialLocation.height) <
                    1
                );
              }).length,
            },
          });
    const assertFullRafTrace = (
      samples: CrossScreenDropSample[],
      label: string,
    ) => {
      expect(
        samples.length,
        `${label} rAF trace was too sparse; last=${JSON.stringify(samples[samples.length - 1] ?? null)}`,
      ).toBeGreaterThan(60);
      expect(
        samples[samples.length - 1]?.at ?? -1,
        `${label} rAF trace ended before the 3s stability window; last=${JSON.stringify(samples[samples.length - 1] ?? null)}; runtimeReloads=${JSON.stringify(
          hostMessageTrace.filter(
            (message) => message.type === "agent-native:runtime-reloading",
          ),
        )}`,
      ).toBeGreaterThanOrEqual(3_000);
    };
    assertFullRafTrace(sourcePostReleaseSamples, "source");
    assertFullRafTrace(destinationPostReleaseSamples, "destination");
    const misplacedSourceSamples = sourcePostReleaseSamples.filter(
      (sample) =>
        sample.present &&
        sample.visible &&
        (sample.parentId !== crossSourceInitialLocation.parentId ||
          sample.index !== crossSourceInitialLocation.index ||
          Math.abs(sample.x - crossSourceInitialLocation.x) >= 1 ||
          Math.abs(sample.y - crossSourceInitialLocation.y) >= 1 ||
          Math.abs(sample.width - crossSourceInitialLocation.width) >= 1 ||
          Math.abs(sample.height - crossSourceInitialLocation.height) >= 1),
    );
    expect(
      misplacedSourceSamples,
      "the source moved to a drag-exit position before deletion; samples=" +
        JSON.stringify({
          firstVisible: sourcePostReleaseSamples.find(
            (sample) => sample.visible,
          ),
          misplacedCount: misplacedSourceSamples.length,
          last: sourcePostReleaseSamples[sourcePostReleaseSamples.length - 1],
          trace: await sourceBrowserFrame!.evaluate(() => {
            const trace = (
              window as Window & {
                __crossScreenDropTrace?: {
                  instanceId: string;
                  insertions: unknown[];
                  mutations: unknown[];
                  samples: CrossScreenDropSample[];
                };
              }
            ).__crossScreenDropTrace;
            return trace
              ? {
                  instanceId: trace.instanceId,
                  insertions: trace.insertions,
                  mutations: trace.mutations,
                  lastSamples: trace.samples.slice(-8),
                }
              : null;
          }),
          relevantMessages: hostMessageTrace.filter(
            (message) =>
              message.type === "agent-native:runtime-reloading" ||
              message.type === "runtime-structure-insert-applied" ||
              message.type === "runtime-structure-insert-rejected" ||
              message.type === "runtime-element-deleted" ||
              message.type === "visual-structure-ack",
          ),
          navigations: crossFrameNavigations,
          iframeLifecycle: iframeLifecycleTrace.slice(-20),
        }),
    ).toHaveLength(0);
    expect(
      sourcePostReleaseSamples[sourcePostReleaseSamples.length - 1],
      "the moved node remained in the source after the stable 3s window",
    ).toMatchObject({ present: false, visible: false });
    expect(
      firstDestinationInsert,
      "the inserted node never appeared in the destination within the 3s window",
    ).not.toBeNull();
    expect(
      destinationBadSampleIndex,
      "the moved node left its destination parent during the 3s stability window; " +
        destinationFailureEvidence +
        "; navigations=" +
        JSON.stringify(crossFrameNavigations) +
        "; iframe lifecycle=" +
        JSON.stringify(iframeLifecycleTrace) +
        "; runtime reloads=" +
        JSON.stringify(
          hostMessageTrace.filter(
            (message) =>
              message.type === "agent-native:runtime-reloading" ||
              message.type === "runtime-structure-insert-applied" ||
              message.type === "runtime-structure-insert-rejected" ||
              message.type === "runtime-structure-rollback-result" ||
              message.type === "runtime-element-deleted",
          ),
        ) +
        "; destination runtime=" +
        JSON.stringify(destinationRuntimeEvidence) +
        "; frames=" +
        JSON.stringify(settledLiveFrameState),
    ).toBe(-1);
    await expect(
      frame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await expect(
      frame.locator("script[data-agent-native-editor-chrome-bridge]"),
    ).toHaveAttribute("type", "module");
    await expandAllLayers(page);
    await installBridge(page);
    await page.evaluate(() => ((window as any).__bridge = []));
    const waitForAnySelection = async () => {
      const handle = await page.waitForFunction(
        () =>
          [...((window as any).__bridge ?? [])]
            .reverse()
            .find((message: any) => message.type === "element-select") ?? null,
        undefined,
        { timeout: 15_000 },
      );
      return await handle.jsonValue();
    };
    const waitForSelection = async (nodeId: string) => {
      const handle = await page.waitForFunction(
        (id) =>
          [...((window as any).__bridge ?? [])]
            .reverse()
            .find(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.selector?.includes(
                  `[data-agent-native-node-id="${id}"]`,
                ),
            ) ?? null,
        nodeId,
        { timeout: 15_000 },
      );
      return await handle.jsonValue();
    };
    const clickBox = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v1"]',
    );
    if (!clickBox) throw new Error("missing React selection geometry");
    await page.mouse.click(
      clickBox.x + clickBox.width / 2,
      clickBox.y + clickBox.height / 2,
    );
    const firstSelection = await waitForAnySelection();
    expect(firstSelection.payload.selector).toBeTruthy();
    expect(firstSelection.payload.sourceId).toBeTruthy();
    expect(firstSelection.payload.sourceId).toBe("v1");
    const otherBox = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v3"]',
    );
    if (!otherBox) throw new Error("missing sibling selection geometry");
    await page.mouse.click(
      otherBox.x + otherBox.width / 2,
      otherBox.y + otherBox.height / 2,
    );
    await waitForSelection("v3");
    await page.evaluate(() => ((window as any).__bridge = []));
    await page.keyboard.down(
      process.platform === "darwin" ? "Meta" : "Control",
    );
    try {
      await page.mouse.click(
        clickBox.x + clickBox.width / 2,
        clickBox.y + clickBox.height / 2,
      );
    } finally {
      await page.keyboard.up(
        process.platform === "darwin" ? "Meta" : "Control",
      );
    }
    const selected = await waitForSelection("v1").catch(async () => {
      const frameTrace = await frame.locator("body").evaluate(() => ({
        input:
          (window as Window & { __physicalInputTrace?: unknown[] })
            .__physicalInputTrace ?? [],
        target: document
          .querySelector('[data-agent-native-node-id="v1"]')
          ?.outerHTML.slice(0, 160),
        bridgeReady: document.documentElement.getAttribute(
          "data-agent-native-editor-chrome-ready",
        ),
      }));
      const hostTrace = await page.evaluate(() => ({
        messages: ((window as any).__bridge ?? []).slice(-12),
        input: (window as Window & { __hostInputTrace?: unknown[] })
          .__hostInputTrace,
      }));
      throw new Error(
        `Cmd-click did not select v1; frame=${JSON.stringify(frameTrace)}; host=${JSON.stringify(hostTrace)}`,
      );
    });
    expect(selected.payload.sourceId).toBe("v1");
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]').filter({
        hasText: "V1",
      }),
    ).toBeVisible();

    const freeform = frame.locator('[data-agent-native-node-id="freeform"]');
    const freeformBefore = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="freeform"]',
    );
    if (!freeformBefore) throw new Error("missing freeform geometry");
    await page.mouse.move(
      freeformBefore.x + freeformBefore.width / 2,
      freeformBefore.y + freeformBefore.height / 2,
    );
    await expect
      .poll(() =>
        frame
          .locator('[data-agent-native-edit-overlay="highlight"]')
          .evaluate((element) => getComputedStyle(element).display),
      )
      .toBe("block");
    await page.mouse.click(
      freeformBefore.x + freeformBefore.width / 2,
      freeformBefore.y + freeformBefore.height / 2,
    );
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Freeform");
    const freeformSelected = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="freeform"]',
    );
    if (!freeformSelected)
      throw new Error("missing selected freeform geometry");
    await page.mouse.move(
      freeformSelected.x + freeformSelected.width / 2,
      freeformSelected.y + freeformSelected.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      freeformSelected.x + freeformSelected.width / 2 + 60,
      freeformSelected.y + freeformSelected.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await physicalBox(
              frame,
              sourceFrameIndex,
              '[data-agent-native-node-id="freeform"]',
            )
          )?.x ?? -1,
      )
      .toBeGreaterThan(freeformSelected.x + 50);
    const selectionHandle = frame.locator(
      '[data-agent-native-edit-overlay="selection"] [data-agent-native-edit-handle="se"]',
    );
    await expect(selectionHandle).toBeVisible();
    const handleBefore = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-edit-overlay="selection"] [data-agent-native-edit-handle="se"]',
    );
    const freeformAfterMove = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="freeform"]',
    );
    if (!handleBefore || !freeformAfterMove)
      throw new Error("missing resize geometry");
    await page.mouse.move(
      handleBefore.x + handleBefore.width / 2,
      handleBefore.y + handleBefore.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBefore.x + handleBefore.width / 2 + 24,
      handleBefore.y + handleBefore.height / 2 + 12,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await physicalBox(
              frame,
              sourceFrameIndex,
              '[data-agent-native-node-id="freeform"]',
            )
          )?.width ?? -1,
      )
      .toBeGreaterThan(Math.round(freeformAfterMove.width));
    const order = (previewFrame = frame) =>
      previewFrame
        .locator(
          '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
        )
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-agent-native-node-id")),
        );
    const sourceBox = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v1"]',
    );
    const targetBox = await physicalBox(
      frame,
      sourceFrameIndex,
      '[data-agent-native-node-id="v3"]',
    );
    if (!sourceBox || !targetBox) throw new Error("missing React geometry");
    const sourceFrameUrl = await frame
      .locator("body")
      .evaluate(() => window.location.href);
    const sourceFrame = page
      .frames()
      .find((candidate) =>
        candidate.url().includes(new URL(sourceFrameUrl).host),
      );
    if (!sourceFrame) throw new Error("could not identify the source iframe");
    const originalLocation = await frame
      .locator('[data-agent-native-node-id="v1"]')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        return {
          parentId: parent?.getAttribute("data-agent-native-node-id") ?? null,
          index: parent ? [...parent.children].indexOf(element) : -1,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    await frame.locator("body").evaluate((_, nodeId) => {
      const trace = {
        samples: [] as Array<{
          at: number;
          parentId: string | null;
          index: number;
          x: number;
          y: number;
          width: number;
          height: number;
        }>,
        stopAt: performance.now() + 60_000,
      };
      (
        window as typeof window & { __visualDropTrace?: typeof trace }
      ).__visualDropTrace = trace;
      const sample = () => {
        const element = document.querySelector(
          `[data-agent-native-node-id="${nodeId}"]`,
        );
        const parent = element?.parentElement;
        if (element && parent) {
          const rect = element.getBoundingClientRect();
          trace.samples.push({
            at: performance.now(),
            parentId: parent.getAttribute("data-agent-native-node-id"),
            index: [...parent.children].indexOf(element),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
        }
        if (performance.now() < trace.stopAt) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, "v1");
    const sourceFrameNavigations: number[] = [];
    const onFrameNavigated = (navigated: typeof sourceFrame) => {
      if (navigated === sourceFrame) sourceFrameNavigations.push(Date.now());
    };
    page.on("framenavigated", onFrameNavigated);
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
    const guide = await frame
      .locator("[data-agent-native-insertion-guide]")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            width: r.width,
            height: r.height,
          };
        }),
      );
    expect(
      guide.some((x) => x.display !== "none" && x.width > 0 && x.height > 0),
    ).toBe(true);
    await page.mouse.up();
    const releaseAt = await frame
      .locator("body")
      .evaluate(() => performance.now());
    const releaseWallClock = Date.now();
    await expect
      .poll(
        () =>
          frame.locator("body").evaluate(
            () =>
              (
                window as typeof window & {
                  __visualDropTrace?: { samples: Array<{ at: number }> };
                }
              ).__visualDropTrace?.samples.slice(-1)[0]?.at ?? -1,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(releaseAt + 3_000);
    const dropTrace = await frame.locator("body").evaluate(
      () =>
        (
          window as typeof window & {
            __visualDropTrace?: {
              samples: Array<{
                at: number;
                parentId: string | null;
                index: number;
                x: number;
                y: number;
                width: number;
                height: number;
              }>;
            };
          }
        ).__visualDropTrace?.samples ?? [],
    );
    const postReleaseSamples = dropTrace.filter(
      (sample) => sample.at >= releaseAt,
    );
    const isOriginalLocation = (sample: (typeof dropTrace)[number]) =>
      sample.parentId === originalLocation.parentId &&
      sample.index === originalLocation.index &&
      Math.abs(sample.x - originalLocation.x) < 1 &&
      Math.abs(sample.y - originalLocation.y) < 1 &&
      Math.abs(sample.width - originalLocation.width) < 1 &&
      Math.abs(sample.height - originalLocation.height) < 1;
    const firstMovedSample = postReleaseSamples.find(
      (sample) => !isOriginalLocation(sample),
    );
    expect(
      firstMovedSample,
      "rAF trace never observed the dropped position",
    ).toBeTruthy();
    const returnedToOriginal = postReleaseSamples.some(
      (sample) =>
        sample.at > firstMovedSample!.at && isOriginalLocation(sample),
    );
    page.off("framenavigated", onFrameNavigated);
    expect(
      sourceFrameNavigations.filter(
        (at) => at >= releaseWallClock && at < releaseWallClock + 3_000,
      ),
      "the source live frame reloaded during the drop stability window",
    ).toEqual([]);
    expect(
      returnedToOriginal,
      "the source element visibly returned to its pre-drop location after moving",
    ).toBe(false);
    await expect.poll(order).toEqual(["v3", "v1"]);
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const prompt = await call("get-visual-edit-prompt");
    expect((prompt as { result: { prompt: string } }).result.prompt).toContain(
      '"operation": "move"',
    );
    expect((prompt as { result: { prompt: string } }).result.prompt).toContain(
      "semantic-source-change",
    );
    const appPath = path.join(rootPath, "src/App.tsx");
    const before = fs.readFileSync(appPath, "utf8");
    const after = before
      .replace(
        'const initialCards = [{ id: "v1", label: "V1" }, { id: "v2", label: "V2" }, { id: "v3", label: "V3" }];',
        'const initialCards = [{ id: "v2", label: "V2" }, { id: "v3", label: "V3" }, { id: "v1", label: "V1 updated" }];',
      )
      .replace(">Go to next route</button>", ">Go to updated route</button>");
    if (after === before)
      throw new Error("React source edit did not match App.tsx");
    fs.writeFileSync(appPath, after);
    await expect(
      frame.getByRole("button", { name: "Go to updated route" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    await installBridge(page);
    const reloadedCandidates = liveFrameIds.map((screenId) =>
      page.frameLocator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      ),
    );
    await expect
      .poll(
        async () =>
          (
            await Promise.all(
              reloadedCandidates.map((candidate) =>
                candidate
                  .locator('[data-agent-native-node-id="flow-root"]')
                  .count(),
              ),
            )
          ).findIndex((count) => count > 0),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(0);
    const reloadedIndex =
      (await reloadedCandidates[0]
        .locator('[data-agent-native-node-id="flow-root"]')
        .count()) > 0
        ? 0
        : 1;
    const reloaded = reloadedCandidates[reloadedIndex];
    const reloadedIframe = iframeForScreen(liveFrameIds[reloadedIndex]!);
    await reloadedIframe.evaluate((iframe) =>
      iframe.setAttribute("data-probe-marker", "keep"),
    );
    await expect(reloaded.getByText("V1 updated", { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect
      .poll(() => order(reloaded), { timeout: 15_000 })
      .toEqual(["v2", "v3", "v1"]);
    await expect
      .poll(
        () =>
          reloadedIframe.evaluate(
            (iframe) => getComputedStyle(iframe).pointerEvents,
          ),
        { timeout: 15_000 },
      )
      .toBe("auto");
    const reloadedFrame = await reloadedIframe
      .elementHandle()
      .then((iframe) => iframe?.contentFrame());
    if (!reloadedFrame) throw new Error("missing reloaded React frame");
    await reloadedFrame.evaluate(() => {
      window.history.pushState({}, "", "/next");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(reloaded.locator("[data-route-label]")).toHaveText(
      "Next route",
    );
    await expect(reloadedIframe).toHaveAttribute("data-probe-marker", "keep");
    await expect
      .poll(
        () =>
          reloadedFrame.evaluate(
            () =>
              typeof (
                window as typeof window & {
                  __forceReactDocumentRemount?: () => void;
                }
              ).__forceReactDocumentRemount,
          ),
        { timeout: 15_000 },
      )
      .toBe("function");
    await reloadedFrame.evaluate(() => {
      const remount = (
        window as typeof window & {
          __forceReactDocumentRemount?: () => void;
        }
      ).__forceReactDocumentRemount;
      if (!remount) throw new Error("missing React document remount hook");
      remount();
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await reloaded.locator("body").evaluate(() => {
      document
        .querySelector("[data-agent-native-editor-chrome-host]")
        ?.remove();
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await reloaded.locator("body").evaluate(() => {
      const bridgeScript = document.querySelector(
        "script[data-agent-native-editor-chrome-bridge]",
      );
      if (!bridgeScript) throw new Error("missing editor bridge script");
      document.head.appendChild(bridgeScript.cloneNode(true));
    });
    await reloaded.locator("body").evaluate(() => {
      const bridgeScript = document.querySelector(
        "script[data-agent-native-editor-chrome-bridge]",
      );
      if (!bridgeScript?.textContent)
        throw new Error("missing editor bridge source");
      const ownerSource = bridgeScript.textContent;
      const viewerSource = ownerSource.replace(
        "var readOnly = false;",
        "var readOnly = true;",
      );
      if (viewerSource === ownerSource)
        throw new Error("bridge readOnly marker was not found");
      for (const source of [viewerSource, ownerSource]) {
        const script = document.createElement("script");
        script.type = "module";
        script.textContent = source;
        document.head.appendChild(script);
      }
    });
    await expect
      .poll(
        () =>
          reloaded
            .locator("[data-agent-native-editor-chrome-host]")
            .evaluate((host) => getComputedStyle(host).zIndex),
        { timeout: 5_000 },
      )
      .toBe("2147483647");
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await page.evaluate(() => ((window as any).__bridge = []));
    const healedTarget = reloaded.locator('[data-agent-native-node-id="v1"]');
    const healedBox = await physicalFrameElementBox(
      reloaded,
      reloadedIframe,
      '[data-agent-native-node-id="v1"]',
    );
    if (!healedBox)
      throw new Error("missing post-hydration selection geometry");
    const differentSelectionBox = await physicalFrameElementBox(
      reloaded,
      reloadedIframe,
      '[data-agent-native-node-id="v2"]',
    );
    if (!differentSelectionBox)
      throw new Error("missing sibling selection geometry after hydration");
    await page.evaluate(() => ((window as any).__bridge = []));
    await page.mouse.click(
      differentSelectionBox.x + differentSelectionBox.width / 2,
      differentSelectionBox.y + differentSelectionBox.height / 2,
    );
    expect((await waitForSelection("v2")).payload.sourceId).toBe("v2");
    await page.evaluate(() => ((window as any).__bridge = []));
    const healedModifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(healedModifier);
    try {
      await page.mouse.click(
        healedBox.x + healedBox.width / 2,
        healedBox.y + healedBox.height / 2,
      );
    } finally {
      await page.keyboard.up(healedModifier);
    }
    const healedSelection = await waitForSelection("v1").catch(async () => {
      const frameTrace = await reloaded.locator("body").evaluate(() => {
        const target = document.querySelector(
          '[data-agent-native-node-id="v1"]',
        );
        const rect = target?.getBoundingClientRect();
        const hit = rect
          ? document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            )
          : null;
        return {
          target: target?.outerHTML.slice(0, 200),
          rect: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null,
          hit: hit?.outerHTML.slice(0, 200),
          overlays: Array.from(
            document.querySelectorAll("[data-agent-native-edit-overlay]"),
          ).map((element) => ({
            kind: element.getAttribute("data-agent-native-edit-overlay"),
            display: getComputedStyle(element).display,
            pointerEvents: getComputedStyle(element).pointerEvents,
          })),
          input:
            (window as Window & { __physicalInputTrace?: unknown[] })
              .__physicalInputTrace ?? [],
        };
      });
      const hostTrace = await page.evaluate(() => ({
        messages: ((window as any).__bridge ?? []).slice(-20),
        selected: document.querySelector(
          '[role="treeitem"][aria-selected="true"]',
        )?.textContent,
      }));
      throw new Error(
        `post-remount click did not select v1; frame=${JSON.stringify(frameTrace)}; host=${JSON.stringify(hostTrace)}`,
      );
    });
    expect(healedSelection.payload.sourceId).toBe("v1");
    expect(
      await page.evaluate(
        () =>
          ((window as any).__bridge ?? []).filter(
            (message: any) =>
              message.type === "element-select" &&
              message.intent?.source === "pointer",
          ).length,
      ),
    ).toBe(1);

    await reloaded.locator("body").evaluate(() => {
      window.setTimeout(() => {
        const currentDocumentElement = document.documentElement;
        const replacement = currentDocumentElement.cloneNode(
          true,
        ) as HTMLElement;
        replacement
          .querySelector("[data-agent-native-editor-chrome-host]")
          ?.remove();
        currentDocumentElement.replaceWith(replacement);
      }, 0);
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await page.evaluate(() => ((window as any).__bridge = []));
    const rootReplacementTarget = reloaded.locator(
      '[data-agent-native-node-id="v2"]',
    );
    const rootReplacementBox = await physicalFrameElementBox(
      reloaded,
      reloadedIframe,
      '[data-agent-native-node-id="v2"]',
    );
    if (!rootReplacementBox)
      throw new Error("missing document-root replacement geometry");
    await page.keyboard.down(healedModifier);
    try {
      await page.mouse.click(
        rootReplacementBox.x + rootReplacementBox.width / 2,
        rootReplacementBox.y + rootReplacementBox.height / 2,
      );
    } finally {
      await page.keyboard.up(healedModifier);
    }
    const rootReplacementSelection = await waitForSelection("v2");
    expect(rootReplacementSelection.payload.sourceId).toBe("v2");

    const escapeTargetSelector = '[data-agent-native-node-id="v2"]';
    const escapeStart = await physicalFrameElementBox(
      reloaded,
      reloadedIframe,
      escapeTargetSelector,
    );
    if (!escapeStart) throw new Error("missing Escape drag geometry");
    const escapeOrigin = await reloaded
      .locator(escapeTargetSelector)
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          parent: el.parentElement?.getAttribute("data-agent-native-node-id"),
          index: el.parentElement
            ? [...el.parentElement.children].indexOf(el)
            : -1,
          x: rect.x,
          y: rect.y,
        };
      });
    await page.mouse.move(
      escapeStart.x + escapeStart.width / 2,
      escapeStart.y + escapeStart.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      escapeStart.x + escapeStart.width / 2,
      escapeStart.y + escapeStart.height / 2 + 24,
      { steps: 8 },
    );
    await expect
      .poll(() =>
        physicalFrameElementBox(reloaded, reloadedIframe, escapeTargetSelector),
      )
      .not.toEqual(escapeStart);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect
      .poll(() =>
        reloaded.locator(escapeTargetSelector).evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            parent: el.parentElement?.getAttribute("data-agent-native-node-id"),
            index: el.parentElement
              ? [...el.parentElement.children].indexOf(el)
              : -1,
            x: rect.x,
            y: rect.y,
          };
        }),
      )
      .toEqual(escapeOrigin);
    const churnNode = await reloaded.locator("body").evaluate(() => {
      const node = document.createElement("span");
      node.dataset.snapshotChurnProbe = "";
      document.body.append(node);
      let count = 0;
      window.setInterval(() => {
        node.textContent = String(++count);
      }, 250);
      return node.dataset.snapshotChurnProbe;
    });
    expect(churnNode).toBe("");
    await expect
      .poll(
        async () =>
          Number(
            await reloaded.locator("[data-snapshot-churn-probe]").textContent(),
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(8);
    expect(collaborationSnapshotRequests).toEqual([]);
    expect(componentDetailsRequests).toEqual([]);
  } finally {
    await bridge?.server.close();
    vite?.kill();
    if (opened && post)
      await post("delete-design", { id: opened.designId }).catch(
        () => undefined,
      );
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
