import {
  expect,
  test,
  type APIRequestContext,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 600;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const BLANK_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Untitled Potion</title></head>
  <body style="margin:0;width:${SCREEN_WIDTH}px;height:${SCREEN_HEIGHT}px;overflow:hidden;background:#ffffff">
    <main data-agent-native-node-id="potion-stage" data-agent-native-layer-name="Potion stage" data-an-primitive="frame" style="position:relative;width:${SCREEN_WIDTH}px;height:${SCREEN_HEIGHT}px"></main>
  </body>
</html>`;

const EXPORT_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Potion export</title></head>
  <body style="margin:0;width:200px;height:271px;overflow:hidden;background:#ffffff">
    <main data-agent-native-node-id="potion-export-stage" data-agent-native-layer-name="Potion export" data-an-primitive="frame" style="position:relative;width:200px;height:271px"></main>
  </body>
</html>`;

type SourceNode = {
  id: string;
  primitive: string | null;
  name: string | null;
};

let baseURL = "";

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(async ({}, workerInfo) => {
  baseURL = (workerInfo.project.use.baseURL as string | undefined) ?? "";
});

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createBlankDesign(
  request: APIRequestContext,
  source = BLANK_SCREEN,
  dimensions = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
): Promise<{ designId: string; screenId: string }> {
  const created = await action(request, "create-design", {
    title: `Potion oracle ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (typeof designId !== "string")
    throw new Error("create-design returned no id");

  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: source,
    fileType: "html",
  });
  const screenId = file?.id ?? file?.data?.id ?? file?.file?.id;
  if (typeof screenId !== "string")
    throw new Error("create-file returned no id");

  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: {
          sourceType: "inline",
          width: dimensions.width,
          height: dimensions.height,
        },
      },
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: dimensions.height,
          z: 0,
        },
      },
    ],
  });
  return { designId, screenId };
}

async function readDesignFiles(
  page: Page,
  designId: string,
): Promise<Array<{ id?: string; filename?: string; content?: string }>> {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok())
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  const payload = await response.json();
  const design = [
    payload,
    payload?.result,
    payload?.design,
    payload?.data,
  ].find((candidate) => Array.isArray(candidate?.files));
  return design?.files ?? [];
}

async function source(
  page: Page,
  designId: string,
  filename = "index.html",
): Promise<string> {
  const file = (await readDesignFiles(page, designId)).find(
    (candidate) => candidate.filename === filename,
  );
  if (typeof file?.content !== "string")
    throw new Error(`${filename} has no content`);
  return file.content;
}

async function persistedSource(
  page: Page,
  designId: string,
  predicate: (content: string) => boolean,
  timeout = 15_000,
): Promise<string> {
  let latest = "";
  await expect
    .poll(
      async () => {
        latest = await source(page, designId);
        return predicate(latest);
      },
      { timeout },
    )
    .toBe(true);
  return latest;
}

async function sourceReceipt(
  page: Page,
  designId: string,
  predicate: (content: string) => boolean,
  timeout = 15_000,
): Promise<{ content: string; matched: boolean }> {
  let content = "";
  const deadline = Date.now() + timeout;
  do {
    content = await source(page, designId);
    if (predicate(content)) return { content, matched: true };
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return { content, matched: predicate(content) };
}

function sourceNodes(content: string): SourceNode[] {
  const nodes: SourceNode[] = [];
  for (const match of content.matchAll(/<[^>]+>/g)) {
    const tag = match[0];
    const id = /data-agent-native-node-id=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!id) continue;
    nodes.push({
      id,
      primitive: /data-an-primitive=["']([^"']+)["']/i.exec(tag)?.[1] ?? null,
      name:
        /data-agent-native-layer-name=["']([^"']*)["']/i.exec(tag)?.[1] ?? null,
    });
  }
  return nodes;
}

function newPrimitiveId(
  before: string,
  after: string,
  primitive: "ellipse" | "rectangle" | "path",
): string {
  const beforeIds = new Set(
    sourceNodes(before)
      .filter((node) => node.primitive === primitive)
      .map((node) => node.id),
  );
  const created = sourceNodes(after).find(
    (node) => node.primitive === primitive && !beforeIds.has(node.id),
  );
  if (!created) {
    throw new Error(`tool did not create a new ${primitive} node`);
  }
  return created.id;
}

function nodeName(content: string, id: string): string {
  const node = sourceNodes(content).find((candidate) => candidate.id === id);
  if (!node?.name) throw new Error(`node ${id} has no layer name`);
  return node.name;
}

function styleFor(content: string, id: string): string {
  const marker = `data-agent-native-node-id="${id}"`;
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) throw new Error(`node ${id} is absent from source`);
  const start = content.lastIndexOf("<", markerIndex);
  const end = content.indexOf(">", markerIndex);
  if (start < 0 || end < 0) throw new Error(`node ${id} has no source tag`);
  return (
    /style=["']([^"']*)["']/i.exec(content.slice(start, end + 1))?.[1] ?? ""
  );
}

function sourceTag(content: string, id: string): string {
  const markerIndex = content.indexOf(`data-agent-native-node-id="${id}"`);
  if (markerIndex < 0) throw new Error(`node ${id} is absent from source`);
  const start = content.lastIndexOf("<", markerIndex);
  const end = content.indexOf(">", markerIndex);
  return content.slice(start, end + 1);
}

function section(page: Page, name: string | RegExp): Locator {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name, exact: typeof name === "string" }),
    })
    .first();
}

function layerButton(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name.replace(/"/g, '\\"')}"]`) })
    .first();
}

