import { type Locator, type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  pickFrameMode,
  selectTool,
} from "./helpers";
import {
  type App,
  childrenOf,
  expect,
  expectOnlyChanged,
  type SavedNode,
  styleOf,
  test,
} from "./rails";

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
  await page.keyboard.press("Shift+2");
  const body = designFrame(page, screenId).locator("body");
  const screenCard = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
  );
  if (!rect.assertUnobstructed) await screenCard.scrollIntoViewIfNeeded();
  const screenGeometry = designData(before).canvasFrames?.[screenId] ?? null;
  const screenWidth = screenGeometry?.width ?? 1440;
  if (tool === "Frame") {
    await pickFrameMode(page, "Frame");
  } else {
    // Rectangle and Text sit in the Frame group's menu, not on the bar itself.
    await selectTool(page, tool);
    await expect(
      page.locator(`[data-design-bottom-toolbar] button[aria-label="${tool}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  }

  let previousCamera: string | null = null;
  let stableCameraSamples = 0;
  const drawingGeometry: {
    current: {
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
    } | null;
  } = {
    current: null,
  };
  const drawingGeometryDiagnostic: {
    current: Record<string, unknown> | null;
  } = {
    current: null,
  };
  try {
    await expect
      .poll(
        async () => {
          const bodyBox = await body.boundingBox();
          const cardBox = await screenCard.boundingBox();
          const viewport = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }));
          if (!bodyBox || !cardBox) {
            drawingGeometry.current = null;
            drawingGeometryDiagnostic.current = {
              screenId,
              tool,
              requestedRect: rect,
              persistedScreenDimensions: {
                width: screenGeometry?.width ?? null,
                height: screenGeometry?.height ?? null,
              },
              screenWidthForScale: screenWidth,
              bodyBox,
              cardBox,
              viewport,
              scale: null,
              startPoint: null,
              endPoint: null,
              pointerTargets: null,
              settled: false,
              safe: false,
            };
            return { settled: false, safe: false };
          }
          const scale = cardBox.width / screenWidth;
          const startPoint = {
            x: bodyBox.x + rect.x * scale,
            y: bodyBox.y + rect.y * scale,
          };
          const endPoint = {
            x: bodyBox.x + (rect.x + (rect.width ?? 1)) * scale,
            y: bodyBox.y + (rect.y + (rect.height ?? 1)) * scale,
          };
          const pointerTargets = await page.evaluate(
            ({ startPoint, endPoint, cardBox }) => {
              return [startPoint, endPoint].map(({ x, y }) => {
                const target = document.elementFromPoint(x, y);
                const targetBounds = target?.getBoundingClientRect();
                const frameElement =
                  target?.closest<HTMLElement>("[data-frame-id]");
                const screenShell = target?.closest<HTMLElement>(
                  "[data-screen-shell]",
                );
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
                  inToolbar: Boolean(
                    target?.closest("[data-design-bottom-toolbar]"),
                  ),
                  creationShield: Boolean(
                    target?.closest("[data-canvas-creation-shield]"),
                  ),
                  frameId: frameElement?.getAttribute("data-frame-id") ?? null,
                  hit: target
                    ? {
                        tagName: target.tagName,
                        id: target.id || null,
                        role: target.getAttribute("role"),
                        className: target.getAttribute("class"),
                        bounds: targetBounds
                          ? {
                              x: targetBounds.x,
                              y: targetBounds.y,
                              width: targetBounds.width,
                              height: targetBounds.height,
                            }
                          : null,
                        screenCard: Boolean(
                          target.closest("[data-screen-card]"),
                        ),
                        screenShellId:
                          screenShell?.getAttribute("data-frame-id") ?? null,
                      }
                    : null,
                };
              });
            },
            { startPoint, endPoint, cardBox },
          );
          const cameraSignature = [
            bodyBox.x,
            bodyBox.y,
            cardBox.x,
            cardBox.y,
            cardBox.width,
            cardBox.height,
          ]
            .map((value) => Math.round(value * 2) / 2)
            .join(":");
          stableCameraSamples =
            cameraSignature === previousCamera ? stableCameraSamples + 1 : 0;
          previousCamera = cameraSignature;
          const settled = stableCameraSamples >= 2;
          const safe =
            Number.isFinite(scale) &&
            scale > 0 &&
            pointerTargets.every(
              (target) =>
                target.inViewport &&
                target.inScreenBounds &&
                !target.inToolbar &&
                (target.frameId === screenId || target.creationShield),
            );
          drawingGeometryDiagnostic.current = {
            screenId,
            tool,
            requestedRect: rect,
            persistedScreenDimensions: {
              width: screenGeometry?.width ?? null,
              height: screenGeometry?.height ?? null,
            },
            screenWidthForScale: screenWidth,
            bodyBox,
            cardBox,
            viewport,
            scale,
            startPoint,
            endPoint,
            pointerTargets,
            cameraSignature,
            stableCameraSamples,
            settled,
            safe,
          };
          drawingGeometry.current = { startPoint, endPoint };
          return { settled, safe, scale, pointerTargets };
        },
        {
          timeout: 15_000,
          message: `screen ${screenId} must fit and expose both ${tool} endpoints before drawing`,
        },
      )
      .toMatchObject({ settled: true, safe: true });
  } catch (error) {
    try {
      await test.info().attach("screen-drawing-geometry-failure", {
        body: JSON.stringify(
          drawingGeometryDiagnostic.current ?? {
            screenId,
            tool,
            requestedRect: rect,
            persistedScreenDimensions: {
              width: screenGeometry?.width ?? null,
              height: screenGeometry?.height ?? null,
            },
            screenWidthForScale: screenWidth,
            detail: "No poll geometry sample was captured",
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } catch {
      // Preserve the original geometry assertion if artifact attachment fails.
    }
    throw error;
  }
  const settledGeometry = drawingGeometry.current;
  if (!settledGeometry) {
    throw new Error(`screen ${screenId} drawing geometry was unavailable`);
  }
  const { startPoint, endPoint } = settledGeometry;
  if (tool === "Text") {
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

async function setSizingMode(page: Page, axis: "W" | "H", mode: string) {
  await waitForSelectionRouteToCommit(page);
  const button = page.getByRole("button", {
    name: new RegExp(`^${axis}(?: sizing mode —| \\d+(?:\\.\\d+)? )`),
  });
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole("menuitem", { name: mode, exact: true }).click();
}

async function waitForSelectionRouteToCommit(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const selection = (window as any).__designSelection;
          if (!selection) return null;
          const params = new URLSearchParams(window.location.search);
          const selectedLayerIds = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
            ),
          )
            .map((button) => button.dataset.layerNodeId)
            .filter((id): id is string => Boolean(id));
          const screenIds = new Set(
            Array.isArray(selection.screens)
              ? selection.screens
                  .map((screen: { id?: unknown }) => screen.id)
                  .filter((id: unknown): id is string => typeof id === "string")
              : [],
          );
          const selectedElementLayerIds = selectedLayerIds.filter(
            (id) => !screenIds.has(id),
          );
          const expectedZoom = Number.isFinite(selection.zoom)
            ? Math.round(selection.zoom * 100) / 100
            : null;
          const routeZoom = params.get("zoom");
          return {
            viewMatches:
              !selection.viewMode ||
              params.get("editorView") === selection.viewMode,
            screenMatches:
              !selection.activeFileId ||
              params.get("screen") === selection.activeFileId,
            selectionMatches:
              selectedElementLayerIds.length > 0
                ? selectedElementLayerIds.includes(
                    params.get("selection") ?? "",
                  )
                : !selection.selectedElement &&
                  params.get("selection") === null,
            zoomMatches:
              expectedZoom === null
                ? routeZoom === null
                : routeZoom !== null && Number(routeZoom) === expectedZoom,
            selectedLayerIds: selectedElementLayerIds,
            route: {
              view: params.get("editorView"),
              screen: params.get("screen"),
              selection: params.get("selection"),
              zoom: routeZoom,
            },
            editor: {
              view: selection.viewMode ?? null,
              screen: selection.activeFileId ?? null,
              hasSelectedElement: Boolean(selection.selectedElement),
              zoom: selection.zoom ?? null,
            },
          };
        }),
      { timeout: 10_000 },
    )
    .toMatchObject({
      viewMatches: true,
      screenMatches: true,
      selectionMatches: true,
      zoomMatches: true,
    });
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

test("sizing mode actions survive the selected layer route update", async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const designId = await createFixtureDesign(
    page,
    `Sizing mode route update ${Date.now()}`,
  );
  await page.setViewportSize({ width: 2800, height: 1600 });
  await gotoEditor(page, designId);
  const screenId = (await readDesign(page, designId)).files?.find(
    (file) => file.filename === "index.html",
  )?.id;
  if (!screenId) throw new Error("Fixture design has no Screen");

  await drawInScreen(
    page,
    screenId,
    "Frame",
    { x: 24, y: 24, width: 320, height: 180 },
    undefined,
    "Route sizing frame",
  );
  await setFlowPosition(page, "Route sizing frame");
  const layout = await turnIntoAutoLayout(
    page,
    "Route sizing frame",
    "Horizontal",
  );
  const gap = layout.getByRole("textbox", { name: "Gap", exact: true });
  await gap.fill("16");
  await gap.press("Enter");
  await waitForSelectionRouteToCommit(page);
  await app.settled();
  const before = await app.savedNodes(designId);
  const frameId = sourceNodeId(
    (await readDesign(page, designId)).files!.find(
      (file) => file.id === screenId,
    )!.content!,
    "Route sizing frame",
  )!;
  const routeSelection = new URL(page.url()).searchParams.get("selection");
  expect(routeSelection).not.toBeNull();
  expect(
    await page
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
      )
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-layer-node-id")),
      ),
  ).toEqual([routeSelection]);

  await setSizingMode(page, "W", "Fill container");
  await setSizingMode(page, "H", "Hug contents");
  await app.settled();

  await expect(
    page.getByRole("button", { name: /^W \d+(?:\.\d+)? Fill$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^H \d+(?:\.\d+)? Hug$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Hug contents" }),
  ).toHaveCount(0);
  const after = await app.savedNodes(designId);
  const style = styleOf(after.get(frameId));
  expect({ width: style.width, height: style.height }).toEqual({
    width: "100%",
    height: "fit-content",
  });
  expectOnlyChanged(before, after, [frameId]);
});

const DESKTOP_WORKSPACE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#0c101a;font-family:system-ui">
  <div data-agent-native-node-id="workspace" data-agent-native-layer-name="Workspace" style="display:flex;flex-direction:row;gap:10px;padding:10px;width:1200px;height:600px;box-sizing:border-box;background:#111827">
    <div data-agent-native-node-id="sidebar" data-agent-native-layer-name="Sidebar" style="width:240px;height:400px;flex-shrink:0;background:#141a24"></div>
    <div data-agent-native-node-id="main" data-agent-native-layer-name="Main Content" style="width:400px;height:300px;flex-shrink:0;background:#1f6feb"></div>
  </div>
</body></html>`;

const PODCAST_ROW = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0c101a;font-family:system-ui">
  <div data-agent-native-node-id="podcast-row" data-agent-native-layer-name="Podcast row" style="display:flex;flex-direction:row;gap:16px;width:800px">
    <div data-agent-native-node-id="card-a" data-agent-native-layer-name="Podcast card A" style="width:240px;height:160px;flex-shrink:0;background:#2f74f5"></div>
    <div data-agent-native-node-id="card-b" data-agent-native-layer-name="Podcast card B" style="width:240px;height:160px;flex-shrink:0;background:#f5a524"></div>
  </div>
</body></html>`;

const WRAPPING_CARDS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0c101a;font-family:system-ui">
  <div data-agent-native-node-id="podcast-row" data-agent-native-layer-name="Podcast row" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:16px">
    <div data-agent-native-node-id="card-a" data-agent-native-layer-name="Podcast card A" style="width:360px;min-width:360px;max-width:400px;height:120px;background:#2f74f5"></div>
    <div data-agent-native-node-id="card-b" data-agent-native-layer-name="Podcast card B" style="width:360px;min-width:360px;max-width:400px;height:120px;background:#f5a524"></div>
  </div>
</body></html>`;

async function clickCenter(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
}

// Screens made in the editor are not seeded, so the rails screen lookups cannot name them.
function screenIframeById(page: Page, fileId: string) {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
  );
}

async function rectInScreen(page: Page, fileId: string, nodeId: string) {
  return screenIframeById(page, fileId)
    .contentFrame()
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

async function clickCenterInScreen(page: Page, fileId: string, nodeId: string) {
  const rect = await rectInScreen(page, fileId, nodeId);
  const iframe = screenIframeById(page, fileId);
  const box = await iframe.boundingBox();
  if (!box) throw new Error(`screen ${fileId} has no box`);
  const width = await iframe.evaluate(
    (element: HTMLIFrameElement) =>
      element.contentDocument!.documentElement.clientWidth,
  );
  const scale = box.width / width;
  await page.mouse.click(
    box.x + (rect.x + rect.width / 2) * scale,
    box.y + (rect.y + rect.height / 2) * scale,
  );
}

function layersWithoutIds(nodes: Map<string, SavedNode>) {
  const name = (id: string | null) =>
    id ? nodes.get(id)?.attrs["data-agent-native-layer-name"] : null;
  return [...nodes.values()].map(({ id: _id, parent, attrs, ...rest }) => {
    const { "data-agent-native-node-id": _nodeId, ...otherAttrs } = attrs;
    return { ...rest, parent: name(parent), attrs: otherAttrs };
  });
}

function idByLayerName(nodes: Map<string, SavedNode>, layerName: string) {
  const matches = [...nodes.values()].filter(
    (node) => node.attrs["data-agent-native-layer-name"] === layerName,
  );
  expect(matches, `one saved layer named ${layerName}`).toHaveLength(1);
  return matches[0].id;
}

function savedFrames(record: DesignRecord, fileId: string) {
  const data = designData(record);
  const frame = data.canvasFrames?.[fileId];
  const metadata = data.screenMetadata?.[fileId];
  return {
    frame: { width: frame?.width, height: frame?.height },
    metadata: { width: metadata?.width, height: metadata?.height },
  };
}

test("Fill container on a horizontal auto-layout child takes the width its fixed sibling leaves", async ({
  app,
}) => {
  const id = await app.seed(DESKTOP_WORKSPACE);
  await app.open(id);
  await app.zoomToFit();
  expect(await app.designRect("main")).toEqual({
    x: 280,
    y: 30,
    width: 400,
    height: 300,
  });
  await clickCenter(app, "main");
  await expect.poll(() => app.selectedLayers()).toEqual(["Main Content"]);
  const before = await app.savedNodes(id);

  await setSizingMode(app.page, "W", "Fill container");
  await app.settled();

  await expect(
    app.page.getByRole("button", { name: /^W 930 Fill$/ }),
  ).toBeVisible();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("main"))).toEqual({
    ...styleOf(before.get("main")),
    width: "auto",
    "flex-grow": "1",
    "flex-basis": "0",
  });
  expectOnlyChanged(before, after, ["main"]);
  expect(await app.designRect("main")).toEqual({
    x: 280,
    y: 30,
    width: 930,
    height: 300,
  });
  expect(await app.designRect("sidebar")).toEqual({
    x: 30,
    y: 30,
    width: 240,
    height: 400,
  });
});

test("reordering flow cards in the Layers panel saves, undoes and redoes in place without reloading the Screen", async ({
  app,
}) => {
  const page = app.page;
  const id = await app.seed(PODCAST_ROW);
  await app.open(id);
  await app.zoomToFit();
  await clickCenter(app, "card-b");
  await expect.poll(() => app.selectedLayers()).toEqual(["Podcast card B"]);
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "podcast-row")).toEqual(["card-a", "card-b"]);
  const cardA = layerRow(page, "Podcast card A");
  const cardB = layerRow(page, "Podcast card B");
  const rowY = async (row: Locator) => (await row.boundingBox())!.y;
  expect(
    await rowY(cardA),
    "the panel lists auto-layout children in layout order",
  ).toBeLessThan(await rowY(cardB));
  await app.node("podcast-row").evaluate(() => {
    (window as unknown as { __screenDocument: string }).__screenDocument =
      "original";
  });
  const screenDocument = () =>
    app
      .node("podcast-row")
      .evaluate(
        () =>
          (window as unknown as { __screenDocument?: string }).__screenDocument,
      );
  const cardXs = async () => [
    (await app.designRect("card-a")).x,
    (await app.designRect("card-b")).x,
  ];

  await cardB.dragTo(cardA, { targetPosition: { x: 24, y: 2 } });
  await app.settled();
  const moved = await app.savedNodes(id);
  expect(childrenOf(moved, "podcast-row")).toEqual(["card-b", "card-a"]);
  expectOnlyChanged(before, moved, []);
  expect(await cardXs()).toEqual([280, 24]);
  await expect.poll(() => app.selectedLayers()).toEqual(["Podcast card B"]);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  const undone = await app.savedNodes(id);
  expect(childrenOf(undone, "podcast-row")).toEqual(["card-a", "card-b"]);
  expectOnlyChanged(before, undone, []);
  expect(await cardXs()).toEqual([24, 280]);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  const redone = await app.savedNodes(id);
  expect(childrenOf(redone, "podcast-row")).toEqual(["card-b", "card-a"]);
  expectOnlyChanged(before, redone, []);
  expect(await cardXs()).toEqual([280, 24]);
  await expect.poll(() => app.selectedLayers()).toEqual(["Podcast card B"]);
  expect(
    await screenDocument(),
    "the Screen iframe kept its document through move, undo and redo",
  ).toBe("original");
});

