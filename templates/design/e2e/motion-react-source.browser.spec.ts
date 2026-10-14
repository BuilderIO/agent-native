import { createHash } from "node:crypto";
import fs from "node:fs";
import http, { type Server } from "node:http";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import { createServer, type ViteDevServer } from "vite";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_CODE_METADATA_VERSION } from "../shared/motion-code";
import { e2eBaseURL } from "./base-url";
import { appPath, enableLab, gotoEditor, selectByText } from "./helpers";

const baseURL = e2eBaseURL();
const sourcePath = "src/App.tsx";
const nodeId = "motion-target";
let rootPath = "";
let designId = "";
let connectionId = "";
let reactDevServerUrl = "";
let viteServer: ViteDevServer | null = null;
let bridge: DesignConnectBridge | null = null;
let viteChangedFiles: string[] = [];
let restoreMotionLab: (() => Promise<void>) | null = null;

function reactSource(): string {
  return `import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ marginLeft: "80px", marginTop: "80px" }}>
      <button data-agent-native-node-id="${nodeId}" id="${nodeId}">
        Motion target
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`;
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${actionName}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, string | readonly string[]>,
): Promise<any> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    const isArray = Array.isArray(value);
    for (const item of isArray ? value : [value]) {
      params.append(isArray ? `${key}[]` : key, item);
    }
  }
  const response = await request.get(
    `${baseURL}/_agent-native/actions/${actionName}?${params}`,
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test.describe.serial("React Motion source browser writeback", () => {
  test.beforeEach(async ({ page }) => {
    restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
  });

  test.afterEach(async () => {
    await restoreMotionLab?.();
    restoreMotionLab = null;
  });

  test.beforeAll(async ({ request }) => {
    const artifactRoot = path.resolve(import.meta.dirname, "..", ".tmp");
    fs.mkdirSync(artifactRoot, { recursive: true });
    rootPath = fs.mkdtempSync(path.join(artifactRoot, "motion-react-source-"));
    fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, "package.json"),
      '{"type":"module"}\n',
    );
    fs.symlinkSync(
      path.resolve(import.meta.dirname, "../../../node_modules"),
      path.join(rootPath, "node_modules"),
      "dir",
    );
    fs.writeFileSync(
      path.join(rootPath, "index.html"),
      '<div id="root"></div><script type="module" src="/src/App.tsx"></script>',
    );
    fs.writeFileSync(path.join(rootPath, sourcePath), reactSource());

    const pluginModule = (await tsImport(
      path.resolve(
        import.meta.dirname,
        "../../../packages/core/src/vite/motion-source-provenance-plugin.ts",
      ),
      import.meta.url,
    )) as {
      motionSourceProvenancePlugin: () => import("vite").Plugin;
    };
    const { motionSourceProvenancePlugin } = pluginModule;
    viteServer = await createServer({
      root: rootPath,
      plugins: [motionSourceProvenancePlugin()],
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      resolve: {
        alias: {
          react: path.resolve(import.meta.dirname, "../node_modules/react"),
          "react-dom/client": path.resolve(
            import.meta.dirname,
            "../node_modules/react-dom/client",
          ),
        },
      },
    });
    await viteServer.listen();
    viteChangedFiles = [];
    viteServer.watcher.on("change", (changedPath) => {
      viteChangedFiles.push(changedPath);
    });
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("React fixture Vite server did not start");
    }
    const reactDevServer = new URL("http://127.0.0.1");
    reactDevServer.port = String(address.port);
    reactDevServerUrl = reactDevServer.origin;

    const bridgeProbe = http.createServer();
    const bridgePort = await listen(bridgeProbe);
    await closeServer(bridgeProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: reactDevServerUrl,
      port: bridgePort,
    });
    const reactManifest = {
      ...manifest,
      routes: manifest.routes.map((route) =>
        route.path === "/" ? { ...route, sourceFile: sourcePath } : route,
      ),
    };
    const opened = await postAction(request, "open-visual-edit", {
      title: "React Motion source proof",
      devServerUrl: reactManifest.devServerUrl,
      bridgeUrl: reactManifest.bridgeUrl,
      rootPath,
      routeManifest: reactManifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: false,
    });
    designId = opened.designId;
    connectionId = opened.connectionId;
    bridge = await startDesignConnectBridge(reactManifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
  });

  test.afterAll(async ({ request }) => {
    try {
      if (designId)
        await postAction(request, "delete-design", { id: designId });
    } finally {
      await closeServer(bridge?.server ?? null);
      await viteServer?.close();
      if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
      bridge = null;
      viteServer = null;
    }
  });

  test("writes React Motion to JSX, reads it back, and renders it after reload", async ({
    page,
    request,
  }) => {
    const opened = await postAction(request, "add-localhost-screens", {
      connectionId,
      designId,
      paths: ["/"],
    });
    const screenId = opened.screens?.[0]?.id;
    if (!screenId) throw new Error("React Motion screen was not registered");

    await page.goto(appPath(`/design/${designId}?editorView=overview`), {
      waitUntil: "domcontentloaded",
    });
    const iframe = page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    );
    await expect(iframe).toBeVisible();
    let frame = iframe.contentFrame();
    const target = frame.locator(`#${nodeId}`);
    await expect(target).toHaveText("Motion target");

    const initialSourceHash = await target.getAttribute(
      "data-agent-native-motion-source-hash",
    );
    expect(initialSourceHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(target).toHaveAttribute(
      "data-agent-native-motion-source-file",
      sourcePath,
    );
    expect(initialSourceHash).toBe(
      createHash("sha256")
        .update(fs.readFileSync(path.join(rootPath, sourcePath), "utf8"))
        .digest("hex"),
    );

    await postAction(request, "grant-localhost-write-consent", {
      designId,
      connectionId,
    });
    const expectedTrack = {
      targetNodeId: nodeId,
      property: "translate",
      keyframes: [
        { t: 0, value: "0px 0px", ease: "linear" },
        { t: 1, value: "24px 0px", ease: "linear" },
      ],
    };
    const textDocument = {
      version: 1,
      animations: [
        {
          targetNodeId: nodeId,
          unit: "character",
          direction: "forward",
          staggerMs: 30,
          property: "opacity",
          durationMs: 320,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    const saved = await postAction(request, "apply-motion-edit", {
      designId,
      fileId: screenId,
      sourceRef: screenId,
      localSource: {
        connectionId,
        modulePath: sourcePath,
        moduleVersionHash: initialSourceHash,
        renderedNodeIds: [nodeId],
      },
      tracks: [expectedTrack],
      textDocument,
      durationMs: 1000,
      playbackMode: "once",
      defaultEase: "linear",
    });
    expect(saved).toMatchObject({
      persisted: true,
      sourceType: "localhost",
      sourcePatched: true,
      filePath: sourcePath,
    });

    const updatedSource = fs.readFileSync(
      path.join(rootPath, sourcePath),
      "utf8",
    );
    expect(updatedSource).toContain("data-agent-native-motion");
    expect(updatedSource).toContain(
      `agent-native-motion-source:v${MOTION_CODE_METADATA_VERSION}`,
    );
    expect(updatedSource).not.toBe(reactSource());
    await expect
      .poll(() => viteChangedFiles)
      .toContain(path.join(rootPath, sourcePath));

    const directSourceHash = createHash("sha256")
      .update(updatedSource)
      .digest("hex");
    const sourceCapability = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
      targetNodeIds: [nodeId],
      previewModulePath: sourcePath,
      previewModuleVersionHash: directSourceHash,
    });
    expect(sourceCapability.sourceWriteCapability).toMatchObject({
      status: "supported",
      modulePath: sourcePath,
      moduleVersionHash: directSourceHash,
      targetNodeIds: [nodeId],
    });
    const roundTrip = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
    });
    expect(roundTrip.timelines).toHaveLength(1);
    expect(roundTrip.timelines[0]).toMatchObject({
      filePath: sourcePath,
      durationMs: 1000,
      playbackMode: "once",
      defaultEase: "linear",
      tracks: [expectedTrack],
      textDocument,
      sourceVersionHash: directSourceHash,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    frame = iframe.contentFrame();
    const reloadedTarget = frame.locator(`#${nodeId}`);
    await expect(reloadedTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      directSourceHash,
    );

    await gotoEditor(page, designId);
    await selectByText(page, "Motion target", { screenId });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add animation", exact: true }),
    ).toBeEnabled();
    const firstTextKeyframeValue = page.getByRole("textbox", {
      name: "Keyframe value 1.1",
      exact: true,
    });
    await expect(firstTextKeyframeValue).toHaveValue("0");
    const textEditSave = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await firstTextKeyframeValue.fill("0.25");
    await expect(firstTextKeyframeValue).toHaveValue("0.25");
    const textEditResponse = await textEditSave;
    expect(textEditResponse.ok(), await textEditResponse.text()).toBe(true);
    await expect
      .poll(() =>
        getAction(request, "get-motion-timeline", {
          designId,
          sourceRef: screenId,
        }),
      )
      .toMatchObject({
        timelines: [
          {
            textDocument: {
              animations: [
                {
                  targetNodeId: nodeId,
                  keyframes: [{ value: "0.25" }, { value: "1" }],
                },
              ],
            },
          },
        ],
      });
    const editorUpdatedSource = fs.readFileSync(
      path.join(rootPath, sourcePath),
      "utf8",
    );
    expect(editorUpdatedSource).not.toBe(updatedSource);
    const editorUpdatedSourceHash = createHash("sha256")
      .update(editorUpdatedSource)
      .digest("hex");

    // Design freezes page animations while editing. Visit the same React host
    // directly to verify the saved CSS runs in its normal browser runtime.
    await page.goto(reactDevServerUrl, { waitUntil: "load" });
    const renderedTarget = page.locator(`#${nodeId}`);
    await expect(renderedTarget).toHaveText("Motion target");
    await expect(renderedTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      editorUpdatedSourceHash,
    );
    await expect(
      page.locator("style[data-agent-native-motion]"),
    ).toHaveAttribute("data-agent-native-motion", "true");
    await expect
      .poll(() =>
        renderedTarget.evaluate((element) => element.getAnimations().length),
      )
      .toBeGreaterThan(0);
    const renderedAtQuarterTime = await renderedTarget.evaluate((element) => {
      const animation = element.getAnimations()[0];
      if (!animation) throw new Error("React Motion CSS animation is missing");
      animation.pause();
      animation.currentTime = 250;
      return getComputedStyle(element).translate;
    });
    expect(renderedAtQuarterTime).toBe("6px");
  });
});
