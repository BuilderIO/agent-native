import {
  expect,
  test,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designFrame, expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Boolean Subtract</title></head>
  <body style="margin:0;min-height:900px;background:#ffffff">
    <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage" data-an-primitive="frame" style="position:absolute;left:24px;top:24px;width:340px;height:160px;background:transparent">
      <div data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:80px;height:80px;background-color:#cc3366;border-radius:8px;opacity:0.5"></div>
      <div data-agent-native-node-id="cutter" data-agent-native-layer-name="Cutter" data-an-primitive="ellipse" style="position:absolute;left:20px;top:20px;width:40px;height:40px;background-color:#3366cc"></div>
      <div data-agent-native-node-id="hotkey-base" data-agent-native-layer-name="Hotkey Base" data-an-primitive="rectangle" style="position:absolute;left:140px;top:0px;width:80px;height:80px;background-color:#cc3366;border-radius:8px;opacity:0.5"></div>
      <div data-agent-native-node-id="hotkey-cutter" data-agent-native-layer-name="Hotkey Cutter" data-an-primitive="ellipse" style="position:absolute;left:160px;top:20px;width:40px;height:40px;background-color:#3366cc"></div>
    </div>
    <div data-agent-native-node-id="overlap-stage" data-agent-native-layer-name="Overlap Stage" data-an-primitive="frame" style="position:absolute;left:400px;top:24px;width:140px;height:120px;background:transparent">
      <div data-agent-native-node-id="overlap-base" data-agent-native-layer-name="Overlap Base" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:100px;height:100px;background-color:#cc3366"></div>
      <div data-agent-native-node-id="overlap-cutter-a" data-agent-native-layer-name="Overlap Cutter A" data-an-primitive="rectangle" style="position:absolute;left:25px;top:25px;width:50px;height:50px;background-color:#3366cc"></div>
      <div data-agent-native-node-id="overlap-cutter-b" data-agent-native-layer-name="Overlap Cutter B" data-an-primitive="rectangle" style="position:absolute;left:50px;top:25px;width:50px;height:50px;background-color:#3366cc"></div>
    </div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response.json();
}

async function designContent(page: Page, designId: string, filename: string) {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(`get-design failed: ${response.status()}`);
  }
  const design = await response.json();
  return (
    design.files?.find(
      (file: { filename?: string }) => file.filename === filename,
    )?.content ?? ""
  );
}

function booleanCutterStrokeMarkup(content: string, rootId: string): string {
  const rootStart = content.indexOf(`data-agent-native-node-id="${rootId}"`);
  const marker = content.indexOf(
    'data-an-boolean-cutter-stroke="true"',
    rootStart,
  );
  if (rootStart < 0 || marker < 0) {
    throw new Error(`Could not find cutter stroke use for Boolean ${rootId}`);
  }
  const start = content.lastIndexOf("<use", marker);
  const end = content.indexOf(">", marker);
  return content.slice(start, end + 1);
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true });
}

