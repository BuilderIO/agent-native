import { createHash } from "node:crypto";
import fs from "node:fs";
import http, { type Server } from "node:http";
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
  type Response,
} from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import { createServer, type ViteDevServer } from "vite";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_CODE_METADATA_VERSION } from "../shared/motion-code";
import { e2eBaseURL } from "./base-url";
import {
  appPath,
  enableLab,
  enterDirectMode,
  gotoEditor,
  installBridge,
} from "./helpers";

const baseURL = e2eBaseURL();
const sourcePath = "index.html";
const nodeId = "motion-target";
const alpineTransitionNodeId = "alpine-transition-target";
const inlineAnimationNodeId = "inline-animation-target";
const source = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Motion HTML source</title><style>@keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }</style></head>
  <body>
    <main x-data="{ open: true }">
      <button id="alpine-toggle" type="button" @click="open = !open">Toggle visibility</button>
      <section id="${nodeId}" data-agent-native-node-id="${nodeId}" x-show="open">Motion target</section>
      <section id="${alpineTransitionNodeId}" data-agent-native-node-id="${alpineTransitionNodeId}" x-show="open" x-transition.opacity>Alpine transition target</section>
      <section id="${inlineAnimationNodeId}" data-agent-native-node-id="${inlineAnimationNodeId}" style="animation: pulse 1s infinite">Inline animation target</section>
    </main>
    <script type="module">import Alpine from "alpinejs"; window.Alpine = Alpine; Alpine.start();</script>
  </body>
</html>
`;
let rootPath = "";
let designId = "";
let connectionId = "";
let screenId = "";
let devServerUrl = "";
let viteServer: ViteDevServer | null = null;
let bridge: DesignConnectBridge | null = null;
let restoreMotionLab: (() => Promise<void>) | null = null;

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

async function selectHtmlNodeFromCanvas(
  page: import("@playwright/test").Page,
  targetScreenId: string,
): Promise<void> {
  await enterDirectMode(page, {
    screenId: targetScreenId,
    waitForBridgeReady: true,
  });
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const iframe = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${targetScreenId}"]`,
  );
  const frame = iframe.contentFrame();
  const target = frame.locator(`#${nodeId}`);
  const targetRect = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const frameRect = await iframe.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const scaleX = frameRect.width / targetRect.viewportWidth;
  const scaleY = frameRect.height / targetRect.viewportHeight;
  await page.keyboard.down("Meta");
  try {
    await page.mouse.click(
      frameRect.x + (targetRect.left + targetRect.width / 2) * scaleX,
      frameRect.y + (targetRect.top + targetRect.height / 2) * scaleY,
    );
  } finally {
    await page.keyboard.up("Meta");
  }
  await expect
    .poll(() =>
      page.evaluate(
        (expectedNodeId) =>
          ((window as any).__bridge as Array<any>).find((message) => {
            const payload = message?.payload ?? message;
            return (
              message?.type === "element-select" &&
              payload.sourceId === expectedNodeId
            );
          }) ?? null,
        nodeId,
      ),
    )
    .toMatchObject({ type: "element-select" });
}

