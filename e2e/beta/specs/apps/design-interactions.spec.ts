import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { collectAppPageErrors } from "../../lib/app";
import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

const SITE = siteById("design");
const ORIGIN = originFor(SITE);
const PRIMARY_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";
const PREVIEW = "iframe[data-design-preview-iframe]";
const SHAPE_ID = "beta-layered-shape";
const HEADING_ID = "beta-heading";
const BODY_ID = "beta-body";
const SHAPE_NAME = "Layered Shape";
const HEADING_NAME = "Beta Heading";
const BODY_NAME = "Beta Body";
const FINAL_TEXT_SIZE = "28";
const SELECTION_COLOR_FRAME_ID = "selection-color-frame";
const SELECTION_COLOR_FRAME_NAME = "Selection Color Frame";
const SELECTION_COLOR_MATCHING_ID = "selection-color-matching";
const SELECTION_COLOR_OTHER_ID = "selection-color-other";
const SELECTION_COLOR_MATCHING_NAME = "Matching";
const SELECTION_COLOR_OTHER_NAME = "Other";
const COMPONENT_OVERRIDE_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Beta component overrides</title></head>
  <body>
    <button data-agent-native-node-id="component-main" data-agent-native-layer-name="Component main"
      data-agent-native-component="BetaButton" data-agent-native-component-id="beta-button"
      data-agent-native-prop-variant="primary">Main button</button>
    <button data-agent-native-node-id="component-instance" data-agent-native-layer-name="Component instance"
      data-agent-native-component="BetaButton" data-agent-native-component-ref="beta-button"
      data-agent-native-prop-variant="primary" data-agent-native-component-overrides="%5B%5D">Instance button</button>
  </body>
</html>`;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Beta Design interactions</title></head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="beta-root" data-agent-native-layer-name="Beta Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="${SHAPE_ID}" data-agent-native-layer-name="${SHAPE_NAME}" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:url(&quot;https://fills.invalid/beta-layer-one.png&quot;),radial-gradient(circle at center,#00ff00 0%,#ff00ff 100%);background-size:cover,24px 24px;background-repeat:no-repeat,repeat-x;background-position:center,30% 40%"></div>
      <h1 data-agent-native-node-id="${HEADING_ID}" data-agent-native-layer-name="${HEADING_NAME}" style="position:absolute;left:64px;top:300px;margin:0;font-size:32px;font-weight:700;color:#0f172a">Beta Heading</h1>
      <p data-agent-native-node-id="${BODY_ID}" data-agent-native-layer-name="${BODY_NAME}" style="position:absolute;left:64px;top:360px;margin:0;font-size:18px;font-weight:400;line-height:1.5;color:#475569">Beta Body</p>
    </main>
  </body>
</html>`;

const NESTED_DROP_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Beta Design drag and drop</title></head>
  <body style="margin:0;position:relative;width:800px;height:600px;background:#fff">
    <div data-agent-native-node-id="root-frame" data-agent-native-layer-name="Root frame" data-an-primitive="frame"
         style="position:absolute;left:48px;top:48px;width:120px;height:80px;box-sizing:border-box;background:#f97316"></div>
    <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
         style="position:absolute;left:300px;top:160px;width:320px;height:240px;box-sizing:border-box;background:#bfdbfe;padding:16px">
      <div data-agent-native-node-id="nested-anchor" data-agent-native-layer-name="Existing child"
           style="position:absolute;left:16px;top:16px;width:80px;height:40px;background:#2563eb"></div>
    </div>
  </body>
</html>`;

const SELECTION_COLOR_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Beta Design selection colors</title></head>
  <body style="margin:0;background:#ffffff;color:#111827">
    <main data-agent-native-node-id="${SELECTION_COLOR_FRAME_ID}" data-agent-native-layer-name="${SELECTION_COLOR_FRAME_NAME}" style="width:900px;height:700px;background:#101010">
      <div data-agent-native-node-id="${SELECTION_COLOR_MATCHING_ID}" data-agent-native-layer-name="${SELECTION_COLOR_MATCHING_NAME}" style="width:120px;height:80px;background:#101010"></div>
      <div data-agent-native-node-id="${SELECTION_COLOR_OTHER_ID}" data-agent-native-layer-name="${SELECTION_COLOR_OTHER_NAME}" style="width:120px;height:80px;background:transparent"></div>
    </main>
  </body>
</html>`;

const NESTED_DROP_BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Beta Design board drag source</title></head>
  <body style="margin:0;position:relative;width:1800px;height:900px;background:transparent">
    <div data-agent-native-node-id="board-source" data-agent-native-layer-name="Board source" data-an-primitive="frame"
         style="position:absolute;left:840px;top:140px;width:60px;height:30px;box-sizing:border-box;background:#f97316"></div>
  </body>
</html>`;

const CROSS_SCREEN_OPTION_SOURCE_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Beta cross-screen source</title></head>
  <body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
    <div data-agent-native-node-id="cross-source" data-agent-native-layer-name="Cross-screen source"
      style="position:absolute;left:100px;top:180px;width:140px;height:60px;box-sizing:border-box;background:#38bdf8;color:#082f49">Source</div>
  </body>
</html>`;

const CROSS_SCREEN_OPTION_DESTINATION_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Beta cross-screen destination</title></head>
  <body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
    <section data-agent-native-node-id="destination-shell" data-agent-native-layer-name="Destination shell"
      style="position:absolute;left:80px;top:120px;width:420px;padding:20px;box-sizing:border-box;background:#334155">
      <section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested auto"
        style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#475569">
        <div data-agent-native-node-id="destination-first" data-agent-native-layer-name="Destination first"
          style="width:180px;height:40px;background:#94a3b8;color:#0f172a">First</div>
        <div data-agent-native-node-id="destination-last" data-agent-native-layer-name="Destination last"
          style="width:180px;height:40px;background:#64748b;color:#f8fafc">Last</div>
      </section>
    </section>
  </body>
