import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { appPath, expandAllLayers, gotoEditor } from "./helpers";

const HORIZONTAL_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Layers panel auto layout</title></head>
  <body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="hrow" data-agent-native-layer-name="Horizontal row" style="position:absolute;left:40px;top:40px;width:560px;height:104px;box-sizing:border-box;display:flex;flex-direction:row;flex-wrap:nowrap;gap:16px;padding:12px 18px;background:#1e293b">
      <div data-agent-native-node-id="h-first" data-agent-native-layer-name="H First" style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#38bdf8">H First</div>
      <div data-agent-native-node-id="h-middle" data-agent-native-layer-name="H Middle" style="box-sizing:border-box;flex:0 0 110px;width:110px;height:56px;background:#a78bfa">H Middle</div>
      <div data-agent-native-node-id="h-last" data-agent-native-layer-name="H Last" style="box-sizing:border-box;flex:0 0 90px;width:90px;height:56px;background:#fbbf24">H Last</div>
    </section>
    <section data-agent-native-node-id="vcol" data-agent-native-layer-name="Vertical column" style="position:absolute;left:40px;top:190px;width:260px;height:210px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:10px 20px 30px 40px;background:#1e293b">
      <div data-agent-native-node-id="v-first" data-agent-native-layer-name="V First" style="flex:0 0 42px;height:42px;background:#34d399">V First</div>
      <div data-agent-native-node-id="v-middle" data-agent-native-layer-name="V Middle" style="flex:0 0 44px;height:44px;background:#fb7185">V Middle</div>
      <div data-agent-native-node-id="v-last" data-agent-native-layer-name="V Last" style="flex:0 0 38px;height:38px;background:#f97316">V Last</div>
    </section>
    <section data-agent-native-node-id="nested-outer" data-agent-native-layer-name="Nested outer" style="position:absolute;left:350px;top:200px;width:400px;height:190px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
      <section data-agent-native-node-id="nested-inner" data-agent-native-layer-name="Nested inner" style="box-sizing:border-box;display:flex;flex-direction:row;gap:10px;padding:8px;width:360px;height:92px;background:#475569">
        <div data-agent-native-node-id="inner-first" data-agent-native-layer-name="Inner First" style="flex:0 0 100px;width:100px;height:40px;background:#e2e8f0;color:#0f172a">Inner First</div>
        <div data-agent-native-node-id="inner-last" data-agent-native-layer-name="Inner Last" style="flex:0 0 120px;width:120px;height:40px;background:#c4b5fd;color:#2e1065">Inner Last</div>
      </section>
      <div data-agent-native-node-id="nested-marker" data-agent-native-layer-name="Nested marker" style="width:100px;height:34px;background:#64748b">Marker</div>
    </section>
    <div data-agent-native-node-id="free-source" data-agent-native-layer-name="Free source" style="position:absolute;left:780px;top:60px;width:76px;height:44px;background:#22d3ee">Free</div>
  </body>
</html>`;

const SECOND_SCREEN_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Second screen</title></head>
<body style="margin:0;position:relative;width:1000px;height:780px;display:flex;flex-direction:row;gap:14px;padding:24px;box-sizing:border-box;background:#111827;color:#f8fafc">
  <section data-agent-native-node-id="screen-row" data-agent-native-layer-name="Screen row" style="position:absolute;left:80px;top:120px;width:400px;height:140px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#334155">
    <div data-agent-native-node-id="screen-anchor" data-agent-native-layer-name="Screen anchor" style="flex:0 0 120px;width:120px;height:50px;background:#94a3b8;color:#0f172a">Anchor</div>
  </section>
</body></html>`;

const CANVAS_FLOW_DRAG_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Canvas flow drag</title></head>
<body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif">
  <section data-agent-native-node-id="flow-origin" data-agent-native-layer-name="Flow origin" style="position:absolute;left:60px;top:70px;width:320px;height:100px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#1e293b">
    <div data-agent-native-node-id="flow-child" data-agent-native-layer-name="Flow child" style="flex:0 0 120px;width:120px;height:56px;background:#38bdf8">Child</div>
    <div data-agent-native-node-id="flow-peer" data-agent-native-layer-name="Flow peer" style="flex:0 0 100px;width:100px;height:56px;background:#a78bfa">Peer</div>
  </section>
  <section data-agent-native-node-id="flow-target" data-agent-native-layer-name="Flow target" style="position:absolute;left:500px;top:70px;width:300px;height:150px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:12px;background:#334155">
    <div data-agent-native-node-id="target-existing" data-agent-native-layer-name="Target existing" style="flex:0 0 52px;height:52px;background:#fbbf24;color:#0f172a">Existing</div>
  </section>