test("a Cmd+D copy of the desktop Screen resized to tablet wraps its cards, and Fill on a card stays in the copy", async ({
  app,
}) => {
  const page = app.page;
  const id = await app.seed(WRAPPING_CARDS);
  await app.open(id);
  await app.zoomToFit();
  const desktopCards = {
    a: { x: 24, y: 24, width: 360, height: 120 },
    b: { x: 400, y: 24, width: 360, height: 120 },
  };
  expect({
    a: await app.designRect("card-a"),
    b: await app.designRect("card-b"),
  }).toEqual(desktopCards);
  const recordBefore = await app.savedRecord(id);
  const desktopFile = recordBefore.files.find(
    (file) => file.filename === "index.html",
  )!;
  const desktopFrame = { x: 0, y: 736, width: 1440, height: 1024 };
  expect(designData(recordBefore).canvasFrames).toStrictEqual({
    [desktopFile.id]: desktopFrame,
  });
  expect(designData(recordBefore).screenMetadata).toBeUndefined();
  const desktopBefore = await app.savedNodes(id);

  await page.locator("[data-frame-label]").click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect
    .poll(async () => (await app.savedRecord(id)).files.length)
    .toBe(recordBefore.files.length + 1);
  await app.settled();
  const copyFile = (await app.savedRecord(id)).files.find(
    (file) => !recordBefore.files.some((existing) => existing.id === file.id),
  )!;
  expect(
    layersWithoutIds(await app.savedNodes(id, copyFile.filename)),
    "the copy has the desktop layers",
  ).toEqual(layersWithoutIds(desktopBefore));
  await expect(
    page.locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
    ),
    "the copy is the selection",
  ).toHaveAttribute("data-layer-node-id", copyFile.id);

  await setDimension(page, "W", 768);
  await setDimension(page, "H", 1366);
  await app.settled();
  expect(savedFrames(await app.savedRecord(id), copyFile.id)).toEqual({
    frame: { width: 768, height: 1366 },
    metadata: { width: 768, height: 1366 },
  });
  const copyBefore = await app.savedNodes(id, copyFile.filename);
  const copyCardA = idByLayerName(copyBefore, "Podcast card A");
  const copyCardB = idByLayerName(copyBefore, "Podcast card B");
  await app.zoomToFit();
  expect(
    await rectInScreen(page, copyFile.id, copyCardB),
    "card B wraps under card A at tablet width",
  ).toEqual({
    x: 24,
    y: 160,
    width: 360,
    height: 120,
  });

  await clickCenterInScreen(page, copyFile.id, copyCardA);
  await expect
    .poll(
      () => app.selectedLayers(),
      "the first click inside the selected Screen picks its child",
    )
    .toEqual(["Podcast row"]);
  await clickCenterInScreen(page, copyFile.id, copyCardA);
  await expect.poll(() => app.selectedLayers()).toEqual(["Podcast card A"]);
  await setSizingMode(page, "W", "Fill container");
  await app.settled();

  const copyAfter = await app.savedNodes(id, copyFile.filename);
  expect(styleOf(copyAfter.get(copyCardA))).toEqual({
    ...styleOf(copyBefore.get(copyCardA)),
    width: "auto",
    "flex-grow": "1",
    "flex-basis": "0",
    "flex-shrink": "0",
  });
  expectOnlyChanged(copyBefore, copyAfter, [copyCardA]);
  expect({
    a: await rectInScreen(page, copyFile.id, copyCardA),
    b: await rectInScreen(page, copyFile.id, copyCardB),
  }).toEqual({
    a: { x: 24, y: 24, width: 400, height: 120 },
    b: { x: 24, y: 160, width: 360, height: 120 },
  });
  const desktopAfter = designData(await app.savedRecord(id));
  expect(desktopAfter.canvasFrames[desktopFile.id]).toStrictEqual({
    ...desktopFrame,
    z: 0,
  });
  expect(desktopAfter.screenMetadata[desktopFile.id]).toBeUndefined();
  expectOnlyChanged(desktopBefore, await app.savedNodes(id), []);
  expect({
    a: await app.designRect("card-a", "index.html"),
    b: await app.designRect("card-b", "index.html"),
  }).toEqual(desktopCards);
});
