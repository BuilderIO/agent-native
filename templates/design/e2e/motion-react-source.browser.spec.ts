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
let screenId = "";
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

  test("writes React Motion to JSX and rehydrates it in the editor after reload", async ({
    page,
    request,
  }) => {
    const opened = await postAction(request, "add-localhost-screens", {
      connectionId,
      designId,
      paths: ["/"],
    });
    screenId = opened.screens?.[0]?.id;
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
    const expectedTracks = [
      {
        targetNodeId: nodeId,
        property: "opacity",
        keyframes: [
          { t: 0, value: "1", ease: "linear" },
          { t: 1, value: "0.8", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "rotate",
        keyframes: [
          { t: 0, value: "0deg", ease: "linear" },
          { t: 1, value: "12deg", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "scale",
        keyframes: [
          { t: 0, value: "1", ease: "linear" },
          { t: 1, value: "1.2", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "translate",
        keyframes: [
          { t: 0, value: "0px 0px", ease: "linear" },
          { t: 1, value: "24px 0px", ease: "linear" },
        ],
      },
    ];
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
        timelineVersionHash: initialSourceHash,
        renderedNodeIds: [nodeId],
      },
      tracks: expectedTracks,
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
      tracks: expectedTracks,
      textDocument,
      sourceVersionHash: directSourceHash,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedFrame = page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame();
    const reloadedTarget = reloadedFrame.locator(`#${nodeId}`);
    await expect(reloadedTarget).toBeVisible({ timeout: 30_000 });
    await expect(reloadedTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      directSourceHash,
      { timeout: 30_000 },
    );
    await expect(
      reloadedFrame.locator("style[data-agent-native-motion]"),
    ).toHaveAttribute("data-agent-native-motion", "true");
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
    const renderedAtQuarterTime = await renderedTarget.evaluate(
      async (element) => {
        const animations = element.getAnimations();
        const properties = ["opacity", "rotate", "scale", "translate"];
        const matchedAnimations = properties.map((property) => {
          const animation = animations.find((candidate) =>
            (candidate.effect as KeyframeEffect | null)
              ?.getKeyframes()
              .some((keyframe) => property in keyframe),
          );
          if (!animation)
            throw new Error(`React ${property} animation is missing`);
          animation.pause();
          return animation;
        });
        await Promise.all(
          matchedAnimations.map((animation) => animation.ready),
        );
        for (const animation of matchedAnimations) animation.currentTime = 250;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const values: Record<string, string> = {};
        for (const property of properties) {
          values[property] =
            getComputedStyle(element).getPropertyValue(property);
        }
        return values;
      },
    );
    expect(renderedAtQuarterTime).toEqual({
      opacity: "0.95",
      rotate: "3deg",
      scale: "1.05",
      translate: "6px",
    });
  });

  test("rehydrates the open Motion editor after a direct JSX source edit", async ({
    page,
    request,
  }) => {
    if (!screenId) throw new Error("React Motion screen is not registered");

    await gotoEditor(page, designId);
    await selectByText(page, "Motion target", { screenId });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    const firstTextKeyframeValue = page.getByRole("textbox", {
      name: "Keyframe value 1.1",
      exact: true,
    });
    await expect(firstTextKeyframeValue).toHaveValue("0.25");

    const sourceFilePath = path.join(rootPath, sourcePath);
    const before = fs.readFileSync(sourceFilePath, "utf8");
    const after = before.replace('"value":"0.25"', '"value":"0.4"');
    expect(after).not.toBe(before);
    fs.writeFileSync(sourceFilePath, after);
    const nextHash = createHash("sha256").update(after).digest("hex");
    const iframe = page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    );
    const frame = iframe.contentFrame();
    await expect(frame.locator(`#${nodeId}`)).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      nextHash,
    );
    await expect(firstTextKeyframeValue).toHaveValue("0.4", {
      timeout: 20_000,
    });

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
            sourceVersionHash: nextHash,
            textDocument: {
              animations: [
                {
                  targetNodeId: nodeId,
                  keyframes: [{ value: "0.4" }, { value: "1" }],
                },
              ],
            },
          },
        ],
      });
    expect(fs.readFileSync(sourceFilePath, "utf8")).toContain('"value":"0.4"');

    const cssEdited = after
      .replace("opacity: 0.8;", "opacity: 0.6;")
      .replace("rotate: 12deg;", "rotate: 24deg;")
      .replace("scale: 1.2;", "scale: 1.4;")
      .replace("translate: 24px 0px;", "translate: 36px 0px;")
      .replace(
        "animation-duration: 1s, 1s, 1s, 1s;",
        "animation-duration: 1.2s, 1.2s, 1.2s, 1.2s;",
      );
    expect(cssEdited).not.toBe(after);
    fs.writeFileSync(sourceFilePath, cssEdited);
    const cssEditedHash = createHash("sha256").update(cssEdited).digest("hex");
    await expect(frame.locator(`#${nodeId}`)).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      cssEditedHash,
      { timeout: 20_000 },
    );

    const expectedDirectTracks = [
      {
        targetNodeId: nodeId,
        property: "opacity",
        keyframes: [
          { t: 0, value: "1", ease: "linear" },
          { t: 1, value: "0.6", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "rotate",
        keyframes: [
          { t: 0, value: "0deg", ease: "linear" },
          { t: 1, value: "24deg", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "scale",
        keyframes: [
          { t: 0, value: "1", ease: "linear" },
          { t: 1, value: "1.4", ease: "linear" },
        ],
      },
      {
        targetNodeId: nodeId,
        property: "translate",
        keyframes: [
          { t: 0, value: "0px 0px", ease: "linear" },
          { t: 1, value: "36px 0px", ease: "linear" },
        ],
      },
    ];
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
            sourceVersionHash: cssEditedHash,
            durationMs: 1200,
            tracks: expectedDirectTracks,
          },
        ],
      });

    const durationInput = page.getByRole("textbox", {
      name: "Duration",
      exact: true,
    });
    await expect(durationInput).toHaveValue("1200");
    const motionCodeSave = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await durationInput.fill("1300");
    await durationInput.press("Enter");
    const savedResponse = await motionCodeSave;
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    await expect
      .poll(() => fs.readFileSync(sourceFilePath, "utf8"))
      .not.toBe(cssEdited);
    const savedSource = fs.readFileSync(sourceFilePath, "utf8");
    const savedSourceHash = createHash("sha256")
      .update(savedSource)
      .digest("hex");
    expect(savedSource).toContain("opacity: 0.6;");
    expect(savedSource).toContain("rotate: 24deg;");
    expect(savedSource).toContain("scale: 1.4;");
    expect(savedSource).toContain("translate: 36px 0px;");
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
            sourceVersionHash: savedSourceHash,
            durationMs: 1300,
            tracks: expectedDirectTracks,
          },
        ],
      });

    await page.goto(reactDevServerUrl, { waitUntil: "load" });
    const browserTarget = page.locator(`#${nodeId}`);
    await expect(browserTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      savedSourceHash,
    );
    const renderedAtHalfTime = await browserTarget.evaluate(async (element) => {
      const animations = element.getAnimations();
      const properties = ["opacity", "rotate", "scale", "translate"];
      const matchedAnimations = properties.map((property) => {
        const animation = animations.find((candidate) =>
          (candidate.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((keyframe) => property in keyframe),
        );
        if (!animation)
          throw new Error(`React ${property} animation is missing`);
        animation.pause();
        return animation;
      });
      await Promise.all(matchedAnimations.map((animation) => animation.ready));
      for (const animation of matchedAnimations) animation.currentTime = 600;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const values: Record<string, string> = {};
      for (const property of properties) {
        values[property] = getComputedStyle(element).getPropertyValue(property);
      }
      return values;
    });
    expect(renderedAtHalfTime).toEqual({
      opacity: "0.8",
      rotate: "12deg",
      scale: "1.2",
      translate: "18px",
    });
  });

  test("imports static JSX CSS into Motion and renders the saved source", async ({
    page,
    request,
  }) => {
    if (!screenId) throw new Error("React Motion screen is not registered");

    const existing = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
    });
    for (const timeline of existing.timelines ?? []) {
      if (timeline.id) {
        if (typeof timeline.sourceVersionHash !== "string") {
          throw new Error("React Motion source version is missing.");
        }
        await postAction(request, "remove-motion-timeline", {
          designId,
          timelineId: timeline.id,
          fileId: screenId,
          timelineVersionHash: timeline.sourceVersionHash,
        });
      }
    }

    const authoredSource = `import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <style>{\`
#motion-target {
  color: rebeccapurple;
  /* Keep this authored note. */
  animation-name: source-fade;
  animation-duration: 900ms;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
@keyframes source-fade {
  from { opacity: 0.1; }
  to { opacity: 0.9; }
}
\`}</style>
      <button data-agent-native-node-id="motion-target" id="motion-target">
        Motion target
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`;
    const sourceFilePath = path.join(rootPath, sourcePath);
    fs.writeFileSync(sourceFilePath, authoredSource);
    await page.goto(reactDevServerUrl, { waitUntil: "load" });
    const target = page.locator("button#motion-target");
    await expect(target).toHaveText("Motion target");
    const targetNodeId = await target.getAttribute("data-agent-native-node-id");
    expect(targetNodeId).toBe(nodeId);

    const sourceHash = createHash("sha256")
      .update(authoredSource)
      .digest("hex");
    const recovered = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
      targetNodeIds: [targetNodeId!],
      previewModulePath: sourcePath,
      previewModuleVersionHash: sourceHash,
    });
    expect(recovered.timelines).toHaveLength(1);
    expect(recovered.timelines[0]).toMatchObject({
      source: "recovered-react",
      filePath: sourcePath,
      tracks: [
        {
          targetNodeId,
          property: "opacity",
          durationMs: 900,
          keyframes: [
            { t: 0, value: "0.1", ease: "linear" },
            { t: 1, value: "0.9", ease: "ease" },
          ],
        },
      ],
      sourceVersionHash: sourceHash,
    });
    expect(recovered.sourceWriteCapability).toMatchObject({
      status: "supported",
      modulePath: sourcePath,
      moduleVersionHash: sourceHash,
      targetNodeIds: [targetNodeId],
    });

    const saved = await postAction(request, "apply-motion-edit", {
      designId,
      fileId: screenId,
      sourceRef: screenId,
      localSource: {
        connectionId,
        modulePath: sourcePath,
        moduleVersionHash: sourceHash,
        timelineVersionHash: sourceHash,
        renderedNodeIds: [targetNodeId],
      },
      tracks: [
        {
          targetNodeId,
          property: "opacity",
          keyframes: [
            { t: 0, value: "0.25", ease: "linear" },
            { t: 1, value: "0.75", ease: "linear" },
          ],
        },
      ],
      durationMs: 900,
      playbackMode: "once",
      defaultEase: "linear",
    });
    expect(saved).toMatchObject({
      persisted: true,
      sourceType: "localhost",
      sourcePatched: true,
      filePath: sourcePath,
    });

    const savedSource = fs.readFileSync(sourceFilePath, "utf8");
    expect(savedSource).not.toContain("animation-name: source-fade;");
    expect(savedSource).toContain("@keyframes source-fade");
    expect(savedSource).toContain("color: rebeccapurple;");
    expect(savedSource).toContain("/* Keep this authored note. */");
    expect(savedSource).toContain("data-agent-native-motion");
    await expect.poll(() => viteChangedFiles).toContain(sourceFilePath);

    const savedHash = createHash("sha256").update(savedSource).digest("hex");
    const roundTrip = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
    });
    expect(roundTrip.timelines).toHaveLength(1);
    expect(roundTrip.timelines[0]).toMatchObject({
      durationMs: 900,
      tracks: [
        {
          targetNodeId,
          property: "opacity",
          keyframes: [
            { t: 0, value: "0.25", ease: "linear" },
            { t: 1, value: "0.75", ease: "linear" },
          ],
        },
      ],
      sourceVersionHash: savedHash,
    });

    const renderedTarget = page.locator(
      `[data-agent-native-node-id="${targetNodeId}"]`,
    );
    await expect(renderedTarget).toHaveText("Motion target");
    await expect(renderedTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      savedHash,
    );
    await expect
      .poll(() =>
        renderedTarget.evaluate((element) => element.getAnimations().length),
      )
      .toBeGreaterThan(0);
    const atHalfTime = await renderedTarget.evaluate(async (element) => {
      const animation = element
        .getAnimations()
        .find((candidate) =>
          (candidate.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((keyframe) => "opacity" in keyframe),
        );
      if (!animation) throw new Error("React opacity animation is missing");
      animation.pause();
      await animation.ready;
      animation.currentTime = 450;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      return getComputedStyle(element).opacity;
    });
    expect(atHalfTime).toBe("0.5");

    const persistedTimelineId = roundTrip.timelines[0]?.id;
    if (!persistedTimelineId) {
      throw new Error("The imported React Motion timeline was not persisted.");
    }
    const sourceVersionHash = roundTrip.timelines[0]?.sourceVersionHash;
    if (typeof sourceVersionHash !== "string") {
      throw new Error("The imported React Motion source version is missing.");
    }
    const viteChangesBeforeRemoval = viteChangedFiles.length;
    await postAction(request, "remove-motion-timeline", {
      designId,
      timelineId: persistedTimelineId,
      fileId: screenId,
      timelineVersionHash: sourceVersionHash,
    });
    const removedSource = fs.readFileSync(sourceFilePath, "utf8");
    expect(removedSource).not.toContain("data-agent-native-motion");
    expect(removedSource).toContain("color: rebeccapurple;");
    expect(removedSource).toContain("/* Keep this authored note. */");
    await expect
      .poll(() => viteChangedFiles.length)
      .toBeGreaterThan(viteChangesBeforeRemoval);

    const motionFreeTarget = page.locator(
      `[data-agent-native-node-id="${targetNodeId}"]`,
    );
    await expect(motionFreeTarget).toHaveText("Motion target");
    await expect(motionFreeTarget).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      createHash("sha256").update(removedSource).digest("hex"),
    );
    await expect
      .poll(() =>
        motionFreeTarget.evaluate((element) => element.getAnimations().length),
      )
      .toBe(0);

    fs.writeFileSync(sourceFilePath, reactSource());
  });
});
