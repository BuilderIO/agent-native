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
    <div data-agent-native-node-id="${boardNodeId}" data-agent-native-layer-name="Proof board primitive" data-an-primitive="rectangle" style="position:absolute;left:600px;top:220px;width:96px;height:72px;border-radius:8px"></div>
  </body>
</html>`;

type JsonObject = Record<string, any>;
type BridgeSnapshot = { content: string; versionHash: string };
type WebMcpCall = {
  state?: string;
  ok?: boolean;
  tool?: string;
  result?: { pendingEditCount?: number; status?: string; prompt?: string };
};

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

async function frameNodePageBox(frame: Frame, iframe: Locator, nodeId: string) {
  const localBox = await frame
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  const iframeBox = requireValue(
    await iframe.boundingBox(),
    "Preview iframe has no page bounding box.",
  );
  const viewport = await frame.evaluate(() => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  }));
  const scaleX = iframeBox.width / Math.max(1, viewport.width);
  const scaleY = iframeBox.height / Math.max(1, viewport.height);
  return {
    x: iframeBox.x + localBox.x * scaleX,
    y: iframeBox.y + localBox.y * scaleY,
    width: localBox.width * scaleX,
    height: localBox.height * scaleY,
  };
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
  let createdDesignId: string | undefined;
  let sourceOriginal: BridgeSnapshot | undefined;
  let sourceChanged = false;

  const postAction = async (name: string, data: JsonObject) => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/actions/${name}`,
      {
        data,
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Tab": "visual-edit-interaction-runtime-proof",
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

  const callWebMcp = async (): Promise<WebMcpCall> =>
    (await page.evaluate(async () => {
      const helper = (
        window as typeof window & {
          __agentNativeWebMcp?: {
            call: (name: string, args?: JsonObject) => Promise<unknown>;
          };
        }
      ).__agentNativeWebMcp;
      if (!helper) throw new Error("WebMCP page helper missing.");
      return helper.call("get-visual-edit-prompt", {});
    })) as WebMcpCall;

  const pendingEdit = async (): Promise<JsonObject> => {
    const call = await waitFor(
      callWebMcp,
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
        source: (await readBridgeFile()).content,
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
          x: 700,
          y: 100,
          z: 0,
          width: 900,
          height: 700,
        },
      ],
      publicReadOnly: false,
      navigate: false,
    });
    createdDesignId =
      typeof opened.designId === "string" ? opened.designId : undefined;
    assert(createdDesignId, "open-visual-edit returned no design id.");
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

    await page.goto(`${designUrl}${opened.urlPath}&view=overview&zoom=100`, {
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
      sandbox.includes("allow-same-origin"),
      "URL-backed target iframe lacks allow-same-origin.",
    );
    assert(
      (await targetIframe.getAttribute("srcdoc")) === null,
      "Target iframe unexpectedly uses srcdoc.",
    );
    const targetFrame = await frameForIframe(targetIframe);
    await targetFrame
      .locator(`[data-agent-native-node-id="${targetNodeId}"]`)
      .waitFor({ state: "visible", timeout: 30_000 });

    const boardIframe = page.locator(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
    await boardIframe.waitFor({ state: "attached", timeout: 30_000 });
    const boardFrame = await frameForIframe(boardIframe);
    const boardPrimitive = boardFrame.locator(
      `[data-agent-native-node-id="${boardNodeId}"]`,
    );
    await boardPrimitive.waitFor({ state: "visible", timeout: 30_000 });
    await page
      .getByRole("button", { name: "Move", exact: true })
      .first()
      .click();

    const sourceBox = requireValue(
      await frameNodePageBox(boardFrame, boardIframe, boardNodeId),
      "Board primitive has no page bounding box.",
    );
    const anchorBox = requireValue(
      await targetFrame
        .locator(`[data-agent-native-node-id="${anchorNodeId}"]`)
        .boundingBox(),
      "Target anchor has no page bounding box.",
    );
    const tailBox = requireValue(
      await targetFrame
        .locator(`[data-agent-native-node-id="${tailNodeId}"]`)
        .boundingBox(),
      "Target tail has no page bounding box.",
    );
    const sourcePoint = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    const gapPoint = {
      x: anchorBox.x + anchorBox.width / 2,
      y:
        anchorBox.y +
        anchorBox.height +
        (tailBox.y - anchorBox.y - anchorBox.height) * 0.35,
    };
    await page.mouse.move(sourcePoint.x, sourcePoint.y);
    await page.mouse.down();
    await page.mouse.move(gapPoint.x, gapPoint.y, { steps: 28 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    const pending = await pendingEdit();
    const pendingPayload = await assertPendingEdit(pending, screenId);
    const liveAfterDrop = await waitFor(
      () => liveRelationship(targetFrame, boardNodeId),
      (value) =>
        value.parentId === targetNodeId &&
        JSON.stringify(value.siblingIds) ===
          JSON.stringify([anchorNodeId, boardNodeId, tailNodeId]),
      "live nested insertion",
    );
    await page.screenshot({
      path: `${outputDir}/url-backed-nested-pending.png`,
      fullPage: true,
    });

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
      callWebMcp,
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

    sourceOriginal = await readBridgeFile();
    assert(
      !sourceOriginal.content.includes(
        `data-agent-native-node-id="${boardNodeId}"`,
      ),
      "Fixture source was not clean before apply.",
    );
    const search = `        </div>\n        <div\n          data-agent-native-node-id="${tailNodeId}"`;
    assert(
      sourceOriginal.content.split(search).length === 2,
      "Target source anchor boundary is not unique.",
    );
    const replace = `        </div>\n        ${redone.insertedHtml}\n        <div\n          data-agent-native-node-id="${tailNodeId}"`;
    const applied = await bridgePost("/apply-edit", {
      relPath: sourceFile,
      search,
      replace,
      expectedVersionHash: sourceOriginal.versionHash,
      requireExpectedVersionHash: true,
    });
    assert(
      applied.ok === true,
      "Bridge apply-edit did not acknowledge the write.",
    );
    sourceChanged = true;
    const sourceAfterApply = await readBridgeFile();
    const pendingAfterApply = await pendingEdit();
    assert(
      pendingAfterApply.sourceId === boardNodeId,
      "Source apply lost the pending edit before reload.",
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
      JSON.stringify(sourceSemantics.targetChildren) ===
        JSON.stringify([anchorNodeId, boardNodeId, tailNodeId]),
      `Source inserted node has the wrong order: ${JSON.stringify(sourceSemantics.targetChildren)}`,
    );
    await page.screenshot({
      path: `${outputDir}/url-backed-nested-reloaded.png`,
      fullPage: true,
    });

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
      bridgeApply: {
        ok: applied.ok,
        method: applied.method,
        usedExpectedVersionHash: sourceOriginal.versionHash,
        resultingVersionHash: sourceAfterApply.versionHash,
      },
      screenshots: [
        "url-backed-nested-pending.png",
        "url-backed-nested-reloaded.png",
      ],
      zoomCoordinateTransformCoverage: [50, 100, 200],
    };
    await writeFile(
      `${outputDir}/url-backed-interaction-proof.json`,
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    if (sourceChanged && sourceOriginal) {
      try {
        const current = await readBridgeFile();
        if (
          current.content.includes(`data-agent-native-node-id="${boardNodeId}"`)
        ) {
          await bridgePost("/apply-edit", {
            relPath: sourceFile,
            content: sourceOriginal.content,
            expectedVersionHash: current.versionHash,
            requireExpectedVersionHash: true,
          });
        }
      } catch (error) {
        console.warn(`source fixture cleanup failed: ${String(error)}`);
      }
    }
    if (createdDesignId) {
      try {
        await postAction("delete-design", { id: createdDesignId });
      } catch (error) {
        console.warn(`design proof cleanup failed: ${String(error)}`);
      }
    }
    await context.close();
    await browser.close();
  }
}

await main();
