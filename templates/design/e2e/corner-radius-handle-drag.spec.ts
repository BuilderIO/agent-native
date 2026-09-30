import { resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, gotoEditor, selectByText } from "./helpers";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Corner radius</title></head>
<body style="margin:0;min-height:700px">
<main data-agent-native-node-id="radius-root" data-agent-native-layer-name="Root" style="position:relative;width:320px;height:240px">
  <div id="radius-target" data-agent-native-node-id="radius-target" data-agent-native-layer-name="Radius target" data-an-primitive="rectangle" style="position:absolute;left:40px;top:40px;width:110px;height:80px;background:#0f766e;color:#fff">Radius target</div>
  <svg id="stroke-polygon" data-agent-native-node-id="stroke-polygon" data-agent-native-layer-name="Stroke polygon" data-an-primitive="polygon" data-an-pen-nodes='[1,[10,10,null,null,null,null,null],[90,10,null,null,null,null,null],[90,90,null,null,null,null,null],[10,90,null,null,null,null,null]]' viewBox="0 0 100 100" style="position:absolute;left:190px;top:30px;width:80px;height:80px"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="none" stroke="#111" stroke-width="4"></path></svg>
  <svg id="stroke-path" data-agent-native-node-id="stroke-path" data-agent-native-layer-name="Stroke-only vector" data-an-primitive="path" data-an-pen-nodes='[1,[10,10,null,null,null,null,null],[90,10,null,null,null,null,null],[90,90,null,null,null,null,null],[10,90,null,null,null,null,null]]' viewBox="0 0 100 100" style="position:absolute;left:190px;top:30px;width:80px;height:80px"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="none" stroke="#111" stroke-width="4"></path></svg>
  <svg id="filled-polygon" data-agent-native-node-id="filled-polygon" data-agent-native-layer-name="Filled polygon" data-an-primitive="polygon" data-an-pen-nodes='[1,[10,10,null,null,null,null,null],[90,10,null,null,null,null,null],[90,90,null,null,null,null,null],[10,90,null,null,null,null,null]]' viewBox="0 0 100 100" style="position:absolute;left:40px;top:140px;width:80px;height:80px"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="#0f766e"></path></svg>
  <div id="empty-rectangle" data-agent-native-node-id="empty-rectangle" data-agent-native-layer-name="Empty rectangle" data-an-primitive="rectangle" style="position:absolute;left:190px;top:140px;width:80px;height:60px"></div>
