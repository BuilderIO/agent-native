import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import {
  appPath,
  cdpScreenshot,
  createFixtureDesign,
  designFrame,
  expandAllLayers,
  gotoEditor,
  pickFrameMode,
} from "./helpers";


type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function sourceLayerTag(source: string, layerName: string) {
  const escaped = layerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    source.match(
      new RegExp(`<[^>]*data-agent-native-layer-name=["']${escaped}["'][^>]*>`),
    )?.[0] ?? null
  );
}

function sourceLayerOrder(source: string, layerNames: string[]) {
  const layers = layerNames.map((name) => {
    const tag = sourceLayerTag(source, name);
    return { name, index: tag ? source.indexOf(tag) : -1 };
  });
  if (layers.some(({ index }) => index < 0)) return [];
  return layers.sort((a, b) => a.index - b.index).map(({ name }) => name);
}

function sourceStyleValue(tag: string, property: string) {
  const style = tag.match(/\sstyle=(["'])(.*?)\1/i)?.[2] ?? "";
  const declaration = style
    .split(";")
    .reverse()
    .map((part) => part.trim())
    .find((part) =>
      part.toLowerCase().startsWith(`${property.toLowerCase()}:`),
    );
  return declaration?.slice(declaration.indexOf(":") + 1).trim() ?? "";
}

function sourceNodeId(source: string, layerName: string) {
  const tag = sourceLayerTag(source, layerName);
  return tag?.match(/data-agent-native-node-id=["']([^"']+)["']/)?.[1] ?? null;
}

function sourceLayerNodes(source: string) {
  const nodes = new Map<
    string,
    {
      nodeId: string;
      name: string | null;
      primitive: string | null;
      tag: string;
    }
  >();
  for (const match of source.matchAll(
    /(<[^>]*data-agent-native-node-id=["']([^"']+)["'][^>]*>)/g,
  )) {
    const tag = match[1];
    const nodeId = match[2];
    if (nodes.has(nodeId)) continue;
    nodes.set(nodeId, {
      nodeId,
      name:
        tag.match(/data-agent-native-layer-name=["']([^"']+)["']/)?.[1] ?? null,
      primitive: tag.match(/data-an-primitive=["']([^"']+)["']/)?.[1] ?? null,
      tag,
    });
  }
  return [...nodes.values()];
}

function sourceNodeIds(source: string) {
  return new Set(sourceLayerNodes(source).map(({ nodeId }) => nodeId));
}

async function measureSourceLayer(
  page: Page,
  screenId: string,
  source: string,
  layerName: string,
) {
  const nodeId = sourceNodeId(source, layerName);
  if (!nodeId) throw new Error(`source is missing node id for ${layerName}`);
  const node = designFrame(page, screenId).locator(
    `[data-agent-native-node-id="${nodeId}"]`,
  );
  await expect(
    node,
    `live preview is missing ${layerName} (${nodeId})`,
  ).toHaveCount(1);
  return node.evaluate((element) => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    const bounds = html.getBoundingClientRect();
    return {
      id: html.getAttribute("data-agent-native-node-id"),
      parentId: html.parentElement?.getAttribute("data-agent-native-node-id"),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      right: bounds.right,
      bottom: bounds.bottom,
      display: style.display,
      flexDirection: style.flexDirection,
      flexWrap: style.flexWrap,
      rowGap: style.rowGap,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      fontReady: html.ownerDocument.fonts.check(
        `${style.fontWeight} ${style.fontSize} ${style.fontFamily.split(",")[0].trim().replace(/"/g, "")}`,
      ),
      widthStyle: style.width,
      heightStyle: style.height,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      overflow: style.overflow,
    };
  });
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = rect.top + 60; y < rect.bottom - 60; y += 40) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 40) {
        if (
          cards.some(
            (card) =>
              x >= card.left - 24 &&
              x <= card.right + 24 &&
              y >= card.top - 24 &&
              y <= card.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty board point found");
  return point;
}

function layerButton(page: Page, name: string) {
  return layerRow(page, name).getByRole("button", {
    name: layerButtonName(name),
  });
}

function layerRenameInput(page: Page) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('input[aria-label="Rename layer"]');
}

function screenLayerRow(page: Page, screenId: string) {
  return layerRowByNodeId(page, screenId);
}

function layerRowByNodeId(page: Page, nodeId: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${nodeId}"]`)
    .locator("xpath=ancestor::*[@role='treeitem']");
}

async function layerRowBySourceNodeId(
  page: Page,
  screenId: string,
  sourceNodeId: string,
) {
  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("editor URL is missing the design id");
  const source = (await readDesign(page, designId)).files?.find(
    (file) => file.id === screenId,
  )?.content;
  const projectionId = source
    ? buildCodeLayerProjection(source, {
        source: { kind: "design-file", fileId: screenId },
      }).nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === sourceNodeId,
      )?.id
    : null;
  if (!projectionId) {
    throw new Error(
      `Screen ${screenId} projection is missing source node ${sourceNodeId}`,
    );
  }
  return layerRowByNodeId(page, projectionId);
}

async function selectScreenLayer(page: Page, screenId: string) {
  const row = screenLayerRow(page, screenId);
  const rowButton = row.locator("[data-layer-row-button]");
  await expect(row).toHaveCount(1);
  await expect(rowButton).toHaveCount(1);
  if ((await row.getAttribute("aria-selected")) !== "true") {
    await rowButton.click();
  }
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => page.evaluate(() => (window as any).__designSelection ?? null))
    .toMatchObject({
      selectedScreenIds: expect.arrayContaining([screenId]),
      selectedElement: null,
    });
}

async function selectLayerInScreen(
  page: Page,
  screenId: string,
  layerName: string,
) {
  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("editor URL is missing the design id");
  const record = await readDesign(page, designId);
  const source = record.files?.find((file) => file.id === screenId)?.content;
  if (!source) throw new Error(`Screen ${screenId} has no saved source`);
  const nodeId = sourceNodeId(source, layerName);
  if (!nodeId) {
    throw new Error(`Screen ${screenId} source is missing ${layerName}`);
  }
  const rowButton = (
    await layerRowBySourceNodeId(page, screenId, nodeId)
  ).locator("[data-layer-row-button]");
  await expect(rowButton).toHaveCount(1);
  await rowButton.click();
  const row = rowButton.locator("xpath=ancestor::*[@role='treeitem']");
  await expect(row).toHaveAttribute("aria-selected", "true");
  return nodeId;
}

async function captureScreenCard(
  page: Page,
  screenId: string,
  screenshotName: string,
) {
  await selectScreenLayer(page, screenId);
  const zoom = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(zoom).toBeVisible();
  if ((await zoom.innerText()).trim() !== "100%") {
    await zoom.click();
    await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  }
  await expect(zoom).toHaveText(/100%/);
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await shell.scrollIntoViewIfNeeded();
  const card = shell.locator("[data-screen-card]");
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error(`Screen card ${screenId} is not measurable`);
  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("editor URL is missing the design id");
  const record = await readDesign(page, designId);
  const geometry = designData(record).canvasFrames?.[screenId];
  if (!geometry) throw new Error(`Screen ${screenId} has no saved geometry`);
  expect(Math.abs(bounds.width - geometry.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(bounds.height - geometry.height)).toBeLessThanOrEqual(4);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  const screenshotPath = test.info().outputPath(screenshotName);
  await card.screenshot({ path: screenshotPath, timeout: 20_000 });
  await test.info().attach(`screen-${screenId}-editor-capture`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return { path: screenshotPath, bounds, geometry, viewport, zoom: "100%" };
}

async function captureEditorScreenshot(page: Page, screenshotName: string) {
  const screenshotPath = test.info().outputPath(screenshotName);
  await cdpScreenshot(page, screenshotPath);
  await test.info().attach(screenshotName, {
    path: screenshotPath,
    contentType: "image/png",
  });
  return screenshotPath;
}

function layerRow(page: Page, name: string) {
  const tree = page.getByRole("tree", { name: "Layers" });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowName = new RegExp(
    `^(?:(?:Collapse|Expand) layer )?${escaped}(?: \\d+)? (?:Lock|Unlock) layer (?:Hide|Show) layer$`,
  );
  return tree.getByRole("treeitem", { name: rowName }).first();
}

function layerButtonName(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?: \\d+)?$`);
}

async function reparentLayer(
  page: Page,
  child: string | Locator,
  parent: string | Locator,
) {
  const parentRow =
    typeof parent === "string" ? layerRow(page, parent) : parent;
  const childRow = typeof child === "string" ? layerRow(page, child) : child;
  await parentRow.scrollIntoViewIfNeeded();
  const parentLevel = Number(await parentRow.getAttribute("aria-level"));
  const parentBounds = await parentRow.boundingBox();
  if (!parentBounds) throw new Error(`layer row ${parent} is not measurable`);
  await childRow.scrollIntoViewIfNeeded();
  await childRow.dragTo(parentRow, {
    targetPosition: { x: 96, y: parentBounds.height / 2 },
  });
  await expect
    .poll(async () => Number(await childRow.getAttribute("aria-level")))
    .toBe(parentLevel + 1);
}

async function renameLayer(page: Page, from: string, to: string) {
  const rowButton = layerButton(page, from);
  const row = rowButton.locator("xpath=ancestor::*[@role='treeitem']");
  await rowButton.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+r`,
  );
  const input = layerRenameInput(page);
  await expect(input).toBeVisible();
  await input.fill(to);
  await expect(input).toHaveValue(to);
  await input.press("Enter");
  await expect(layerButton(page, to)).toBeVisible();
}