</body></html>`;

type FileRecord = { id: string; filename: string; content: string };
type DesignRecord = { files?: FileRecord[] };

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function readDesign(
  request: APIRequestContext,
  designId: string,
): Promise<DesignRecord> {
  const response = await request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return response.json() as Promise<DesignRecord>;
}

async function createDesign(
  request: APIRequestContext,
  withSecondScreen = false,
  primaryHtml = HORIZONTAL_FIXTURE,
): Promise<{ id: string; primaryId: string; secondId?: string }> {
  const created = await action(request, "create-design", {
    title: `Layers panel auto layout ${Date.now()}`,
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (typeof id !== "string") throw new Error("create-design returned no id");
  try {
    await action(request, "create-file", {
      designId: id,
      filename: "index.html",
      content: primaryHtml,
      fileType: "html",
    });
    if (withSecondScreen) {
      await action(request, "create-file", {
        designId: id,
        filename: "second.html",
        content: SECOND_SCREEN_FIXTURE,
        fileType: "html",
      });
    }
    const record = await readDesign(request, id);
    const primaryId = record.files?.find(
      (file) => file.filename === "index.html",
    )?.id;
    const secondId = record.files?.find(
      (file) => file.filename === "second.html",
    )?.id;
    if (!primaryId || (withSecondScreen && !secondId))
      throw new Error("fixture files are missing");
    const dataOperations = [
      {
        op: "set",
        path: ["screenMetadata", primaryId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", primaryId],
        value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
      },
    ];
    if (secondId) {
      dataOperations.push(
        {
          op: "set",
          path: ["screenMetadata", secondId],
          value: { sourceType: "inline", width: 1000, height: 780 },
        },
        {
          op: "set",
          path: ["canvasFrames", secondId],
          value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
        },
      );
    }
    await action(request, "update-design", { id, dataOperations });
    return { id, primaryId, secondId };
  } catch (error) {
    await deleteDesign(request, id);
    throw error;
  }
}

async function deleteDesign(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await action(request, "delete-design", { id });
}

async function fileHtml(
  request: APIRequestContext,
  designId: string,
  fileId: string,
): Promise<string> {
  const record = await readDesign(request, designId);
  const file = record.files?.find((candidate) => candidate.id === fileId);
  if (!file) throw new Error(`design file ${fileId} is missing`);
  return file.content;
}

function nodeOffset(html: string, nodeId: string): number {
  return html.indexOf(`data-agent-native-node-id="${nodeId}"`);
}

type HtmlParent = { id: string | null; tag: string };

function nodeParent(
  html: string,
  nodeId: string,
): HtmlParent | null | undefined {
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const tagPattern = /<\/?([a-z][^\s/>]*)(?:\s[^>]*)?>/gi;
  const stack: Array<{ id: string | null; tag: string }> = [];
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (tag.startsWith("</")) {
      if (stack.length > 0 && stack[stack.length - 1]?.tag === tagName) {
        stack.pop();
      }
      continue;
    }
    const nodeMatch = tag.match(
      /data-agent-native-node-id=(?:"([^"]+)"|'([^']+)')/i,
    );
    const currentId = nodeMatch?.[1] ?? nodeMatch?.[2] ?? null;
    if (currentId === nodeId) {
      return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
    }
    if (!voidTags.has(tagName) && !tag.endsWith("/>")) {
      stack.push({ id: currentId, tag: tagName });
    }
  }
  return undefined;
}

function nodeParentId(html: string, nodeId: string): string | null | undefined {
  const parent = nodeParent(html, nodeId);
  if (parent === undefined) return undefined;
  return parent?.id?.startsWith("an-") ? null : (parent?.id ?? null);
}

function semanticNodeHtml(html: string, nodeId: string): string | undefined {
  const nodeOffset = html.indexOf(`data-agent-native-node-id="${nodeId}"`);
  if (nodeOffset < 0) return undefined;
  const nodeStart = html.lastIndexOf("<", nodeOffset);
  const openingTag = html.slice(nodeStart).match(/^<([a-z][^\s/>]*)/i);
  if (!openingTag) return undefined;
  const nodeTag = openingTag[1].toLowerCase();
  const tagPattern = /<\/?([a-z][^\s/>]*)(?:\s[^>]*)?>/gi;
  let depth = 0;
  for (const match of html.slice(nodeStart).matchAll(tagPattern)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (tag.startsWith("</")) {
      if (tagName !== nodeTag) continue;
      depth -= 1;
      if (depth === 0) {
        return html
          .slice(nodeStart, nodeStart + (match.index ?? 0) + tag.length)
          .replace(/\sdata-agent-native-node-id="an-[^"]*"/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      continue;
    }
    if (
      tagName === nodeTag &&
      !tag.endsWith("/>") &&
      !/^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(
        tag,
      )
    ) {
      depth += 1;
    }
  }
  return undefined;
}

function nodeIsBefore(
  html: string,
  beforeId: string,
  afterId: string,
): boolean {
  const beforeOffset = nodeOffset(html, beforeId);
  const afterOffset = nodeOffset(html, afterId);
  return beforeOffset >= 0 && afterOffset >= 0 && beforeOffset < afterOffset;
}

function nodeIsInsideSection(
  html: string,
  sectionId: string,
  nodeId: string,
): boolean {
  let inTargetSection = false;
  let targetSectionDepth = 0;
  const tagPattern = /<\/?([a-z][^\s/>]*)(?:\s[^>]*)?>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = tag.startsWith("</");
    if (isClosing) {
      if (inTargetSection && tagName === "section") {
        targetSectionDepth -= 1;
        if (targetSectionDepth === 0) inTargetSection = false;
      }
      continue;
    }
    const nodeMatch = tag.match(
      /data-agent-native-node-id=(?:"([^"]+)"|'([^']+)')/i,
    );
    const currentNodeId = nodeMatch?.[1] ?? nodeMatch?.[2];
    if (inTargetSection && currentNodeId === nodeId) return true;
    if (tagName !== "section" || /\/\s*>$/.test(tag)) continue;
    if (currentNodeId === sectionId) {
      inTargetSection = true;
      targetSectionDepth = 1;
    } else if (inTargetSection) {
      targetSectionDepth += 1;
    }
  }
  return false;
}

async function waitForPersistedHtml(
  request: APIRequestContext,
  designId: string,
  fileId: string,
  predicate: (html: string) => boolean,
): Promise<string> {
  let html = "";
  await expect
    .poll(
      async () => {
        html = await fileHtml(request, designId, fileId);
        return predicate(html);
      },
      {
        timeout: 5_000,
        intervals: [100, 200, 400, 800],
        message: "expected the layer move to reach persisted source HTML",
      },
    )
    .toBe(true);
  return html;
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function layerButton(page: Page, name: string): Locator {
  return layersTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${cssString(name)}"]`) })
    .first();
}