</main></body></html>`;

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
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Corner radius drag ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 320, height: 240 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

async function selectLayerFromTree(page: Page, layerName: string) {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${layerName}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function expectSelectedLayer(page: Page, sourceId: string) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selected = (window as any).__designSelection?.selectedElement;
        return selected
          ? {
              sourceId: selected.sourceId ?? null,
              tagName: selected.tagName ?? null,
            }
          : null;
      }),
    )
    .toMatchObject({ sourceId, tagName: "svg" });
}

async function setOverviewZoom(page: Page, zoom: 200) {
  const zoomButton = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(zoomButton).toBeVisible();
  await zoomButton.click();
  await page.getByRole("menuitem", { name: `Zoom to ${zoom}%` }).click();
  await expect(zoomButton).toHaveText(`${zoom}%`);
}

async function expectSelectionOverlayToMatch(
  page: Page,
  frame: ReturnType<typeof designFrame>,
  selector: string,
) {
  const target = frame.locator(selector);
  const selection = frame.locator(
    '[data-agent-native-edit-overlay="selection"]',
  );
  await expect(selection).toBeVisible();
  await expect
    .poll(async () => {
      const [targetBounds, selectionBounds] = await Promise.all([
        target.boundingBox(),
        selection.boundingBox(),
      ]);
      if (!targetBounds || !selectionBounds) return false;
      return ["x", "y", "width", "height"].every(
        (key) =>
          Math.abs(
            targetBounds[key as keyof typeof targetBounds] -
              selectionBounds[key as keyof typeof selectionBounds],
          ) < 1,
      );
    })
    .toBe(true);
}

async function dragSouthEastRadius(
  page: Page,
  frame: ReturnType<typeof designFrame>,
) {
  const target = frame.locator("#radius-target");
  const corner = frame.locator('[data-agent-native-radius-handle="se"]');
  const initial = await corner.boundingBox();
  if (!initial) throw new Error("south-east radius handle is not laid out");
  const startX = initial.x + initial.width / 2;
  const startY = initial.y + initial.height / 2;
  await page.mouse.move(startX, startY);
  await expect(corner).toHaveCSS("visibility", "visible");
  await page.mouse.down();

  let previousRadius = await target.evaluate((element) =>
    parseFloat(getComputedStyle(element).borderTopLeftRadius),
  );
  for (const distance of [4, 8, 12, 16]) {
    const pointer = { x: startX - distance, y: startY - distance };
    await page.mouse.move(pointer.x, pointer.y, { steps: 1 });
    await expect
      .poll(async () => {
        const moved = await corner.boundingBox();
        if (!moved) return Number.POSITIVE_INFINITY;
        return Math.hypot(
          moved.x + moved.width / 2 - pointer.x,
          moved.y + moved.height / 2 - pointer.y,
        );
      })
      .toBeLessThan(1);
    const radius = await target.evaluate((element) =>
      parseFloat(getComputedStyle(element).borderTopLeftRadius),
    );
    expect(radius).toBeGreaterThan(previousRadius);
    previousRadius = radius;
    if (process.env.E2E_CAPTURE_RADIUS_SCREENSHOT === "1" && distance === 8) {
      await page.screenshot({
        path: resolve(
          process.cwd(),
          "../../.tmp/design-corner-radius-moving-handle.png",
        ),
      });
    }
  }
  await page.mouse.up();
  return previousRadius;
}

test("canvas corner-radius handle follows the drag and persists the radius", async ({
  page,
  request,
}) => {
  const { designId, fileId } = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "Radius target", { screenId: fileId });

    const frame = designFrame(page, fileId);
    const handles = frame.locator("[data-agent-native-radius-handle]");

    await expect(handles).toHaveCount(4);
    await expect(
      frame.locator('[data-agent-native-radius-handle="se"]'),
    ).toHaveCSS("visibility", "hidden");
    const committedRadius = await dragSouthEastRadius(page, frame);
    const target = frame.locator("#radius-target");
    await expect
      .poll(async () => {
        const response = await request.get(
          appPath(
            `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
          ),
        );
        if (!response.ok()) return "";
        const design = await response.json();
        const html = design.files?.find(
          (file: { id?: string }) => file.id === fileId,
        )?.content;
        if (typeof html !== "string") return "";
        return page.evaluate((source) => {
          const doc = new DOMParser().parseFromString(source, "text/html");
          return (
            doc.querySelector<HTMLElement>("#radius-target")?.style
              .borderRadius ?? ""
          );
        }, html);
      })
      .toBe(`${committedRadius}px`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() =>
        designFrame(page, fileId)
          .locator("#radius-target")
          .evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
      )
      .toBe(`${committedRadius}px`);

    await setOverviewZoom(page, 200);
    await selectLayerFromTree(page, "Radius target");
    const zoomedRadius = await dragSouthEastRadius(
      page,
      designFrame(page, fileId),
    );
    expect(zoomedRadius).toBeGreaterThan(committedRadius);

    await selectLayerFromTree(page, "Stroke polygon");
    await expectSelectedLayer(page, "stroke-polygon");
    await expectSelectionOverlayToMatch(page, frame, "#stroke-polygon");
    const strokePolygon = frame.locator("#stroke-polygon");
    const vectorPaint = await strokePolygon.evaluate((element) => {
      const path = element.querySelector(":scope > path");
      if (!path) return null;
      const style = getComputedStyle(path);
      return {
        pathCount: element.querySelectorAll("path").length,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeOpacity: style.strokeOpacity,
        visibility: style.visibility,
      };
    });
    expect(vectorPaint).not.toBeNull();
    expect(vectorPaint).toMatchObject({
      pathCount: 1,
      fill: "none",
      stroke: "rgb(17, 17, 17)",
      strokeWidth: "4px",
      strokeOpacity: "1",
      visibility: "visible",
    });
    await expect(handles).toHaveCount(4);
    const strokeVertex = frame.locator(
      '[data-agent-native-radius-handle="vertex-0"]',
    );
    const strokeVertexBox = await strokeVertex.boundingBox();
    if (!strokeVertexBox)
      throw new Error("stroke-polygon radius handle is not laid out");
    await page.mouse.move(
      strokeVertexBox.x + strokeVertexBox.width / 2,
      strokeVertexBox.y + strokeVertexBox.height / 2,
    );
    await expect(strokeVertex).toHaveCSS("visibility", "visible");

    await selectLayerFromTree(page, "Stroke-only vector");
    await expectSelectedLayer(page, "stroke-path");
    await expectSelectionOverlayToMatch(page, frame, "#stroke-path");
    await expect(handles).toHaveCount(0);

    await selectLayerFromTree(page, "Filled polygon");
    await expectSelectedLayer(page, "filled-polygon");
    await expectSelectionOverlayToMatch(page, frame, "#filled-polygon");
    await expect(handles).toHaveCount(4);
    const polygon = frame.locator("#filled-polygon");
    const vertex = frame.locator(
      '[data-agent-native-radius-handle="vertex-0"]',
    );
    const initialVertex = await vertex.boundingBox();
    if (!initialVertex)
      throw new Error("polygon radius handle is not laid out");
    const vertexX = initialVertex.x + initialVertex.width / 2;
    const vertexY = initialVertex.y + initialVertex.height / 2;
    await expect(vertex).toHaveCSS("visibility", "hidden");
    await page.mouse.move(vertexX, vertexY);
    await expect(vertex).toHaveCSS("visibility", "visible");
    await page.mouse.down();
    let previousPolygonRadius = Number(
      await polygon.getAttribute("data-an-corner-radius"),
    );
    for (const distance of [4, 8, 12, 16]) {
      const pointer = { x: vertexX + distance, y: vertexY + distance };
      await page.mouse.move(pointer.x, pointer.y, { steps: 1 });
      await expect
        .poll(async () => {
          const moved = await vertex.boundingBox();
          if (!moved) return Number.POSITIVE_INFINITY;
          return Math.hypot(
            moved.x + moved.width / 2 - pointer.x,
            moved.y + moved.height / 2 - pointer.y,
          );
        })
        .toBeLessThan(1);
      const polygonRadius = Number(
        await polygon.getAttribute("data-an-corner-radius"),
      );
      expect(polygonRadius).toBeGreaterThan(previousPolygonRadius);
      previousPolygonRadius = polygonRadius;
    }
    await page.mouse.up();
    const readSavedPolygon = async () => {
      const response = await request.get(
        appPath(
          `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
        ),
      );
      if (!response.ok()) return null;
      const design = await response.json();
      const html = design.files?.find(
        (file: { id?: string }) => file.id === fileId,
      )?.content;
      if (typeof html !== "string") return null;
      return page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, "text/html");
        const svg = doc.querySelector<SVGSVGElement>("#filled-polygon");
        const path = svg?.querySelector(":scope > path");
        const radius = svg?.getAttribute("data-an-corner-radius");
        const d = path?.getAttribute("d");
        return radius && d?.includes(" A ") ? { radius, d } : null;
      }, html);
    };
    await expect.poll(readSavedPolygon).not.toBeNull();
    const savedPolygon = await readSavedPolygon();
    expect(Number(savedPolygon?.radius)).toBeGreaterThan(0);
    expect(savedPolygon?.d).toContain(" A ");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() =>
        designFrame(page, fileId)
          .locator("#filled-polygon")
          .evaluate((element) => ({
            radius: element.getAttribute("data-an-corner-radius"),
            d: element.querySelector(":scope > path")?.getAttribute("d"),
          })),
      )
      .toEqual(savedPolygon);

    await selectLayerFromTree(page, "Empty rectangle");
    await expectSelectionOverlayToMatch(page, frame, "#empty-rectangle");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