async function selectLayerByNodeId(
  page: Page,
  screenId: string,
  sourceNodeId: string,
) {
  const rowButton = (
    await layerRowBySourceNodeId(page, screenId, sourceNodeId)
  ).locator("[data-layer-row-button]");
  await expect(rowButton).toHaveCount(1);
  await expect(rowButton).toBeVisible();
  await rowButton.click();
  const row = rowButton.locator("xpath=ancestor::*[@role='treeitem']");
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function renameLayerByNodeId(
  page: Page,
  screenId: string,
  sourceNodeId: string,
  to: string,
) {
  await selectLayerByNodeId(page, screenId, sourceNodeId);
  await page.keyboard.press("ControlOrMeta+r");
  const input = layerRenameInput(page);
  await expect(input).toBeVisible();
  await input.fill(to);
  await expect(input).toHaveValue(to);
  await input.press("Enter");
  const rowButton = (
    await layerRowBySourceNodeId(page, screenId, sourceNodeId)
  ).locator("[data-layer-row-button]");
  await expect(rowButton).toHaveAccessibleName(layerButtonName(to));
  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("editor URL is missing the design id");
  await expect
    .poll(async () => {
      const source = (await readDesign(page, designId)).files?.find(
        (file) => file.id === screenId,
      )?.content;
      return source
        ? sourceLayerNodes(source).find(({ nodeId }) => nodeId === sourceNodeId)
            ?.name
        : null;
    })
    .toBe(to);
}

async function waitForNewLayerNodeId(
  page: Page,
  designId: string,
  screenId: string,
  existingNodeIds: Set<string>,
  expectedPrimitive: string,
  expectedText?: string,
) {
  let candidates: ReturnType<typeof sourceLayerNodes> = [];
  await expect
    .poll(
      async () => {
        const source = (await readDesign(page, designId)).files?.find(
          (file) => file.id === screenId,
        )?.content;
        candidates = source
          ? sourceLayerNodes(source).filter(
              ({ nodeId }) => !existingNodeIds.has(nodeId),
            )
          : [];
        return candidates.length;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const latestSource = (await readDesign(page, designId)).files?.find(
    (file) => file.id === screenId,
  )?.content;
  candidates = latestSource
    ? sourceLayerNodes(latestSource).filter(
        ({ nodeId }) => !existingNodeIds.has(nodeId),
      )
    : [];
  if (expectedPrimitive !== "text") {
    if (
      candidates.length === 1 &&
      candidates[0]?.primitive === expectedPrimitive
    ) {
      return candidates[0].nodeId;
    }
    throw new Error(
      "Expected one new " +
        expectedPrimitive +
        " layer, found " +
        JSON.stringify(candidates),
    );
  }

  const logicalCandidates = candidates.filter(
    ({ primitive }) => primitive === expectedPrimitive,
  );
  if (logicalCandidates.length !== 1 || expectedText === undefined) {
    throw new Error(
      "Expected one new text primitive with exact text, found " +
        JSON.stringify(candidates),
    );
  }
  const nodeId = logicalCandidates[0].nodeId;
  const topology = await designFrame(page, screenId)
    .locator("body")
    .evaluate(
      (body, input) => {
        const tagged = [
          ...body.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
        ];
        const matches = (id: string) =>
          tagged.filter((node) => node.dataset.agentNativeNodeId === id);
        const roots = matches(input.nodeId);
        const problems: Array<{ nodeId: string; reason: string }> = [];
        if (roots.length !== 1) {
          problems.push({
            nodeId: input.nodeId,
            reason: `root-count:${roots.length}`,
          });
        }
        const root = roots[0];
        for (const candidate of input.candidates) {
          const nodes = matches(candidate.nodeId);
          if (nodes.length !== 1) {
            problems.push({
              nodeId: candidate.nodeId,
              reason: `count:${nodes.length}`,
            });
            continue;
          }
          if (candidate.nodeId === input.nodeId) continue;
          const node = nodes[0];
          if (!root?.contains(node)) {
            problems.push({ nodeId: candidate.nodeId, reason: "outside-text" });
          } else if (!["DIV", "SPAN", "BR"].includes(node.tagName)) {
            problems.push({
              nodeId: candidate.nodeId,
              reason: `tag:${node.tagName}`,
            });
          } else if (
            node.hasAttribute("data-an-primitive") ||
            node.hasAttribute("data-agent-native-layer-name")
          ) {
            problems.push({
              nodeId: candidate.nodeId,
              reason: "logical-descendant",
            });
          }
        }
        return {
          innerText: root?.innerText.replace(/\r\n/g, "\n") ?? null,
          problems,
        };
      },
      { candidates, nodeId },
    );
  if (topology.problems.length > 0 || topology.innerText !== expectedText) {
    throw new Error(
      "New text topology/content mismatch: " +
        JSON.stringify({ candidates, expectedText, topology }),
    );
  }
  return nodeId;
}

async function renameSelectedLayer(page: Page, to: string, visibleName = to) {
  const selected = page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  const rowButton = selected.locator("[data-layer-row-button]");
  await expect(rowButton).toHaveCount(1);
  await rowButton.click();
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+r`,
  );
  const input = layerRenameInput(page);
  await expect(input).toBeVisible();
  await input.fill(to);
  await expect(input).toHaveValue(to);
  await input.press("Enter");
  await expect(layerButton(page, visibleName)).toBeVisible();
}

async function panOverviewCanvas(page: Page, deltaY: number) {
  const surface = page
    .locator("[data-multi-screen-canvas-world]")
    .locator("..");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("overview canvas is not measurable");
  const start = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + deltaY, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Space");
}

async function drawInScreen(
  page: Page,
  screenId: string,
  tool: "Frame" | "Rectangle" | "Text",
  rect: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    assertUnobstructed?: boolean;
  },
  text?: string,
  layerName?: string,
): Promise<string> {
  const activeDesignId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!activeDesignId) throw new Error("editor URL is missing the design id");
  const before = await readDesign(page, activeDesignId);
  const sourceBefore = before.files?.find(
    (file) => file.id === screenId,
  )?.content;
  if (!sourceBefore)
    throw new Error("Screen " + screenId + " has no saved source");
  const existingNodeIds = sourceNodeIds(sourceBefore);
  await selectScreenLayer(page, screenId);
  const body = designFrame(page, screenId).locator("body");
  const screenCard = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
  );
  if (!rect.assertUnobstructed) await screenCard.scrollIntoViewIfNeeded();
  const bodyBox = await body.boundingBox();
  const cardBox = await screenCard.boundingBox();
  if (!bodyBox || !cardBox) throw new Error("screen canvas is not measurable");
  const screenWidth =
    designData(before).canvasFrames?.[screenId]?.width ?? 1440;
  const scale = cardBox.width / screenWidth;
  const startPoint = {
    x: bodyBox.x + rect.x * scale,
    y: bodyBox.y + rect.y * scale,
  };
  const endPoint = {
    x: bodyBox.x + (rect.x + (rect.width ?? 1)) * scale,
    y: bodyBox.y + (rect.y + (rect.height ?? 1)) * scale,
  };
  if (rect.assertUnobstructed) {
    const pointerTargets = await page.evaluate(
      ({ startPoint, endPoint, cardBox }) => {
        return [startPoint, endPoint].map(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return {
            inViewport:
              x >= 0 &&
              y >= 0 &&
              x < window.innerWidth &&
              y < window.innerHeight,
            inScreenBounds:
              x >= cardBox.x &&
              y >= cardBox.y &&
              x <= cardBox.x + cardBox.width &&
              y <= cardBox.y + cardBox.height,
            inToolbar: Boolean(target?.closest("[data-design-bottom-toolbar]")),
          };
        });
      },
      { startPoint, endPoint, cardBox },
    );
    expect(pointerTargets).toEqual([
      { inViewport: true, inScreenBounds: true, inToolbar: false },
      { inViewport: true, inScreenBounds: true, inToolbar: false },
    ]);
  }
  if (tool === "Text") {
    const textTool = page.locator(
      '[data-design-bottom-toolbar] button[aria-label="Text"]',
    );
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(startPoint.x, startPoint.y);
    const editable = designFrame(page, screenId).locator(
      '[data-agent-native-text-editing][contenteditable="true"]',
    );
    await expect(editable).toBeVisible({ timeout: 10_000 });
    await expect(editable).toBeFocused();
    await page.keyboard.press(
      `${process.platform === "darwin" ? "Meta" : "Control"}+a`,
    );
    const lines = (text ?? "").split("\n");
    for (const [index, line] of lines.entries()) {
      if (index > 0) await page.keyboard.press("Enter");
      await page.keyboard.type(line, { delay: 4 });
    }
    await page.keyboard.press("Escape");
    const nodeId = await waitForNewLayerNodeId(
      page,
      activeDesignId,
      screenId,
      existingNodeIds,
      "text",
      text ?? "",
    );
    await renameLayerByNodeId(
      page,
      screenId,
      nodeId,
      layerName ?? text ?? "Text",
    );
    await setFlowPosition(page, layerName ?? text ?? "Text");
    await expect
      .poll(async () => {
        const source =
          (await readDesign(page, activeDesignId)).files?.find(
            (file) => file.id === screenId,
          )?.content ?? "";
        const normalizedSource = source.replace(/\s+/g, " ");
        return (text ?? "")
          .split("\n")
          .every((line) =>
            normalizedSource.includes(line.replace(/\s+/g, " ").trim()),
          );
      })
      .toBe(true);
    return nodeId;
  }
  if (tool === "Frame") {
    await pickFrameMode(page, "Frame");
  } else {
    const rectangleTool = page.locator(
      '[data-design-bottom-toolbar] button[aria-label="Rectangle"]',
    );
    await rectangleTool.click();
    await expect(rectangleTool).toHaveAttribute("aria-pressed", "true");
  }
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 12 });
  await page.mouse.up();
  const nodeId = await waitForNewLayerNodeId(
    page,
    activeDesignId,
    screenId,
    existingNodeIds,
    tool === "Frame" ? "frame" : "rectangle",
  );
  if (layerName) await renameLayerByNodeId(page, screenId, nodeId, layerName);
  else await selectLayerByNodeId(page, screenId, nodeId);
  return nodeId;
}

async function turnIntoAutoLayout(
  page: Page,
  name: string,
  direction: "Horizontal" | "Vertical",
) {
  await layerButton(page, name).click();
  await page.keyboard.press("Shift+a");
  const heading = page.getByRole("heading", {
    name: "Auto layout",
    exact: true,
  });
  await expect(heading).toBeVisible();
  const section = heading.locator("xpath=ancestor::section");
  await section.getByRole("button", { name: direction, exact: true }).click();
  return section;
}

async function setFlowPosition(page: Page, name: string) {
  await layerButton(page, name).click();
  const absolute = page.getByRole("button", {
    name: "Absolute position",
    exact: true,
  });
  const pressed = await absolute.getAttribute("aria-pressed");
  if (pressed === "true") await absolute.click();
  await expect(absolute).toHaveAttribute("aria-pressed", "false");
}

async function setDimension(page: Page, axis: "W" | "H", value: number) {
  const field = page.getByRole("textbox", {
    name: new RegExp(`^${axis}(?: size in pixels)?$`),
  });
  await expect(field).toBeVisible();
  await field.fill(String(value));
  await field.press("Enter");
}

async function setPosition(page: Page, x: number, y: number) {
  const xField = page.getByRole("textbox", { name: "X-position" });
  const yField = page.getByRole("textbox", { name: "Y-position" });
  await xField.fill(String(x));
  await xField.press("Enter");
  await yField.fill(String(y));
  await yField.press("Enter");
}

async function setConstraints(
  page: Page,
  horizontal: "Left" | "Right" | "Left and right" | "Center" | "Scale",
  vertical: "Top" | "Bottom" | "Top and bottom" | "Center" | "Scale",
) {
  await page.getByRole("button", { name: "Constraints", exact: true }).click();
  const horizontalPicker = page.getByRole("combobox", { name: "Horizontal" });
  await horizontalPicker.click();
  await page.getByRole("option", { name: horizontal, exact: true }).click();
  const verticalPicker = page.getByRole("combobox", { name: "Vertical" });
  await verticalPicker.click();
  await page.getByRole("option", { name: vertical, exact: true }).click();
}

async function setCornerRadius(page: Page, value: number) {
  const appearance = page
    .getByRole("heading", { name: "Appearance", exact: true })
    .locator("xpath=ancestor::section");
  const radius = appearance.locator('input[aria-label="Corner radius" i]');
  await expect(radius).toBeVisible();
  await radius.fill(String(value));
  await radius.press("Enter");
}

async function setWrap(section: Locator) {
  const checkbox = section.getByRole("checkbox", { name: "Wrap" });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
}

async function createPodcastCard(
  page: Page,
  screenId: string,
  rowName: string,
  cardName: string,
  x: number,
  y: number,
  title: string,
  creator: string,
  width = 360,
  fillWidth = false,
) {
  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x, y, width, height: 315 },
    undefined,
    cardName,
  );
  await reparentLayer(page, cardName, rowName);
  await setFlowPosition(page, cardName);
  const layout = await turnIntoAutoLayout(page, cardName, "Vertical");
  const gap = layout.getByRole("textbox", { name: "Gap", exact: true });
  await gap.fill("12");
  await gap.press("Enter");
  const horizontalPadding = layout.getByRole("textbox", {
    name: /Left.*Right/,
  });
  await horizontalPadding.fill("12");
  await horizontalPadding.press("Enter");
  const verticalPadding = layout.getByRole("textbox", {
    name: /Top.*Bottom/,
  });
  await verticalPadding.fill("12");
  await verticalPadding.press("Enter");
  await addSizingConstraint(page, "W", "min", 200);
  await addSizingConstraint(page, "W", "max", 400);
  await addSizingConstraint(page, "H", "min", 240);
  await addSizingConstraint(page, "H", "max", 320);
  if (fillWidth) await setSizingMode(page, "W", "Fill container");
  else await setDimension(page, "W", width);
  await setSizingMode(page, "H", "Hug contents");
  await setFillHex(page, "FFFFFF");
  await setCornerRadius(page, 8);

  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: x + 12, y: y + 12, width: width - 24, height: 242 },
    undefined,
    `${cardName} artwork`,
  );
  await reparentLayer(page, `${cardName} artwork`, rowName);
  await reparentLayer(page, `${cardName} artwork`, cardName);
  await setFlowPosition(page, `${cardName} artwork`);
  await setSizingMode(page, "W", "Fill container");
  await setDimension(page, "H", 242);
  const pathSegments = new URL(page.url()).pathname.split("/").filter(Boolean);
  const currentDesignId = pathSegments[pathSegments.length - 1];
  if (!currentDesignId) throw new Error("editor URL is missing the design id");
  await logNodeStage(
    page,
    currentDesignId,
    screenId,
    `${cardName} artwork`,
    "artwork-height-242-before-fill",
  );
  await setFillImage(
    page,
    `${cardName} artwork`,
    path.resolve(import.meta.dirname, "fixtures/responsive-card-art-photo.png"),
  );
  await addNativeArtworkGradient(page, `${cardName} artwork`);
  await setCornerRadius(page, 4);

  const artworkBounds = await designFrame(page, screenId)
    .locator(`[data-agent-native-layer-name="${cardName} artwork"]`)
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    });
  const imageLeft = artworkBounds.width - 48 - 10;
  const imageTop = artworkBounds.height - 48 - 13;
  await drawInScreen(
    page,
    screenId,
    "Frame",
    {
      x: artworkBounds.x + imageLeft,
      y: artworkBounds.y + imageTop,
      width: 48,
      height: 48,
    },
    undefined,
    `${cardName} play button`,
  );
  await reparentLayer(page, `${cardName} play button`, `${cardName} artwork`);
  await setDimension(page, "W", 48);
  await setDimension(page, "H", 48);
  await setPosition(page, imageLeft, imageTop);
  await setConstraints(page, "Right", "Bottom");
  await setFillImage(
    page,
    `${cardName} play button`,
    path.resolve(import.meta.dirname, "fixtures/sonora-play-button.svg"),
  );

  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: x + 12, y: y + 266, width: width - 24, height: 37 },
    undefined,
    `${cardName} metadata`,
  );
  await reparentLayer(page, `${cardName} metadata`, rowName);
  await reparentLayer(page, `${cardName} metadata`, cardName);
  await setFlowPosition(page, `${cardName} metadata`);
  const metadataLayout = await turnIntoAutoLayout(
    page,
    `${cardName} metadata`,
    "Vertical",
  );
  await metadataLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("4");
  await metadataLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, `${cardName} metadata`);

  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: x + 12, y: y + 266 },
    title,
    `${cardName} title`,
  );
  await reparentLayer(page, `${cardName} title`, `${cardName} metadata`);
  await setSizingMode(page, "W", "Fill container");
  await setTextStyle(
    page,
    `${cardName} title`,
    "Lato",
    "Bold",
    16,
    "132745",
    "Auto",
  );
  await setTextTruncation(page, screenId, `${cardName} title`, title, 1);
  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: x + 12, y: y + 286 },
    creator,
    `${cardName} creator`,
  );
  await reparentLayer(page, `${cardName} creator`, `${cardName} metadata`);
  await setSizingMode(page, "W", "Fill container");
  await setTextStyle(
    page,
    `${cardName} creator`,
    "Lato",
    "Medium",
    12,
    "132745",
    "Auto",
  );
}

async function createPodcastRow(
  page: Page,
  screenId: string,
  parentName: string,
  rowName: string,
  y: number,
  cards: Array<{
    name: string;
    title: string;
    creator: string;
  }>,
  options: {
    direction?: "Horizontal" | "Vertical";
    cardWidth?: number;
    width?: number;
  } = {},
) {
  const direction = options.direction ?? "Horizontal";
  const cardWidth = options.cardWidth ?? 360;
  const rowWidth = options.width ?? 1091;
  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: 300, y, width: rowWidth, height: 315 },
    undefined,
    rowName,
  );
  await reparentLayer(page, rowName, parentName);
  await setFlowPosition(page, rowName);
  const layout = await turnIntoAutoLayout(page, rowName, direction);
  const gap = layout.getByRole("textbox", { name: "Gap", exact: true });
  await gap.fill("24");
  await gap.press("Enter");
  if (direction === "Horizontal") await setWrap(layout);
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, rowName);

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    await createPodcastCard(
      page,
      screenId,
      rowName,
      card.name,
      312 + index * (cardWidth + 24),
      y + 12,
      card.title,
      card.creator,
      cardWidth,
      direction === "Vertical",
    );
  }
}

async function logNodeStage(
  page: Page,
  designId: string,
  screenId: string,
  name: string,
  stage: string,
) {
  const live = await designFrame(page, screenId)
    .locator(`[data-agent-native-layer-name="${name}"]`)
    .evaluate((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-agent-native-node-id"),
        primitive: node.getAttribute("data-an-primitive"),
        absolute: node.getAttribute("data-an-positioning"),
        authoredStyle: node.getAttribute("style"),
        position: style.position,
        display: style.display,
        flexDirection: style.flexDirection,
        width: bounds.width,
        height: bounds.height,
        parentId: node.parentElement?.getAttribute("data-agent-native-node-id"),
        parentDisplay: node.parentElement
          ? getComputedStyle(node.parentElement).display
          : null,
        parentFlexDirection: node.parentElement
          ? getComputedStyle(node.parentElement).flexDirection
          : null,
      };
    });
  const record = await readDesign(page, designId);
  const source =
    record.files?.find((file) => file.id === screenId)?.content ?? "";
  const sourceIndex = live.id
    ? source.indexOf(`data-agent-native-node-id="${live.id}"`)
    : -1;
  const sourceTagEnd = sourceIndex >= 0 ? source.indexOf(">", sourceIndex) : -1;
  const sourceTag =
    sourceIndex >= 0 && sourceTagEnd >= 0
      ? source.slice(sourceIndex, sourceTagEnd + 1)
      : null;
  const selectedRows = await page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"]')
    .allTextContents();
  const sizingControls = await page
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons
        .map(
          (button) =>
            button.getAttribute("aria-label") ||
            button.textContent?.trim() ||
            "",
        )
        .filter((label) => /^(?:W|H)(?: sizing mode| \d)/.test(label)),
    );
  const evidence = {
    name,
    selectedRows,
    sizingControls,
    live,
    sourceContainsId: live.id ? source.includes(`"${live.id}"`) : false,
    sourceTag,
  };
  console.info(`music-app-node-stage-${stage}`, evidence);
  await test.info().attach(`node-stage-${stage}`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
}

async function setSizingMode(page: Page, axis: "W" | "H", mode: string) {
  const button = page.getByRole("button", {
    name: new RegExp(`^${axis}(?: sizing mode —| \\d+ )`),
  });
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole("menuitem", { name: mode, exact: true }).click();
}

async function addSizingConstraint(
  page: Page,
  axis: "W" | "H",
  kind: "min" | "max",
  value: number,
) {
  const button = page.getByRole("button", {
    name: new RegExp(`^${axis}(?: sizing mode —| \\d+ )`),
  });
  await expect(button).toBeVisible();
  await button.click();
  const dimension = axis === "W" ? "width" : "height";
  await page
    .getByRole("menuitem", {
      name: new RegExp(`Add ${kind} ${dimension}`, "i"),
    })
    .click();
  const label = `${kind === "min" ? "Min" : "Max"} ${dimension}`;
  const field = page.getByRole("textbox", { name: label, exact: true });
  await expect(field).toBeVisible();
  await field.fill(String(value));
  await field.press("Enter");
}

async function setFillHex(page: Page, hex: string, probeName?: string) {
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(hexInput).toBeVisible();
  await hexInput.fill(hex.replace(/^#/, ""));
  const picker = page.getByRole("dialog").filter({ has: hexInput });
  if (probeName) {
    await page.evaluate(() => {
      const input =
        document.querySelector<HTMLInputElement>('[aria-label="Hex"]');
      const originalDialog = input?.closest<HTMLElement>('[role="dialog"]');
      if (!input || !originalDialog) {
        throw new Error("Hex input is not inside its color dialog");
      }
      const events: Array<Record<string, unknown>> = [];
      const describe = (event: Event, phase: string) => {
        const keyboard = event as KeyboardEvent;
        if (
          event.type !== "focusin" &&
          keyboard.key !== "Enter" &&
          keyboard.key !== "Escape"
        ) {
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        const frames = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        ).map((frame) => ({
          screenId: frame.getAttribute("data-screen-iframe-id"),
          focused: frame.contentDocument?.hasFocus() ?? false,
          activeElement: frame.contentDocument?.activeElement?.tagName ?? null,
        }));
        const selectedRows = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="treeitem"][aria-selected="true"]',
          ),
        ).map((row) => ({
          text: row.innerText.trim(),
          nodeId: row
            .querySelector<HTMLElement>("[data-layer-row-button]")
            ?.getAttribute("data-layer-node-id"),
        }));
        events.push({
          type: event.type,
          phase,
          key: keyboard.key,
          target:
            event.target instanceof HTMLElement
              ? {
                  tag: event.target.tagName,
                  role: event.target.getAttribute("role"),
                  label: event.target.getAttribute("aria-label"),
                }
              : null,
          activeElement: active
            ? {
                tag: active.tagName,
                role: active.getAttribute("role"),
                label: active.getAttribute("aria-label"),
              }
            : null,
          defaultPrevented: event.defaultPrevented,
          documentFocused: document.hasFocus(),
          frames,
          selectedRows,
          selection:
            (window as unknown as { __designSelection?: unknown })
              .__designSelection ?? null,
          dialogState: originalDialog.getAttribute("data-state"),
          dialogConnected: originalDialog.isConnected,
          hex: input.value,
        });
      };
      const handlers = {
        keyCapture: (event: Event) => describe(event, "capture"),
        keyBubble: (event: Event) => describe(event, "bubble"),
        focusCapture: (event: Event) => describe(event, "focus-capture"),
      };
      document.addEventListener("keydown", handlers.keyCapture, true);
      document.addEventListener("keydown", handlers.keyBubble, false);
      document.addEventListener("keyup", handlers.keyCapture, true);
      document.addEventListener("keyup", handlers.keyBubble, false);
      document.addEventListener("focusin", handlers.focusCapture, true);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.target === originalDialog) {
            events.push({
              type: "dialog-attribute",
              name: record.attributeName,
              state: originalDialog.getAttribute("data-state"),
              connected: originalDialog.isConnected,
            });
          }
          for (const node of [
            ...Array.from(record.addedNodes),
            ...Array.from(record.removedNodes),
          ]) {
            if (node instanceof Element && node.matches('[role="dialog"]')) {
              events.push({
                type: "dialog-node",
                id: node.id,
                state: node.getAttribute("data-state"),
                connected: node.isConnected,
              });
            }
          }
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-state"],
      });
      (
        window as unknown as {
          __colorEscapeProbe?: {
            events: Array<Record<string, unknown>>;
            originalDialog: HTMLElement;
            observer: MutationObserver;
            handlers: typeof handlers;
          };
        }
      ).__colorEscapeProbe = { events, originalDialog, observer, handlers };
    });
  }
  await hexInput.press("Enter");
  await page.keyboard.press("Escape");
  if (probeName) {
    const evidence = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          __colorEscapeProbe?: {
            events: Array<Record<string, unknown>>;
            originalDialog: HTMLElement;
            observer: MutationObserver;
            handlers: {
              keyCapture: EventListener;
              keyBubble: EventListener;
              focusCapture: EventListener;
            };
          };
        }
      ).__colorEscapeProbe;
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).map((dialog) => ({
        id: dialog.id,
        state: dialog.getAttribute("data-state"),
        connected: dialog.isConnected,
        hasHex: Boolean(dialog.querySelector('[aria-label="Hex"]')),
      }));
      if (!probe) return { events: [], dialogs };
      const input =
        document.querySelector<HTMLInputElement>('[aria-label="Hex"]');
      const evidence = {
        events: probe.events,
        originalDialogConnected: probe.originalDialog.isConnected,
        originalDialogState: probe.originalDialog.getAttribute("data-state"),
        currentHex: input?.value ?? null,
        dialogs,
      };
      probe.observer.disconnect();
      document.removeEventListener("keydown", probe.handlers.keyCapture, true);
      document.removeEventListener("keydown", probe.handlers.keyBubble, false);
      document.removeEventListener("keyup", probe.handlers.keyCapture, true);
      document.removeEventListener("keyup", probe.handlers.keyBubble, false);
      document.removeEventListener(
        "focusin",
        probe.handlers.focusCapture,
        true,
      );
      delete (window as unknown as { __colorEscapeProbe?: unknown })
        .__colorEscapeProbe;
      return evidence;
    });
    await test.info().attach("color-escape-" + probeName, {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    console.info("color-escape-" + probeName, JSON.stringify(evidence));
    await expect(picker).toHaveAttribute("data-state", "closed", {
      timeout: 2_500,
    });
  }
  await expect(picker).toBeHidden({ timeout: probeName ? 2_500 : 20_000 });
}

async function removeFill(page: Page, layerName: string) {
  await layerButton(page, layerName).click();
  await expect(layerRow(page, layerName)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  const remove = fillSection
    .locator('button[aria-label="Remove layer"]')
    .first();
  if (!(await remove.count())) {
    await expect
      .poll(async () => await sourceHasTransparentFill(page, layerName))
      .toBe(true);
  } else {
    await remove.click();
    await expect
      .poll(async () => await sourceHasTransparentFill(page, layerName))
      .toBe(true);
  }
  const target = await persistedLayer(page, layerName);
  const live = designFrame(page, target.fileId).locator(
    `[data-agent-native-node-id="${target.nodeId}"]`,
  );
  await expect(live).toHaveCount(1);
  await expect
    .poll(async () =>
      live.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
}

async function persistedLayer(page: Page, layerName: string) {
  const pathParts = new URL(page.url()).pathname.split("/").filter(Boolean);
  const designId = pathParts[pathParts.length - 1];
  if (!designId) throw new Error("editor URL is missing the design id");
  const record = await readDesign(page, designId);
  const matches = (record.files ?? []).flatMap((file) => {
    if (!file.content) return [];
    const tag = sourceLayerTag(file.content, layerName);
    const nodeId = tag?.match(
      /data-agent-native-node-id=["']([^"']+)["']/,
    )?.[1];
    return tag && nodeId
      ? [{ fileId: file.id, content: file.content, tag, nodeId }]
      : [];
  });
  if (matches.length !== 1) {
    throw new Error(
      `expected one saved ${layerName} layer, found ${matches.length}`,
    );
  }
  return matches[0]!;
}

function tagStyle(tag: string) {
  const raw = tag.match(/\sstyle=["']([^"']*)["']/i)?.[1] ?? "";
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function sourceHasTransparentFill(page: Page, layerName: string) {
  const target = await persistedLayer(page, layerName);
  const style = tagStyle(target.tag);
  const color = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i)?.[1];
  const background = style.match(/(?:^|;)\s*background\s*:\s*([^;]+)/i)?.[1];
  const backgroundImage = style
    .match(/(?:^|;)\s*background-image\s*:\s*([^;]+)/i)?.[1]
    ?.trim();
  const isTransparent = (value: string | undefined) =>
    value !== undefined &&
    (/^transparent\s*$/i.test(value.trim()) ||
      /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)$/i.test(value.trim()));
  return (
    (isTransparent(color) || isTransparent(background)) &&
    (!backgroundImage || /^none$/i.test(backgroundImage))
  );
}

function savedImageUrl(tag: string) {
  const backgroundImage = tagStyle(tag).match(
    /(?:^|;)\s*background-image\s*:\s*([^;]+)/i,
  )?.[1];
  const urls = [...(backgroundImage ?? "").matchAll(/url\(([^)]*)\)/gi)];
  const value = urls[urls.length - 1]?.[1];
  const url = value?.trim().replace(/^["']|["']$/g, "");
  return url && url !== "none" ? url : null;
}

async function addNativeArtworkGradient(page: Page, layerName: string) {
  await layerButton(page, layerName).click();
  await expect(layerRow(page, layerName)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  const paintRows = fillSection.locator(
    '[data-inspector-layout="drag-paint-row"]',
  );
  const originalImage = await persistedLayer(page, layerName);
  const originalImageUrl = savedImageUrl(originalImage.tag);
  expect(originalImageUrl).toContain("/api/qa-figma-import-assets/");
  const previousRows = await paintRows.count();
  await fillSection
    .getByRole("button", { name: "Add fill", exact: true })
    .click();
  await expect(paintRows).toHaveCount(previousRows + 1);
  const gradientRow = paintRows.first();
  await gradientRow
    .getByRole("button")
    .filter({ hasText: /#[\da-f]{6}/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Linear", exact: true }).click();
  const stops = dialog.getByRole("group", { name: "Gradient stops" });
  await expect(stops).toBeVisible();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  const opacity = page.getByRole("spinbutton", {
    name: "Opacity",
    exact: true,
  });
  const topStop = dialog.getByRole("button", { name: / at 0%$/ }).first();
  await topStop.click();
  await hex.fill("000000");
  await hex.press("Enter");
  await opacity.fill("0");
  await opacity.press("Enter");
  const bottomStop = dialog.getByRole("button", { name: / at 100%$/ }).first();
  await bottomStop.click();
  await hex.fill("666666");
  await hex.press("Enter");
  await opacity.fill("100");
  await opacity.press("Enter");
  const angle = page.getByRole("spinbutton", {
    name: "Gradient angle",
    exact: true,
  });
  await angle.fill("180");
  await angle.press("Tab");

  let target: Awaited<ReturnType<typeof persistedLayer>> | undefined;
  await expect
    .poll(async () => {
      const updated = await persistedLayer(page, layerName);
      target = updated;
      const backgroundImage = tagStyle(updated.tag).match(
        /(?:^|;)\s*background-image\s*:\s*([^;]+)/i,
      )?.[1];
      return Boolean(
        backgroundImage?.includes("linear-gradient(180deg") &&
        backgroundImage.includes("rgba(0, 0, 0, 0)") &&
        backgroundImage.includes("#666666 100%") &&
        savedImageUrl(updated.tag) === originalImageUrl,
      );
    })
    .toBe(true);
  const updatedTarget = target!;
  expect(updatedTarget.nodeId).toBeTruthy();
  const imageUrl = savedImageUrl(updatedTarget.tag);
  expect(imageUrl).toContain("/api/qa-figma-import-assets/");
  const live = designFrame(page, updatedTarget.fileId).locator(
    `[data-agent-native-node-id="${updatedTarget.nodeId}"]`,
  );
  await expect
    .poll(async () =>
      live.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain(imageUrl!);
  await expect
    .poll(async () =>
      live.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain("linear-gradient");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function setFillImage(page: Page, layerName: string, imagePath: string) {
  await layerButton(page, layerName).click();
  await expect(layerRow(page, layerName)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const previous = await persistedLayer(page, layerName);
  const previousUrl = savedImageUrl(previous.tag);
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Image", exact: true }).click();
  await dialog.getByRole("button", { name: "Upload image" }).click();
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles(imagePath);
  let applied: Awaited<ReturnType<typeof persistedLayer>> | undefined;
  await expect
    .poll(async () => {
      applied = await persistedLayer(page, layerName);
      const url = savedImageUrl(applied.tag);
      return Boolean(
        url &&
        url !== previousUrl &&
        url.includes("/api/qa-figma-import-assets/"),
      );
    })
    .toBe(true);
  const target = applied!;
  const live = designFrame(page, target.fileId).locator(
    `[data-agent-native-node-id="${target.nodeId}"]`,
  );
  await expect(live).toHaveCount(1);
  const imageUrl = savedImageUrl(target.tag)!;
  await expect
    .poll(async () =>
      live.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain(imageUrl);
  await expect
    .poll(async () =>
      live.evaluate(async (_element, url) => {
        const image = new Image();
        image.src = new URL(url, document.baseURI).href;
        try {
          await image.decode();
          return image.naturalWidth > 0 && image.naturalHeight > 0;
        } catch {
          return false;
        }
      }, imageUrl),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function setTextStyle(
  page: Page,
  layerName: string,
  family: string,
  weight: string,
  size: number,
  color: string,
  lineHeight?: string | number,
  fillProbeName?: string,
) {
  await layerButton(page, layerName).click();
  const typography = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Typography" }) })
    .first();
  const fontPicker = typography.getByRole("button", { name: "Font" });
  await fontPicker.click();
  await page.getByRole("combobox", { name: "Search" }).fill(family);
  await page.getByRole("option", { name: family, exact: true }).click();
  const weightPicker = typography.getByRole("combobox");
  await weightPicker.click();
  await page.getByRole("option", { name: weight, exact: true }).click();
  const sizeField = typography.locator('input[aria-label="Size" i]');
  await sizeField.fill(String(size));
  await sizeField.press("Enter");
  if (lineHeight !== undefined) {
    const lineHeightField = typography.locator(
      'input[aria-label="Line height" i]',
    );
    await lineHeightField.fill(String(lineHeight));
    await lineHeightField.press("Enter");
  }
  await setFillHex(page, color, fillProbeName);
}

async function setTextTruncation(
  page: Page,
  screenId: string,
  layerName: string,
  fullText: string,
  maxLines: number,
) {
  await layerButton(page, layerName).click();
  await page.getByRole("button", { name: "Typography details" }).click();
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await details.getByRole("tab", { name: "Basics", exact: true }).click();
  const truncate = details.getByRole("switch", {
    name: "Truncate text",
    exact: true,
  });
  await expect(truncate).toBeVisible();
  await expect(truncate).toBeEnabled();
  if ((await truncate.getAttribute("aria-checked")) !== "true") {
    await truncate.click();
  }
  const maxLinesField = details.getByRole("textbox", {
    name: "Max lines",
    exact: true,
  });
  await maxLinesField.fill(String(maxLines));
  await maxLinesField.press("Enter");
  await expect(truncate).toHaveAttribute("aria-checked", "true");
  await expect(maxLinesField).toHaveValue(String(maxLines));
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("editor URL is missing the design id");
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const source = record.files?.find(
        (file) => file.id === screenId,
      )?.content;
      return Boolean(
        source &&
        (() => {
          const tag = sourceLayerTag(source, layerName);
          return (
            tag &&
            sourceStyleValue(tag, "-webkit-line-clamp") === String(maxLines) &&
            sourceStyleValue(tag, "-webkit-box-orient") === "vertical"
          );
        })() &&
        source.includes(fullText),
      );
    })
    .toBe(true);

  const record = await readDesign(page, designId);
  const source = record.files?.find((file) => file.id === screenId)?.content;
  if (!source) throw new Error(`Screen ${screenId} has no saved source`);
  const tag = sourceLayerTag(source, layerName);
  const nodeId = sourceNodeId(source, layerName);
  expect(tag, `${layerName} is missing from saved source`).not.toBeNull();
  expect(nodeId, `${layerName} has no durable id`).not.toBeNull();
  expect(source).toContain(fullText);
  expect(sourceStyleValue(tag!, "-webkit-box-orient")).toBe("vertical");
  expect(sourceStyleValue(tag!, "-webkit-line-clamp")).toBe(String(maxLines));
  const title = designFrame(page, screenId).locator(
    `[data-agent-native-node-id="${nodeId}"]`,
  );
  await expect(title).toHaveCount(1);
  const rendered = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const renderedLines = new Set(
      Array.from(range.getClientRects())
        .filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < bounds.bottom &&
            rect.bottom > bounds.top,
        )
        .map((rect) => Math.round(rect.top * 2) / 2),
    );
    return {
      text: element.textContent?.trim() ?? "",
      display: (element as HTMLElement).style.display,
      overflow: style.overflow,
      boxOrient: style.getPropertyValue("-webkit-box-orient"),
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      lineCount: renderedLines.size,
      height: bounds.height,
    };
  });
  expect(rendered.text).toBe(fullText);
  expect(rendered.display).toBe("-webkit-box");
  expect(rendered.overflow).toBe("hidden");
  expect(rendered.boxOrient).toBe("vertical");
  expect(rendered.lineClamp).toBe(String(maxLines));
  expect(rendered.lineCount).toBe(maxLines);
  expect(rendered.height).toBeGreaterThan(0);
}

test("a drawn empty Frame refreshes its inspector after auto layout", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const designId = await createFixtureDesign(
    page,
    `Empty frame auto layout ${Date.now()}`,
  );
  await page.setViewportSize({ width: 2800, height: 1600 });
  await gotoEditor(page, designId);
  const existingFiles = new Set(
    (await readDesign(page, designId)).files?.map((file) => file.id),
  );

  await pickFrameMode(page, "Screen");
  const start = await emptyBoardPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 12 });
  await page.mouse.up();
  let screenId = "";
  await expect
    .poll(async () => {
      const added = (await readDesign(page, designId)).files?.find(
        (file) =>
          !existingFiles.has(file.id) && file.filename !== "__board__.html",
      );
      screenId = added?.id ?? "";
      return screenId || null;
    })
    .not.toBeNull();
  await selectScreenLayer(page, screenId);
  await page.keyboard.press("Shift+a");
  const rootLayout = page
    .getByRole("heading", { name: "Auto layout", exact: true })
    .locator("xpath=ancestor::section");
  await expect(rootLayout).toBeVisible();
  await rootLayout
    .getByRole("button", { name: "Vertical", exact: true })
    .click();

  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: 20, y: 20, width: 320, height: 240 },
    undefined,
    "Workspace",
  );
  await setFlowPosition(page, "Workspace");
  const workspaceLayout = await turnIntoAutoLayout(
    page,
    "Workspace",
    "Horizontal",
  );
  const horizontal = workspaceLayout.getByRole("button", {
    name: "Horizontal",
    exact: true,
  });
  let source = "";
  await expect
    .poll(
      async () => {
        source =
          (await readDesign(page, designId)).files?.find(
            (file) => file.id === screenId,
          )?.content ?? "";
        const tag = sourceLayerTag(source, "Workspace");
        return Boolean(
          tag &&
          /display:\s*flex/i.test(tag) &&
          /flex-direction:\s*row/i.test(tag),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const workspaceTag = sourceLayerTag(source, "Workspace");
  const workspaceId = sourceNodeId(source, "Workspace");
  const live = workspaceId
    ? await designFrame(page, screenId)
        .locator(`[data-agent-native-node-id="${workspaceId}"]`)
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            display: style.display,
            flexDirection: style.flexDirection,
          };
        })
    : null;

  await expect(horizontal).toHaveAttribute("aria-pressed", "true");
  expect(workspaceTag).not.toBeNull();
  expect(workspaceTag).toMatch(/display:\s*flex/i);
  expect(workspaceTag).toMatch(/flex-direction:\s*row/i);
  expect(live).toEqual({ display: "flex", flexDirection: "row" });
  await expect(
    workspaceLayout.getByRole("textbox", { name: "Gap", exact: true }),
  ).toBeVisible();
  await test.info().attach("auto-layout-selection-readback", {
    body: JSON.stringify({ designId, screenId, workspaceId, live }, null, 2),
    contentType: "application/json",
  });
});

test("create a responsive music-app desktop shell under a Screen root", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const designId = await createFixtureDesign(
    page,
    `Responsive music app desktop ${Date.now()}`,
  );
  const chatThread404s: Array<{
    method: string;
    path: string;
    status: number;
  }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() === "GET" &&
      response.status() === 404 &&
      /^\/_agent-native\/agent-chat\/threads\/[^/]+$/.test(url.pathname)
    ) {
      chatThread404s.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  await test.info().attach("tutorial-identities-design", {
    body: JSON.stringify({ designId, screenIds: [] }, null, 2),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 2800, height: 1600 });
  await gotoEditor(page, designId);
  const zoom = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(zoom).toBeVisible();
  await zoom.click();
  await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  await expect(zoom).toHaveText(/100%/);
  let screenId = "";
  let shell: Locator;
  const before = await readDesign(page, designId);
  const existingFiles = new Set(before.files?.map((file) => file.id));

  const geometryRequests: Array<{
    at: number;
    body: string | null;
  }> = [];
  const geometryResponses: Array<{
    at: number;
    status: number;
    body: string | null;
  }> = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/_agent-native/actions/create-file") ||
      request.url().includes("/_agent-native/actions/update-design")
    ) {
      geometryRequests.push({ at: Date.now(), body: request.postData() });
    }
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/_agent-native/actions/create-file") ||
      response.url().includes("/_agent-native/actions/update-design")
    ) {
      geometryResponses.push({
        at: Date.now(),
        status: response.status(),
        body: response.request().postData(),
      });
    }
  });

  await pickFrameMode(page, "Screen");
  const start = await emptyBoardPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const added = record.files?.find(
        (file) =>
          !existingFiles.has(file.id) && file.filename !== "__board__.html",
      );
      if (!added) return null;
      screenId = added.id;
      return added.id;
    })
    .not.toBeNull();
  shell = page.locator(`[data-screen-shell][data-frame-id="${screenId}"]`);
  const createdRecord = await readDesign(page, designId);
  const createdData = designData(createdRecord);
  const createdGeometry = createdData.canvasFrames?.[screenId];
  const createdMetadata = createdData.screenMetadata?.[screenId];
  const selectedScreenRow = page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`);
  await expect(selectedScreenRow).toHaveCount(1);
  const selectedState = () =>
    selectedScreenRow.evaluate((button) =>
      button.closest('[role="treeitem"]')?.getAttribute("aria-selected"),
    );
  if ((await selectedState()) !== "true") {
    await selectedScreenRow.click();
  }
  await expect.poll(selectedState).toBe("true");
  await expect
    .poll(() => page.evaluate(() => (window as any).__designSelection ?? null))
    .toMatchObject({
      designId,
      selectedScreenIds: expect.arrayContaining([screenId]),
    });
  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${screenId}"]`,
  );
  await expect(screenIframe).toHaveCount(1);
  const bodyIdentity = await screenIframe
    .contentFrame()
    .locator("body")
    .evaluate((body) => ({
      nodeId: body.getAttribute("data-agent-native-node-id"),
      layerName: body.getAttribute("data-agent-native-layer-name"),
    }));
  const screenSelection = await page.evaluate(
    () => (window as any).__designSelection ?? null,
  );
  const width = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const height = page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  const inspectorBeforeBurst = {
    width: await width.inputValue(),
    height: await height.inputValue(),
  };
  const shellFrameId = await shell.getAttribute("data-frame-id");
  const layerNodeId =
    await selectedScreenRow.getAttribute("data-layer-node-id");
  const screenIframeId = await screenIframe.getAttribute(
    "data-screen-iframe-id",
  );
  expect(shellFrameId).toBe(screenId);
  expect(layerNodeId).toBe(screenId);
  expect(screenIframeId).toBe(screenId);
  expect(screenSelection?.designId).toBe(designId);
  expect(screenSelection?.selectedScreenIds).toContain(screenId);
  await test.info().attach("tutorial-identities-desktop", {
    body: JSON.stringify(
      {
        designId,
        screenIds: [screenId],
        geometryAtCreation: createdGeometry,
        metadataAtCreation: createdMetadata,
        screenSelection,
        screenShellId: shellFrameId,
        layerNodeId,
        screenIframeId,
        bodyIdentity,
        inspectorBeforeBurst,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await width.fill("1440");
  await width.press("Enter");
  await height.fill("1024");
  await height.press("Enter");
  try {
    await expect
      .poll(async () => {
        const data = designData(await readDesign(page, designId));
        const frame = data.canvasFrames?.[screenId];
        const metadata = data.screenMetadata?.[screenId];
        return [frame?.width, frame?.height, metadata?.width, metadata?.height];
      })
      .toEqual([1440, 1024, 1440, 1024]);
  } finally {
    let finalGeometry: unknown = null;
    try {
      const finalRecord = await readDesign(page, designId);
      const finalData = designData(finalRecord);
      finalGeometry = {
        canvasFrame: finalData.canvasFrames?.[screenId],
        screenMetadata: finalData.screenMetadata?.[screenId],
        screenSource: finalRecord.files?.find((file) => file.id === screenId)
          ?.content,
      };
    } catch (error) {
      finalGeometry = { readError: String(error) };
    }
    await test.info().attach("screen-geometry-commit-trace", {
      body: JSON.stringify(
        {
          designId,
          screenId,
          screenSelection,
          shellFrameId: await shell.getAttribute("data-frame-id"),
          layerNodeId:
            await selectedScreenRow.getAttribute("data-layer-node-id"),
          screenIframeId: await screenIframe.getAttribute(
            "data-screen-iframe-id",
          ),
          bodyIdentity,
          inspectorBeforeBurst,
          initialGeometry: createdGeometry,
          initialMetadata: createdMetadata,
          geometryRequests,
          geometryResponses,
          finalGeometry,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }

  await page.keyboard.press("Shift+a");
  const rootLayoutHeading = page.getByRole("heading", {
    name: "Auto layout",
    exact: true,
  });
  await expect(rootLayoutHeading).toBeVisible();
  const rootLayout = rootLayoutHeading.locator("xpath=ancestor::section");
  await rootLayout
    .getByRole("button", { name: "Vertical", exact: true })
    .click();
  const rootGap = rootLayout.getByRole("textbox", {
    name: "Gap",
    exact: true,
  });
  await rootGap.fill("10");
  await rootGap.press("Enter");
  const horizontalPadding = rootLayout.getByRole("textbox", {
    name: /Left.*Right/,
  });
  await horizontalPadding.fill("10");
  await horizontalPadding.press("Enter");
  const verticalPadding = rootLayout.getByRole("textbox", {
    name: /Top.*Bottom/,
  });
  await verticalPadding.fill("10");
  await verticalPadding.press("Enter");
  await setFillHex(page, "0C101A", "desktop-screen-fill");

  await drawInScreen(page, screenId, "Frame", {
    x: 10,
    y: 10,
    width: 1420,
    height: 850,
  });
  await expect
    .poll(
      async () =>
        (await readDesign(page, designId)).files?.find(
          (file) => file.id === screenId,
        )?.content,
    )
    .toContain('data-an-primitive="frame"');
  await renameLayer(page, "Frame", "Workspace");
  await setFlowPosition(page, "Workspace");
  const workspaceLayout = await turnIntoAutoLayout(
    page,
    "Workspace",
    "Horizontal",
  );
  const workspaceGap = workspaceLayout.getByRole("textbox", {
    name: "Gap",
    exact: true,
  });
  await workspaceGap.fill("10");
  await workspaceGap.press("Enter");
  await workspaceLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .fill("10");
  await workspaceLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .press("Enter");
  await workspaceLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .fill("10");
  await workspaceLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .press("Enter");
  await setDimension(page, "H", 850);
  await setSizingMode(page, "W", "Fill container");
  const workspaceFillBadge = page.getByRole("button", {
    name: /^W \d+ Fill$/,
  });
  await expect(workspaceFillBadge).toBeVisible();
  await removeFill(page, "Workspace");

  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: 20, y: 20, width: 96, height: 120 },
    "Home\nBrowse\nYour Library\nPlaylists",
    "Navigation",
  );
  await reparentLayer(page, "Navigation", "Workspace");
  await setTextStyle(
    page,
    "Navigation",
    "Inter",
    "Bold",
    16,
    "FFFFFF",
    "30",
    "desktop-navigation-text",
  );
  await setSizingMode(page, "W", "Fixed");
  await setSizingMode(page, "H", "Fixed");
  await setDimension(page, "W", 96);
  await setDimension(page, "H", 120);

  await drawInScreen(page, screenId, "Frame", {
    x: 116,
    y: 10,
    width: 145,
    height: 69,
  });
  await renameLayer(page, "Frame", "Sidebar");
  await reparentLayer(page, "Sidebar", "Workspace");
  await setFlowPosition(page, "Sidebar");
  const sidebarLayout = await turnIntoAutoLayout(page, "Sidebar", "Vertical");
  await sidebarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("0");
  await sidebarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  await sidebarLayout.getByRole("textbox", { name: /Left.*Right/ }).fill("20");
  await sidebarLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .press("Enter");
  await sidebarLayout.getByRole("textbox", { name: /Top.*Bottom/ }).fill("20");
  await sidebarLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .press("Enter");
  await setFillHex(page, "141A24");
  await drawInScreen(page, screenId, "Text", { x: 136, y: 30 }, "SONORA");
  await reparentLayer(page, "SONORA", "Sidebar");
  await setTextStyle(page, "SONORA", "Inter", "Bold", 24, "FFFFFF");
  await layerButton(page, "Sidebar").click();
  await setSizingMode(page, "W", "Hug contents");
  await setSizingMode(page, "H", "Hug contents");
  await logNodeStage(
    page,
    designId,
    screenId,
    "Sidebar",
    "desktop-sidebar-hug-hug",
  );

  await drawInScreen(page, screenId, "Frame", {
    x: 271,
    y: 10,
    width: 1139,
    height: 776,
  });
  await renameLayer(page, "Frame", "Main Content");
  await reparentLayer(page, "Main Content", "Workspace");
  await setFlowPosition(page, "Main Content");
  const contentLayout = await turnIntoAutoLayout(
    page,
    "Main Content",
    "Vertical",
  );
  const contentGap = contentLayout.getByRole("textbox", {
    name: "Gap",
    exact: true,
  });
  await contentGap.fill("24");
  await contentGap.press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "24"],
    [/Top.*Bottom/, "24"],
  ] as const) {
    const field = contentLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, "Main Content");

  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: 295, y: 34, width: 285, height: 50 },
    undefined,
    "Top Bar",
  );
  await reparentLayer(page, "Top Bar", "Main Content");
  await setFlowPosition(page, "Top Bar");
  const topBarLayout = await turnIntoAutoLayout(page, "Top Bar", "Vertical");
  await topBarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("0");
  await topBarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  await topBarLayout.getByRole("textbox", { name: /Left.*Right/ }).fill("10");
  await topBarLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .press("Enter");
  await topBarLayout.getByRole("textbox", { name: /Top.*Bottom/ }).fill("10");
  await topBarLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .press("Enter");
  await removeFill(page, "Top Bar");
  await layerButton(page, "Main Content").click();
  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: 305, y: 44 },
    "Good evening, Alex",
    "Desktop greeting",
  );
  await reparentLayer(page, "Desktop greeting", "Top Bar");
  await setTextStyle(
    page,
    "Desktop greeting",
    "Inter",
    "Bold",
    28,
    "FFFFFF",
    "30",
  );
  await layerButton(page, "Top Bar").click();
  await setSizingMode(page, "W", "Hug contents");
  await setSizingMode(page, "H", "Hug contents");
  await logNodeStage(
    page,
    designId,
    screenId,
    "Top Bar",
    "desktop-topbar-hug-hug",
  );

  await createPodcastRow(page, screenId, "Main Content", "Podcast row", 108, [
    {
      name: "Podcast card A",
      title: "Tasty Bites: Exploring Culinary Delights",
      creator: "FoodieFiends",
    },
    {
      name: "Podcast card B",
      title: "Tasty Bites: Exploring Culinary Delights",
      creator: "FoodieFiends",
    },
  ]);

  await test.step("reorder flow cards, undo, redo, and restore source order", async () => {
    const cardNames = ["Podcast card A", "Podcast card B"];
    const reorderedNames = ["Podcast card B", "Podcast card A"];
    const savedSource = async () =>
      (await readDesign(page, designId)).files?.find(
        (file) => file.id === screenId,
      )?.content ?? "";
    const savedCardOrder = async () =>
      sourceLayerOrder(await savedSource(), cardNames);
    await expect.poll(savedCardOrder).toEqual(cardNames);
    const sourceBefore = await savedSource();
    const cardANodeId = sourceNodeId(sourceBefore, "Podcast card A");
    const cardBNodeId = sourceNodeId(sourceBefore, "Podcast card B");
    const rowNodeId = sourceNodeId(sourceBefore, "Podcast row");
    if (!cardANodeId || !cardBNodeId || !rowNodeId) {
      throw new Error("Podcast row source is missing stable node ids");
    }

    const cardA = layerRow(page, "Podcast card A");
    const cardB = layerRow(page, "Podcast card B");
    await cardA.scrollIntoViewIfNeeded();
    await cardB.scrollIntoViewIfNeeded();
    const [cardABounds, cardBInitialBounds] = await Promise.all([
      cardA.boundingBox(),
      cardB.boundingBox(),
    ]);
    if (!cardABounds || !cardBInitialBounds) {
      throw new Error("Podcast card rows are not measurable");
    }
    expect(cardBInitialBounds.y).toBeLessThan(cardABounds.y);
    const liveRow = designFrame(page, screenId).locator(
      `[data-agent-native-node-id="${rowNodeId}"]`,
    );
    const liveSiblingNodes = async () =>
      liveRow.evaluate((row) =>
        Array.from(row.children).map((child) => ({
          id: child.getAttribute("data-agent-native-node-id"),
          name: child.getAttribute("data-agent-native-layer-name"),
        })),
      );
    const liveSiblingOrder = async () =>
      (await liveSiblingNodes()).map(({ name }) => name);
    const liveCardPositions = async () => {
      const [cardAState, cardBState] = await Promise.all([
        measureSourceLayer(page, screenId, sourceBefore, "Podcast card A"),
        measureSourceLayer(page, screenId, sourceBefore, "Podcast card B"),
      ]);
      return {
        cardA: { id: cardAState.id, x: cardAState.x },
        cardB: { id: cardBState.id, x: cardBState.x },
      };
    };
    await expect.poll(liveSiblingOrder).toEqual(cardNames);
    const beforePositions = await liveCardPositions();
    expect(beforePositions.cardA.x).toBeLessThan(beforePositions.cardB.x);
    await layerButton(page, "Podcast card A").click();
    await expect(cardA).toHaveAttribute("aria-selected", "true");
    const selectedPanelNodeId = await cardA
      .locator("[data-layer-row-button]")
      .getAttribute("data-layer-node-id");
    expect(selectedPanelNodeId).not.toBeNull();

    const previewSelector = `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`;
    const previewIframe = page.locator(previewSelector);
    const previewIframeHandle = await previewIframe.elementHandle();
    if (!previewIframeHandle)
      throw new Error("Screen preview iframe is missing");
    const previewFrame = await previewIframeHandle.contentFrame();
    if (!previewFrame)
      throw new Error("Screen preview document is unavailable");
    const previewDocument = designFrame(page, screenId).locator("html");
    const previewDocumentToken = await previewDocument.evaluate(() => {
      const token = crypto.randomUUID();
      (window as any).__musicTutorialLayerMoveDocumentToken = token;
      return token;
    });
    await previewIframeHandle.evaluate((iframe) => {
      const host = window as any;
      host.__musicTutorialLayerMoveLoadCount = 0;
      iframe.addEventListener("load", () => {
        host.__musicTutorialLayerMoveLoadCount += 1;
      });
    });
    const consoleMessages: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];
    const networkRequests: Array<{
      method: string;
      path: string;
      resourceType: string;
    }> = [];
    const networkResponses: Array<{
      method: string;
      path: string;
      status: number;
    }> = [];
    const frameNavigations: string[] = [];
    const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    };
    const onPageError = (error: Error) => pageErrors.push(error.message);
    const onRequest = (request: import("@playwright/test").Request) => {
      const url = new URL(request.url());
      if (
        url.origin === new URL(page.url()).origin &&
        url.pathname.startsWith("/_agent-native/")
      ) {
        networkRequests.push({
          method: request.method(),
          path: url.pathname,
          resourceType: request.resourceType(),
        });
      }
    };
    const onResponse = (response: import("@playwright/test").Response) => {
      const url = new URL(response.url());
      if (
        url.origin === new URL(page.url()).origin &&
        url.pathname.startsWith("/_agent-native/")
      ) {
        networkResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      }
    };
    const onFrameNavigated = (frame: import("@playwright/test").Frame) => {
      if (frame === previewFrame) frameNavigations.push(frame.url());
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("framenavigated", onFrameNavigated);
    const proof: Record<string, unknown> = {
      figmaStep:
        "Auto Layout > Work with objects > Arrange or reorder objects (horizontal flow)",
      designId,
      screenId,
      nodeIds: { row: rowNodeId, cardA: cardANodeId, cardB: cardBNodeId },
      sourceOrderBefore: sourceLayerOrder(sourceBefore, cardNames),
      liveSiblingNodesBefore: await liveSiblingNodes(),
      liveCardPositionsBefore: beforePositions,
    };
    try {
      await cardA.dragTo(cardB, { targetPosition: { x: 24, y: 2 } });
      await expect.poll(savedCardOrder).toEqual(reorderedNames);
      proof.sourceOrderAfterMove = await savedCardOrder();
      await expect.poll(liveSiblingOrder).toEqual(reorderedNames);
      const movedPositions = await liveCardPositions();
      expect(movedPositions.cardB.x).toBeLessThan(movedPositions.cardA.x);
      proof.liveAfterMove = {
        siblingNodes: await liveSiblingNodes(),
        positions: movedPositions,
        selectedNodeId: await cardA
          .locator("[data-layer-row-button]")
          .getAttribute("data-layer-node-id"),
      };

      await expect(cardA).toHaveAttribute("aria-selected", "true");
      await expect(cardA.locator("[data-layer-row-button]")).toHaveAttribute(
        "data-layer-node-id",
        selectedPanelNodeId ?? "",
      );
      expect(
        await previewDocument.evaluate(
          () => (window as any).__musicTutorialLayerMoveDocumentToken ?? null,
        ),
      ).toBe(previewDocumentToken);
      expect(
        await page.evaluate(
          () => (window as any).__musicTutorialLayerMoveLoadCount ?? -1,
        ),
      ).toBe(0);
      expect(frameNavigations).toEqual([]);

      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(savedCardOrder).toEqual(cardNames);
      await expect.poll(liveSiblingOrder).toEqual(cardNames);
      const undoPositions = await liveCardPositions();
      expect(undoPositions.cardA.x).toBeLessThan(undoPositions.cardB.x);
      await expect(cardA).toHaveAttribute("aria-selected", "true");
      await expect(cardA.locator("[data-layer-row-button]")).toHaveAttribute(
        "data-layer-node-id",
        selectedPanelNodeId ?? "",
      );
      proof.sourceOrderAfterUndo = await savedCardOrder();
      proof.liveAfterUndo = {
        siblingNodes: await liveSiblingNodes(),
        positions: undoPositions,
        selectedNodeId: await cardA
          .locator("[data-layer-row-button]")
          .getAttribute("data-layer-node-id"),
      };

      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(savedCardOrder).toEqual(reorderedNames);
      await expect.poll(liveSiblingOrder).toEqual(reorderedNames);
      const redoPositions = await liveCardPositions();
      expect(redoPositions.cardB.x).toBeLessThan(redoPositions.cardA.x);
      await expect(cardA).toHaveAttribute("aria-selected", "true");
      await expect(cardA.locator("[data-layer-row-button]")).toHaveAttribute(
        "data-layer-node-id",
        selectedPanelNodeId ?? "",
      );
      proof.sourceOrderAfterRedo = await savedCardOrder();
      proof.liveAfterRedo = {
        siblingNodes: await liveSiblingNodes(),
        positions: redoPositions,
        selectedNodeId: await cardA
          .locator("[data-layer-row-button]")
          .getAttribute("data-layer-node-id"),
      };
      expect(
        await previewDocument.evaluate(
          () => (window as any).__musicTutorialLayerMoveDocumentToken ?? null,
        ),
      ).toBe(previewDocumentToken);
      expect(
        await page.evaluate(
          () => (window as any).__musicTutorialLayerMoveLoadCount ?? -1,
        ),
      ).toBe(0);
      expect(frameNavigations).toEqual([]);
      expect(await previewIframe.count()).toBe(1);
      proof.sourceOrderBeforeRestore = await savedCardOrder();
      await test.info().attach("music-app-layer-reorder-live-proof", {
        body: JSON.stringify(proof, null, 2),
        contentType: "application/json",
      });
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("framenavigated", onFrameNavigated);
      proof.console = consoleMessages;
      proof.pageErrors = pageErrors;
      proof.networkRequests = networkRequests;
      proof.networkResponses = networkResponses;
      proof.previewFrameNavigations = frameNavigations;
      proof.previewDocumentTokenPreserved =
        (await previewDocument
          .evaluate(
            () => (window as any).__musicTutorialLayerMoveDocumentToken ?? null,
          )
          .catch(() => null)) === previewDocumentToken;
      proof.previewLoadEvents = await page
        .evaluate(() => (window as any).__musicTutorialLayerMoveLoadCount ?? -1)
        .catch(() => -1);
    }

    await cardB.dragTo(cardA, { targetPosition: { x: 24, y: 2 } });
    await expect.poll(savedCardOrder).toEqual(cardNames);
    const restoredSource = await savedSource();
    const [restoredCardA, restoredCardB] = await Promise.all([
      measureSourceLayer(page, screenId, restoredSource, "Podcast card A"),
      measureSourceLayer(page, screenId, restoredSource, "Podcast card B"),
    ]);
    expect(restoredCardA.x).toBeLessThan(restoredCardB.x);
    await expect.poll(liveSiblingOrder).toEqual(cardNames);
    const [cardABoundsRestored, cardBBoundsRestored] = await Promise.all([
      cardA.boundingBox(),
      cardB.boundingBox(),
    ]);
    if (!cardABoundsRestored || !cardBBoundsRestored) {
      throw new Error("Restored podcast card rows are not measurable");
    }
    expect(cardBBoundsRestored.y).toBeLessThan(cardABoundsRestored.y);
    await test.info().attach("music-app-layer-reorder-restored", {
      body: JSON.stringify(
        {
          sourceOrder: sourceLayerOrder(restoredSource, cardNames),
          liveSiblingNodes: await liveSiblingNodes(),
          savedCardA: restoredCardA,
          savedCardB: restoredCardB,
          layersCardA: cardABoundsRestored,
          layersCardB: cardBBoundsRestored,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
  await createPodcastRow(
    page,
    screenId,
    "Main Content",
    "Recently played",
    447,
    [
      {
        name: "Recent card A",
        title: "Tasty Bites: Exploring Culinary Delights",
        creator: "FoodieFiends",
      },
      {
        name: "Recent card B",
        title: "Tasty Bites: Exploring Culinary Delights",
        creator: "FoodieFiends",
      },
    ],
  );

  await panOverviewCanvas(page, -480);
  await drawInScreen(page, screenId, "Frame", {
    x: 10,
    y: 954,
    width: 1420,
    height: 60,
    assertUnobstructed: true,
  });
  await renameLayer(page, "Frame", "Now Playing");
  await setFlowPosition(page, "Now Playing");
  const playerLayout = await turnIntoAutoLayout(
    page,
    "Now Playing",
    "Horizontal",
  );
  const playerGap = playerLayout.getByRole("textbox", {
    name: "Gap",
    exact: true,
  });
  await playerGap.fill("10");
  await playerGap.press("Enter");
  await playerLayout.getByRole("textbox", { name: /Left.*Right/ }).fill("10");
  await playerLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .press("Enter");
  await playerLayout.getByRole("textbox", { name: /Top.*Bottom/ }).fill("10");
  await playerLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .press("Enter");
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, "Now Playing");
  await drawInScreen(
    page,
    screenId,
    "Rectangle",
    { x: 40, y: 816, width: 40, height: 40 },
    undefined,
    "Player artwork",
  );
  await reparentLayer(page, "Player artwork", "Now Playing");
  await setFlowPosition(page, "Player artwork");
  await setFillHex(page, "2F74F5");
  await setCornerRadius(page, 6);
  await setSizingMode(page, "W", "Fixed");
  await setSizingMode(page, "H", "Fixed");
  await setDimension(page, "W", 40);
  await setDimension(page, "H", 40);
  await logNodeStage(
    page,
    designId,
    screenId,
    "Player artwork",
    "desktop-player-art-fixed-40x40",
  );
  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: 112, y: 828 },
    "North Star  /  Aster Vale",
    "Track metadata",
  );
  await reparentLayer(page, "Track metadata", "Now Playing");
  await setTextStyle(page, "Track metadata", "Inter", "Regular", 12, "FFFFFF");
  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: 620, y: 828 },
    "‹   ▶   ›",
    "Transport controls",
  );
  await reparentLayer(page, "Transport controls", "Now Playing");
  await setTextStyle(
    page,
    "Transport controls",
    "Inter",
    "Regular",
    12,
    "FFFFFF",
  );
  await drawInScreen(
    page,
    screenId,
    "Text",
    { x: 620, y: 828 },
    "00:24  ━━━━━━━━━  03:42",
    "Progress and duration",
  );
  await reparentLayer(page, "Progress and duration", "Now Playing");
  await setTextStyle(
    page,
    "Progress and duration",
    "Inter",
    "Regular",
    12,
    "FFFFFF",
  );

  const saved = await readDesign(page, designId);
  const content =
    saved.files?.find((file) => file.id === screenId)?.content ?? "";
  for (const label of [
    "Workspace",
    "Sidebar",
    "Main Content",
    "SONORA",
    "Good evening, Alex",
    "Recently played",
    "Tasty Bites",
    "Now Playing",
    "North Star",
    "00:24",
  ]) {
    expect(content, `saved Screen source is missing ${label}`).toContain(label);
  }
  const desktopMainMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Main Content",
  );
  const desktopPlayerMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Now Playing",
  );
  const desktopWorkspaceMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Workspace",
  );
  const desktopNavigationMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Navigation",
  );
  const desktopSidebarMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Sidebar",
  );
  const desktopLogoMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "SONORA",
  );
  const desktopPodcastRowMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Podcast row",
  );
  const desktopTopBarMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Top Bar",
  );
  const desktopRecentlyPlayedMetrics = await measureSourceLayer(
    page,
    screenId,
    content,
    "Recently played",
  );
  const mainContentTag = sourceLayerTag(content, "Main Content");
  expect(mainContentTag).toBeTruthy();
  expect(sourceStyleValue(mainContentTag!, "height")).toBe("fit-content");
  expect(mainContentTag).toMatch(/display:\s*flex/i);
  expect(mainContentTag).toMatch(/flex-direction:\s*column/i);
  const mainContentNaturalHeight =
    desktopTopBarMetrics.height +
    desktopPodcastRowMetrics.height +
    desktopRecentlyPlayedMetrics.height +
    parseFloat(desktopMainMetrics.rowGap) * 2 +
    parseFloat(desktopMainMetrics.paddingTop) +
    parseFloat(desktopMainMetrics.paddingBottom);
  const workspaceTag = sourceLayerTag(content, "Workspace");
  expect(workspaceTag).toBeTruthy();
  expect(workspaceTag).toMatch(/width:\s*auto/i);
  expect(workspaceTag).toMatch(/align-self:\s*stretch/i);
  const desktopCardA = await measureSourceLayer(
    page,
    screenId,
    content,
    "Podcast card A",
  );
  const desktopCardB = await measureSourceLayer(
    page,
    screenId,
    content,
    "Podcast card B",
  );
  await test.info().attach("tutorial-measurements-desktop", {
    body: JSON.stringify(
      {
        designId,
        screenId,
        geometry: designData(saved).canvasFrames?.[screenId],
        workspace: desktopWorkspaceMetrics,
        navigation: desktopNavigationMetrics,
        sidebar: desktopSidebarMetrics,
        logo: desktopLogoMetrics,
        mainContent: desktopMainMetrics,
        mainContentNaturalHeight,
        topBar: desktopTopBarMetrics,
        podcastRow: desktopPodcastRowMetrics,
        recentlyPlayed: desktopRecentlyPlayedMetrics,
        cardA: desktopCardA,
        cardB: desktopCardB,
        player: desktopPlayerMetrics,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect.soft(desktopMainMetrics.width).toBeCloseTo(1139, 0);
  expect
    .soft(desktopMainMetrics.height)
    .toBeCloseTo(mainContentNaturalHeight, 0);
  expect.soft(desktopTopBarMetrics.parentId).toBe(desktopMainMetrics.id);
  expect.soft(desktopPodcastRowMetrics.parentId).toBe(desktopMainMetrics.id);
  expect
    .soft(desktopRecentlyPlayedMetrics.parentId)
    .toBe(desktopMainMetrics.id);
  expect.soft(desktopWorkspaceMetrics.width).toBeCloseTo(1420, 0);
  expect.soft(desktopNavigationMetrics.width).toBeCloseTo(96, 0);
  expect.soft(desktopSidebarMetrics.width).toBeCloseTo(145, 0);
  expect.soft(desktopLogoMetrics.width).toBeCloseTo(105, 0);
  expect.soft(desktopPodcastRowMetrics.width).toBeCloseTo(1091, 0);
  expect.soft(desktopPlayerMetrics.width).toBeCloseTo(1420, 0);
  expect.soft(desktopPlayerMetrics.height).toBeCloseTo(60, 0);
  expect.soft(desktopCardA.width).toBeCloseTo(360, 0);
  expect.soft(desktopCardB.width).toBeCloseTo(360, 0);
  expect.soft(desktopCardA.y).toBeCloseTo(desktopCardB.y, 0);
  expect.soft(desktopCardB.x).toBeGreaterThan(desktopCardA.x);
  const shellBounds = await shell
    .locator("[data-screen-card]")
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  expect(shellBounds.width).toBeGreaterThan(0);
  const desktopScreenCapture = await captureScreenCard(
    page,
    screenId,
    "music-app-desktop-screen.png",
  );
  await test.info().attach("tutorial-screen-screenshot-desktop", {
    body: JSON.stringify(desktopScreenCapture, null, 2),
    contentType: "application/json",
  });
  await captureEditorScreenshot(page, "music-app-desktop-editor.png");

  const beforeMobile = await readDesign(page, designId);
  const existingMobileIds = new Set(beforeMobile.files?.map((file) => file.id));
  await pickFrameMode(page, "Screen");
  const mobileStart = await emptyBoardPoint(page);
  await page.mouse.move(mobileStart.x, mobileStart.y);
  await page.mouse.down();
  await page.mouse.move(mobileStart.x + 160, mobileStart.y + 220, {
    steps: 14,
  });
  await page.mouse.up();

  let mobileScreenId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const added = record.files?.find(
        (file) =>
          !existingMobileIds.has(file.id) && file.filename !== "__board__.html",
      );
      if (!added) return null;
      mobileScreenId = added.id;
      return added.id;
    })
    .not.toBeNull();
  await test.info().attach("tutorial-identities-desktop-mobile", {
    body: JSON.stringify(
      { designId, screenIds: [screenId, mobileScreenId] },
      null,
      2,
    ),
    contentType: "application/json",
  });

  await selectScreenLayer(page, mobileScreenId);
  await page
    .getByRole("textbox", { name: /^W(?: size in pixels)?$/ })
    .fill("390");
  await page
    .getByRole("textbox", { name: /^W(?: size in pixels)?$/ })
    .press("Enter");
  await page
    .getByRole("textbox", { name: /^H(?: size in pixels)?$/ })
    .fill("844");
  await page
    .getByRole("textbox", { name: /^H(?: size in pixels)?$/ })
    .press("Enter");
  await expect
    .poll(async () => {
      const data = designData(await readDesign(page, designId));
      const frame = data.canvasFrames?.[mobileScreenId];
      const metadata = data.screenMetadata?.[mobileScreenId];
      return [frame?.width, frame?.height, metadata?.width, metadata?.height];
    })
    .toEqual([390, 844, 390, 844]);
  await page.keyboard.press("Shift+a");
  const mobileRootHeading = page.getByRole("heading", {
    name: "Auto layout",
    exact: true,
  });
  await expect(mobileRootHeading).toBeVisible();
  const mobileRootLayout = mobileRootHeading.locator("xpath=ancestor::section");
  await mobileRootLayout
    .getByRole("button", { name: "Vertical", exact: true })
    .click();
  await mobileRootLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .fill("10");
  await mobileRootLayout
    .getByRole("textbox", { name: /Left.*Right/ })
    .press("Enter");
  await mobileRootLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .fill("10");
  await mobileRootLayout
    .getByRole("textbox", { name: /Top.*Bottom/ })
    .press("Enter");
  await mobileRootLayout.getByRole("button", { name: "Gap mode" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Auto" }).click();
  await setFillHex(page, "0C101A");

  await drawInScreen(
    page,
    mobileScreenId,
    "Frame",
    { x: 10, y: 10, width: 370, height: 536 },
    undefined,
    "Mobile Workspace",
  );
  await reparentLayer(
    page,
    "Mobile Workspace",
    screenLayerRow(page, mobileScreenId),
  );
  await setFlowPosition(page, "Mobile Workspace");
  const mobileWorkspaceLayout = await turnIntoAutoLayout(
    page,
    "Mobile Workspace",
    "Vertical",
  );
  await mobileWorkspaceLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("10");
  await mobileWorkspaceLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "10"],
    [/Top.*Bottom/, "10"],
  ] as const) {
    const field = mobileWorkspaceLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, "Mobile Workspace");

  await drawInScreen(
    page,
    mobileScreenId,
    "Frame",
    { x: 20, y: 20, width: 323, height: 69 },
    undefined,
    "Mobile Sidebar",
  );
  await reparentLayer(page, "Mobile Sidebar", "Mobile Workspace");
  await setFlowPosition(page, "Mobile Sidebar");
  const mobileSidebarLayout = await turnIntoAutoLayout(
    page,
    "Mobile Sidebar",
    "Horizontal",
  );
  await mobileSidebarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("8");
  await mobileSidebarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "12"],
    [/Top.*Bottom/, "20"],
  ] as const) {
    const field = mobileSidebarLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await setSizingMode(page, "W", "Hug contents");
  await setSizingMode(page, "H", "Hug contents");
  await setFillHex(page, "141A24");

  await drawInScreen(
    page,
    mobileScreenId,
    "Text",
    { x: 32, y: 32 },
    "Home  Browse  Library  Playlists",
    "Mobile navigation",
  );
  await reparentLayer(page, "Mobile navigation", "Mobile Sidebar");
  await setTextStyle(
    page,
    "Mobile navigation",
    "Inter",
    "Bold",
    12,
    "FFFFFF",
    "16",
  );
  await setSizingMode(page, "W", "Fixed");
  await setSizingMode(page, "H", "Fixed");
  await setDimension(page, "W", 186);
  await setDimension(page, "H", 16);
  await drawInScreen(
    page,
    mobileScreenId,
    "Text",
    { x: 230, y: 30 },
    "SONORA",
    "Mobile SONORA",
  );
  await reparentLayer(page, "Mobile SONORA", "Mobile Sidebar");
  await setTextStyle(page, "Mobile SONORA", "Inter", "Bold", 24, "FFFFFF");

  await drawInScreen(
    page,
    mobileScreenId,
    "Frame",
    { x: 20, y: 89, width: 350, height: 437 },
    undefined,
    "Mobile Main Content",
  );
  await reparentLayer(page, "Mobile Main Content", "Mobile Workspace");
  await setFlowPosition(page, "Mobile Main Content");
  const mobileContentLayout = await turnIntoAutoLayout(
    page,
    "Mobile Main Content",
    "Vertical",
  );
  await mobileContentLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("24");
  await mobileContentLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "24"],
    [/Top.*Bottom/, "24"],
  ] as const) {
    const field = mobileContentLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, "Mobile Main Content");

  await drawInScreen(
    page,
    mobileScreenId,
    "Frame",
    { x: 44, y: 113, width: 285, height: 50 },
    undefined,
    "Mobile Top Bar",
  );
  await reparentLayer(page, "Mobile Top Bar", "Mobile Main Content");
  await setFlowPosition(page, "Mobile Top Bar");
  const mobileTopBarLayout = await turnIntoAutoLayout(
    page,
    "Mobile Top Bar",
    "Horizontal",
  );
  await mobileTopBarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("10");
  await mobileTopBarLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "10"],
    [/Top.*Bottom/, "10"],
  ] as const) {
    const field = mobileTopBarLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await removeFill(page, "Mobile Top Bar");
  await drawInScreen(
    page,
    mobileScreenId,
    "Text",
    { x: 54, y: 123 },
    "Good evening, Alex",
    "Mobile greeting",
  );
  await reparentLayer(page, "Mobile greeting", "Mobile Top Bar");
  await setTextStyle(
    page,
    "Mobile greeting",
    "Inter",
    "Bold",
    28,
    "FFFFFF",
    "30",
  );
  await layerButton(page, "Mobile Top Bar").click();
  await setSizingMode(page, "W", "Hug contents");
  await setSizingMode(page, "H", "Hug contents");

  await createPodcastRow(
    page,
    mobileScreenId,
    "Mobile Main Content",
    "Mobile Podcast row",
    187,
    [
      {
        name: "Mobile Podcast card",
        title: "Tasty Bites: Exploring Culinary Delights",
        creator: "FoodieFiends",
      },
    ],
    { direction: "Vertical", cardWidth: 302, width: 302 },
  );

  const mobileCardAuthoring = await readDesign(page, designId);
  const mobileCardFile = mobileCardAuthoring.files?.find(
    (file) => file.id === mobileScreenId,
  );
  const mobileBoardFile = mobileCardAuthoring.files?.find(
    (file) => file.filename === "__board__.html",
  );
  const mobilePlayButtonTag =
    mobileCardFile?.content?.match(
      /<[^>]*data-agent-native-layer-name=["']Mobile Podcast card play button["'][^>]*>/,
    )?.[0] ?? "";
  expect(
    mobilePlayButtonTag,
    "mobile play-button Frame should be authored in the Mobile Screen file",
  ).toContain('data-an-primitive="frame"');
  expect(mobileBoardFile?.content ?? "").not.toContain(
    'data-agent-native-layer-name="Mobile Podcast card play button"',
  );
  expect(mobilePlayButtonTag).toMatch(/right:\s*10px/i);
  expect(mobilePlayButtonTag).toMatch(/bottom:\s*13px/i);

  await panOverviewCanvas(page, -480);
  await drawInScreen(
    page,
    mobileScreenId,
    "Frame",
    {
      x: 10,
      y: 774,
      width: 370,
      height: 60,
      assertUnobstructed: true,
    },
    undefined,
    "Mobile Now Playing",
  );
  await reparentLayer(
    page,
    "Mobile Now Playing",
    screenLayerRow(page, mobileScreenId),
  );
  await setFlowPosition(page, "Mobile Now Playing");
  const mobilePlayerLayout = await turnIntoAutoLayout(
    page,
    "Mobile Now Playing",
    "Horizontal",
  );
  await mobilePlayerLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .fill("10");
  await mobilePlayerLayout
    .getByRole("textbox", { name: "Gap", exact: true })
    .press("Enter");
  for (const [name, value] of [
    [/Left.*Right/, "10"],
    [/Top.*Bottom/, "10"],
  ] as const) {
    const field = mobilePlayerLayout.getByRole("textbox", { name });
    await field.fill(value);
    await field.press("Enter");
  }
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await removeFill(page, "Mobile Now Playing");
  await drawInScreen(
    page,
    mobileScreenId,
    "Rectangle",
    { x: 20, y: 784, width: 40, height: 40 },
    undefined,
    "Mobile Album art",
  );
  await reparentLayer(page, "Mobile Album art", "Mobile Now Playing");
  await setFlowPosition(page, "Mobile Album art");
  await setSizingMode(page, "W", "Fixed");
  await setSizingMode(page, "H", "Fixed");
  await setDimension(page, "W", 40);
  await setDimension(page, "H", 40);
  await setFillHex(page, "2F74F5");
  await setCornerRadius(page, 6);
  await drawInScreen(
    page,
    mobileScreenId,
    "Text",
    { x: 70, y: 795 },
    "North Star  /  Aster Vale",
    "Mobile Track metadata",
  );
  await reparentLayer(page, "Mobile Track metadata", "Mobile Now Playing");
  await setTextStyle(
    page,
    "Mobile Track metadata",
    "Inter",
    "Regular",
    12,
    "FFFFFF",
  );
  await drawInScreen(
    page,
    mobileScreenId,
    "Text",
    { x: 280, y: 795 },
    "‹   ▶   ›",
    "Mobile Transport controls",
  );
  await reparentLayer(page, "Mobile Transport controls", "Mobile Now Playing");
  await setTextStyle(
    page,
    "Mobile Transport controls",
    "Inter",
    "Regular",
    12,
    "FFFFFF",
  );

  const mobileSaved = await readDesign(page, designId);
  const mobileSource =
    mobileSaved.files?.find((file) => file.id === mobileScreenId)?.content ??
    "";
  for (const label of [
    "Mobile Workspace",
    "Mobile Sidebar",
    "Mobile Main Content",
    "Mobile Podcast row",
    "Mobile Podcast card",
    "Tasty Bites",
    "Now Playing",
    "North Star",
  ]) {
    expect(mobileSource, `mobile Screen source is missing ${label}`).toContain(
      label,
    );
  }
  expect(mobileSource).not.toContain("Progress and duration");
  expect(mobileSource).toMatch(/min-width:\s*200px/i);
  expect(mobileSource).toMatch(/max-width:\s*400px/i);
  const mobileGeometry = designData(mobileSaved).canvasFrames?.[mobileScreenId];
  expect(mobileGeometry).toMatchObject({ width: 390, height: 844 });
  const mobileMainMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Main Content",
  );
  const mobileCardMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Podcast card",
  );
  const mobilePlayerMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Now Playing",
  );
  const mobileWorkspaceMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Workspace",
  );
  const mobileSidebarMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Sidebar",
  );
  const mobilePodcastRowMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Podcast row",
  );
  const mobileArtworkMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Podcast card artwork",
  );
  const mobilePlayButtonMetrics = await measureSourceLayer(
    page,
    mobileScreenId,
    mobileSource,
    "Mobile Podcast card play button",
  );
  const mobileImageSource = sourceLayerTag(
    mobileSource,
    "Mobile Podcast card artwork",
  );
  await test.info().attach("tutorial-measurements-mobile", {
    body: JSON.stringify(
      {
        designId,
        screenId: mobileScreenId,
        geometry: mobileGeometry,
        workspace: mobileWorkspaceMetrics,
        sidebar: mobileSidebarMetrics,
        mainContent: mobileMainMetrics,
        podcastRow: mobilePodcastRowMetrics,
        card: mobileCardMetrics,
        artwork: mobileArtworkMetrics,
        playButton: mobilePlayButtonMetrics,
        player: mobilePlayerMetrics,
        playButtonAdaptation:
          "Frame with the reference SVG image; Figma source uses a component instance",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(mobileImageSource).toContain("/api/qa-figma-import-assets/");
  expect.soft(mobileMainMetrics.width).toBeCloseTo(350, 0);
  expect.soft(mobileMainMetrics.height).toBeCloseTo(438, 0);
  expect.soft(mobileCardMetrics.width).toBeCloseTo(302, 0);
  expect.soft(mobileCardMetrics.height).toBeCloseTo(316, 0);
  expect.soft(mobileWorkspaceMetrics.width).toBeCloseTo(370, 0);
  expect.soft(mobileWorkspaceMetrics.height).toBeCloseTo(537, 0);
  expect.soft(mobileSidebarMetrics.width).toBeCloseTo(323, 0);
  expect.soft(mobileSidebarMetrics.height).toBeCloseTo(69, 0);
  expect.soft(mobilePodcastRowMetrics.width).toBeCloseTo(302, 0);
  expect.soft(mobilePodcastRowMetrics.height).toBeCloseTo(316, 0);
  expect.soft(mobileArtworkMetrics.width).toBeCloseTo(278, 0);
  expect.soft(mobileArtworkMetrics.height).toBeCloseTo(242, 0);
  expect.soft(mobilePlayerMetrics.width).toBeCloseTo(370, 0);
  expect.soft(mobilePlayerMetrics.height).toBeCloseTo(60, 0);
  const mobileScreenCapture = await captureScreenCard(
    page,
    mobileScreenId,
    "music-app-mobile-screen.png",
  );
  await test.info().attach("tutorial-screen-screenshot-mobile", {
    body: JSON.stringify(mobileScreenCapture, null, 2),
    contentType: "application/json",
  });
  await captureEditorScreenshot(page, "music-app-mobile-editor.png");
  const filesBeforeTablet = new Set(
    (await readDesign(page, designId)).files?.map((file) => file.id),
  );
  await selectScreenLayer(page, screenId);
  await page.keyboard.press("ControlOrMeta+d");
  let tabletScreenId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const duplicate = record.files?.find(
        (file) =>
          !filesBeforeTablet.has(file.id) && file.filename !== "__board__.html",
      );
      if (!duplicate) return null;
      tabletScreenId = duplicate.id;
      return duplicate.id;
    })
    .not.toBeNull();
  await test.info().attach("tutorial-identities-all-screens", {
    body: JSON.stringify(
      { designId, screenIds: [screenId, mobileScreenId, tabletScreenId] },
      null,
      2,
    ),
    contentType: "application/json",
  });

  const tabletShell = page.locator(
    `[data-screen-shell][data-frame-id="${tabletScreenId}"]`,
  );
  await selectScreenLayer(page, tabletScreenId);
  await expandAllLayers(page);
  await renameSelectedLayer(page, "Tablet - 1", "Tablet 1");
  const renamedTablet = await readDesign(page, designId);
  expect(
    renamedTablet.files?.find((file) => file.id === tabletScreenId)?.filename,
  ).toBe("Tablet - 1.html");
  await setDimension(page, "W", 768);
  await setDimension(page, "H", 1366);
  await expect
    .poll(async () => {
      const data = designData(await readDesign(page, designId));
      const frame = data.canvasFrames?.[tabletScreenId];
      const metadata = data.screenMetadata?.[tabletScreenId];
      return [frame?.width, frame?.height, metadata?.width, metadata?.height];
    })
    .toEqual([768, 1366, 768, 1366]);

  await selectLayerInScreen(page, tabletScreenId, "Workspace");
  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Fill container");
  for (const cardName of [
    "Podcast card A",
    "Podcast card B",
    "Recent card A",
    "Recent card B",
  ]) {
    await selectLayerInScreen(page, tabletScreenId, cardName);
    await setSizingMode(page, "W", "Fill container");
  }

  const tabletSaved = await readDesign(page, designId);
  const tabletSource =
    tabletSaved.files?.find((file) => file.id === tabletScreenId)?.content ??
    "";
  for (const layerName of [
    "Workspace",
    "Sidebar",
    "Main Content",
    "Podcast row",
    "Podcast card A",
    "Podcast card B",
    "Recently played",
    "Recent card A",
    "Recent card B",
    "Now Playing",
  ]) {
    expect(tabletSource, `tablet source is missing ${layerName}`).toContain(
      layerName,
    );
  }
  expect(tabletSource).toMatch(/min-width:\s*200px/i);
  expect(tabletSource).toMatch(/max-width:\s*400px/i);
  expect(tabletSource).toMatch(/flex-wrap:\s*wrap/i);

  const tabletMainMetrics = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Main Content",
  );
  const tabletWorkspaceMetrics = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Workspace",
  );
  const desktopPodcastRow = await measureSourceLayer(
    page,
    screenId,
    content,
    "Podcast row",
  );
  const tabletPodcastRow = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Podcast row",
  );
  const tabletCardA = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Podcast card A",
  );
  const tabletCardB = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Podcast card B",
  );
  const tabletRecentlyA = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Recent card A",
  );
  const tabletRecentlyB = await measureSourceLayer(
    page,
    tabletScreenId,
    tabletSource,
    "Recent card B",
  );
  const tabletGeometry = designData(tabletSaved).canvasFrames?.[tabletScreenId];
  await test.info().attach("tutorial-measurements-tablet", {
    body: JSON.stringify(
      {
        designId,
        screenId: tabletScreenId,
        geometry: tabletGeometry,
        mainContent: tabletMainMetrics,
        workspace: tabletWorkspaceMetrics,
        podcastRow: tabletPodcastRow,
        cardA: tabletCardA,
        cardB: tabletCardB,
        recentlyPlayedA: tabletRecentlyA,
        recentlyPlayedB: tabletRecentlyB,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect.soft(tabletMainMetrics.width).toBeCloseTo(467, 0);
  expect.soft(tabletMainMetrics.height).toBeCloseTo(1458, 0);
  expect.soft(tabletWorkspaceMetrics.width).toBeCloseTo(748, 0);
  expect.soft(tabletWorkspaceMetrics.height).toBeCloseTo(1276, 0);
  expect.soft(tabletCardA.width).toBeCloseTo(400, 0);
  expect.soft(tabletCardB.width).toBeCloseTo(400, 0);
  expect.soft(tabletCardA.height).toBeCloseTo(316, 0);
  expect.soft(tabletCardB.height).toBeCloseTo(316, 0);
  expect.soft(desktopCardA.y).toBeCloseTo(desktopCardB.y, 0);
  expect.soft(desktopCardB.x).toBeGreaterThan(desktopCardA.x);
  expect.soft(tabletCardA.x).toBeCloseTo(tabletCardB.x, 0);
  expect.soft(tabletCardB.y).toBeGreaterThan(tabletCardA.y);
  expect.soft(tabletRecentlyA.x).toBeCloseTo(tabletRecentlyB.x, 0);
  expect.soft(tabletRecentlyB.y).toBeGreaterThan(tabletRecentlyA.y);
  expect.soft(tabletPodcastRow.flexWrap).toBe("wrap");
  expect.soft(desktopPodcastRow.flexWrap).toBe("wrap");
  const tabletCard = await tabletShell
    .locator("[data-screen-card]")
    .boundingBox();
  if (!tabletCard) throw new Error("tablet Screen card is not visible");
  expect.soft(tabletMainMetrics.bottom).toBeGreaterThan(1366);
  const tabletScreenCapture = await captureScreenCard(
    page,
    tabletScreenId,
    "music-app-tablet-screen.png",
  );
  await test.info().attach("tutorial-screen-screenshot-tablet", {
    body: JSON.stringify(tabletScreenCapture, null, 2),
    contentType: "application/json",
  });
  await captureEditorScreenshot(page, "music-app-tablet-editor.png");
  const screenIds = [screenId, mobileScreenId, tabletScreenId];
  const savedBeforeReload = await readDesign(page, designId);
  const sourceBeforeReload = new Map(
    screenIds.map((id) => [
      id,
      savedBeforeReload.files?.find((file) => file.id === id)?.content ?? "",
    ]),
  );
  for (const [id, source] of sourceBeforeReload) {
    expect(source, `Screen ${id} source is empty before reload`).not.toBe("");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  const savedAfterReload = await readDesign(page, designId);
  const persistence = screenIds.map((id) => {
    const file = savedAfterReload.files?.find(
      (candidate) => candidate.id === id,
    );
    const source = file?.content ?? "";
    const unchanged = source !== "" && source === sourceBeforeReload.get(id);
    expect(
      unchanged,
      `Screen ${id} source changed or vanished after reload`,
    ).toBe(true);
    return {
      id,
      filename: file?.filename,
      characters: source.length,
      unchanged,
    };
  });

  const afterReloadMetrics = {
    desktopArtwork: await measureSourceLayer(
      page,
      screenId,
      sourceBeforeReload.get(screenId) ?? "",
      "Podcast card A artwork",
    ),
    mobileArtwork: await measureSourceLayer(
      page,
      mobileScreenId,
      sourceBeforeReload.get(mobileScreenId) ?? "",
      "Mobile Podcast card artwork",
    ),
    tabletPodcastRow: await measureSourceLayer(
      page,
      tabletScreenId,
      sourceBeforeReload.get(tabletScreenId) ?? "",
      "Podcast row",
    ),
  };
  const desktopArtworkTag = sourceLayerTag(
    sourceBeforeReload.get(screenId) ?? "",
    "Podcast card A artwork",
  );
  expect(desktopArtworkTag).not.toBeNull();
  const desktopArtworkImageUrl = savedImageUrl(desktopArtworkTag!);
  expect(desktopArtworkImageUrl).toContain("/api/qa-figma-import-assets/");
  expect(afterReloadMetrics.desktopArtwork.backgroundImage).toContain(
    "linear-gradient",
  );
  expect(afterReloadMetrics.desktopArtwork.backgroundImage).toContain(
    desktopArtworkImageUrl!,
  );
  expect(afterReloadMetrics.mobileArtwork.backgroundImage).toContain(
    "linear-gradient",
  );
  await test.info().attach("tutorial-source-and-render-after-reload", {
    body: JSON.stringify({ persistence, afterReloadMetrics }, null, 2),
    contentType: "application/json",
  });
  await test.info().attach("tutorial-chat-thread-404s", {
    body: JSON.stringify(
      { count: chatThread404s.length, responses: chatThread404s },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