function layerRow(page: Page, name: string): Locator {
  return layerButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

function frame(page: Page, screenId?: string) {
  return page
    .locator(
      screenId
        ? `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`
        : "iframe[data-design-preview-iframe]",
    )
    .first()
    .contentFrame();
}

async function directChildren(page: Page, parentId: string, screenId?: string) {
  return frame(page, screenId)
    .locator(
      `[data-agent-native-node-id="${parentId}"] > [data-agent-native-node-id]`,
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
    );
}

async function rootChildren(page: Page, screenId: string) {
  return frame(page, screenId)
    .locator("body > [data-agent-native-node-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
    );
}

async function nodeBox(page: Page, nodeId: string, screenId?: string) {
  const box = await frame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`node ${nodeId} has no bounding box`);
  return box;
}

async function parentId(page: Page, nodeId: string, screenId?: string) {
  return frame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate(
      (node) =>
        node.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
    );
}

async function panelParentName(
  page: Page,
  layerName: string,
): Promise<string | null> {
  return layerRow(page, layerName).evaluate((row) => {
    const item = row.closest<HTMLElement>('[role="treeitem"]');
    const tree = item?.closest<HTMLElement>('[role="tree"]');
    if (!item || !tree) return null;
    const level = Number(item.getAttribute("aria-level"));
    const items = Array.from(
      tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    const index = items.indexOf(item);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (Number(items[i]?.getAttribute("aria-level")) < level) {
        return (
          items[i]?.querySelector<HTMLElement>("span[title]")?.title ?? null
        );
      }
    }
    return null;
  });
}