</html>`;

const ROOT_FRAME_ID = "root-frame";
const ROOT_FRAME_NAME = "Root frame";
const NESTED_FRAME_ID = "nested-frame";
const BOARD_SOURCE_ID = "board-source";
const CROSS_SCREEN_SOURCE_ID = "cross-source";
const CROSS_SCREEN_DESTINATION_ID = "nested-auto";
const URL_BACKED_TARGET_URL = "https://example.com/beta-design-target";

interface StyleSnapshot {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundSize: string;
  fontSize: string;
  fontWeight: string;
}

interface AuthedPage {
  context: BrowserContext;
  page: Page;
  appErrors: string[];
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
  allowConflict = false,
): Promise<any> {
  const response = await page.request.post(
    `${ORIGIN}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok() && !(allowConflict && response.status() === 409))
    throw new Error(`${name} failed: HTTP ${response.status()}`);
  if (allowConflict && response.status() === 409)
    return { conflict: true, error: await response.text() };
  return response.json();
}

async function readSource(
  page: Page,
  designId: string,
  filename = "index.html",
): Promise<string> {
  if (filename === "__board__.html") {
    const response = await page.request.get(
      `${ORIGIN}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    );
    if (!response.ok()) {
      throw new Error(`get-design failed: HTTP ${response.status()}`);
    }
    const record = (await response.json()) as {
      files?: Array<{ filename?: string; content?: unknown }>;
    };
    const content = record.files?.find(
      (file) => file.filename === filename,
    )?.content;
    if (typeof content !== "string") {
      throw new Error(`get-design returned no ${filename} content`);
    }
    return content;
  }

  const url = new URL("/_agent-native/actions/read-source-file", ORIGIN);
  url.searchParams.set("designId", designId);
  url.searchParams.set("path", filename);
  const response = await page.request.get(url.href);
  if (!response.ok()) {
    throw new Error(`read-source-file failed: HTTP ${response.status()}`);
  }
  const result = (await response.json()) as { content?: unknown };
  if (typeof result.content !== "string") {
    throw new Error("read-source-file returned no source content");
  }
  return result.content;
}

function sourceContentHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

async function expectedHtmlFiles(
  page: Page,
  designId: string,
): Promise<Array<{ fileId: string; versionHash: string }>> {
  const response = await page.request.get(
    `${ORIGIN}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok())
    throw new Error(`get-design failed: HTTP ${response.status()}`);
  const record = (await response.json()) as {
    files?: Array<{ id?: unknown; fileType?: unknown; content?: unknown }>;
  };
  return (record.files ?? [])
    .filter(
      (file): file is { id: string; fileType: "html"; content: string } =>
        typeof file.id === "string" &&
        file.fileType === "html" &&
        typeof file.content === "string",
    )
    .map((file) => ({
      fileId: file.id,
      versionHash: sourceContentHash(file.content),
    }));
}

async function sourceAttribute(
  page: Page,
  designId: string,
  nodeId: string,
  attribute: string,
): Promise<string | null> {
  const source = await readSource(page, designId);
  return page.evaluate(
    ({ html, nodeId: targetNodeId, attribute: targetAttribute }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return (
        document
          .querySelector<HTMLElement>(
            `[data-agent-native-node-id="${CSS.escape(targetNodeId)}"]`,
          )
          ?.getAttribute(targetAttribute) ?? null
      );
    },
    { html: source, nodeId, attribute },
  );
}

function previewNode(page: Page, nodeId: string): Locator {
  return page
    .locator(PREVIEW)
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${nodeId}"]`);
}

async function readScreenMetadata(
  page: Page,
  designId: string,
  screenId: string,
): Promise<Record<string, unknown>> {
  const response = await page.request.get(
    `${ORIGIN}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(`get-design failed: HTTP ${response.status()}`);
  }
  const record = (await response.json()) as { data?: unknown };
  const data =
    typeof record.data === "string"
      ? JSON.parse(record.data || "{}")
      : record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("get-design returned invalid design data");
  }
  const metadata = (
    data as {
      screenMetadata?: Record<string, Record<string, unknown>>;
    }
  ).screenMetadata?.[screenId];
  if (!metadata)
    throw new Error(`get-design returned no metadata for ${screenId}`);
  return metadata;
}

async function directChildIds(
  page: Page,
  source: string,
  parentId: string,
): Promise<string[]> {
  return page.evaluate(
    ({ html, id }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const parent = document.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${CSS.escape(id)}"]`,
      );
      if (!parent) throw new Error(`saved source is missing ${id}`);
      return Array.from(parent.children)
        .map((child) => child.getAttribute("data-agent-native-node-id"))
        .filter((childId): childId is string => Boolean(childId));
    },
    { html: source, id: parentId },
  );
}

async function topLevelNodeIds(page: Page, source: string): Promise<string[]> {
  return page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    return Array.from(document.body.children)
      .map((child) => child.getAttribute("data-agent-native-node-id"))
      .filter((nodeId): nodeId is string => Boolean(nodeId));
  }, source);
}

function layerIds(source: string, layerName: string): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(
    `data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-layer-name="${layerName}"`,
    "g",
  );
  for (const match of source.matchAll(pattern)) ids.push(match[1]!);
  return ids;
}

async function parseSource(
  page: Page,
  source: string,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return page.evaluate(
    ({ html, ids }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const result: Record<string, StyleSnapshot> = {};
      for (const id of ids) {
        const node = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-agent-native-node-id]",
          ),
        ].find((candidate) => candidate.dataset.agentNativeNodeId === id);
        if (!node) throw new Error(`saved source is missing ${id}`);
        result[id] = {
          backgroundColor: node.style.backgroundColor,
          backgroundImage: node.style.backgroundImage,
          backgroundPosition: node.style.backgroundPosition,
          backgroundRepeat: node.style.backgroundRepeat,
          backgroundSize: node.style.backgroundSize,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
        };
      }
      return result;
    },
    { html: source, ids: nodeIds },
  );
}

async function readSourceStyles(
  page: Page,
  designId: string,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return parseSource(page, await readSource(page, designId), nodeIds);
}