function layerRow(page: Page, name: string): Locator {
  return layerButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").trim())
        .filter((name) => name.length > 0),
    );
}

async function expandPotionLayers(page: Page): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await expandAllLayers(page);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("could not expand Potion layers");
}

async function selectLayer(page: Page, name: string): Promise<void> {
  const button = layerButton(page, name);
  await expect(button, `missing layer row ${name}`).toBeVisible();
  await button.click({ force: true });
  await expect(layerRow(page, name)).toHaveAttribute("aria-selected", "true");
}

async function renameLayer(
  page: Page,
  currentName: string,
  nextName: string,
): Promise<void> {
  const button = layerButton(page, currentName);
  await expect(button).toBeVisible();
  await button.dblclick({ force: true });
  const input = page
    .getByRole("tree", { name: "Layers" })
    .locator('input[aria-label="Rename layer"]');
  await expect(input).toBeVisible();
  await input.fill(nextName);
  await input.press("Enter");
  await expect(layerButton(page, nextName)).toBeVisible();
}

async function screenCanvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const iframe = page.locator("iframe[data-design-preview-iframe]").last();
  const box = await iframe.boundingBox();
  if (!box) throw new Error("screen iframe has no geometry");
  return box;
}

async function drawTool(
  page: Page,
  key: "o" | "r",
  local: { x: number; y: number; width: number; height: number },
  contentWidth = SCREEN_WIDTH,
  contentHeight = SCREEN_HEIGHT,
): Promise<void> {
  const box = await screenCanvasBox(page);
  const scaleX = box.width / contentWidth;
  const scaleY = box.height / contentHeight;
  const buttonName = key === "o" ? "Ellipse" : "Rectangle";
  const toolButton = page.locator(`button[aria-label="${buttonName}"]`).first();
  await page.keyboard.press(key);
  if ((await toolButton.getAttribute("aria-pressed")) !== "true") {
    await toolButton.click({ force: true });
  }
  await expect(toolButton).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + local.x * scaleX, box.y + local.y * scaleY);
  await page.mouse.down();
  await page.mouse.move(
    box.x + (local.x + local.width) * scaleX,
    box.y + (local.y + local.height) * scaleY,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press("v");
}

