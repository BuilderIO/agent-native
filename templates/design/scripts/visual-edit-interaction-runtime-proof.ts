import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Frame, type Locator, type Page } from "playwright";

const designUrl =
  process.env.VISUAL_EDIT_INTERACTION_DESIGN_URL ?? "http://localhost:8091";
const slidesUrl =
  process.env.VISUAL_EDIT_INTERACTION_SLIDES_URL ?? "http://localhost:8084";
const bridgeUrl =
  process.env.VISUAL_EDIT_INTERACTION_BRIDGE_URL ?? "http://127.0.0.1:7331";
const bridgeToken =
  process.env.VISUAL_EDIT_INTERACTION_BRIDGE_TOKEN ??
  "visual-edit-interaction-proof-token";
const rootPath =
  process.env.VISUAL_EDIT_INTERACTION_ROOT_PATH ??
  path.resolve(import.meta.dirname, "../../slides");
const outputDir = path.resolve(
  import.meta.dirname,
  "../../../.tmp/visual-edit-interaction-proof",
);
const targetPath = "/visual-edit-structure-proof.html";
const sourceFile = "public/visual-edit-structure-proof.html";
const boardNodeId = "proof-board-primitive";
const targetNodeId = "proof-auto-layout-target";
const anchorNodeId = "proof-target-anchor";
const tailNodeId = "proof-target-tail";
const bridgeHost = new URL(bridgeUrl).host;

const boardHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Visual edit board proof</title></head>
  <body style="margin:0;position:relative;width:131072px;height:131072px;overflow:visible">
    <div data-agent-native-node-id="${boardNodeId}" data-agent-native-layer-name="Proof board primitive" data-an-primitive="rectangle" style="position:absolute;left:1050px;top:500px;width:48px;height:36px;border-radius:8px;background:currentColor"></div>
  </body>