function layerTreeItem(page: Page, name: string) {
  return layerRow(page, name)
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

function svgSourceTag(content: string, marker: string): string {
  const markerIndex = content.indexOf(marker);
  const start = content.lastIndexOf("<svg", markerIndex);
  const end = content.indexOf(">", markerIndex);
  if (markerIndex < 0 || start < 0 || end < 0) {
    throw new Error(`Could not find SVG source tag containing ${marker}`);
  }
  return content.slice(start, end + 1);
}

function inspectorSection(page: Page, title: RegExp): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

async function openBooleanMenu(page: Page) {
  const canvas = page.locator("[data-design-canvas-container]");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Design canvas has no browser geometry");
  await canvas.dispatchEvent("contextmenu", {
    button: 2,
    clientX: box.x + 8,
    clientY: box.y + 8,
  });
  const menu = page.getByRole("menu").last();
  const booleanOperations = menu.getByRole("menuitem", {
    name: "Boolean operations",
    exact: true,
  });
  await expect(booleanOperations).toBeVisible();
  await booleanOperations.hover();
  const submenu = page.getByRole("menu").last();
  await expect(
    submenu.getByRole("menuitem", { name: "Subtract", exact: true }),
  ).toBeVisible();
  return submenu;
}

async function setInspectorValue(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const input = page.locator(`input[aria-label="${label}" i]`).last();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function booleanMaskPixels(
  frame: FrameLocator,
  index = 0,
  removeTransform = false,
  samples: Record<string, [number, number]> = {
    outside: [10, 40],
    hole: [40, 40],
    roundedCorner: [3, 3],
    insideRoundedCorner: [15, 3],
    cutEdge: [18, 40],
  },
  width = 80,
  height = 80,
) {
  return frame
    .locator('svg[data-an-primitive="boolean"]')
    .nth(index)
    .evaluate(
      async (root, options) => {
        const rootStyle = root.getAttribute("style");
        if (options.removeTransform) root.style.removeProperty("transform");
        root.style.position = "static";
        root.style.left = "0px";
        root.style.top = "0px";
        const svg = new XMLSerializer().serializeToString(root);
        if (rootStyle === null) root.removeAttribute("style");
        else root.setAttribute("style", rootStyle);
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = options.width;
          canvas.height = options.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas 2D context is unavailable");
          context.drawImage(image, 0, 0, options.width, options.height);
          return Object.fromEntries(
            Object.entries(options.samples).map(([name, [x, y]]) => [
              name,
              Array.from(context.getImageData(x, y, 1, 1).data),
            ]),
          );
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { removeTransform, samples, width, height },
    );
}

test.beforeEach(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
});

test.use({ viewport: { width: 1600, height: 1000 } });

test("Subtract creates an editable, transparent mask with undo and unique duplicate references", async ({
  page,
}) => {
  const created = await postAction(page, "create-design", {
    title: `Boolean Subtract ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    const indexScreen = await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await postAction(page, "create-file", {
      designId,
      filename: "about.html",
      content:
        "<!doctype html><html><body><p>Untouched screen</p></body></html>",
      fileType: "html",
    });
    const untouchedScreen = await designContent(page, designId, "about.html");

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await layerRow(page, "Base").click();
    await layerRow(page, "Cutter").click({ modifiers: ["Shift"] });
    await expect
      .poll(() =>
        page.locator('[role="treeitem"][aria-selected="true"]').count(),
      )
      .toBe(2);

    const submenu = await openBooleanMenu(page);
    await submenu
      .getByRole("menuitem", { name: "Subtract", exact: true })
      .click();

    const frame = designFrame(page, indexScreen.id);
    const booleanRoot = frame.locator('svg[data-an-primitive="boolean"]');
    await expect(booleanRoot).toBeVisible();
    await expect
      .poll(async () => (await layerRow(page, "Subtract").textContent()) ?? "")
      .toContain("Subtract");

    await booleanRoot.screenshot({
      path: test.info().outputPath("boolean-subtract-live-root.png"),
    });
    const [outside, hole] = await booleanMaskPixels(frame).then((pixels) => [
      pixels.outside,
      pixels.hole,
    ]);
    expect(outside?.[3]).toBeGreaterThanOrEqual(126);
    expect(outside?.[3]).toBeLessThanOrEqual(129);
    expect(outside?.[0]).toBeGreaterThan(150);
    expect(hole?.[3]).toBe(0);

    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain('data-an-primitive="boolean"');
    const createdContent = await designContent(page, designId, "index.html");
    expect(createdContent).toContain('data-an-primitive="boolean"');
    expect(createdContent).toContain('data-an-boolean-operand="base"');
    expect(createdContent).toContain('data-an-boolean-operand="subtract"');
    expect(await designContent(page, designId, "about.html")).toBe(
      untouchedScreen,
    );
    await expect(
      page.getByRole("heading", { name: "Stroke", exact: true }),
    ).toBeVisible();

    await page.keyboard.press(`${MOD}+d`);
    const duplicateFrame = designFrame(page, indexScreen.id);
    await expect(
      duplicateFrame.locator('svg[data-an-primitive="boolean"]'),
    ).toHaveCount(2);
    const refs = await duplicateFrame.locator("body").evaluate(() => {
      const ids = Array.from(document.querySelectorAll("[id]"), (node) =>
        node.getAttribute("id"),
      );
      const roots = Array.from(
        document.querySelectorAll<SVGSVGElement>(
          'svg[data-an-primitive="boolean"]',
        ),
      );
      return {
        idsAreUnique: new Set(ids).size === ids.length,
        masksResolve: roots.every((root) => {
          const reference = root
            .querySelector('use[data-an-boolean-result="true"]')
            ?.getAttribute("mask");
          const maskId = reference?.match(/^url\(#(.+)\)$/)?.[1];
          return Boolean(
            maskId &&
            root.querySelector(`#${CSS.escape(maskId)}`)?.tagName === "mask",
          );
        }),
      };
    });
    expect(refs).toEqual({ idsAreUnique: true, masksResolve: true });

    await page.keyboard.press(`${MOD}+z`);
    await expect(
      designFrame(page, indexScreen.id).locator(
        'svg[data-an-primitive="boolean"]',
      ),
    ).toHaveCount(1);
    await page.keyboard.press(`${MOD}+z`);
    await expect(
      designFrame(page, indexScreen.id).locator(
        'svg[data-an-primitive="boolean"]',
      ),
    ).toHaveCount(0);
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .not.toContain('data-an-primitive="boolean"');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(
      designFrame(page, indexScreen.id).locator(
        'svg[data-an-primitive="boolean"]',
      ),
    ).toHaveCount(1);
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain('data-an-primitive="boolean"');
    expect(await designContent(page, designId, "about.html")).toBe(
      untouchedScreen,
    );

    await layerRow(page, "Subtract").first().click();
    const fillSection = inspectorSection(page, /^Fill$/i);
    const hideFill = fillSection.locator('button[aria-label="Hide layer"]');
    await expect(hideFill).toBeVisible();
    await hideFill.click();
    await expect(
      fillSection.locator('button[aria-label="Show layer"]'),
    ).toBeVisible();
    await expect
      .poll(async () => (await booleanMaskPixels(frame)).outside?.[3])
      .toBe(0);
    await fillSection.locator('button[aria-label="Show layer"]').click();
    await expect
      .poll(async () => (await booleanMaskPixels(frame)).outside?.[3])
      .toBeGreaterThanOrEqual(126);
    await expect
      .poll(async () => (await booleanMaskPixels(frame)).outside?.[3])
      .toBeLessThanOrEqual(129);

    await layerRow(page, "Subtract").first().click();
    await page.getByRole("button", { name: "Add stroke", exact: true }).click();
    await setInspectorValue(page, "Weight", "4");
    const strokedPixels = await booleanMaskPixels(frame);
    expect(strokedPixels.cutEdge?.[3]).toBeGreaterThan(0);
    expect(strokedPixels.hole?.[3]).toBe(0);
    await page.screenshot({
      path: test.info().outputPath("boolean-subtract-stroke.png"),
      fullPage: true,
    });

    await layerRow(page, "Subtract").first().click();
    await setInspectorValue(page, "Rotation", "45");
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-an-primitive="boolean"',
        ),
      )
      .toMatch(/transform:\s*rotate\(-45deg\)/);

    const subtractRow = layerTreeItem(page, "Subtract");
    const expandSubtract = subtractRow.getByRole("button", {
      name: "Expand layer",
    });
    await expect(expandSubtract).toBeVisible();
    await expandSubtract.click();
    await expect(layerRow(page, "Cutter").first()).toBeVisible();
    await layerRow(page, "Cutter").first().click();
    await setInspectorValue(page, "W size in pixels", "20");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain('width="20"');

    const probes: Record<string, [number, number]> = {
      beforeX: [25, 40],
      afterX: [45, 40],
      beforeY: [40, 25],
      afterY: [40, 70],
    };
    const beforePosition = await booleanMaskPixels(frame, 0, true, probes);
    expect(beforePosition.beforeX?.[3]).toBe(0);
    expect(beforePosition.afterX?.[3]).toBeGreaterThan(0);
    expect(beforePosition.beforeY?.[3]).toBe(0);
    expect(beforePosition.afterY?.[3]).toBeGreaterThan(0);

    await setInspectorValue(page, "X-position", "30");
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('x="30"');
    const editedXContent = await designContent(page, designId, "index.html");
    const editedXOperand = svgSourceTag(
      editedXContent,
      'data-agent-native-node-id="cutter"',
    );
    expect(editedXOperand).toContain('x="30"');
    expect(editedXOperand).toContain('y="20"');
    expect(editedXOperand).toContain('width="20"');
    expect(svgSourceTag(editedXContent, 'data-an-primitive="boolean"')).toMatch(
      /transform:\s*rotate\(-45deg\)/,
    );
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).afterX?.[3],
      )
      .toBe(0);
    const afterX = await booleanMaskPixels(frame, 0, true, probes);
    expect(afterX.beforeX?.[3]).toBeGreaterThan(0);
    expect(afterX.beforeY?.[3]).toBe(0);
    expect(afterX.afterY?.[3]).toBeGreaterThan(0);

    await setInspectorValue(page, "Y-position", "35");
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('y="35"');
    const editedXYContent = await designContent(page, designId, "index.html");
    const editedXYOperand = svgSourceTag(
      editedXYContent,
      'data-agent-native-node-id="cutter"',
    );
    expect(editedXYOperand).toContain('x="30"');
    expect(editedXYOperand).toContain('y="35"');
    expect(editedXYOperand).toContain('width="20"');
    expect(
      svgSourceTag(editedXYContent, 'data-an-primitive="boolean"'),
    ).toMatch(/transform:\s*rotate\(-45deg\)/);
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).afterY?.[3],
      )
      .toBe(0);
    const afterXY = await booleanMaskPixels(frame, 0, true, probes);
    expect(afterXY.beforeX?.[3]).toBeGreaterThan(0);
    expect(afterXY.beforeY?.[3]).toBeGreaterThan(0);

    await layerRow(page, "Cutter").first().click();
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('y="20"');
    const undoYContent = await designContent(page, designId, "index.html");
    expect(
      svgSourceTag(undoYContent, 'data-agent-native-node-id="cutter"'),
    ).toContain('x="30"');
    expect(svgSourceTag(undoYContent, 'data-an-primitive="boolean"')).toMatch(
      /transform:\s*rotate\(-45deg\)/,
    );
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).beforeY?.[3],
      )
      .toBe(0);
    expect(
      (await booleanMaskPixels(frame, 0, true, probes)).afterY?.[3],
    ).toBeGreaterThan(0);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('x="20"');
    expect((await booleanMaskPixels(frame, 0, true, probes)).beforeX?.[3]).toBe(
      0,
    );

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('x="30"');
    expect(
      svgSourceTag(
        await designContent(page, designId, "index.html"),
        'data-agent-native-node-id="cutter"',
      ),
    ).toContain('y="20"');
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).afterX?.[3],
      )
      .toBe(0);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(async () =>
        svgSourceTag(
          await designContent(page, designId, "index.html"),
          'data-agent-native-node-id="cutter"',
        ),
      )
      .toContain('y="35"');
    const redoneXYContent = await designContent(page, designId, "index.html");
    const redoneXYOperand = svgSourceTag(
      redoneXYContent,
      'data-agent-native-node-id="cutter"',
    );
    expect(redoneXYOperand).toContain('x="30"');
    expect(redoneXYOperand).toContain('y="35"');
    expect(
      svgSourceTag(redoneXYContent, 'data-an-primitive="boolean"'),
    ).toMatch(/transform:\s*rotate\(-45deg\)/);
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).afterY?.[3],
      )
      .toBe(0);

    await page.reload();
    await expect(
      designFrame(page, indexScreen.id).locator("body"),
    ).toBeVisible();
    await expandAllLayers(page);
    await layerRow(page, "Cutter").first().click();
    await expect(
      page.locator('input[aria-label="W size in pixels" i]').last(),
    ).toHaveValue("20px");
    await expect(
      page.locator('input[aria-label="X-position" i]').last(),
    ).toHaveValue("30px");
    await expect(
      page.locator('input[aria-label="Y-position" i]').last(),
    ).toHaveValue("35px");
    const persistedContent = await designContent(page, designId, "index.html");
    expect(
      svgSourceTag(persistedContent, 'data-agent-native-node-id="cutter"'),
    ).toContain('x="30"');
    expect(
      svgSourceTag(persistedContent, 'data-agent-native-node-id="cutter"'),
    ).toContain('y="35"');
    expect(
      svgSourceTag(persistedContent, 'data-an-primitive="boolean"'),
    ).toMatch(/transform:\s*rotate\(-45deg\)/);
    await expect
      .poll(
        async () =>
          (await booleanMaskPixels(frame, 0, true, probes)).afterY?.[3],
      )
      .toBe(0);
    expect(
      await designFrame(page, indexScreen.id)
        .locator('svg[data-an-primitive="boolean"]')
        .first()
        .evaluate((root) => getComputedStyle(root).transform),
    ).not.toBe("none");

    await expandAllLayers(page);
    await layerRow(page, "Hotkey Base").click();
    await layerRow(page, "Hotkey Cutter").click({ modifiers: ["Shift"] });
    const shortcutFrame = designFrame(page, indexScreen.id);
    await shortcutFrame.locator("body").press("Alt+Shift+s");
    const shortcutRoot = shortcutFrame
      .locator('svg[data-an-primitive="boolean"]')
      .last();
    await expect(shortcutRoot).toBeVisible();
    await expect(
      shortcutFrame.locator('svg[data-an-primitive="boolean"]'),
    ).toHaveCount(2);
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain('data-an-primitive="boolean"');
    await expect
      .poll(() => layerRow(page, "Subtract").last().textContent())
      .toContain("Subtract");

    const originalBounds = await shortcutRoot.boundingBox();
    expect(originalBounds?.width).toBeGreaterThan(0);
    await setInspectorValue(page, "Rotation", "45");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toMatch(/transform:\s*rotate\(-45deg\)/);
    const rotatedBounds = await shortcutRoot.boundingBox();
    expect(rotatedBounds?.width).toBeGreaterThan(originalBounds!.width * 1.3);
    expect(rotatedBounds?.height).toBeGreaterThan(originalBounds!.height * 1.3);
    await setInspectorValue(page, "Corner radius", "13");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain("--boolean-result-radius-x: 13px");
    await setInspectorValue(page, "Opacity", "25");
    await page.screenshot({
      path: test.info().outputPath("boolean-subtract-proof.png"),
      fullPage: true,
    });
    const roundedPixels = await booleanMaskPixels(shortcutFrame, 1, true);
    expect(roundedPixels.roundedCorner?.[3]).toBe(0);
    expect(roundedPixels.insideRoundedCorner?.[3]).toBeGreaterThanOrEqual(63);
    expect(roundedPixels.insideRoundedCorner?.[3]).toBeLessThanOrEqual(65);
    const styledContent = await designContent(page, designId, "index.html");
    expect(styledContent).toContain("border-radius: 13px");
    expect(styledContent).toContain("--boolean-result-radius-x: 13px");
    expect(styledContent).toContain("--boolean-result-radius-y: 13px");
    expect(styledContent).toContain("opacity: 0.25");
    expect(styledContent).toMatch(/transform:\s*rotate\(-45deg\)/);

    await layerRow(page, "Subtract").first().click();
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]').last(),
    ).toContainText("Subtract");
    await page.keyboard.press(`${MOD}+Shift+g`);
    await expect
      .poll(async () => {
        const content = await designContent(page, designId, "index.html");
        return (content.match(/data-an-primitive="boolean"/g) ?? []).length;
      })
      .toBe(1);
    const releasedContent = await designContent(page, designId, "index.html");
    expect(releasedContent).not.toMatch(
      /data-agent-native-node-id="hotkey-base"[^>]*data-an-boolean-operand=/,
    );
    expect(releasedContent).not.toMatch(
      /data-agent-native-node-id="hotkey-cutter"[^>]*data-an-boolean-operand=/,
    );
    expect(releasedContent).toMatch(
      /data-agent-native-node-id="hotkey-base"[^>]*data-an-primitive="rectangle"/,
    );
    expect(releasedContent).toMatch(
      /data-agent-native-node-id="hotkey-cutter"[^>]*data-an-primitive="ellipse"/,
    );
    const hotkeyLayerNodeIds = await Promise.all(
      ["Hotkey Base", "Hotkey Cutter"].map((name) =>
        layerRow(page, name).getAttribute("data-layer-node-id"),
      ),
    );
    expect(hotkeyLayerNodeIds.every(Boolean)).toBe(true);
    const selectedLayerNodeIds = () =>
      page
        .locator(
          '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
        )
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("data-layer-node-id")),
        );
    await expect
      .poll(selectedLayerNodeIds)
      .toEqual(expect.arrayContaining(hotkeyLayerNodeIds));
    await expect
      .poll(async () => (await selectedLayerNodeIds()).length)
      .toBe(2);
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

    const releasedBase = shortcutFrame.locator(
      'svg[data-agent-native-node-id="hotkey-base"]',
    );
    const releasedCutter = shortcutFrame.locator(
      'svg[data-agent-native-node-id="hotkey-cutter"]',
    );
    await expect(releasedBase).toHaveAttribute(
      "data-an-primitive",
      "rectangle",
    );
    await expect(releasedCutter).toHaveAttribute(
      "data-an-primitive",
      "ellipse",
    );
    const releasedStyles = await Promise.all([
      releasedBase.evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        paintOpacity: getComputedStyle(node.querySelector("rect")!).opacity,
        fill: getComputedStyle(node.querySelector("rect")!).fill,
        rx: node.querySelector("rect")?.getAttribute("rx"),
        transform: getComputedStyle(node).transform,
      })),
      releasedCutter.evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        paintOpacity: getComputedStyle(node.querySelector("rect")!).opacity,
        fill: getComputedStyle(node.querySelector("rect")!).fill,
        transform: getComputedStyle(node).transform,
      })),
    ]);
    expect(releasedStyles[0]).toMatchObject({
      opacity: "0.5",
      paintOpacity: "1",
      fill: "rgb(204, 51, 102)",
      rx: "13",
    });
    expect(releasedStyles[0].transform).not.toBe("none");
    expect(releasedStyles[1]).toMatchObject({
      opacity: "1",
      paintOpacity: "1",
      fill: "rgb(51, 102, 204)",
    });
    expect(releasedStyles[1].transform).not.toBe("none");
    await expect(
      shortcutFrame.locator('svg[data-an-primitive="boolean"]'),
    ).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath("boolean-subtract-ungroup.png"),
      fullPage: true,
    });

    await layerRow(page, "Hotkey Base").click();
    const opacityInput = page.locator('input[aria-label="Opacity" i]').last();
    await expect(opacityInput).toHaveValue("50%");
    await setInspectorValue(page, "Opacity", "25");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toMatch(/data-agent-native-node-id="hotkey-base"[^>]*opacity: 0\.25/);
    await expect
      .poll(() =>
        releasedBase.evaluate((node) => ({
          opacity: getComputedStyle(node).opacity,
          paintOpacity: getComputedStyle(node.querySelector("rect")!).opacity,
        })),
      )
      .toEqual({ opacity: "0.25", paintOpacity: "1" });

    await layerRow(page, "Hotkey Base").click();
    await layerRow(page, "Hotkey Cutter").click({ modifiers: ["Shift"] });
    await expect
      .poll(selectedLayerNodeIds)
      .toEqual(expect.arrayContaining(hotkeyLayerNodeIds));
    await expect
      .poll(async () => (await selectedLayerNodeIds()).length)
      .toBe(2);
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
    await setInspectorValue(page, "Opacity", "25");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toMatch(/data-agent-native-node-id="hotkey-cutter"[^>]*opacity: 0\.25/);

    await page.reload();
    await expect(
      designFrame(page, indexScreen.id).locator(
        'svg[data-agent-native-node-id="hotkey-base"]',
      ),
    ).toHaveAttribute("data-an-primitive", "rectangle");
    await expect(
      designFrame(page, indexScreen.id).locator(
        'svg[data-agent-native-node-id="hotkey-cutter"]',
      ),
    ).toHaveAttribute("data-an-primitive", "ellipse");
  } finally {
    await postAction(page, "delete-design", { id: designId });
  }
});