async function heldCanvasDrag(
  page: Page,
  sourceId: string,
  destination: { x: number; y: number },
  onHeld: () => Promise<void>,
): Promise<void> {
  const sourceBox = await nodeBox(page, sourceId);
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  try {
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 14,
      sourceBox.y + sourceBox.height / 2 + 6,
      { steps: 8 },
    );
    await page.mouse.move(destination.x, destination.y, { steps: 24 });
    await page.waitForTimeout(350);
    await onHeld();
  } finally {
    await page.mouse.up();
  }
}

async function parentTag(page: Page, nodeId: string, screenId?: string) {
  return frame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => node.parentElement?.tagName ?? null);
}

async function heldPanelDrag(
  page: Page,
  sourceName: string,
  targetName: string,
  targetPosition: "leading" | "middle" | "trailing" = "middle",
  onHeld?: () => Promise<void>,
): Promise<{
  indicator: { placement: string; count: number };
  sourceBox: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  targetBox: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
}> {
  const source = layerRow(page, sourceName);
  const target = layerRow(page, targetName);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("layer row has no box");
  const targetY =
    targetPosition === "leading"
      ? targetBox.y + 2
      : targetPosition === "trailing"
        ? targetBox.y + targetBox.height - 2
        : targetBox.y + targetBox.height / 2;
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  let mouseHeld = false;
  try {
    mouseHeld = true;
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 14,
      sourceBox.y + sourceBox.height / 2 + 6,
      {
        steps: 8,
      },
    );
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, {
      steps: 24,
    });
    await page.waitForTimeout(350);
    const indicators = page.locator("[data-layer-drop-indicator]");
    const count = await indicators.count();
    const placement =
      count > 0
        ? ((await indicators
            .first()
            .getAttribute("data-layer-drop-indicator")) ?? "")
        : "";
    await onHeld?.();
    return { indicator: { placement, count }, sourceBox, targetBox };
  } finally {
    if (mouseHeld) await page.mouse.up();
  }
}

test.use({ viewport: { width: 1600, height: 1100 } });