</html>`;

type JsonObject = Record<string, any>;
type BridgeSnapshot = { content: string; versionHash: string };
type WebMcpCall = {
  state?: string;
  ok?: boolean;
  tool?: string;
  result?: JsonObject;
};
type HmrSignal = { type: "update" | "full-reload"; url: string; at: number };

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  if (!predicate(value)) {
    throw new Error(`${label} did not settle: ${JSON.stringify(value)}`);
  }
  return value;
}

async function frameForIframe(locator: Locator): Promise<Frame> {
  const handle = await locator.elementHandle();
  const frame = await handle?.contentFrame();
  return requireValue(frame, "Preview iframe has no content frame.");
}

async function frameNodePageBox(frame: Frame, nodeId: string) {
  return frame.locator(`[data-agent-native-node-id="${nodeId}"]`).boundingBox();
}

async function cdpScreenshot(page: Page, filePath: string): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(filePath, Buffer.from(data, "base64"));
}

async function liveRelationship(frame: Frame, nodeId: string) {
  return frame
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const parent = element.parentElement;
      return {
        parentId: parent?.getAttribute("data-agent-native-node-id") ?? null,
        siblingIds: parent
          ? Array.from(parent.children).map((child) =>
              child.getAttribute("data-agent-native-node-id"),
            )
          : [],
      };
    });
}

async function sourceRelationship(page: Page, content: string, nodeId: string) {
  return page.evaluate(
    ({ content: source, nodeId: subjectId, targetId, anchorId, tailId }) => {
      const document = new DOMParser().parseFromString(source, "text/html");
      const nodes = Array.from(
        document.querySelectorAll("[data-agent-native-node-id]"),
      );
      const subject = nodes.filter(
        (element) =>
          element.getAttribute("data-agent-native-node-id") === subjectId,
      );
      const target = nodes.filter(
        (element) =>
          element.getAttribute("data-agent-native-node-id") === targetId,
      );
      const anchor = nodes.filter(
        (element) =>
          element.getAttribute("data-agent-native-node-id") === anchorId,
      );
      const tail = nodes.filter(
        (element) =>
          element.getAttribute("data-agent-native-node-id") === tailId,
      );
      const parent = subject[0]?.parentElement;
      return {
        subjectCount: subject.length,
        targetCount: target.length,
        anchorCount: anchor.length,
        tailCount: tail.length,
        subjectParentId:
          subject[0]?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ) ?? null,
        targetChildren: target[0]
          ? Array.from(target[0].children).map((child) =>
              child.getAttribute("data-agent-native-node-id"),
            )
          : [],
        subjectIndex: parent
          ? Array.from(parent.children).indexOf(subject[0]!)
          : -1,
      };
    },
    {
      content,
      nodeId,
      targetId: targetNodeId,
      anchorId: anchorNodeId,
      tailId: tailNodeId,
    },
  );
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: process.env.VISUAL_EDIT_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1900, height: 1100 },
  });
  const page = await context.newPage();
  const hmrSignals: HmrSignal[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      let message: { type?: unknown } | null = null;
      try {
        message = JSON.parse(String(payload)) as { type?: unknown };
      } catch {
        // coercion-ok: Vite heartbeat/control frames are not JSON or HMR evidence.
      }
      if (message?.type === "update" || message?.type === "full-reload") {
        const socketUrl = new URL(socket.url());
        hmrSignals.push({
          type: message.type,
          url: `${socketUrl.protocol}//${socketUrl.host}${socketUrl.pathname}`,
          at: Date.now(),
        });
      }
    });
  });
  let browserTabId = "";
  let createdDesignId: string | undefined;
  let connectionId: string | undefined;
  let sourceOriginal: BridgeSnapshot | undefined;
  let sourceNeedsRestore = false;
  let expectedEditedContent: string | undefined;
  let proofError: unknown;
  const cleanupErrors: Error[] = [];

  const postAction = async (name: string, data: JsonObject) => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/actions/${name}`,
      {
        data,
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Tab": browserTabId,
          "X-Agent-Native-Frontend": "1",
        },
        timeout: 60_000,
      },
    );
    const body = await response.text();
    if (!response.ok()) {
      throw new Error(`${name}: ${response.status()} ${body}`);
    }
    return body ? (JSON.parse(body) as JsonObject) : {};
  };

  const bridgePost = async (pathname: string, data: JsonObject) => {
    const response = await page.request.post(`${bridgeUrl}${pathname}`, {
      data,
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": bridgeToken,
      },
      timeout: 60_000,
    });
    const body = await response.text();
    if (!response.ok()) {
      throw new Error(`bridge ${pathname}: ${response.status()} ${body}`);
    }
    return (body ? JSON.parse(body) : {}) as JsonObject;
  };

  const readBridgeFile = async (): Promise<BridgeSnapshot> => {
    const result = await bridgePost("/read-file", { relPath: sourceFile });
    assert(
      typeof result.content === "string",
      "Bridge read-file returned no content.",
    );
    assert(
      typeof result.versionHash === "string",
      "Bridge read-file returned no version hash.",
    );
    return { content: result.content, versionHash: result.versionHash };
  };

  const callWebMcp = async (
    name: string,
    args: JsonObject = {},
  ): Promise<WebMcpCall> =>
    (await page.evaluate(
      async ({ name, args }: { name: string; args: JsonObject }) => {
        const helper = (
          window as typeof window & {
            __agentNativeWebMcp?: {
              call: (
                name: string,
                args?: JsonObject,
                options?: { waitMs?: number },
              ) => Promise<unknown>;
            };
          }
        ).__agentNativeWebMcp;
        if (!helper) throw new Error("WebMCP page helper missing.");
        return helper.call(name, args, { waitMs: 20_000 });
      },
      { name, args },
    )) as WebMcpCall;

  const requiredWebMcpTools = [
    "get-visual-edit-prompt",
    "read-local-file",
    "request-localhost-write-consent",
    "write-local-file",
  ];
  const waitForWebMcpTools = () =>
    waitFor(
      () =>
        page.evaluate(async () => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                ready: (options?: { waitMs?: number }) => Promise<unknown>;
                tools: () => Promise<Array<{ name: string }>>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing.");
          const ready = await helper.ready({ waitMs: 10_000 });
          const tools = await helper.tools();
          return {
            ready,
            names: tools.map((tool) => tool.name).sort(),
          };
        }),
      (value) =>
        requiredWebMcpTools.every((name) => value.names.includes(name)),
      "visual-edit WebMCP registration",
      60_000,
    );

  const readLocalFile = async (): Promise<BridgeSnapshot> => {
    const designId = requireValue(
      createdDesignId,
      "Cannot read local source before creating the proof design.",
    );
    const connection = requireValue(
      connectionId,
      "Cannot read local source before opening its bridge connection.",
    );
    const call = await callWebMcp("read-local-file", {
      designId,
      connectionId: connection,
      path: sourceFile,
    });
    assert(
      call.state === "done" &&
        call.ok === true &&
        call.tool === "read-local-file",
      `WebMCP read-local-file failed: ${JSON.stringify(call)}`,
    );
    assert(
      typeof call.result?.content === "string" &&
        typeof call.result?.versionHash === "string",
      "WebMCP read-local-file returned incomplete source metadata.",
    );
    return {
      content: call.result.content,
      versionHash: call.result.versionHash,
    };
  };

  const pendingEdit = async (): Promise<JsonObject> => {
    const call = await waitFor(
      () => callWebMcp("get-visual-edit-prompt"),
      (value) =>
        value.state === "done" &&
        value.ok === true &&
        value.tool === "get-visual-edit-prompt" &&
        (value.result?.pendingEditCount ?? 0) === 1 &&
        typeof value.result?.prompt === "string",
      "pending WebMCP structure edit",
    );
    const prompt = requireValue(
      call.result?.prompt,
      "WebMCP returned no prompt.",
    );
    const marker = "Pending text/layer-state/structure edits:";
    const markerIndex = prompt.lastIndexOf(marker);
    assert(markerIndex >= 0, "WebMCP prompt omitted the pending edit payload.");
    const edits = JSON.parse(
      prompt.slice(markerIndex + marker.length).trim(),
    ) as JsonObject[];
    assert(
      edits.length === 1,
      `Expected one pending structure edit, got ${edits.length}.`,
    );
    return edits[0]!;
  };

  const assertPendingEdit = async (edit: JsonObject, screenId: string) => {
    assert(
      edit.kind === "structure",
      `Expected structure edit: ${JSON.stringify(edit)}`,
    );
    assert(
      edit.screenId === screenId,
      "Pending edit points at the wrong screen.",
    );
    assert(
      edit.routeSourceFile === sourceFile,
      "Pending edit lost route source file.",
    );
    assert(
      edit.sourceId === boardNodeId,
      "Pending edit lost the board source id.",
    );
    assert(
      edit.anchorSourceId === anchorNodeId,
      "Pending edit lost the exact target anchor id.",
    );
    assert(
      typeof edit.selector === "string" && edit.selector.length > 0,
      "Missing source selector.",
    );
    assert(
      typeof edit.anchorSelector === "string" && edit.anchorSelector.length > 0,
      "Missing anchor selector.",
    );
    assert(
      edit.placement === "after",
      `Expected after-anchor placement: ${edit.placement}`,
    );
    assert(
      edit.dropMode === "flow-insert",
      `Expected flow-insert drop mode: ${edit.dropMode}`,
    );
    assert(
      typeof edit.insertedHtml === "string",
      "Pending edit omitted insertedHtml.",
    );
    assert(
      edit.insertedHtml.includes(`data-agent-native-node-id="${boardNodeId}"`),
      "insertedHtml lost source id.",
    );
    assert(
      edit.sourceRect?.width > 0 && edit.sourceRect?.height > 0,
      "Missing source rect payload.",
    );
    assert(
      edit.anchorRect?.width > 0 && edit.anchorRect?.height > 0,
      "Missing anchor rect payload.",
    );
    const selectorResolution = await page.evaluate(
      ({ source, selector }) => {
        const document = new DOMParser().parseFromString(source, "text/html");
        const matches = Array.from(document.querySelectorAll(selector));
        return {
          count: matches.length,
          nodeIds: matches.map((element) =>
            element.getAttribute("data-agent-native-node-id"),
          ),
        };
      },
      {
        source: (await readLocalFile()).content,
        selector: edit.anchorSelector,
      },
    );
    assert(
      selectorResolution.count === 1,
      "Anchor selector is not unique in source.",
    );
    assert(
      selectorResolution.nodeIds[0] === anchorNodeId,
      "Anchor selector resolved the wrong source node.",
    );
    return {
      kind: edit.kind,
      screenId: edit.screenId,
      routeSourceFile: edit.routeSourceFile,
      sourceId: edit.sourceId,
      selector: edit.selector,
      anchorSourceId: edit.anchorSourceId,
      anchorSelector: edit.anchorSelector,
      placement: edit.placement,
      dropMode: edit.dropMode,
      sourceRect: edit.sourceRect,
      anchorRect: edit.anchorRect,
      insertedHtml: edit.insertedHtml,
      semanticHandoff: edit.semanticHandoff ?? null,
      semanticHandoffFailure: edit.semanticHandoffFailure ?? null,
    };
  };

  try {
    const signIn = await page.request.post(
      `${designUrl}/_agent-native/auth/local-dev`,
      { headers: { Accept: "application/json" }, timeout: 60_000 },
    );
    assert(signIn.ok(), `Design local-dev sign-in failed: ${signIn.status()}.`);
    await page.goto(`${designUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => new URL(url).pathname !== "/", {
      timeout: 30_000,
    });
    const browserTabDeadline = Date.now() + 30_000;
    let storedBrowserTabId: string | null = null;
    while (!storedBrowserTabId && Date.now() < browserTabDeadline) {
      try {
        storedBrowserTabId = await page.evaluate(() =>
          sessionStorage.getItem("agent-native:browser-tab-id"),
        );
      } catch {
        // coercion-ok: client redirects can transiently detach the document; the bounded retry below surfaces a real failure.
        // The authenticated root can perform one or more client redirects.
      }
      if (!storedBrowserTabId) await page.waitForTimeout(250);
    }
    assert(
      typeof storedBrowserTabId === "string" && storedBrowserTabId.length > 0,
      "Design page did not establish a browser-tab id.",
    );
    browserTabId = storedBrowserTabId;

    const opened = await postAction("open-visual-edit", {
      title: "URL-backed nested structure proof",
      devServerUrl: slidesUrl,
      bridgeUrl,
      bridgeToken,
      rootPath,
      routes: [
        {
          path: targetPath,
          url: `${slidesUrl}${targetPath}`,
          title: "Nested auto-layout target",
          sourceFile,
          sourceKind: "html",
          x: 600,
          y: 100,
          z: 0,
          width: 400,
          height: 400,
        },
      ],
      publicReadOnly: false,
      navigate: true,
    });
    createdDesignId =
      typeof opened.designId === "string" ? opened.designId : undefined;
    assert(createdDesignId, "open-visual-edit returned no design id.");
    connectionId =
      typeof opened.connectionId === "string" ? opened.connectionId : undefined;
    assert(
      connectionId,
      "open-visual-edit returned no localhost connection id.",
    );
    const screen = (Array.isArray(opened.screens) ? opened.screens : []).find(
      (candidate: JsonObject) => candidate.path === targetPath,
    );
    const screenId = requireValue(
      screen?.id,
      "open-visual-edit returned no target screen.",
    );

    const board = await postAction("create-file", {
      designId: createdDesignId,
      filename: "__board__.html",
      content: boardHtml,
      fileType: "html",
    });
    const boardFileId = requireValue(
      typeof board.id === "string" ? board.id : undefined,
      "create-file returned no board file id.",
    );
    await postAction("update-design", {
      id: createdDesignId,
      dataOperations: [
        { op: "set", path: ["boardFileId"], value: boardFileId },
      ],
    });

    await page.goto(`${designUrl}${opened.urlPath}&zoom=100`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const iframeSelector = `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId.replaceAll('"', '\\"')}"]`;
    const targetIframe = page.locator(iframeSelector);
    await targetIframe.waitFor({ state: "attached", timeout: 30_000 });
    const targetSrc = requireValue(
      await targetIframe.getAttribute("src"),
      "Target iframe has no src.",
    );
    const targetUrl = new URL(targetSrc);
    assert(
      targetUrl.host === bridgeHost && targetUrl.pathname === "/live-edit",
      "Target is not a URL-backed bridge iframe.",
    );
    const sandboxAttribute = await targetIframe.getAttribute("sandbox");
    assert(
      sandboxAttribute !== null,
      "Target iframe has no sandbox attribute.",
    );
    const sandbox = sandboxAttribute.split(/\s+/);
    assert(
      sandbox.includes("allow-scripts"),
      "URL-backed target iframe lacks allow-scripts.",
    );
    assert(
      sandbox.includes("allow-same-origin"),
      "URL-backed target iframe lacks allow-same-origin.",
    );
    assert(
      (await targetIframe.getAttribute("srcdoc")) === null,
      "Target iframe unexpectedly uses srcdoc.",
    );
    let targetFrame = await frameForIframe(targetIframe);
    try {
      await targetFrame
        .locator(`[data-agent-native-node-id="${targetNodeId}"]`)
        .waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      const frameText = await targetFrame
        .locator("body")
        .innerText({ timeout: 2_000 })
        .catch(() => "<unreadable>");
      throw new Error(
        `Nested target did not load in ${targetFrame.url()}: ${frameText.slice(0, 500)} (${String(error)})`,
      );
    }

    const webMcpTools = await waitForWebMcpTools();
    assert(
      requiredWebMcpTools.every((name) => webMcpTools.names.includes(name)),
      `Supported visual-edit WebMCP tools are missing: ${JSON.stringify({
        required: requiredWebMcpTools,
        available: webMcpTools.names,
      })}`,
    );
    sourceOriginal = await readLocalFile();
    assert(
      !sourceOriginal.content.includes(
        `data-agent-native-node-id="${boardNodeId}"`,
      ),
      "Fixture source was not clean before the structure edit.",
    );

    const boardIframe = page.locator(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
    const inspectorSection = (name: string) =>
      page
        .locator("[data-design-inspector-section]")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .first();
    const inspectorReceipt = async () =>
      waitFor(
        async () => ({
          selectedLayerNames: await page
            .locator(
              '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
            )
            .allInnerTexts(),
          positionSectionCount: await inspectorSection("Position").count(),
          fillSectionCount: await inspectorSection("Fill").count(),
        }),
        (value) =>
          value.selectedLayerNames.some((name) =>
            name.includes("Proof board primitive"),
          ) &&
          value.positionSectionCount === 1 &&
          value.fillSectionCount === 1,
        "selected primitive inspector state",
      );
    const dragAtZoom = async (zoom: number, undoAfterDrop: boolean) => {
      await page.goto(`${designUrl}${opened.urlPath}&zoom=${zoom}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .waitFor({ state: "attached", timeout: 30_000 });
      await waitForWebMcpTools();
      await targetIframe.waitFor({ state: "attached", timeout: 30_000 });
      const zoomTargetFrame = await frameForIframe(targetIframe);
      await zoomTargetFrame
        .locator(`[data-agent-native-node-id="${targetNodeId}"]`)
        .waitFor({ state: "visible", timeout: 30_000 });
      await boardIframe.waitFor({ state: "attached", timeout: 30_000 });
      const zoomBoardFrame = await frameForIframe(boardIframe);
      await zoomBoardFrame
        .locator(`[data-agent-native-node-id="${boardNodeId}"]`)
        .waitFor({ state: "visible", timeout: 30_000 });
      await page
        .getByRole("button", { name: "Move", exact: true })
        .first()
        .click();

      const zoomSurfaceBox = requireValue(
        await page.locator("[data-multi-screen-canvas-surface]").boundingBox(),
        "Visual-edit canvas surface has no page bounding box.",
      );
      const zoomBoardIframeBox = requireValue(
        await boardIframe.boundingBox(),
        "Board iframe has no page bounding box.",
      );
      const zoomTargetIframeBox = requireValue(
        await targetIframe.boundingBox(),
        "Target iframe has no page bounding box.",
      );
      const zoomSourceBox = requireValue(
        await frameNodePageBox(zoomBoardFrame, boardNodeId),
        "Board primitive has no page bounding box.",
      );
      const zoomAnchorBox = requireValue(
        await zoomTargetFrame
          .locator(`[data-agent-native-node-id="${anchorNodeId}"]`)
          .boundingBox(),
        "Target anchor has no page bounding box.",
      );
      const zoomTailBox = requireValue(
        await zoomTargetFrame
          .locator(`[data-agent-native-node-id="${tailNodeId}"]`)
          .boundingBox(),
        "Target tail has no page bounding box.",
      );
      const zoomSourcePoint = {
        x: zoomSourceBox.x + zoomSourceBox.width / 2,
        y: zoomSourceBox.y + zoomSourceBox.height / 2,
      };
      const zoomGapPoint = {
        x: zoomAnchorBox.x + zoomAnchorBox.width / 2,
        y:
          zoomAnchorBox.y +
          zoomAnchorBox.height +
          (zoomTailBox.y - zoomAnchorBox.y - zoomAnchorBox.height) * 0.35,
      };
      assert(
        zoomSourcePoint.x >= zoomSurfaceBox.x &&
          zoomSourcePoint.x <= zoomSurfaceBox.x + zoomSurfaceBox.width &&
          zoomSourcePoint.y >= zoomSurfaceBox.y &&
          zoomSourcePoint.y <= zoomSurfaceBox.y + zoomSurfaceBox.height,
        `Composed board coordinate is outside the overview canvas surface at ${zoom}%: ${JSON.stringify(
          {
            surfaceBox: zoomSurfaceBox,
            boardIframeBox: zoomBoardIframeBox,
            sourceBox: zoomSourceBox,
            sourcePoint: zoomSourcePoint,
          },
        )}`,
      );
      await page.mouse.move(zoomSourcePoint.x, zoomSourcePoint.y);
      await page.mouse.down();
      await page.mouse.move(zoomGapPoint.x, zoomGapPoint.y, { steps: 28 });
      await page.waitForTimeout(300);
      await page.mouse.up();

      let zoomPendingPayload: JsonObject;
      try {
        zoomPendingPayload = await assertPendingEdit(
          await pendingEdit(),
          screenId,
        );
      } catch (error) {
        throw new Error(
          `Structure drag did not produce a pending edit at ${zoom}%: ${JSON.stringify(
            {
              surfaceBox: zoomSurfaceBox,
              targetIframeBox: zoomTargetIframeBox,
              sourceBox: zoomSourceBox,
              boardIframeBox: zoomBoardIframeBox,
              anchorBox: zoomAnchorBox,
              tailBox: zoomTailBox,
              sourcePoint: zoomSourcePoint,
              gapPoint: zoomGapPoint,
            },
          )} (${String(error)})`,
        );
      }
      const zoomLiveAfterDrop = await waitFor(
        () => liveRelationship(zoomTargetFrame, boardNodeId),
        (value) =>
          value.parentId === targetNodeId &&
          JSON.stringify(value.siblingIds) ===
            JSON.stringify([anchorNodeId, boardNodeId, tailNodeId]),
        `live nested insertion at ${zoom}%`,
      );
      let liveAfterUndoCount: number | null = null;
      if (undoAfterDrop) {
        await page.keyboard.press("ControlOrMeta+z");
        liveAfterUndoCount = await waitFor(
          () =>
            zoomTargetFrame
              .locator(`[data-agent-native-node-id="${boardNodeId}"]`)
              .count(),
          (count) => count === 0,
          `live insertion undo at ${zoom}%`,
        );
        await waitFor(
          () => callWebMcp("get-visual-edit-prompt"),
          (value) =>
            value.state === "done" &&
            value.ok === true &&
            (value.result?.pendingEditCount ?? -1) === 0,
          `pending insertion undo at ${zoom}%`,
        );
      }
      return {
        zoom,
        targetFrame: zoomTargetFrame,
        coordinateProbe: {
          overviewZoom: zoom,
          surfaceBox: zoomSurfaceBox,
          boardIframeBox: zoomBoardIframeBox,
          targetIframeBox: zoomTargetIframeBox,
          sourceBox: zoomSourceBox,
          anchorBox: zoomAnchorBox,
          tailBox: zoomTailBox,
          sourcePoint: zoomSourcePoint,
          gapPoint: zoomGapPoint,
        },
        pendingPayload: zoomPendingPayload,
        liveAfterDrop: zoomLiveAfterDrop,
        liveAfterUndoCount,
      };
    };

    const zoomRuntimeProof = [];
    for (const zoom of [50, 200]) {
      zoomRuntimeProof.push(await dragAtZoom(zoom, true));
    }
    const primaryZoomProof = await dragAtZoom(100, false);
    zoomRuntimeProof.push(primaryZoomProof);
    targetFrame = primaryZoomProof.targetFrame;
    const { coordinateProbe, pendingPayload, liveAfterDrop } = primaryZoomProof;
    const inspectorState = await inspectorReceipt();
    await cdpScreenshot(page, `${outputDir}/url-backed-nested-pending.png`);

    await page.keyboard.press("ControlOrMeta+z");
    const liveAfterUndo = await waitFor(
      () =>
        targetFrame
          .locator(`[data-agent-native-node-id="${boardNodeId}"]`)
          .count(),
      (count) => count === 0,
      "live insertion undo",
    );
    const undoneCall = await waitFor(
      () => callWebMcp("get-visual-edit-prompt"),
      (value) =>
        value.state === "done" &&
        value.ok === true &&
        (value.result?.pendingEditCount ?? -1) === 0,
      "pending insertion undo",
    );

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitFor(
      () => liveRelationship(targetFrame, boardNodeId),
      (value) =>
        value.parentId === targetNodeId &&
        value.siblingIds.join(",") ===
          `${anchorNodeId},${boardNodeId},${tailNodeId}`,
      "live insertion redo",
    );
    const redone = await pendingEdit();
    const redonePayload = await assertPendingEdit(redone, screenId);
    assert(
      redonePayload.sourceId === pendingPayload.sourceId,
      "Redo changed the source id.",
    );
    assert(
      redonePayload.anchorSourceId === pendingPayload.anchorSourceId,
      "Redo changed the target anchor id.",
    );
    assert(
      redonePayload.placement === pendingPayload.placement,
      "Redo changed placement.",
    );
    assert(
      redonePayload.dropMode === pendingPayload.dropMode,
      "Redo changed drop mode.",
    );

    sourceOriginal = await readLocalFile();
    assert(
      !sourceOriginal.content.includes(
        `data-agent-native-node-id="${boardNodeId}"`,
      ),
      "Fixture source was not clean before apply.",
    );
    const hmrMarker = "url-backed-structure-proof-hmr";
    const search = `        </div>\n        <div\n          data-agent-native-node-id="${tailNodeId}"`;
    assert(
      sourceOriginal.content.split(search).length === 2,
      "Target source anchor boundary is not unique.",
    );
    const replace = `        </div>\n        ${redone.insertedHtml}\n        <div\n          data-agent-native-node-id="${tailNodeId}"\n          data-visual-edit-hmr="${hmrMarker}"`;
    expectedEditedContent = sourceOriginal.content.replace(search, replace);
    assert(
      expectedEditedContent !== sourceOriginal.content,
      "Source patch did not change the fixture content.",
    );
    const consentRequest = await callWebMcp("request-localhost-write-consent", {
      designId: createdDesignId,
      connectionId,
      files: [sourceFile],
    });
    assert(
      consentRequest.state === "done" &&
        consentRequest.ok === true &&
        consentRequest.tool === "request-localhost-write-consent" &&
        consentRequest.result?.surfaced === true,
      `WebMCP write-consent request failed to surface: ${JSON.stringify(
        consentRequest,
      )}`,
    );
    const consentDialog = page.getByRole("dialog");
    await consentDialog.waitFor({ state: "visible", timeout: 10_000 });
    await consentDialog
      .getByRole("button", { name: "Allow writes", exact: true })
      .click();
    await consentDialog.waitFor({ state: "hidden", timeout: 10_000 });

    sourceNeedsRestore = true;
    const hmrSignalStart = hmrSignals.length;
    const applied = await callWebMcp("write-local-file", {
      designId: createdDesignId,
      connectionId,
      relPath: sourceFile,
      patch: { search, replace },
      expectedVersionHash: sourceOriginal.versionHash,
      requireExpectedVersionHash: true,
    });
    assert(
      applied.state === "done" &&
        applied.ok === true &&
        applied.tool === "write-local-file" &&
        applied.result?.written === true,
      `WebMCP write-local-file did not acknowledge the write: ${JSON.stringify(
        applied,
      )}`,
    );
    assert(
      typeof applied.result?.versionHash === "string",
      "WebMCP write-local-file returned no resulting version hash.",
    );
    const sourceAfterApply = await readLocalFile();
    assert(
      sourceAfterApply.content === expectedEditedContent,
      "WebMCP write-local-file wrote unexpected source content.",
    );
    assert(
      sourceAfterApply.versionHash === applied.result.versionHash,
      "WebMCP write-local-file returned a stale version hash.",
    );
    const pendingAfterApply = await pendingEdit();
    assert(
      pendingAfterApply.sourceId === boardNodeId,
      "Source apply lost the pending edit before reload.",
    );

    await waitFor(
      async () => {
        const currentTargetFrame = await frameForIframe(targetIframe);
        return currentTargetFrame
          .locator(`[data-agent-native-node-id="${tailNodeId}"]`)
          .getAttribute("data-visual-edit-hmr");
      },
      (value) => value === hmrMarker,
      "URL-backed iframe HMR source update",
      60_000,
    );
    const hmrDuringApply = await waitFor(
      () => Promise.resolve(hmrSignals.slice(hmrSignalStart)),
      (signals) => signals.length > 0,
      "Vite HMR signal after local source write",
      60_000,
    );
    assert(
      hmrDuringApply.every(
        ({ url }) => !url.includes("?") && !url.includes("#"),
      ),
      "HMR receipt included a query or fragment.",
    );

    await page.reload({ waitUntil: "commit" });
    const reloadedTargetIframe = page.locator(iframeSelector);
    await reloadedTargetIframe.waitFor({ state: "attached", timeout: 30_000 });
    const reloadedTargetFrame = await frameForIframe(reloadedTargetIframe);
    await reloadedTargetFrame
      .locator(`[data-agent-native-node-id="${boardNodeId}"]`)
      .waitFor({ state: "visible", timeout: 30_000 });
    const liveAfterReload = await liveRelationship(
      reloadedTargetFrame,
      boardNodeId,
    );
    assert(
      liveAfterReload.parentId === targetNodeId,
      "Reload changed the inserted parent.",
    );
    assert(
      JSON.stringify(liveAfterReload.siblingIds) ===
        JSON.stringify([anchorNodeId, boardNodeId, tailNodeId]),
      `Reload changed the inserted order: ${JSON.stringify(liveAfterReload.siblingIds)}`,
    );
    const sourceSemantics = await sourceRelationship(
      page,
      sourceAfterApply.content,
      boardNodeId,
    );
    assert(
      sourceSemantics.subjectCount === 1,
      "Source contains the wrong number of inserted nodes.",
    );
    assert(
      sourceSemantics.subjectParentId === targetNodeId,
      "Source inserted node has the wrong parent.",
    );
    assert(
      sourceSemantics.subjectIndex === 1,
      `Source inserted node has the wrong index: ${sourceSemantics.subjectIndex}`,
    );
    assert(
      JSON.stringify(sourceSemantics.targetChildren) ===
        JSON.stringify([anchorNodeId, boardNodeId, tailNodeId]),
      `Source inserted node has the wrong order: ${JSON.stringify(sourceSemantics.targetChildren)}`,
    );
    await cdpScreenshot(page, `${outputDir}/url-backed-nested-reloaded.png`);

    const artifact = {
      targetPath,
      sourceFile,
      screenId,
      targetIframe: {
        srcHost: targetUrl.host,
        srcPath: targetUrl.pathname,
        sandbox,
        hasSrcdoc: false,
      },
      coordinateProbe,
      zoomRuntimeProof: zoomRuntimeProof.map(
        ({ targetFrame: _targetFrame, ...proof }) => proof,
      ),
      sourceNodeId: boardNodeId,
      targetNodeId,
      anchorNodeId,
      tailNodeId,
      pendingPayload,
      redoPayload: redonePayload,
      liveAfterDrop,
      liveAfterUndoCount: liveAfterUndo,
      undonePendingEditCount: undoneCall.result?.pendingEditCount ?? null,
      liveAfterReload,
      sourceSemantics,
      inspectorState,
      hmr: {
        signals: hmrDuringApply,
        marker: hmrMarker,
      },
      supportedWrite: {
        transport: "page-webmcp",
        tool: applied.tool,
        ok: applied.ok,
        usedExpectedVersionHash: sourceOriginal.versionHash,
        resultingVersionHash: sourceAfterApply.versionHash,
        operation: applied.result.operation,
      },
      screenshots: [
        "url-backed-nested-pending.png",
        "url-backed-nested-reloaded.png",
      ],
      zoomCoordinateTransformCoverage: zoomRuntimeProof
        .map(({ zoom }) => zoom)
        .sort((a, b) => a - b),
    };
    await writeFile(
      `${outputDir}/url-backed-interaction-proof.json`,
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    console.log(JSON.stringify(artifact, null, 2));
  } catch (error) {
    proofError = error;
  } finally {
    if (sourceNeedsRestore && sourceOriginal) {
      try {
        const current = await readBridgeFile();
        if (current.content === sourceOriginal.content) {
          sourceNeedsRestore = false;
        } else {
          assert(
            expectedEditedContent !== undefined &&
              current.content === expectedEditedContent,
            "Refusing to overwrite a source change made outside this proof.",
          );
          const restored = await bridgePost("/apply-edit", {
            relPath: sourceFile,
            content: sourceOriginal.content,
            expectedVersionHash: current.versionHash,
            requireExpectedVersionHash: true,
          });
          assert(
            restored.ok === true,
            "Source fixture cleanup did not acknowledge restoration.",
          );
          const restoredSource = await readBridgeFile();
          assert(
            restoredSource.content === sourceOriginal.content,
            "Source fixture cleanup did not restore the original content.",
          );
          sourceNeedsRestore = false;
        }
      } catch (error) {
        cleanupErrors.push(
          new Error(`source fixture cleanup failed: ${String(error)}`),
        );
      }
    }
    if (createdDesignId && connectionId) {
      try {
        await postAction("revoke-localhost-write-consent", {
          designId: createdDesignId,
          connectionId,
        });
      } catch (error) {
        cleanupErrors.push(
          new Error(`write consent cleanup failed: ${String(error)}`),
        );
      }
    }
    if (createdDesignId) {
      try {
        await postAction("delete-design", { id: createdDesignId });
      } catch (error) {
        cleanupErrors.push(
          new Error(`design proof cleanup failed: ${String(error)}`),
        );
      }
    }
    try {
      await context.close();
    } catch (error) {
      cleanupErrors.push(
        new Error(`browser context cleanup failed: ${String(error)}`),
      );
    }
    try {
      await browser.close();
    } catch (error) {
      cleanupErrors.push(new Error(`browser cleanup failed: ${String(error)}`));
    }
  }
  if (proofError && cleanupErrors.length > 0) {
    throw new Error(
      [
        "Visual-edit proof and cleanup failed.",
        String(proofError),
        ...cleanupErrors.map(String),
      ].join("\n"),
    );
  }
  if (proofError) throw proofError;
  if (cleanupErrors.length > 0) {
    throw new Error(
      ["Visual-edit proof cleanup failed.", ...cleanupErrors.map(String)].join(
        "\n",
      ),
    );
  }
}

await main();