test("inside stroke follows exposed cutter edges without drawing overlap seams", async ({
  page,
}) => {
  const created = await postAction(page, "create-design", {
    title: `Boolean Stroke Overlap ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    const indexScreen = await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await layerRow(page, "Overlap Base").click();
    await layerRow(page, "Overlap Cutter A").click({ modifiers: ["Shift"] });
    await layerRow(page, "Overlap Cutter B").click({ modifiers: ["Shift"] });
    const submenu = await openBooleanMenu(page);
    await submenu
      .getByRole("menuitem", { name: "Subtract", exact: true })
      .click();
    const frame = designFrame(page, indexScreen.id);
    const overlapRoot = frame
      .locator('svg[data-an-primitive="boolean"]')
      .first();
    const overlapRootId = await overlapRoot.getAttribute(
      "data-agent-native-node-id",
    );
    if (!overlapRootId) throw new Error("Overlap Boolean has no source id");
    await expandAllLayers(page);
    await layerRow(page, "Subtract").last().click();
    await expect(
      page.getByRole("button", { name: "Add stroke", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add stroke", exact: true }).click();
    await setInspectorValue(page, "Weight", "4");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toMatch(/--boolean-mask-stroke-width:\s*4px/);

    const pixels = await booleanMaskPixels(
      frame,
      0,
      false,
      { cutEdge: [24, 50], internalSeam: [50, 50] },
      100,
      100,
    );
    expect(pixels.cutEdge?.[3]).toBeGreaterThan(0);
    expect(pixels.internalSeam?.[3]).toBe(0);

    const initialContent = await designContent(page, designId, "index.html");
    const overlapStrokeBefore = booleanCutterStrokeMarkup(
      initialContent,
      overlapRootId,
    );
    await expandAllLayers(page);
    await layerRow(page, "Base").click();
    await layerRow(page, "Cutter").click({ modifiers: ["Shift"] });
    const secondSubmenu = await openBooleanMenu(page);
    await secondSubmenu
      .getByRole("menuitem", { name: "Subtract", exact: true })
      .click();
    await expect(frame.locator('svg[data-an-primitive="boolean"]')).toHaveCount(
      2,
    );
    const mainRootId = await frame
      .locator('svg[data-an-primitive="boolean"]')
      .evaluateAll(
        (roots, excludedId) =>
          roots
            .map((root) => root.getAttribute("data-agent-native-node-id"))
            .find((id) => id !== excludedId),
        overlapRootId,
      );
    if (!mainRootId) throw new Error("Sibling Boolean has no source id");
    await expandAllLayers(page);
    await layerRow(page, "Subtract").last().click();
    await expect(
      page.getByRole("button", { name: "Add stroke", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add stroke", exact: true }).click();
    await setInspectorValue(page, "Weight", "8");
    await expect
      .poll(() => designContent(page, designId, "index.html"))
      .toContain("--boolean-mask-stroke-width: 8px");
    const changedContent = await designContent(page, designId, "index.html");
    expect(booleanCutterStrokeMarkup(changedContent, mainRootId)).toMatch(
      /--boolean-mask-stroke-width:\s*8px/,
    );
    expect(booleanCutterStrokeMarkup(changedContent, overlapRootId)).toBe(
      overlapStrokeBefore,
    );
  } finally {
    await postAction(page, "delete-design", { id: designId });
  }
});

test("redo keeps the Boolean result selected for immediate follow-up actions", async ({
  page,
}) => {
  const created = await postAction(page, "create-design", {
    title: `Boolean Redo Selection ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    const indexScreen = await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await layerRow(page, "Base").click();
    await layerRow(page, "Cutter").click({ modifiers: ["Shift"] });
    const submenu = await openBooleanMenu(page);
    await submenu
      .getByRole("menuitem", { name: "Subtract", exact: true })
      .click();

    const frame = designFrame(page, indexScreen.id);
    const booleanResults = frame.locator('svg[data-an-primitive="boolean"]');
    const layerTree = page.getByRole("tree", { name: "Layers" });
    const selectedRows = layerTree.locator(
      '[role="treeitem"][aria-selected="true"]',
    );
    await expect(booleanResults).toHaveCount(1);
    await expect(layerTreeItem(page, "Subtract")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press(`${MOD}+z`);
    await expect(booleanResults).toHaveCount(0);
    await expect(selectedRows).toHaveCount(2);
    await expect(layerTreeItem(page, "Base")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(layerTreeItem(page, "Cutter")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(booleanResults).toHaveCount(1);
    await expect(selectedRows).toHaveCount(1);
    await expect(layerTreeItem(page, "Subtract")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press(`${MOD}+d`);
    await expect(booleanResults).toHaveCount(2);
  } finally {
    await postAction(page, "delete-design", { id: designId });
  }
});