test.describe.serial("HTML Motion source browser writeback", () => {
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
    rootPath = fs.mkdtempSync(path.join(artifactRoot, "motion-html-source-"));
    fs.writeFileSync(
      path.join(rootPath, "package.json"),
      '{"type":"module"}\n',
    );
    fs.symlinkSync(
      path.resolve(import.meta.dirname, "../../../node_modules"),
      path.join(rootPath, "node_modules"),
      "dir",
    );
    fs.writeFileSync(path.join(rootPath, sourcePath), source);

    const pluginModule = (await tsImport(
      path.resolve(
        import.meta.dirname,
        "../../../packages/core/src/vite/motion-source-provenance-plugin.ts",
      ),
      import.meta.url,
    )) as {
      motionSourceProvenancePlugin: () => import("vite").Plugin;
    };
    viteServer = await createServer({
      root: rootPath,
      plugins: [pluginModule.motionSourceProvenancePlugin()],
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("HTML fixture Vite server did not start");
    }
    const localUrl = new URL("http://127.0.0.1");
    localUrl.port = String(address.port);
    devServerUrl = localUrl.origin;

    const bridgeProbe = http.createServer();
    const bridgePort = await listen(bridgeProbe);
    await closeServer(bridgeProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: devServerUrl,
      port: bridgePort,
    });
    const htmlManifest = {
      ...manifest,
      routes: manifest.routes.map((route) =>
        route.path === "/" ? { ...route, sourceFile: sourcePath } : route,
      ),
    };
    const opened = await postAction(request, "open-visual-edit", {
      title: "HTML Motion source proof",
      devServerUrl: htmlManifest.devServerUrl,
      bridgeUrl: htmlManifest.bridgeUrl,
      rootPath,
      routeManifest: htmlManifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: false,
    });
    designId = opened.designId;
    connectionId = opened.connectionId;
    bridge = await startDesignConnectBridge(htmlManifest, {
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

  test("writes HTML Motion, preserves Alpine, and imports direct CSS edits", async ({
    page,
    request,
  }) => {
    const opened = await postAction(request, "add-localhost-screens", {
      connectionId,
      designId,
      paths: ["/"],
    });
    screenId = opened.screens?.[0]?.id;
    if (!screenId) throw new Error("HTML Motion screen was not registered");

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
    await expect(frame.locator("main")).toHaveAttribute(
      "x-data",
      "{ open: true }",
    );
    await expect(target).toHaveAttribute("x-show", "open");
    await expect(target).not.toHaveAttribute("x-transition.opacity");
    await expect(frame.locator(`#${alpineTransitionNodeId}`)).toHaveAttribute(
      "x-transition.opacity",
      "",
    );

    const initialSourceHash = createHash("sha256")
      .update(fs.readFileSync(path.join(rootPath, sourcePath), "utf8"))
      .digest("hex");
    await expect(target).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      initialSourceHash,
    );
    await postAction(request, "grant-localhost-write-consent", {
      designId,
      connectionId,
    });

    const refusedWrite = await request.post(
      `${baseURL}/_agent-native/actions/apply-motion-edit`,
      {
        data: {
          designId,
          fileId: screenId,
          sourceRef: screenId,
          localSource: {
            connectionId,
            modulePath: sourcePath,
            moduleVersionHash: initialSourceHash,
            timelineVersionHash: initialSourceHash,
            renderedNodeIds: [alpineTransitionNodeId],
          },
          tracks: [
            {
              targetNodeId: alpineTransitionNodeId,
              property: "opacity",
              keyframes: [
                { t: 0, value: "0", ease: "linear" },
                { t: 1, value: "1", ease: "linear" },
              ],
            },
          ],
          durationMs: 500,
          playbackMode: "once",
          defaultEase: "linear",
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(refusedWrite.ok()).toBe(false);
    expect(await refusedWrite.text()).toContain("x-transition.opacity");
    expect(fs.readFileSync(path.join(rootPath, sourcePath), "utf8")).toBe(
      source,
    );

    const refusedInlineAnimation = await request.post(
      `${baseURL}/_agent-native/actions/apply-motion-edit`,
      {
        data: {
          designId,
          fileId: screenId,
          sourceRef: screenId,
          localSource: {
            connectionId,
            modulePath: sourcePath,
            moduleVersionHash: initialSourceHash,
            timelineVersionHash: initialSourceHash,
            renderedNodeIds: [inlineAnimationNodeId],
          },
          tracks: [
            {
              targetNodeId: inlineAnimationNodeId,
              property: "opacity",
              keyframes: [
                { t: 0, value: "0", ease: "linear" },
                { t: 1, value: "1", ease: "linear" },
              ],
            },
          ],
          durationMs: 500,
          playbackMode: "once",
          defaultEase: "linear",
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(refusedInlineAnimation.ok()).toBe(false);
    expect(await refusedInlineAnimation.text()).toContain("uses style");
    expect(fs.readFileSync(path.join(rootPath, sourcePath), "utf8")).toBe(
      source,
    );

    const expectedTrack = {
      targetNodeId: nodeId,
      property: "translate",
      keyframes: [
        { t: 0, value: "0px 0px", ease: "linear" },
        { t: 1, value: "24px 0px", ease: "linear" },
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
      tracks: [expectedTrack],
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

    const managedSource = fs.readFileSync(
      path.join(rootPath, sourcePath),
      "utf8",
    );
    expect(managedSource).toContain(
      `agent-native-motion-source:v${MOTION_CODE_METADATA_VERSION}`,
    );
    expect(managedSource).toContain('x-data="{ open: true }"');
    expect(managedSource).toContain("x-transition.opacity");
    await expect(target).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      createHash("sha256").update(managedSource).digest("hex"),
    );
    await expect(frame.locator("style[data-agent-native-motion]")).toHaveCount(
      1,
    );

    await gotoEditor(page, designId);
    await selectHtmlNodeFromCanvas(page, screenId);
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    const durationInput = page.getByRole("textbox", {
      name: "Duration",
      exact: true,
    });
    await expect(durationInput).toHaveValue("1000");

    const directSource = managedSource
      .replace("translate: 0px 0px;", "translate: 6px 0px;")
      .replace("animation-duration: 1s;", "animation-duration: 1.2s;")
      .replace(
        "animation-timing-function: linear;",
        "animation-timing-function: ease-in;",
      );
    expect(directSource).not.toBe(managedSource);
    const refreshedMotionQueries: Array<{ query: string; result: any }> = [];
    const responseReadErrors: string[] = [];
    const directHash = createHash("sha256").update(directSource).digest("hex");
    const resultHasSourceVersion = (result: unknown, expectedHash: string) => {
      if (
        !result ||
        typeof result !== "object" ||
        !("timelines" in result) ||
        !Array.isArray(result.timelines)
      ) {
        return false;
      }
      return result.timelines.some(
        (timeline: unknown) =>
          timeline !== null &&
          typeof timeline === "object" &&
          "sourceVersionHash" in timeline &&
          timeline.sourceVersionHash === expectedHash,
      );
    };
    const isActiveTimelineQuery = (query: string) => {
      const params = new URLSearchParams(query);
      return (
        params.get("sourceRef") === screenId &&
        !params.has("previewModuleVersionHash") &&
        !params.has("targetNodeIds[]")
      );
    };
    const onTimelineResponse = async (response: Response) => {
      if (
        !response.url().includes("/_agent-native/actions/get-actions-batch")
      ) {
        return;
      }
      const responseBodyPromise = response.json() as Promise<{
        results?: Array<{ body?: unknown }>;
      }>;
      const requestBody = response.request().postDataJSON() as {
        requests?: Array<{ action: string; query: string }>;
      };
      const matchingRequests = (requestBody.requests ?? [])
        .map((requestItem, index) => ({ requestItem, index }))
        .filter(
          ({ requestItem }) =>
            requestItem.action === "get-motion-timeline" &&
            isActiveTimelineQuery(requestItem.query),
        );
      if (matchingRequests.length === 0) return;

      try {
        const responseBody = await responseBodyPromise;
        for (const { requestItem, index } of matchingRequests) {
          refreshedMotionQueries.push({
            query: requestItem.query,
            result: responseBody.results?.[index]?.body,
          });
        }
        if (
          refreshedMotionQueries.some(({ result }) =>
            resultHasSourceVersion(result, directHash),
          )
        ) {
          page.off("response", onTimelineResponse);
        }
      } catch (error) {
        responseReadErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    page.on("response", onTimelineResponse);
    fs.writeFileSync(path.join(rootPath, sourcePath), directSource);
    frame = iframe.contentFrame();
    await expect(frame.locator(`#${nodeId}`)).toHaveAttribute(
      "data-agent-native-motion-source-hash",
      directHash,
      { timeout: 20_000 },
    );
    await expect
      .poll(() =>
        refreshedMotionQueries.some(({ result }) =>
          resultHasSourceVersion(result, directHash),
        ),
      )
      .toBe(true);
    page.off("response", onTimelineResponse);
    expect(responseReadErrors).toEqual([]);
    const refreshedTimelineQuery = [...refreshedMotionQueries]
      .reverse()
      .find(({ result }) => resultHasSourceVersion(result, directHash));
    expect(refreshedTimelineQuery?.result).toMatchObject({
      timelines: [{ sourceVersionHash: directHash, durationMs: 1200 }],
    });

    const timeline = await getAction(request, "get-motion-timeline", {
      designId,
      sourceRef: screenId,
    });
    expect(timeline.timelines[0]).toMatchObject({
      sourceVersionHash: directHash,
      durationMs: 1200,
      tracks: [
        {
          targetNodeId: nodeId,
          property: "translate",
          keyframes: [
            { t: 0, value: "6px 0px", ease: "ease-in" },
            { t: 1, value: "24px 0px", ease: "linear" },
          ],
        },
      ],
    });
    await expect(
      page.locator('[data-motion-property-row="translate"]'),
    ).toContainText("Position");
    await expect(durationInput).toHaveValue("1200");
    await expect(frame.locator(`#${alpineTransitionNodeId}`)).toHaveAttribute(
      "x-transition.opacity",
      "",
    );

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
      .poll(() => fs.readFileSync(path.join(rootPath, sourcePath), "utf8"))
      .not.toBe(directSource);
    const savedSource = fs.readFileSync(
      path.join(rootPath, sourcePath),
      "utf8",
    );
    const savedSourceHash = createHash("sha256")
      .update(savedSource)
      .digest("hex");
    expect(savedSource).toContain("translate: 6px 0px;");
    expect(savedSource).toContain("animation-timing-function: ease-in;");
    expect(
      await getAction(request, "get-motion-timeline", {
        designId,
        sourceRef: screenId,
      }),
    ).toMatchObject({
      timelines: [
        {
          sourceVersionHash: savedSourceHash,
          durationMs: 1300,
          tracks: [
            {
              targetNodeId: nodeId,
              property: "translate",
              keyframes: [
                { t: 0, value: "6px 0px", ease: "ease-in" },
                { t: 1, value: "24px 0px", ease: "linear" },
              ],
            },
          ],
        },
      ],
    });

    await page.goto(devServerUrl, { waitUntil: "load" });
    const browserTarget = page.locator(`#${nodeId}`);
    await expect(browserTarget).toBeVisible();
    await expect
      .poll(() =>
        browserTarget.evaluate((element) => element.getAnimations().length),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Toggle visibility" }).click();
    await expect(browserTarget).toBeHidden();
    await page.getByRole("button", { name: "Toggle visibility" }).click();
    await expect(browserTarget).toBeVisible();
  });
});
