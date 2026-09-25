import {
  expect,
  test,
  type APIRequestContext,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Vector edit source</title></head>
<body style="margin:0;min-height:600px">
  <main data-agent-native-node-id="main" style="position:relative;min-height:600px">
    <div data-agent-native-node-id="frame" data-agent-native-layer-name="Frame" data-an-primitive="frame"
      style="position:absolute;left:40px;top:120px;width:600px;height:400px">
      <div data-agent-native-node-id="nested" data-agent-native-layer-name="Nested"
        style="position:absolute;left:80px;top:70px;width:280px;height:200px;transform:translate(10px,5px)">
        <svg data-agent-native-node-id="nested-path" data-agent-native-layer-name="Nested path" data-an-primitive="path"
          data-an-pen-nodes='[1,[0,0,null,null,null,null],[100,0,null,null,null,null],[100,80,null,null,null,null],[0,80,null,null,null,null]]'
          viewBox="0 0 100 80" preserveAspectRatio="none"
          style="position:absolute;left:15.25px;top:20.5px;width:100px;height:80px;overflow:visible;opacity:0.5;filter:drop-shadow(0 1px 2px #000)">
          <path d="M 0 0 L 100 0 L 100 80 L 0 80 Z" fill="#336699" stroke="none" />
        </svg>
      <div data-agent-native-node-id="editable-ellipse" data-agent-native-layer-name="Editable ellipse" data-an-primitive="ellipse"
        style="position:absolute;left:145px;top:105px;width:48px;height:48px;transform:translate(10px,5px);background-color:rgb(204, 51, 102);border:0;border-radius:50%;opacity:0.6;filter:blur(1px)"></div>
      </div>
    </div>
    <svg data-agent-native-node-id="exterior-handle-path" data-agent-native-layer-name="Exterior handle path" data-an-primitive="path"
      data-an-pen-nodes='[1,[0,0,null,null,-80,-100],[100,0,100,0,null,null]]'
      viewBox="-80 -100 180 100" preserveAspectRatio="none"
      style="position:absolute;left:390px;top:120px;width:180px;height:100px;overflow:visible">
      <path d="M 0 0 C -80 -100 100 0 100 0" fill="none" stroke="#336699" stroke-width="2" />
    </svg>
  </main>
</body></html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext): Promise<string> {
  const created = await postAction(request, "create-design", {
    title: `Vector edit geometry ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await postAction(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function selectLayer(page: Page, name: string) {
  const row = layerRow(page, name);
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function openDesign(page: Page, designId: string) {
  await gotoEditor(page, designId);
  await enterDirectMode(page);
  await expandAllLayers(page);
}

async function selectedFrame(page: Page) {
  const iframe = page.locator("iframe[data-design-preview-iframe]").first();
  return { iframe, frame: iframe.contentFrame() };
}

async function overlayAnchorMatchesFramePoint(
  page: Page,
  frame: FrameLocator,
  selector: string,
  point: "path-start" | "ellipse-top",
) {
  const iframe = page.locator("iframe[data-design-preview-iframe]").first();
  const iframeBox = await iframe.boundingBox();
  if (!iframeBox) throw new Error("design iframe has no visible bounds");
  const sourcePoint = await frame
    .locator(selector)
    .evaluate((element, kind) => {
      const box = element.getBoundingClientRect();
      if (kind === "ellipse-top")
        return { x: box.left + box.width / 2, y: box.top };
      const svg = element.closest("svg");
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(0);
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("SVG has no screen transform");
      return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      };
    }, point);
  const viewport = await frame.locator("html").evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  const anchor = await page
    .locator("[data-vector-anchor]")
    .first()
    .boundingBox();
  if (!anchor) throw new Error("vector editor has no first anchor");
  const actual = {
    x: iframeBox.x + (sourcePoint.x * iframeBox.width) / viewport.width,
    y: iframeBox.y + (sourcePoint.y * iframeBox.height) / viewport.height,
  };
  const center = {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height / 2,
  };
  return Math.hypot(actual.x - center.x, actual.y - center.y);
}

async function overlayCapturesAnchor(
  page: Page,
  anchorBox: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
) {
  return page.evaluate(
    ({ x, y }) => {
      return Boolean(
        document.elementFromPoint(x, y)?.closest("[data-vector-edit-overlay]"),
      );
    },
    {
      x: anchorBox.x + anchorBox.width / 2,
      y: anchorBox.y + anchorBox.height / 2,
    },
  );
}

async function penNodes(frame: FrameLocator, nodeId: string) {
  const serialized = await frame
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .getAttribute("data-an-pen-nodes");
  if (!serialized) throw new Error(`${nodeId} has no serialized Pen nodes`);
  type PenNodeTuple = [
    number,
    number,
    number | null,
    number | null,
    number | null,
    number | null,
    number | null,
  ];
  return JSON.parse(serialized) as [number, ...PenNodeTuple[]];
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("nested Pen edits stay in the screen coordinate space and preserve authored SVG styles", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await openDesign(page, designId);
    await selectLayer(page, "Nested path");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);

    const { frame } = await selectedFrame(page);
    const before = await frame
      .locator('[data-agent-native-node-id="nested-path"] path')
      .getAttribute("d");
    expect(
      await overlayAnchorMatchesFramePoint(
        page,
        frame,
        '[data-agent-native-node-id="nested-path"] path',
        "path-start",
      ),
    ).toBeLessThan(8);

    const anchor = page.locator("[data-vector-anchor]").first();
    const box = await anchor.boundingBox();
    if (!box) throw new Error("nested path anchor has no bounds");
    expect(await overlayCapturesAnchor(page, box)).toBe(true);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 18,
      box.y + box.height / 2 - 14,
      {
        steps: 5,
      },
    );
    await page.mouse.up();

    const vector = frame.locator('[data-agent-native-node-id="nested-path"]');
    await expect
      .poll(() => vector.locator("path").getAttribute("d"))
      .not.toBe(before);
    const result = await vector.evaluate((element) => ({
      left: (element as SVGSVGElement).style.left,
      top: (element as SVGSVGElement).style.top,
      opacity: (element as SVGSVGElement).style.opacity,
      filter: (element as SVGSVGElement).style.filter,
    }));
    expect(Number.parseFloat(result.left)).toBeLessThan(15.25);
    expect(Number.parseFloat(result.top)).toBeLessThan(20.5);
    expect(result.opacity).toBe("0.5");
    expect(result.filter).toContain("drop-shadow");
  } finally {
    await postAction(request, "delete-design", { id: designId });
  }
});

test("selected Pen anchors round independently and survive undo, redo, and reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await openDesign(page, designId);
    await selectLayer(page, "Nested path");
    const { frame } = await selectedFrame(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();

    const selectAnchor = async (index: number) => {
      const anchor = page.locator("[data-vector-anchor]").nth(index);
      const box = await anchor.boundingBox();
      if (!box) throw new Error(`vector anchor ${index} has no bounds`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(anchor).toHaveClass(/ring-2/);
    };
    const radiusField = page.getByRole("textbox", { name: "Corner radius" });
    const setRadius = async (index: number, radius: number) => {
      await selectAnchor(index);
      await radiusField.fill(String(radius));
      await radiusField.press("Enter");
      await expect(radiusField).toHaveValue(String(radius));
    };

    await setRadius(1, 12);
    await setRadius(3, 18);
    const rounded = await penNodes(frame, "nested-path");
    expect(rounded[2]?.[6]).toBe(12);
    expect(rounded[4]?.[6]).toBe(18);
    expect(
      rounded.slice(1).filter((node) => Array.isArray(node) && node[6] != null),
    ).toHaveLength(2);
    await selectAnchor(1);
    await expect(radiusField).toHaveValue("12");
    await selectAnchor(3);
    await expect(radiusField).toHaveValue("18");

    await page.keyboard.press("Escape");
    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => (await penNodes(frame, "nested-path"))[4]?.[6])
      .toBeNull();
    expect((await penNodes(frame, "nested-path"))[2]?.[6]).toBe(12);

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => (await penNodes(frame, "nested-path"))[4]?.[6])
      .toBe(18);

    await page.reload({ waitUntil: "domcontentloaded" });
    await openDesign(page, designId);
    await selectLayer(page, "Nested path");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await selectAnchor(1);
    await expect(radiusField).toHaveValue("12");
    await selectAnchor(3);
    await expect(radiusField).toHaveValue("18");
  } finally {
    await postAction(request, "delete-design", { id: designId });
  }
});

test("Enter edits an ellipse as a vector, Escape preserves it, and commit converts it in place", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await openDesign(page, designId);
    await selectLayer(page, "Editable ellipse");
    const { frame } = await selectedFrame(page);
    const ellipse = frame.locator(
      '[data-agent-native-node-id="editable-ellipse"]',
    );
    const originalStyle = await ellipse.getAttribute("style");
    const originalBox = await ellipse.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);
    expect(
      await overlayAnchorMatchesFramePoint(
        page,
        frame,
        '[data-agent-native-node-id="editable-ellipse"]',
        "ellipse-top",
      ),
    ).toBeLessThan(8);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
    await expect(ellipse).toHaveJSProperty("tagName", "DIV");
    expect(await ellipse.getAttribute("style")).toBe(originalStyle);

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const anchor = page.locator("[data-vector-anchor]").first();
    const box = await anchor.boundingBox();
    if (!box) throw new Error("ellipse top anchor has no bounds");
    expect(await overlayCapturesAnchor(page, box)).toBe(true);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 18, {
      steps: 5,
    });
    await page.mouse.up();

    const vector = frame.locator(
      '[data-agent-native-node-id="editable-ellipse"]',
    );
    await expect(vector).toHaveJSProperty("tagName", "svg");
    await expect(vector.locator("path")).toHaveCount(1);
    const result = await vector.evaluate((element) => ({
      top: (element as SVGSVGElement).style.top,
      transform: (element as SVGSVGElement).style.transform,
      rect: (() => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      })(),
      opacity: (element as SVGSVGElement).style.opacity,
      filter: (element as SVGSVGElement).style.filter,
      fill: element.querySelector("path")?.getAttribute("fill"),
    }));
    expect(Number.parseFloat(result.top)).toBeLessThan(105);
    expect(result.transform).toBe("translate(10px, 5px)");
    expect(Math.abs(result.rect.left - originalBox.left)).toBeLessThan(2);
    expect(result.rect.top).toBeLessThan(originalBox.top - 1);
    expect(result.opacity).toBe("0.6");
    expect(result.filter).toBe("blur(1px)");
    expect(result.fill).toBe("rgb(204, 51, 102)");
  } finally {
    await postAction(request, "delete-design", { id: designId });
  }
});

test("vector edit captures and drags a tangent handle beyond the rendered curve bounds", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await openDesign(page, designId);
    await selectLayer(page, "Exterior handle path");
    const { frame } = await selectedFrame(page);
    const path = frame.locator(
      '[data-agent-native-node-id="exterior-handle-path"] path',
    );
    const before = await path.getAttribute("d");
    const handleIsOutsideCurve = await path.evaluate((element) => {
      const bounds = (element as SVGPathElement).getBBox();
      const tangent = { x: -80, y: -100 };
      return (
        tangent.x < bounds.x ||
        tangent.x > bounds.x + bounds.width ||
        tangent.y < bounds.y ||
        tangent.y > bounds.y + bounds.height
      );
    });
    expect(handleIsOutsideCurve).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const handle = page.locator("[data-vector-handle]").first();
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("exterior tangent handle has no bounds");
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(
            document
              .elementFromPoint(x, y)
              ?.closest("[data-vector-edit-overlay]"),
          ),
        {
          x: handleBox.x + handleBox.width / 2,
          y: handleBox.y + handleBox.height / 2,
        },
      ),
    ).toBe(true);

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 22,
      handleBox.y + handleBox.height / 2 - 18,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect.poll(() => path.getAttribute("d")).not.toBe(before);
  } finally {
    await postAction(request, "delete-design", { id: designId });
  }
});