test.describe("Layers-panel auto-layout parity", () => {
  test("canvas flow drag previews root and frame tree placement before release", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, false, CANVAS_FLOW_DRAG_FIXTURE);
    try {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      await expect(layerButton(page, "Flow child")).toBeVisible();
      expect(await panelParentName(page, "Flow child")).toBe("Flow origin");
      await layerButton(page, "Flow child").click();
      const original = await fileHtml(request, design.id, design.primaryId);
      expect(
        original.match(/data-agent-native-node-id="flow-child"/g),
      ).toHaveLength(1);
      const bodyBox = await frame(page).locator("body").boundingBox();
      if (!bodyBox) throw new Error("design body has no box");

      await heldCanvasDrag(
        page,
        "flow-child",
        {
          x: bodyBox.x + 420,
          y: bodyBox.y + 300,
        },
        async () => {
          expect(await panelParentName(page, "Flow child")).toBe("Home");
          expect(
            await frame(page)
              .locator("[data-agent-native-insertion-guide]")
              .evaluate((node) => getComputedStyle(node).display),
          ).toBe("block");
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
          expect(await parentId(page, "flow-child")).toBe("flow-origin");
          await page.mouse.move(bodyBox.x - 80, bodyBox.y + 80, { steps: 4 });
          await page.waitForTimeout(80);
          await page.mouse.move(bodyBox.x + 420, bodyBox.y + 300, {
            steps: 4,
          });
          await page.waitForTimeout(120);
          expect(pageErrors).toEqual([]);
        },
      );
      await expect.poll(() => panelParentName(page, "Flow child")).toBe("Home");
      await expect.poll(() => parentTag(page, "flow-child")).toBe("BODY");
      const moved = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          (html.match(/data-agent-native-node-id="flow-child"/g) ?? [])
            .length === 1 &&
          !nodeIsInsideSection(html, "flow-origin", "flow-child"),
      );
      expect(
        moved.match(/data-agent-native-node-id="flow-child"/g),
      ).toHaveLength(1);
      expect(nodeParentId(moved, "flow-child")).toBeNull();
      expect(nodeIsInsideSection(moved, "flow-origin", "flow-child")).toBe(
        false,
      );

      const undoMod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(undoMod);
      await page.keyboard.press("z");
      await page.keyboard.up(undoMod);
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow origin");
      await expect.poll(() => parentId(page, "flow-child")).toBe("flow-origin");
      await expect
        .poll(() => fileHtml(request, design.id, design.primaryId))
        .toBe(original);

      await heldCanvasDrag(
        page,
        "flow-child",
        {
          x: bodyBox.x + 420,
          y: bodyBox.y + 300,
        },
        async () => {
          expect(await panelParentName(page, "Flow child")).toBe("Home");
          await page.keyboard.press("Escape");
          await expect
            .poll(() => panelParentName(page, "Flow child"))
            .toBe("Flow origin");
          await expect
            .poll(() => parentId(page, "flow-child"))
            .toBe("flow-origin");
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );

      await page.reload();
      await expandAllLayers(page);
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow origin");

      const targetBox = await nodeBox(page, "flow-target");
      await heldCanvasDrag(
        page,
        "flow-child",
        {
          x: targetBox.x + targetBox.width / 2,
          y: targetBox.y + targetBox.height / 2,
        },
        async () => {
          await expect(layerButton(page, "Flow child")).toHaveCount(1);
          await expect
            .poll(() => panelParentName(page, "Flow child"))
            .toBe("Flow target");
          expect(await parentId(page, "flow-child")).toBe("flow-origin");
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow target");
      await expect.poll(() => parentId(page, "flow-child")).toBe("flow-target");
      const nestedPersisted = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          (html.match(/data-agent-native-node-id="flow-child"/g) ?? [])
            .length === 1 &&
          nodeIsInsideSection(html, "flow-target", "flow-child"),
      );
      expect(
        nodeIsInsideSection(nestedPersisted, "flow-origin", "flow-child"),
      ).toBe(false);
      const crossUndoMod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(crossUndoMod);
      await page.keyboard.press("z");
      await page.keyboard.up(crossUndoMod);
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow origin");
      await expect.poll(() => parentId(page, "flow-child")).toBe("flow-origin");
      await expect
        .poll(() =>
          fileHtml(request, design.id, design.primaryId).then((html) =>
            nodeIsInsideSection(html, "flow-origin", "flow-child"),
          ),
        )
        .toBe(true);
      await page.keyboard.down(crossUndoMod);
      await page.keyboard.down("Shift");
      await page.keyboard.press("z");
      await page.keyboard.up("Shift");
      await page.keyboard.up(crossUndoMod);
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow target");
      await expect
        .poll(() =>
          fileHtml(request, design.id, design.primaryId).then((html) =>
            nodeIsInsideSection(html, "flow-target", "flow-child"),
          ),
        )
        .toBe(true);
      await page.reload();
      await expandAllLayers(page);
      await expect
        .poll(() => panelParentName(page, "Flow child"))
        .toBe("Flow target");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("row drag exposes a held insertion line and reorders the horizontal flow child", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      await expect(layerButton(page, "H Last")).toBeVisible();
      const before = await directChildren(page, "hrow");
      expect(before).toEqual(["h-first", "h-middle", "h-last"]);
      const original = await fileHtml(request, design.id, design.primaryId);
      const beforeGeometry = await Promise.all(
        ["h-first", "h-middle", "h-last"].map((nodeId) =>
          nodeBox(page, nodeId),
        ),
      );
      const result = await heldPanelDrag(
        page,
        "H Middle",
        "H Last",
        "leading",
        async () => {
          expect(await directChildren(page, "hrow")).toEqual([
            "h-first",
            "h-middle",
            "h-last",
          ]);
          expect(
            await Promise.all(
              ["h-first", "h-middle", "h-last"].map((nodeId) =>
                nodeBox(page, nodeId),
              ),
            ),
          ).toEqual(beforeGeometry);
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "before", count: 1 });
      await expect
        .poll(() => directChildren(page, "hrow"))
        .toEqual(["h-first", "h-last", "h-middle"]);
      const persisted = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          nodeIsBefore(html, "h-first", "h-last") &&
          nodeIsBefore(html, "h-last", "h-middle"),
      );
      expect(persisted).not.toEqual(original);

      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(mod);
      await page.keyboard.press("z");
      await page.keyboard.up(mod);
      await expect
        .poll(() => directChildren(page, "hrow"))
        .toEqual(["h-first", "h-middle", "h-last"]);
      const undone = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          nodeIsInsideSection(html, "hrow", "h-middle") &&
          nodeIsInsideSection(html, "hrow", "h-last") &&
          nodeIsBefore(html, "h-middle", "h-last"),
      );
      expect(semanticNodeHtml(undone, "hrow")).toBe(
        semanticNodeHtml(original, "hrow"),
      );

      await page.keyboard.down(mod);
      await page.keyboard.down("Shift");
      await page.keyboard.press("z");
      await page.keyboard.up("Shift");
      await page.keyboard.up(mod);
      await expect
        .poll(() => directChildren(page, "hrow"))
        .toEqual(["h-first", "h-last", "h-middle"]);
      await waitForPersistedHtml(request, design.id, design.primaryId, (html) =>
        nodeIsBefore(html, "h-last", "h-middle"),
      );

      await page.reload();
      await expandAllLayers(page);
      await expect
        .poll(() => directChildren(page, "hrow"))
        .toEqual(["h-first", "h-last", "h-middle"]);
      await expect(layerRow(page, "H Middle")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("nested auto-layout row drag reorders its children with a held inside tree", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      const before = await directChildren(page, "nested-inner");
      expect(before).toEqual(["inner-first", "inner-last"]);
      const original = await fileHtml(request, design.id, design.primaryId);
      const result = await heldPanelDrag(
        page,
        "Inner First",
        "Inner Last",
        "leading",
        async () => {
          expect(await directChildren(page, "nested-inner")).toEqual(before);
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "before", count: 1 });
      await expect
        .poll(() => directChildren(page, "nested-inner"))
        .toEqual(["inner-last", "inner-first"]);
      const persisted = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          nodeIsInsideSection(html, "nested-inner", "inner-first") &&
          nodeIsBefore(html, "inner-last", "inner-first"),
      );
      await expect(layerRow(page, "Inner First")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("nested auto-layout parent accepts a physical Layers-panel reparent with undo/redo", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      const before = await directChildren(page, "nested-inner");
      expect(before).toEqual(["inner-first", "inner-last"]);
      const sourceParentBefore = await parentId(page, "free-source");
      expect(sourceParentBefore).toMatch(/^an-/);
      expect(await parentTag(page, "free-source")).toBe("BODY");
      const original = await fileHtml(request, design.id, design.primaryId);
      const sourceWasAfterOuter = nodeIsBefore(
        original,
        "nested-outer",
        "free-source",
      );
      expect(sourceWasAfterOuter).toBe(true);
      const result = await heldPanelDrag(
        page,
        "Free source",
        "Nested inner",
        "middle",
        async () => {
          expect(await directChildren(page, "nested-inner")).toEqual(before);
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "inside", count: 1 });
      await expect
        .poll(() => parentId(page, "free-source"))
        .toBe("nested-inner");
      const persisted = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) => nodeIsInsideSection(html, "nested-inner", "free-source"),
      );
      expect(nodeParentId(persisted, "free-source")).toBe("nested-inner");
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(mod);
      await page.keyboard.press("z");
      await page.keyboard.up(mod);
      await expect.poll(() => parentTag(page, "free-source")).toBe("BODY");
      const undone = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) =>
          html !== persisted &&
          nodeParent(html, "free-source")?.tag === "body" &&
          nodeOffset(html, "free-source") >= 0 &&
          nodeIsBefore(html, "nested-outer", "free-source") ===
            sourceWasAfterOuter &&
          nodeOffset(html, "nested-outer") >= 0,
      );
      expect(nodeParent(undone, "free-source")?.tag).toBe("body");
      expect(nodeIsBefore(undone, "nested-outer", "free-source")).toBe(
        sourceWasAfterOuter,
      );

      await page.keyboard.down(mod);
      await page.keyboard.down("Shift");
      await page.keyboard.press("z");
      await page.keyboard.up("Shift");
      await page.keyboard.up(mod);
      await expect
        .poll(() => parentId(page, "free-source"))
        .toBe("nested-inner");
      const redone = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) => nodeParentId(html, "free-source") === "nested-inner",
      );
      expect(nodeParentId(redone, "free-source")).toBe("nested-inner");

      await page.reload();
      await expandAllLayers(page);
      await expect
        .poll(() => parentId(page, "free-source"))
        .toBe("nested-inner");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("vertical auto-layout row drag uses the panel line and persists the reorder", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      const before = await directChildren(page, "vcol");
      expect(before).toEqual(["v-first", "v-middle", "v-last"]);
      const original = await fileHtml(request, design.id, design.primaryId);
      const result = await heldPanelDrag(
        page,
        "V Middle",
        "V Last",
        "leading",
        async () => {
          expect(await directChildren(page, "vcol")).toEqual(before);
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "before", count: 1 });
      await expect
        .poll(() => directChildren(page, "vcol"))
        .toEqual(["v-first", "v-last", "v-middle"]);
      const persisted = await waitForPersistedHtml(
        request,
        design.id,
        design.primaryId,
        (html) => nodeIsBefore(html, "v-last", "v-middle"),
      );
      await expect(layerRow(page, "V Middle")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("Layers-panel drag into a second Screen root keeps the source held until release and persists across files", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, true);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      await expect(layerButton(page, "Second")).toBeVisible();
      const sourceBefore = await fileHtml(request, design.id, design.primaryId);
      const destinationBefore = await fileHtml(
        request,
        design.id,
        design.secondId!,
      );
      const rootBefore = await rootChildren(page, design.secondId!);
      expect(rootBefore).toEqual(["screen-row"]);
      const result = await heldPanelDrag(
        page,
        "Free source",
        "Second",
        "middle",
        async () => {
          expect(await rootChildren(page, design.secondId!)).toEqual(
            rootBefore,
          );
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            sourceBefore,
          );
          expect(await fileHtml(request, design.id, design.secondId!)).toBe(
            destinationBefore,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "inside", count: 1 });
      await expect
        .poll(() => rootChildren(page, design.secondId!))
        .toContain("free-source");
      let persistedSource = "";
      let persistedDestination = "";
      await expect
        .poll(
          async () => {
            [persistedSource, persistedDestination] = await Promise.all([
              fileHtml(request, design.id, design.primaryId),
              fileHtml(request, design.id, design.secondId!),
            ]);
            return {
              sourceHasNode: persistedSource.includes(
                'data-agent-native-node-id="free-source"',
              ),
              destinationHasNode: persistedDestination.includes(
                'data-agent-native-node-id="free-source"',
              ),
            };
          },
          {
            timeout: 5_000,
            intervals: [100, 200, 400, 800],
            message: "expected the Screen-root cross-file move to persist",
          },
        )
        .toEqual({ sourceHasNode: false, destinationHasNode: true });
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(mod);
      await page.keyboard.press("z");
      await page.keyboard.up(mod);
      await expect
        .poll(() => rootChildren(page, design.secondId!))
        .toEqual(rootBefore);
      await expect
        .poll(async () => {
          const [source, destination] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            sourceHasNode: source.includes(
              'data-agent-native-node-id="free-source"',
            ),
            destinationHasNode: destination.includes(
              'data-agent-native-node-id="free-source"',
            ),
          };
        })
        .toEqual({ sourceHasNode: true, destinationHasNode: false });

      await page.keyboard.down(mod);
      await page.keyboard.down("Shift");
      await page.keyboard.press("z");
      await page.keyboard.up("Shift");
      await page.keyboard.up(mod);
      await expect
        .poll(() => rootChildren(page, design.secondId!))
        .toContain("free-source");
      await expect
        .poll(async () => {
          const [source, destination] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            sourceHasNode: source.includes(
              'data-agent-native-node-id="free-source"',
            ),
            destinationHasNode: destination.includes(
              'data-agent-native-node-id="free-source"',
            ),
          };
        })
        .toEqual({ sourceHasNode: false, destinationHasNode: true });

      await page.reload();
      await expandAllLayers(page);
      await expect
        .poll(() => rootChildren(page, design.secondId!))
        .toContain("free-source");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("self-drop is an invalid target and leaves flow order and source unchanged", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      const before = await directChildren(page, "hrow");
      const original = await fileHtml(request, design.id, design.primaryId);
      const result = await heldPanelDrag(
        page,
        "H Middle",
        "H Middle",
        "middle",
        async () => {
          expect(
            await page.locator("[data-layer-drop-indicator]").count(),
          ).toBe(0);
          expect(await directChildren(page, "hrow")).toEqual(before);
          expect(await fileHtml(request, design.id, design.primaryId)).toBe(
            original,
          );
        },
      );
      expect(result.indicator).toEqual({ placement: "", count: 0 });
      expect(await directChildren(page, "hrow")).toEqual(before);
      expect(await fileHtml(request, design.id, design.primaryId)).toBe(
        original,
      );
    } finally {
      await deleteDesign(request, design.id);
    }
  });
});