async function readRenderedStyles(
  page: Page,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return page
    .locator(PREVIEW)
    .last()
    .contentFrame()
    .locator("body")
    .evaluate((body, ids) => {
      const result: Record<string, StyleSnapshot> = {};
      for (const id of ids) {
        const node = [
          ...body.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
        ].find((candidate) => candidate.dataset.agentNativeNodeId === id);
        if (!node) throw new Error(`rendered frame is missing ${id}`);
        const style = getComputedStyle(node);
        result[id] = {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          backgroundPosition: style.backgroundPosition,
          backgroundRepeat: style.backgroundRepeat,
          backgroundSize: style.backgroundSize,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      }
      return result;
    }, nodeIds);
}

function splitCssList(value: string): string[] {
  const layers: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers.filter(Boolean);
}

async function openAuthedPage(browser: Browser): Promise<AuthedPage> {
  const context = await signedInContext(browser, SITE, { seedModel: false });
  try {
    await assertSignedInOnBeta(context, SITE);
    const page = await context.newPage();
    const { errors } = collectAppPageErrors(page, ORIGIN);
    return { context, page, appErrors: errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function createFixture(
  page: Page,
  onCreated: (designId: string) => void,
  content = FIXTURE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: runMarker(`Design interactions ${Date.now()}`),
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  onCreated(designId);
  try {
    await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content,
      fileType: "html",
    });
  } catch (error) {
    try {
      await postAction(page, "delete-design", { id: designId });
      onCreated("");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `create-file failed for ${designId}; cleanup also failed`,
      );
    }
    throw error;
  }
  return designId;
}

async function createNestedDropFixture(
  page: Page,
  onCreated: (designId: string) => void,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: runMarker(`Design drag and drop ${Date.now()}`),
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  onCreated(designId);

  try {
    const screen = await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: NESTED_DROP_FIXTURE,
      fileType: "html",
    });
    const screenId = String(screen?.id ?? screen?.data?.id ?? "");
    if (!screenId) throw new Error("create-file returned no screen id");

    const board = await postAction(page, "create-file", {
      designId,
      filename: "__board__.html",
      content: NESTED_DROP_BOARD_FIXTURE,
      fileType: "html",
    });
    const boardId = String(board?.id ?? board?.data?.id ?? "");
    if (!boardId) throw new Error("create-file returned no board id");

    await postAction(page, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["boardFileId"], value: boardId },
        {
          op: "set",
          path: ["screenMetadata", boardId],
          value: { sourceType: "inline", width: 1800, height: 900 },
        },
        {
          op: "set",
          path: ["screenMetadata", screenId],
          value: { sourceType: "inline", width: 800, height: 600 },
        },
        {
          op: "set",
          path: ["canvasFrames", screenId],
          value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
        },
      ],
    });
  } catch (error) {
    try {
      await postAction(page, "delete-design", { id: designId });
      onCreated("");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `drag fixture creation failed for ${designId}; cleanup also failed`,
      );
    }
    throw error;
  }

  return designId;
}

async function createCrossScreenOptionDragFixture(
  page: Page,
  onCreated: (designId: string) => void,
): Promise<{ designId: string; sourceId: string; destinationId: string }> {
  const created = await postAction(page, "create-design", {
    title: runMarker(`Design cross-screen Option drag ${Date.now()}`),
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  onCreated(designId);

  try {
    const source = await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: CROSS_SCREEN_OPTION_SOURCE_FIXTURE,
      fileType: "html",
    });
    const sourceId = String(source?.id ?? source?.data?.id ?? "");
    if (!sourceId) throw new Error("create-file returned no source screen id");

    const destination = await postAction(page, "create-file", {
      designId,
      filename: "destination.html",
      content: CROSS_SCREEN_OPTION_DESTINATION_FIXTURE,
      fileType: "html",
    });
    const destinationId = String(
      destination?.id ?? destination?.data?.id ?? "",
    );
    if (!destinationId)
      throw new Error("create-file returned no destination screen id");

    await postAction(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["screenMetadata", sourceId],
          value: { sourceType: "inline", width: 1000, height: 780 },
        },
        {
          op: "set",
          path: ["canvasFrames", sourceId],
          value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
        },
        {
          op: "set",
          path: ["screenMetadata", destinationId],
          value: { sourceType: "inline", width: 1000, height: 780 },
        },
        {
          op: "set",
          path: ["canvasFrames", destinationId],
          value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
        },
      ],
    });
    return { designId, sourceId, destinationId };
  } catch (error) {
    try {
      await postAction(page, "delete-design", { id: designId });
      onCreated("");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `cross-screen fixture creation failed for ${designId}; cleanup also failed`,
      );
    }
    throw error;
  }
}

async function addUrlBackedDropTarget(
  page: Page,
  designId: string,
): Promise<string> {
  const created = await postAction(page, "create-file", {
    designId,
    filename: "url-target.html",
    content: URL_BACKED_TARGET_URL,
    fileType: "html",
  });
  const screenId = String(created?.id ?? created?.data?.id ?? "");
  if (!screenId) throw new Error("create-file returned no URL target id");

  await postAction(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: {
          sourceType: "localhost",
          previewState: "live",
          url: URL_BACKED_TARGET_URL,
          previewUrl: URL_BACKED_TARGET_URL,
          title: "URL-backed target",
          width: 800,
          height: 600,
        },
      },
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 1900, y: 0, width: 800, height: 600, z: 2 },
      },
    ],
  });
  return screenId;
}