async function setInput(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const input = page
    .locator(`input[aria-label="${label.replace(/"/g, '\\"')}" i]`)
    .last();
  await expect(input, `missing inspector input ${label}`).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function setGeometry(
  page: Page,
  geometry: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await setInput(page, "X-position", String(geometry.x));
  await setInput(page, "Y-position", String(geometry.y));
  await setInput(page, "W size in pixels", String(geometry.width));
  await setInput(page, "H size in pixels", String(geometry.height));
}

async function setFill(page: Page, hex: string): Promise<void> {
  const fill = section(page, "Fill");
  await expect(fill).toBeVisible();
  let open = fill.getByRole("button", { name: "Open color picker" });
  if ((await open.count()) === 0) {
    await fill.getByRole("button", { name: "Add fill" }).click();
    open = fill.getByRole("button", { name: "Open color picker" });
  }
  await expect(open).toBeVisible();
  await open.click();
  const input = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(input).toBeVisible();
  await input.fill(hex.replace(/^#/, ""));
  await input.press("Enter");
  await page.keyboard.press("Escape");
}

async function setRadius(page: Page, value: number): Promise<void> {
  const appearance = section(page, /^Appearance$/);
  await expect(appearance).toBeVisible();
  await setInput(page, "Corner radius", String(value));
  await expect(
    appearance.locator('input[aria-label="Corner radius" i]').last(),
  ).toHaveValue(String(value));
}

async function persistNodeStyle(
  page: Page,
  designId: string,
  id: string,
  matcher: RegExp,
): Promise<string> {
  return persistedSource(page, designId, (content) =>
    matcher.test(styleFor(content, id)),
  );
}

async function topAnchorIndex(page: Page): Promise<number> {
  const anchors = page.locator("[data-vector-anchor]");
  const positions = await anchors.evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const box = node.getBoundingClientRect();
      return {
        index,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    }),
  );
  if (positions.length === 0) throw new Error("vector edit has no anchors");
  return positions.reduce((best, candidate) =>
    candidate.y < best.y ? candidate : best,
  ).index;
}

async function downloadedPngSize(
  page: Page,
  download: Download,
): Promise<{ width: number; height: number }> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("export returned no PNG stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, Buffer.concat(chunks).toString("base64"));
}

test("Potion O/R tools create exact bottle primitives and fills on a blank document", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { designId } = await createBlankDesign(request);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandPotionLayers(page);

    let before = await source(page, designId);
    await drawTool(page, "o", { x: 100, y: 100, width: 200, height: 200 });
    let after = await persistedSource(page, designId, (content) =>
      sourceNodes(content).some((node) => node.primitive === "ellipse"),
    );
    const bodyId = newPrimitiveId(before, after, "ellipse");
    const bodyName = nodeName(after, bodyId);
    await renameLayer(page, bodyName, "Bottle body");
    await selectLayer(page, "Bottle body");
    await setGeometry(page, { x: 0, y: 71, width: 200, height: 200 });
    await setFill(page, "#DEDCF9");
    after = await persistNodeStyle(
      page,
      designId,
      bodyId,
      /dedcf9|rgb\(222,\s*220,\s*249\)/i,
    );
    expect(sourceTag(after, bodyId)).toMatch(
      /data-an-primitive=["']ellipse["']/,
    );
    expect(styleFor(after, bodyId)).toMatch(/(?:width:\s*200px|width:\s*200)/i);
    expect(styleFor(after, bodyId)).toMatch(
      /(?:height:\s*200px|height:\s*200)/i,
    );
    expect(styleFor(after, bodyId)).toMatch(/left:\s*0px/i);
    expect(styleFor(after, bodyId)).toMatch(/top:\s*71px/i);

    before = after;
    await drawTool(page, "r", { x: 150, y: 30, width: 100, height: 100 });
    after = await persistedSource(
      page,
      designId,
      (content) =>
        sourceNodes(content).filter((node) => node.primitive === "rectangle")
          .length >
        sourceNodes(before).filter((node) => node.primitive === "rectangle")
          .length,
    );
    const neckId = newPrimitiveId(before, after, "rectangle");
    const neckName = nodeName(after, neckId);
    await renameLayer(page, neckName, "Bottle neck");
    await selectLayer(page, "Bottle neck");
    await setGeometry(page, { x: 50, y: 0, width: 100, height: 100 });
    await setFill(page, "#DEDCF9");
    after = await persistNodeStyle(
      page,
      designId,
      neckId,
      /dedcf9|rgb\(222,\s*220,\s*249\)/i,
    );

    before = after;
    await drawTool(page, "r", { x: 140, y: 60, width: 120, height: 40 });
    after = await persistedSource(
      page,
      designId,
      (content) =>
        sourceNodes(content).filter((node) => node.primitive === "rectangle")
          .length >
        sourceNodes(before).filter((node) => node.primitive === "rectangle")
          .length,
    );
    const rimId = newPrimitiveId(before, after, "rectangle");
    const rimName = nodeName(after, rimId);
    await renameLayer(page, rimName, "Bottle rim");
    await selectLayer(page, "Bottle rim");
    await setGeometry(page, { x: 40, y: 40, width: 120, height: 40 });
    await setFill(page, "#DEDCF9");
    await setRadius(page, 10);
    const rimRadius = await sourceReceipt(
      page,
      designId,
      (content) =>
        /dedcf9|rgb\(222,\s*220,\s*249\)/i.test(styleFor(content, rimId)) &&
        /border-radius:\s*10px/i.test(styleFor(content, rimId)),
    );
    after = rimRadius.content;
    expect(rimRadius.matched).toBe(true);

    before = after;
    await drawTool(page, "o", { x: 112, y: 112, width: 175, height: 175 });
    after = await persistedSource(
      page,
      designId,
      (content) =>
        sourceNodes(content).filter((node) => node.primitive === "ellipse")
          .length >
        sourceNodes(before).filter((node) => node.primitive === "ellipse")
          .length,
    );
    const potionId = newPrimitiveId(before, after, "ellipse");
    const potionName = nodeName(after, potionId);
    await renameLayer(page, potionName, "Potion");
    await selectLayer(page, "Potion");
    await setGeometry(page, { x: 14, y: 112, width: 175, height: 175 });
    await setFill(page, "#E99BF4");
    after = await persistNodeStyle(
      page,
      designId,
      potionId,
      /e99bf4|rgb\(233,\s*155,\s*244\)/i,
    );
    expect(sourceTag(after, potionId)).toMatch(
      /data-an-primitive=["']ellipse["']/,
    );

    before = after;
    await drawTool(page, "r", { x: 159, y: 8, width: 75, height: 75 });
    after = await persistedSource(
      page,
      designId,
      (content) =>
        sourceNodes(content).filter((node) => node.primitive === "rectangle")
          .length >
        sourceNodes(before).filter((node) => node.primitive === "rectangle")
          .length,
    );
    const corkId = newPrimitiveId(before, after, "rectangle");
    const corkName = nodeName(after, corkId);
    await renameLayer(page, corkName, "Cork");
    await selectLayer(page, "Cork");
    await setGeometry(page, { x: 59, y: 0, width: 75, height: 75 });
    await setFill(page, "#CE856C");
    await setRadius(page, 25);
    const corkRadius = await sourceReceipt(
      page,
      designId,
      (content) =>
        /ce856c|rgb\(206,\s*133,\s*108\)/i.test(styleFor(content, corkId)) &&
        /border-radius:\s*25px/i.test(styleFor(content, corkId)),
    );
    after = corkRadius.content;
    expect(corkRadius.matched).toBe(true);

    const evidence = { bodyId, neckId, rimId, potionId, corkId, source: after };
    await test.info().attach("potion-primitives.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    expect(after).toContain('data-agent-native-layer-name="Bottle body"');
    expect(after).toContain('data-agent-native-layer-name="Potion"');
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Potion vector point edit converts the ellipse and moves its top anchor", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { designId } = await createBlankDesign(request);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandPotionLayers(page);
    const before = await source(page, designId);
    await drawTool(page, "o", { x: 100, y: 80, width: 175, height: 175 });
    const drawn = await persistedSource(page, designId, (content) =>
      sourceNodes(content).some((node) => node.primitive === "ellipse"),
    );
    const ellipseId = newPrimitiveId(before, drawn, "ellipse");
    const ellipseName = nodeName(drawn, ellipseId);
    await renameLayer(page, ellipseName, "Potion point edit");
    await selectLayer(page, "Potion point edit");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);
    const topIndex = await topAnchorIndex(page);
    const top = page.locator("[data-vector-anchor]").nth(topIndex);
    const topBox = await top.boundingBox();
    if (!topBox) throw new Error("top vector anchor has no geometry");
    const beforeAnchorY = topBox.y + topBox.height / 2;
    await page.mouse.move(
      topBox.x + topBox.width / 2,
      topBox.y + topBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      topBox.x + topBox.width / 2,
      topBox.y +
        topBox.height / 2 +
        29 * ((await screenCanvasBox(page)).height / SCREEN_HEIGHT),
      { steps: 8 },
    );
    await page.mouse.up();
    const vector = designFrame(page).locator(
      `[data-agent-native-node-id="${ellipseId}"]`,
    );
    await expect(vector).toHaveJSProperty("tagName", "svg");
    await expect(vector.locator("path")).toHaveCount(1);
    const afterAnchor = page
      .locator("[data-vector-anchor]")
      .nth(await topAnchorIndex(page));
    await expect
      .poll(async () => {
        const box = await afterAnchor.boundingBox();
        return box ? box.y + box.height / 2 : null;
      })
      .toBeGreaterThan(beforeAnchorY + 10);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
    const edited = await persistedSource(page, designId, (content) =>
      sourceTag(content, ellipseId).includes('data-an-primitive="path"'),
    );
    expect(sourceTag(edited, ellipseId)).toMatch(
      /data-an-primitive=["']path["']/,
    );
    expect(edited).toContain(`data-agent-native-node-id="${ellipseId}"`);
    await test.info().attach("potion-vector-edit.json", {
      body: JSON.stringify({ ellipseId, source: edited }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Potion grouping, layer lock, and reorder use the Layers interaction path", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { designId } = await createBlankDesign(request);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandPotionLayers(page);
    const names: string[] = [];
    for (const [key, name] of [
      ["o", "Bottle"] as const,
      ["o", "Potion fill"] as const,
      ["r", "Glare"] as const,
      ["r", "Cork order"] as const,
    ]) {
      const before = await source(page, designId);
      await drawTool(page, key, {
        x: 100 + names.length * 30,
        y: 100 + names.length * 20,
        width: 50,
        height: 50,
      });
      const primitive = key === "o" ? "ellipse" : "rectangle";
      const after = await persistedSource(
        page,
        designId,
        (content) =>
          sourceNodes(content).filter((node) => node.primitive === primitive)
            .length >
          sourceNodes(before).filter((node) => node.primitive === primitive)
            .length,
      );
      const id = newPrimitiveId(before, after, primitive);
      const currentName = nodeName(after, id);
      await renameLayer(page, currentName, name);
      names.push(name);
    }

    const beforeOrder = await page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button][data-layer-node-id] span[title]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("title") ?? ""),
      );
    await layerButton(page, "Bottle").click({ force: true });
    await layerButton(page, "Potion fill").click({
      force: true,
      modifiers: ["Shift"],
    });
    await layerButton(page, "Glare").click({
      force: true,
      modifiers: ["Shift"],
    });
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
    await page.keyboard.press(`${MOD}+g`);
    await expect(layerButton(page, "Group")).toBeVisible();
    const grouped = await persistedSource(page, designId, (content) =>
      /data-agent-native-layer-name="Group"/.test(content),
    );
    expect(
      grouped.indexOf('data-agent-native-layer-name="Group"'),
    ).toBeGreaterThan(-1);
    expect(
      grouped.indexOf('data-agent-native-layer-name="Bottle"'),
    ).toBeGreaterThan(grouped.indexOf('data-agent-native-layer-name="Group"'));

    await layerRow(page, "Cork order").dragTo(layerRow(page, "Group"), {
      targetPosition: { x: 24, y: 2 },
    });
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return names.indexOf("Cork order") < names.indexOf("Group");
      })
      .toBe(true);
    const reordered = await persistedSource(page, designId, (content) => {
      const cork = content.indexOf('data-agent-native-layer-name="Cork order"');
      const group = content.indexOf('data-agent-native-layer-name="Group"');
      return cork >= 0 && group >= 0 && cork > group;
    });

    const groupRow = layerRow(page, "Group");
    await groupRow.hover();
    await expect(
      groupRow.locator('button[aria-label="Lock layer"]'),
    ).toBeVisible();
    await groupRow
      .locator('button[aria-label="Lock layer"]')
      .click({ force: true });
    await expect(
      groupRow.locator('button[aria-label="Unlock layer"]'),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await source(page, designId)).includes(
          'data-agent-native-locked="true"',
        ),
      )
      .toBe(true);
    const corkIndex = reordered.indexOf(
      'data-agent-native-layer-name="Cork order"',
    );
    const groupIndex = reordered.indexOf(
      'data-agent-native-layer-name="Group"',
    );
    expect(corkIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeGreaterThan(-1);
    expect(corkIndex).toBeGreaterThan(groupIndex);
    await test.info().attach("potion-structure.json", {
      body: JSON.stringify({ beforeOrder, reordered }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Potion rotation follows the recorded positive-45 direction", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { designId } = await createBlankDesign(request);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandPotionLayers(page);
    const before = await source(page, designId);
    await drawTool(page, "r", { x: 100, y: 100, width: 120, height: 60 });
    const after = await persistedSource(page, designId, (content) =>
      sourceNodes(content).some((node) => node.primitive === "rectangle"),
    );
    const id = newPrimitiveId(before, after, "rectangle");
    const name = nodeName(after, id);
    await renameLayer(page, name, "Rotation probe");
    await selectLayer(page, "Rotation probe");
    await setGeometry(page, { x: 100, y: 100, width: 120, height: 60 });
    await setInput(page, "Rotation", "45");
    const rotated = await persistedSource(page, designId, (content) =>
      /transform:\s*rotate\(-?45deg\)/i.test(styleFor(content, id)),
    );
    expect(styleFor(rotated, id)).toMatch(/transform:\s*rotate\(-45deg\)/i);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Potion screen export preserves the oracle's 200x271 output size", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { designId } = await createBlankDesign(request, EXPORT_SCREEN, {
    width: 200,
    height: 271,
  });
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandPotionLayers(page);
    await drawTool(
      page,
      "r",
      { x: 40, y: 50, width: 80, height: 80 },
      200,
      271,
    );
    await expect
      .poll(async () =>
        (await source(page, designId)).includes(
          'data-an-primitive="rectangle"',
        ),
      )
      .toBe(true);
    const screen = page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-level="1"]')
      .first()
      .locator("[data-layer-row-button]");
    await screen.click({ force: true });
    await expect(
      screen.locator('xpath=ancestor::*[@role="treeitem"][1]'),
    ).toHaveAttribute("aria-selected", "true");
    const exportSection = section(page, "Export");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportSection
        .getByRole("button", { name: "Export", exact: true })
        .click(),
    ]);
    const size = await downloadedPngSize(page, download);
    expect(size).toEqual({ width: 200, height: 271 });
    await test.info().attach("potion-export-size.json", {
      body: JSON.stringify(size, null, 2),
      contentType: "application/json",
    });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