async function cleanupTest(options: {
  context: BrowserContext;
  page: Page;
  designId: string;
  appErrors: string[];
  primaryFailure: boolean;
}): Promise<void> {
  const failures: string[] = [];
  try {
    if (options.designId) {
      await postAction(options.page, "delete-design", { id: options.designId });
    }
  } catch (error) {
    failures.push(
      `delete-design failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    expect(
      options.appErrors,
      `${ORIGIN} emitted app-owned page errors`,
    ).toEqual([]);
  } catch (error) {
    failures.push(
      `app-owned page errors: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await options.context.close();
  } catch (error) {
    failures.push(
      `context.close failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (failures.length === 0) return;

  const message = `[beta-e2e] Design test teardown failures:\n${failures.join("\n")}`;
  console.error(message);
  if (options.primaryFailure) {
    test.info().annotations.push({
      type: "cleanup-failure",
      description: message,
    });
    return;
  }
  throw new Error(message);
}

function frame(page: Page) {
  return page
    .locator(`${PREVIEW}[data-screen-iframe-id]`)
    .first()
    .contentFrame();
}

function frameById(page: Page, screenId: string) {
  const escapedScreenId = screenId.replace(/["\\]/g, "\\$&");
  return page
    .locator(`${PREVIEW}[data-screen-iframe-id="${escapedScreenId}"]`)
    .first()
    .contentFrame();
}

function boardFrame(page: Page) {
  return page
    .locator(`[data-board-surface-layer] ${PREVIEW}`)
    .first()
    .contentFrame();
}

async function waitForEditor(page: Page, readyNodeId: string): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.locator(`${PREVIEW}[data-screen-iframe-id]`).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        frame(page)
          .locator(`[data-agent-native-node-id="${readyNodeId}"]`)
          .count(),
      { timeout: 30_000 },
    )
    .toBe(1);
  await expect(
    frame(page).locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached({ timeout: 30_000 });
}

async function enterDirectMode(page: Page): Promise<void> {
  const allScreens = page
    .locator("aside")
    .first()
    .getByRole("button", { name: "All screens", exact: true });
  if (
    (await allScreens.count()) > 0 &&
    (await allScreens.getAttribute("aria-current")) !== "page"
  ) {
    await allScreens.click();
    await expect(allScreens).toHaveAttribute("aria-current", "page");
  }
  await expect(
    frame(page).locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached({ timeout: 15_000 });
}

async function openEditor(
  page: Page,
  designId: string,
  readyNodeId: string,
): Promise<void> {
  await page.goto(`${ORIGIN}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForEditor(page, readyNodeId);
  await enterDirectMode(page);
}

async function expandLayers(page: Page): Promise<void> {
  const tree = page.getByRole("tree", { name: "Layers" });
  await expect(tree.getByRole("treeitem").first()).toBeVisible({
    timeout: 30_000,
  });
  for (let index = 0; index < 128; index += 1) {
    const expand = tree.getByRole("button", { name: "Expand layer" }).first();
    if ((await expand.count()) === 0) return;
    const row = expand.locator('xpath=ancestor::*[@role="treeitem"][1]');
    const rowIndex = await row.evaluate((element) => {
      const treeElement = element.closest('[role="tree"]');
      return treeElement
        ? Array.from(treeElement.querySelectorAll('[role="treeitem"]')).indexOf(
            element,
          )
        : -1;
    });
    if (rowIndex < 0) {
      throw new Error("Could not resolve the expandable layer row");
    }
    await expand.click();
    await expect(
      tree
        .getByRole("treeitem")
        .nth(rowIndex)
        .getByRole("button", { name: "Collapse layer" }),
    ).toHaveCount(1, { timeout: 5_000 });
  }
  throw new Error("Layers tree still has collapsed rows after 128 expansions");
}

function layerButton(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .first();
}

async function selectLayer(
  page: Page,
  name: string,
  withPrimaryModifier = false,
): Promise<void> {
  const button = layerButton(page, name);
  await expect(button).toBeVisible({ timeout: 15_000 });
  if (withPrimaryModifier) {
    await button.click({ force: true, modifiers: [PRIMARY_MODIFIER] });
  } else {
    await button.click({ force: true });
  }
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

function fillSection(page: Page): Locator {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Fill", exact: true }),
    })
    .first();
}

function typographySection(page: Page): Locator {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Typography", exact: true }),
    })
    .first();
}

test.describe.configure({ mode: "serial" });

test.describe("authenticated beta Design interactions", () => {
  test.skip(
    !selectedSites().some((site) => site.id === SITE.id),
    "design is not selected by BETA_E2E_APPS",
  );

  test.beforeEach(() => skipUnlessAuthed());

  test("component variant overrides survive propagation, reload, and reset", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(
        page,
        (id) => {
          designId = id;
        },
        COMPONENT_OVERRIDE_FIXTURE,
      );
      const design = await page.request.get(
        `${ORIGIN}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      );
      if (!design.ok())
        throw new Error(`get-design failed: HTTP ${design.status()}`);
      const record = (await design.json()) as {
        files?: Array<{ id?: unknown; filename?: unknown }>;
      };
      const fileId = record.files?.find(
        (file) => file.filename === "index.html" && typeof file.id === "string",
      )?.id;
      if (typeof fileId !== "string")
        throw new Error("index.html file was not created");

      const apply = async (nodeId: string, value: string) => {
        let result: any;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          result = await postAction(
            page,
            "apply-component-prop-edit",
            {
              designId,
              fileId,
              nodeId,
              edit: {
                kind: "attribute",
                attribute: "data-agent-native-prop-variant",
                value,
              },
              source: {
                expectedFiles: await expectedHtmlFiles(page, designId),
              },
            },
            true,
          );
          if (!result.conflict) return result;
          await page.waitForTimeout(500);
        }
        return result;
      };

      const mainEdit = await apply("component-main", "secondary");
      expect(mainEdit.persisted, JSON.stringify(mainEdit)).toBe(true);
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-main",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("secondary");
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("secondary");

      const instanceEdit = await apply("component-instance", "outline");
      expect(instanceEdit.persisted, JSON.stringify(instanceEdit)).toBe(true);
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("outline");
      expect(
        decodeURIComponent(
          (await sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-component-overrides",
          )) ?? "",
        ),
      ).toContain('"property":"attribute:data-agent-native-prop-variant"');

      await page.goto(`${ORIGIN}/design/${designId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("button", { name: "Move", exact: true }),
      ).toBeVisible({
        timeout: 45_000,
      });
      await expect(previewNode(page, "component-instance")).toHaveAttribute(
        "data-agent-native-prop-variant",
        "outline",
      );

      const laterMainEdit = await apply("component-main", "quiet");
      expect(laterMainEdit.persisted, JSON.stringify(laterMainEdit)).toBe(true);
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-main",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("quiet");
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("outline");

      const reset = await postAction(page, "apply-component-prop-edit", {
        designId,
        fileId,
        nodeId: "component-instance",
        edit: { kind: "resetOverrides" },
        source: { expectedFiles: await expectedHtmlFiles(page, designId) },
      });
      expect(reset.persisted, JSON.stringify(reset)).toBe(true);
      await expect
        .poll(() =>
          sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-prop-variant",
          ),
        )
        .toBe("quiet");
      expect(
        decodeURIComponent(
          (await sourceAttribute(
            page,
            designId,
            "component-instance",
            "data-agent-native-component-overrides",
          )) ?? "",
        ),
      ).not.toContain("attribute:data-agent-native-prop-variant");
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({ context, page, designId, appErrors, primaryFailure });
    }
  });

  test("report path: nested drop shows its guide before release and preserves parent order", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createNestedDropFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, ROOT_FRAME_ID);

      const screen = frame(page);
      const board = boardFrame(page);
      const source = board.locator(
        `[data-agent-native-node-id="${BOARD_SOURCE_ID}"]`,
      );
      const target = screen.locator(
        `[data-agent-native-node-id="${NESTED_FRAME_ID}"]`,
      );
      await expect(source).toBeVisible({ timeout: 30_000 });
      await expect(target).toBeVisible({ timeout: 30_000 });
      expect(
        await directChildIds(
          page,
          await readSource(page, designId),
          NESTED_FRAME_ID,
        ),
      ).toEqual(["nested-anchor"]);

      const sourceBox = (await source.boundingBox())!;
      const targetBox = (await target.boundingBox())!;
      const grabOffset = { x: 18, y: 11 };
      const release = {
        x: targetBox.x + targetBox.width / 2,
        y: targetBox.y + targetBox.height / 2,
      };
      await page.mouse.move(
        sourceBox.x + grabOffset.x,
        sourceBox.y + grabOffset.y,
      );
      await page.mouse.down();
      await page.mouse.move(
        sourceBox.x + grabOffset.x - 12,
        sourceBox.y + grabOffset.y,
        { steps: 4 },
      );
      await page.mouse.move(release.x, release.y, { steps: 24 });
      await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
        timeout: 10_000,
      });
      expect(
        await directChildIds(
          page,
          await readSource(page, designId),
          NESTED_FRAME_ID,
        ),
      ).toEqual(["nested-anchor"]);
      await page.mouse.up();

      await expect
        .poll(
          async () =>
            directChildIds(
              page,
              await readSource(page, designId),
              NESTED_FRAME_ID,
            ),
          { timeout: 20_000 },
        )
        .toEqual(["nested-anchor", BOARD_SOURCE_ID]);
      await expect
        .poll(() => readSource(page, designId, "__board__.html"), {
          timeout: 20_000,
        })
        .not.toContain(`data-agent-native-node-id="${BOARD_SOURCE_ID}"`);

      await expandLayers(page);
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator('[role="treeitem"][aria-selected="true"]')
          .filter({ hasText: "Board source" }),
      ).toHaveCount(1);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("report path: URL-backed target keeps its route and source ownership bounded", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      await page.route(URL_BACKED_TARGET_URL, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><html><body style="margin:0;width:800px;height:600px;background:#e2e8f0"><section data-agent-native-node-id="external-target" style="position:absolute;left:80px;top:80px;width:360px;height:240px;background:#94a3b8"></section></body></html>`,
        });
      });
      designId = await createNestedDropFixture(page, (id) => {
        designId = id;
      });
      const urlTargetId = await addUrlBackedDropTarget(page, designId);
      await openEditor(page, designId, ROOT_FRAME_ID);
      await page.keyboard.press("Shift+1");

      const source = boardFrame(page).locator(
        `[data-agent-native-node-id="${BOARD_SOURCE_ID}"]`,
      );
      const urlTarget = page.locator(
        `${PREVIEW}[data-screen-iframe-id="${urlTargetId}"]`,
      );
      await expect(source).toBeVisible({ timeout: 30_000 });
      await expect(urlTarget).toBeVisible({ timeout: 30_000 });
      await expect(
        urlTarget
          .contentFrame()
          .locator('[data-agent-native-node-id="external-target"]'),
      ).toBeVisible({ timeout: 30_000 });
      const sourceBox = (await source.boundingBox())!;
      const targetBox = (await urlTarget.boundingBox())!;
      const beforeBoard = await readSource(page, designId, "__board__.html");
      const beforeInline = await readSource(page, designId);
      const beforeBoardOrder = await topLevelNodeIds(page, beforeBoard);
      const beforeInlineNestedOrder = await directChildIds(
        page,
        beforeInline,
        NESTED_FRAME_ID,
      );

      const grabX = sourceBox.x + sourceBox.width / 2;
      const grabY = sourceBox.y + sourceBox.height / 2;
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX - 12, grabY, { steps: 4 });
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
        { steps: 24 },
      );
      await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
        timeout: 10_000,
      });
      await expect
        .poll(() => readSource(page, designId, "__board__.html"), {
          timeout: 5_000,
        })
        .toBe(beforeBoard);
      await expect
        .poll(() => readSource(page, designId), { timeout: 5_000 })
        .toBe(beforeInline);
      await expect
        .poll(async () =>
          directChildIds(
            page,
            await readSource(page, designId),
            NESTED_FRAME_ID,
          ),
        )
        .toEqual(beforeInlineNestedOrder);
      await page.mouse.up();
      await expect(
        urlTarget
          .contentFrame()
          .locator('[data-agent-native-node-id="external-target"]'),
      ).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => readScreenMetadata(page, designId, urlTargetId), {
          timeout: 20_000,
        })
        .toMatchObject({
          sourceType: "localhost",
          previewState: "live",
          url: URL_BACKED_TARGET_URL,
          previewUrl: URL_BACKED_TARGET_URL,
        });

      await expect
        .poll(async () => {
          const afterBoard = await readSource(page, designId, "__board__.html");
          return topLevelNodeIds(page, afterBoard);
        })
        .toEqual(beforeBoardOrder);
      await expect
        .poll(async () =>
          directChildIds(
            page,
            await readSource(page, designId),
            NESTED_FRAME_ID,
          ),
        )
        .toEqual(beforeInlineNestedOrder);
      await expect
        .poll(() => readSource(page, designId, "url-target.html"), {
          timeout: 20_000,
        })
        .toBe(URL_BACKED_TARGET_URL);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("report path: Option-dragging a root frame preserves source and selects the copy", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createNestedDropFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, ROOT_FRAME_ID);

      const screenIframe = page
        .locator(`${PREVIEW}[data-screen-iframe-id]`)
        .first();
      const activeScreenId = await screenIframe.getAttribute(
        "data-screen-iframe-id",
      );
      expect(activeScreenId).toBeTruthy();
      const screen = frameById(page, activeScreenId!);
      const root = screen.locator(
        `[data-agent-native-node-id="${ROOT_FRAME_ID}"]`,
      );
      await expect(root).toBeVisible({ timeout: 30_000 });
      const rootBefore = (await root.boundingBox())!;
      await page.mouse.click(
        rootBefore.x + rootBefore.width / 2,
        rootBefore.y + rootBefore.height / 2,
      );
      await expect(
        screen.locator('[data-agent-native-edit-overlay="selection"]'),
      ).toBeVisible();

      await page.mouse.move(
        rootBefore.x + rootBefore.width / 2,
        rootBefore.y + rootBefore.height / 2,
      );
      let mouseHeld = false;
      let modifierHeld = false;
      try {
        modifierHeld = true;
        await page.keyboard.down("Alt");
        mouseHeld = true;
        await page.mouse.down();
        await page.mouse.move(
          rootBefore.x + rootBefore.width / 2 + 6,
          rootBefore.y + rootBefore.height / 2 + 3,
          { steps: 2 },
        );
        await page.mouse.move(
          rootBefore.x + rootBefore.width / 2 + 120,
          rootBefore.y + rootBefore.height / 2 + 60,
          { steps: 12 },
        );
        await expect(
          screen.locator("[data-agent-native-transform-badge]"),
        ).toHaveText("Duplicate layer");
      } finally {
        if (mouseHeld) await page.mouse.up();
        if (modifierHeld) await page.keyboard.up("Alt");
      }

      const roots = screen.locator(
        `[data-agent-native-layer-name="${ROOT_FRAME_NAME}"]`,
      );
      await expect(roots).toHaveCount(2, { timeout: 20_000 });
      const rootState = await screen.locator("body").evaluate(() => {
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
      const original = rootState.nodes.find(
        (node) => node.id === ROOT_FRAME_ID,
      );
      const copy = rootState.nodes.find((node) => node.id !== ROOT_FRAME_ID);
      expect(original).toBeTruthy();
      const copyId = copy!.id!;
      expect(copyId).toMatch(/^an-copy-/);
      expect(copy!.rect.x).toBeGreaterThan(original!.rect.x);
      expect(rootState.selectionRect).toMatchObject({
        x: copy!.rect.x,
        y: copy!.rect.y,
        width: copy!.rect.width,
        height: copy!.rect.height,
      });
      expect(await readSource(page, designId)).toContain(
        `data-agent-native-node-id="${ROOT_FRAME_ID}"`,
      );
      await expect
        .poll(() => readSource(page, designId), { timeout: 20_000 })
        .toContain(`data-agent-native-node-id="${copyId}"`);

      await expandLayers(page);
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator('[role="treeitem"][aria-selected="true"]')
          .filter({ hasText: ROOT_FRAME_NAME }),
      ).toHaveCount(1);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("Option-dragging across Screens duplicates into nested auto layout", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      const design = await createCrossScreenOptionDragFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, design.designId, CROSS_SCREEN_SOURCE_ID);
      await page.keyboard.press("Shift+1");

      let previousScreenPositions = "";
      await expect
        .poll(async () => {
          const source = frameById(page, design.sourceId)
            .locator(`[data-agent-native-node-id="${CROSS_SCREEN_SOURCE_ID}"]`)
            .first();
          const target = frameById(page, design.destinationId)
            .locator(
              `[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"]`,
            )
            .first();
          const [sourceBox, targetBox] = await Promise.all([
            source.boundingBox(),
            target.boundingBox(),
          ]);
          const current = JSON.stringify({ sourceBox, targetBox });
          const settled = current === previousScreenPositions;
          previousScreenPositions = current;
          return settled;
        })
        .toBe(true);

      const source = await frameById(page, design.sourceId)
        .locator(`[data-agent-native-node-id="${CROSS_SCREEN_SOURCE_ID}"]`)
        .boundingBox();
      const target = await frameById(page, design.destinationId)
        .locator(`[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"]`)
        .boundingBox();
      expect(source).not.toBeNull();
      expect(target).not.toBeNull();
      const sourceBefore = await readSource(
        page,
        design.designId,
        "index.html",
      );
      const destinationBefore = await readSource(
        page,
        design.designId,
        "destination.html",
      );
      const sourceNode = frameById(page, design.sourceId).locator(
        `[data-agent-native-node-id="${CROSS_SCREEN_SOURCE_ID}"]`,
      );
      const sourceBeforeGeometry = await sourceNode.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          parentNodeId: node.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          cssWidth: style.width,
          cssHeight: style.height,
        };
      });

      await page.keyboard.down(PRIMARY_MODIFIER);
      await page.mouse.click(
        source!.x + source!.width / 2,
        source!.y + source!.height / 2,
      );
      await page.keyboard.up(PRIMARY_MODIFIER);
      await page.keyboard.down("Alt");
      await page.mouse.move(
        source!.x + source!.width / 2,
        source!.y + source!.height / 2,
      );
      await page.mouse.down();
      try {
        await page.mouse.move(
          source!.x + source!.width / 2 + 12,
          source!.y + 8,
          { steps: 4 },
        );
        await page.mouse.move(
          target!.x + target!.width / 2,
          target!.y + target!.height / 2,
          { steps: 30 },
        );
        await expect(
          page.locator("[data-cross-screen-drag-ghost]"),
        ).toBeVisible();
        await expect(
          page.locator("[data-cross-screen-drop-guide]"),
        ).toBeVisible();

        const sourceHeldGeometry = await sourceNode.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            parentNodeId: node.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        });
        expect(sourceHeldGeometry.parentNodeId).toBe(
          sourceBeforeGeometry.parentNodeId,
        );
        expect(sourceHeldGeometry.x).toBeCloseTo(sourceBeforeGeometry.x, 1);
        expect(sourceHeldGeometry.y).toBeCloseTo(sourceBeforeGeometry.y, 1);
        expect(sourceHeldGeometry.width).toBeCloseTo(
          sourceBeforeGeometry.width,
          1,
        );
        expect(sourceHeldGeometry.height).toBeCloseTo(
          sourceBeforeGeometry.height,
          1,
        );
        await expect(sourceNode).toHaveCount(1);
        expect(await readSource(page, design.designId, "index.html")).toBe(
          sourceBefore,
        );
        expect(
          await readSource(page, design.designId, "destination.html"),
        ).toBe(destinationBefore);
      } finally {
        await page.mouse.up();
        await page.keyboard.up("Alt");
      }

      let destinationAfter = "";
      await expect
        .poll(async () => {
          destinationAfter = await readSource(
            page,
            design.designId,
            "destination.html",
          );
          return layerIds(destinationAfter, "Cross-screen source").length;
        })
        .toBe(1);
      const copyId = layerIds(destinationAfter, "Cross-screen source")[0]!;
      expect(copyId).not.toBe(CROSS_SCREEN_SOURCE_ID);
      expect(await readSource(page, design.designId, "index.html")).toContain(
        `data-agent-native-node-id="${CROSS_SCREEN_SOURCE_ID}"`,
      );

      const copy = frameById(page, design.destinationId).locator(
        `[data-agent-native-node-id="${copyId}"]`,
      );
      await expect(copy).toHaveCount(1);
      expect(
        await copy.evaluate((node) =>
          node.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
      ).toBe(CROSS_SCREEN_DESTINATION_ID);
      await expect(
        frameById(page, design.destinationId).locator(
          `[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"] > [data-agent-native-node-id]`,
        ),
      ).toHaveCount(3);
      const destinationOrder = await frameById(page, design.destinationId)
        .locator(
          `[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"] > [data-agent-native-node-id]`,
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
        );
      expect(destinationOrder).toEqual([
        "destination-first",
        copyId,
        "destination-last",
      ]);

      const copyGeometry = await copy.evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          cssWidth: style.width,
          cssHeight: style.height,
        };
      });
      expect(copyGeometry).toMatchObject({
        background: sourceBeforeGeometry.background,
        cssWidth: sourceBeforeGeometry.cssWidth,
        cssHeight: sourceBeforeGeometry.cssHeight,
      });

      await page.keyboard.press(`${PRIMARY_MODIFIER}+z`);
      await expect
        .poll(() => readSource(page, design.designId, "destination.html"))
        .toBe(destinationBefore);
      await expect
        .poll(() => readSource(page, design.designId, "index.html"))
        .toBe(sourceBefore);

      await page.keyboard.press(`${PRIMARY_MODIFIER}+Shift+z`);
      await expect
        .poll(() => readSource(page, design.designId, "destination.html"))
        .toContain(`data-agent-native-node-id="${copyId}"`);
      const redoCopy = frameById(page, design.destinationId).locator(
        `[data-agent-native-node-id="${copyId}"]`,
      );
      await expect(redoCopy).toHaveCount(1);
      expect(
        await redoCopy.evaluate((node) =>
          node.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
      ).toBe(CROSS_SCREEN_DESTINATION_ID);
      const redoDestinationOrder = await frameById(page, design.destinationId)
        .locator(
          `[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"] > [data-agent-native-node-id]`,
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
        );
      expect(redoDestinationOrder).toEqual([
        "destination-first",
        copyId,
        "destination-last",
      ]);
      await expect
        .poll(() => readSource(page, design.designId, "index.html"))
        .toContain(`data-agent-native-node-id="${CROSS_SCREEN_SOURCE_ID}"`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: "Move", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(copy).toHaveCount(1);
      const reloadedGeometry = await copy.evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          cssWidth: style.width,
          cssHeight: style.height,
          parent: node.parentElement?.getAttribute("data-agent-native-node-id"),
        };
      });
      expect(reloadedGeometry).toMatchObject({
        x: copyGeometry.x,
        y: copyGeometry.y,
        width: copyGeometry.width,
        height: copyGeometry.height,
        background: copyGeometry.background,
        cssWidth: copyGeometry.cssWidth,
        cssHeight: copyGeometry.cssHeight,
        parent: CROSS_SCREEN_DESTINATION_ID,
      });
      expect(await readSource(page, design.designId, "index.html")).toBe(
        sourceBefore,
      );
      const reloadedDestinationOrder = await frameById(
        page,
        design.destinationId,
      )
        .locator(
          `[data-agent-native-node-id="${CROSS_SCREEN_DESTINATION_ID}"] > [data-agent-native-node-id]`,
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
        );
      expect(reloadedDestinationOrder).toEqual([
        "destination-first",
        copyId,
        "destination-last",
      ]);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("converting a base solid preserves ordered fill layers through reload", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, SHAPE_ID);
      await expandLayers(page);
      await selectLayer(page, SHAPE_NAME);

      const beforeRendered = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      const beforeImages = splitCssList(beforeRendered.backgroundImage);
      expect(beforeRendered.backgroundColor).toBe("rgb(18, 52, 86)");
      expect(beforeImages).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundSize)).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundRepeat)).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundPosition)).toHaveLength(2);

      const rows = fillSection(page).locator(
        '[data-inspector-layout="drag-paint-row"]',
      );
      await expect(rows).toHaveCount(2);
      const initialRows = await rows.allTextContents();
      expect(initialRows[0]).toMatch(/Image 1/);
      expect(initialRows[1]).toMatch(/Radial gradient 2/);

      await fillSection(page)
        .locator('[data-inspector-layout="paint-row"]')
        .getByRole("button", { name: "Open color picker" })
        .click();
      await page.getByRole("button", { name: "Linear", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Gradient stops" }),
      ).toBeVisible();

      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [SHAPE_ID]))[SHAPE_ID]
              .backgroundImage,
        )
        .toContain("linear-gradient");
      const afterRendered = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      const afterImages = splitCssList(afterRendered.backgroundImage);
      expect(afterRendered.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(afterImages.slice(0, 2)).toEqual(beforeImages);
      expect(afterImages[afterImages.length - 1]).toMatch(/^linear-gradient/i);
      expect(splitCssList(afterRendered.backgroundSize).slice(0, 2)).toEqual(
        splitCssList(beforeRendered.backgroundSize),
      );
      const afterSizes = splitCssList(afterRendered.backgroundSize);
      expect(afterSizes[afterSizes.length - 1]).toBe("auto");
      expect(splitCssList(afterRendered.backgroundRepeat).slice(0, 2)).toEqual(
        splitCssList(beforeRendered.backgroundRepeat),
      );
      const afterRepeats = splitCssList(afterRendered.backgroundRepeat);
      expect(afterRepeats[afterRepeats.length - 1]).toBe("no-repeat");
      expect(
        splitCssList(afterRendered.backgroundPosition).slice(0, 2),
      ).toEqual(splitCssList(beforeRendered.backgroundPosition));
      const afterPositions = splitCssList(afterRendered.backgroundPosition);
      expect(afterPositions[afterPositions.length - 1]).toBe("0% 0%");

      await expect
        .poll(async () => {
          const saved = (await readSourceStyles(page, designId, [SHAPE_ID]))[
            SHAPE_ID
          ];
          return splitCssList(saved.backgroundImage).length;
        })
        .toBe(3);
      const savedBeforeReload = (
        await readSourceStyles(page, designId, [SHAPE_ID])
      )[SHAPE_ID];
      const savedImages = splitCssList(savedBeforeReload.backgroundImage);
      expect(savedImages[0]).toMatch(/^url\(/i);
      expect(savedImages[1]).toMatch(/^radial-gradient/i);
      expect(savedImages[2]).toMatch(/^linear-gradient/i);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForEditor(page, SHAPE_ID);
      await enterDirectMode(page);
      await expandLayers(page);
      await selectLayer(page, SHAPE_NAME);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [SHAPE_ID]))[SHAPE_ID]
              .backgroundImage,
        )
        .toContain("linear-gradient");
      const afterReload = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      expect(splitCssList(afterReload.backgroundImage)).toEqual(afterImages);
      expect(splitCssList(afterReload.backgroundSize)).toEqual(
        splitCssList(afterRendered.backgroundSize),
      );
      expect(splitCssList(afterReload.backgroundRepeat)).toEqual(
        splitCssList(afterRendered.backgroundRepeat),
      );
      expect(splitCssList(afterReload.backgroundPosition)).toEqual(
        splitCssList(afterRendered.backgroundPosition),
      );
      const reloadedRows = fillSection(page).locator(
        '[data-inspector-layout="drag-paint-row"]',
      );
      await expect(reloadedRows).toHaveCount(3);
      const reloadedRowText = await reloadedRows.allTextContents();
      expect(reloadedRowText[0]).toMatch(/Image 1/);
      expect(reloadedRowText[1]).toMatch(/Radial gradient 2/);
      expect(reloadedRowText[2]).toMatch(/Linear gradient 3/);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("report path: authored #101010 selection color finds only matching layers after reload", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(
        page,
        (id) => {
          designId = id;
        },
        SELECTION_COLOR_FIXTURE,
      );
      await openEditor(page, designId, SELECTION_COLOR_FRAME_ID);
      await expandLayers(page);
      await selectLayer(page, SELECTION_COLOR_FRAME_NAME);

      const tree = page.getByRole("tree", { name: "Layers" });
      const selectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await selectionColors
        .getByRole("button", { name: "Show selection colors" })
        .click();
      await expect(
        selectionColors.locator('button[aria-label^="#"]'),
      ).toHaveAttribute("aria-label", "#101010");
      await expect(
        selectionColors.locator('button[aria-label^="#"]'),
      ).toHaveCount(1);
      await selectionColors
        .locator('button[aria-label="Find layers: #101010"]')
        .click();

      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_FRAME_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_MATCHING_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_OTHER_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "false");

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForEditor(page, SELECTION_COLOR_FRAME_ID);
      await enterDirectMode(page);
      await expandLayers(page);
      await selectLayer(page, SELECTION_COLOR_FRAME_NAME);
      const reloadedSelectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await reloadedSelectionColors
        .getByRole("button", { name: "Show selection colors" })
        .click();
      await expect(
        reloadedSelectionColors.locator('button[aria-label^="#"]'),
      ).toHaveAttribute("aria-label", "#101010");
      await expect(
        reloadedSelectionColors.locator('button[aria-label^="#"]'),
      ).toHaveCount(1);
      await reloadedSelectionColors
        .locator('button[aria-label="Find layers: #101010"]')
        .click();
      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_FRAME_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_MATCHING_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        tree
          .getByRole("button", {
            name: SELECTION_COLOR_OTHER_NAME,
            exact: true,
          })
          .locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "false");
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("multi-selected text shares size, undoes once, and persists after reload", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, HEADING_ID);
      await expandLayers(page);
      await selectLayer(page, HEADING_NAME);
      await selectLayer(page, BODY_NAME, true);
      await expect
        .poll(() =>
          page.locator('[role="treeitem"][aria-selected="true"]').count(),
        )
        .toBe(2);

      const before = await readRenderedStyles(page, [HEADING_ID, BODY_ID]);
      expect(before[HEADING_ID].fontWeight).not.toBe(
        before[BODY_ID].fontWeight,
      );
      expect(before[HEADING_ID].fontSize).not.toBe(before[BODY_ID].fontSize);
      const size = typographySection(page).locator(
        'input[aria-label="Size" i]',
      );
      await expect(size).toHaveValue("Mixed");
      await size.fill(FINAL_TEXT_SIZE);
      await size.press("Enter");
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);

      await page.keyboard.press(`${PRIMARY_MODIFIER}+z`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(before[HEADING_ID].fontSize);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(before[BODY_ID].fontSize);

      await size.fill(FINAL_TEXT_SIZE);
      await size.press("Enter");
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(async () => {
          const saved = await readSourceStyles(page, designId, [
            HEADING_ID,
            BODY_ID,
          ]);
          return [saved[HEADING_ID].fontSize, saved[BODY_ID].fontSize];
        })
        .toEqual([`${FINAL_TEXT_SIZE}px`, `${FINAL_TEXT_SIZE}px`]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForEditor(page, HEADING_ID);
      await enterDirectMode(page);
      await expandLayers(page);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      const savedAfterReload = await readSourceStyles(page, designId, [
        HEADING_ID,
        BODY_ID,
      ]);
      expect(savedAfterReload[HEADING_ID].fontSize).toBe(
        `${FINAL_TEXT_SIZE}px`,
      );
      expect(savedAfterReload[BODY_ID].fontSize).toBe(`${FINAL_TEXT_SIZE}px`);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });
});
