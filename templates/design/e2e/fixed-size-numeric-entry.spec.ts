import { expect, test, type Page } from "@playwright/test";

import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

const ROW_FRAME_ID = "fixed-size-row-frame";
const COLUMN_LEAF_ID = "fixed-size-column-leaf";

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createConstrainedFlexDesign(page: Page) {
  const created = await action(page, "create-design", {
    title: `Fixed size in constrained flex ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  const content = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="box-sizing:border-box;width:480px;height:360px;margin:0;padding:20px;display:flex;flex-direction:column;gap:20px">
  <section data-agent-native-node-id="fixed-size-row-parent" data-agent-native-layer-name="Row Parent" data-an-primitive="frame" style="box-sizing:border-box;width:180px;height:140px;padding:8px;display:flex;flex-direction:row;align-items:stretch;gap:8px;flex:0 0 auto;background:#e2e8f0">
    <div data-agent-native-node-id="${ROW_FRAME_ID}" data-agent-native-layer-name="Row Frame" data-an-primitive="frame" style="box-sizing:border-box;width:120px;height:100%;min-width:0;flex:0 1 auto;display:flex;align-items:center;background:#2563eb"><span>Frame</span></div>
    <div data-agent-native-node-id="fixed-size-row-companion" data-agent-native-layer-name="Row Companion" data-an-primitive="rectangle" style="box-sizing:border-box;width:30px;height:40px;flex:0 1 auto;background:#f97316"></div>
  </section>
  <section data-agent-native-node-id="fixed-size-column-parent" data-agent-native-layer-name="Column Parent" data-an-primitive="frame" style="box-sizing:border-box;width:180px;height:140px;padding:8px;display:flex;flex-direction:column;align-items:stretch;gap:8px;flex:0 0 auto;background:#e2e8f0">
    <div data-agent-native-node-id="${COLUMN_LEAF_ID}" data-agent-native-layer-name="Column Leaf" data-an-primitive="rectangle" style="box-sizing:border-box;width:100%;height:80px;min-height:0;flex:0 1 auto;background:#16a34a"></div>
    <div data-agent-native-node-id="fixed-size-column-companion" data-agent-native-layer-name="Column Companion" data-an-primitive="rectangle" style="box-sizing:border-box;width:40px;height:24px;flex:0 1 auto;background:#f97316"></div>
  </section>
</body></html>`;
  const createdFile = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content,
  });
  const screenId = createdFile.id ?? createdFile.data?.id;
  if (typeof screenId !== "string") throw new Error("missing Screen id");

  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 100, y: 100, width: 480, height: 360 },
      },
    ],
  });
  return { designId, screenId };
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readSourceStyle(
  page: Page,
  designId: string,
  screenId: string,
  nodeId: string,
  property: "width" | "height",
) {
  const design = await readDesign(page, designId);
  const content = design.files?.find((file) => file.id === screenId)?.content;
  if (!content) throw new Error(`missing saved source for ${screenId}`);
  return page.evaluate(
    ({ html, id, propertyName }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const node = parsed.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!node) throw new Error(`missing source node ${id}`);
      return node.style.getPropertyValue(propertyName);
    },
    { html: content, id: nodeId, propertyName: property },
  );
}

async function readInlineSizingStyles(
  page: Page,
  designId: string,
  screenId: string,
  nodeId: string,
) {
  const design = await readDesign(page, designId);
  const content = design.files?.find((file) => file.id === screenId)?.content;
  if (!content) throw new Error(`missing saved source for ${screenId}`);
  return page.evaluate(
    ({ html, id }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const node = parsed.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!node) throw new Error(`missing source node ${id}`);
      return {
        width: node.style.width,
        height: node.style.height,
        alignSelf: node.style.getPropertyValue("align-self"),
        flexShrink: node.style.flexShrink,
      };
    },
    { html: content, id: nodeId },
  );
}

async function readLiveGeometry(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const parent = node.parentElement;
      const parentStyle = parent ? getComputedStyle(parent) : null;
      const parentBounds = parent?.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        widthStyle: node.style.width,
        heightStyle: node.style.height,
        flexShrink: style.flexShrink,
        parent:
          parentBounds && parentStyle
            ? {
                width: parentBounds.width,
                height: parentBounds.height,
                display: parentStyle.display,
                flexDirection: parentStyle.flexDirection,
                padding: parentStyle.padding,
                gap: parentStyle.gap,
              }
            : null,
      };
    });
}

async function selectLayer(page: Page, name: string) {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { name: new RegExp(`\\b${name}\\b`) })
    .first();
  const button = row.getByRole("button", { name, exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function setDimension(page: Page, axis: "W" | "H", value: number) {
  const input = page.getByRole("textbox", { name: `${axis} size in pixels` });
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press("Enter");
}

function sizingMode(page: Page, axis: "W" | "H", mode: "Fixed" | "Fill") {
  return page.getByRole("button", {
    name: new RegExp(`^${axis}(?: sizing mode — | \\d+ )${mode}$`),
  });
}

async function setSizingMode(
  page: Page,
  axis: "W" | "H",
  currentMode: "Fixed" | "Fill",
  nextMode: "Fixed" | "Fill",
) {
  await sizingMode(page, axis, currentMode).click();
  await page
    .getByRole("menuitem", {
      name: nextMode === "Fill" ? "Fill container" : "Fixed",
      exact: true,
    })
    .click();
}

async function reloadEditor(page: Page, screenId: string) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.locator(`[data-screen-shell][data-frame-id="${screenId}"]`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
}

test("numeric Fixed size sticks on a Frame's row main axis while its cross axis stays Fill", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  let fixture: Awaited<ReturnType<typeof createConstrainedFlexDesign>> | null =
    null;
  try {
    fixture = await createConstrainedFlexDesign(page);
    const { designId, screenId } = fixture;
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await selectLayer(page, "Row Frame");
    await setSizingMode(page, "H", "Fill", "Fill");
    await expect
      .poll(() =>
        readInlineSizingStyles(page, designId, screenId, ROW_FRAME_ID),
      )
      .toMatchObject({ height: "auto", alignSelf: "stretch" });
    const afterFillContainer = await readLiveGeometry(
      page,
      screenId,
      ROW_FRAME_ID,
    );
    await expect(sizingMode(page, "W", "Fixed")).toBeVisible();
    await expect(sizingMode(page, "H", "Fill")).toBeVisible();

    await setDimension(page, "W", 260);
    await expect
      .poll(() =>
        readSourceStyle(page, designId, screenId, ROW_FRAME_ID, "width"),
      )
      .toBe("260px");
    const beforeReload = await readLiveGeometry(page, screenId, ROW_FRAME_ID);

    await reloadEditor(page, screenId);
    await expandAllLayers(page);
    await selectLayer(page, "Row Frame");
    const afterReload = await readLiveGeometry(page, screenId, ROW_FRAME_ID);
    const afterReloadStyles = await readInlineSizingStyles(
      page,
      designId,
      screenId,
      ROW_FRAME_ID,
    );
    const modeLabels = await page
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => button.getAttribute("aria-label"))
          .filter(
            (label) =>
              /^W sizing mode — Fixed$/.test(label ?? "") ||
              /^H(?: sizing mode — | \d+ )Fill$/.test(label ?? ""),
          ),
      );
    await setSizingMode(page, "H", "Fill", "Fixed");
    await expect
      .poll(() =>
        readInlineSizingStyles(page, designId, screenId, ROW_FRAME_ID),
      )
      .toMatchObject({ height: "124px" });
    const afterFillToFixed = await readLiveGeometry(
      page,
      screenId,
      ROW_FRAME_ID,
    );
    const fixedHeightSource = await readSourceStyle(
      page,
      designId,
      screenId,
      ROW_FRAME_ID,
      "height",
    );
    const afterFillToFixedStyles = await readInlineSizingStyles(
      page,
      designId,
      screenId,
      ROW_FRAME_ID,
    );
    const fixedHeightModeVisible = await sizingMode(page, "H", "Fixed")
      .isVisible()
      .catch(() => false);
    const evidence = {
      designId,
      screenId,
      expectedWidth: 260,
      persistedWidth: await readSourceStyle(
        page,
        designId,
        screenId,
        ROW_FRAME_ID,
        "width",
      ),
      beforeReload,
      afterFillContainer,
      afterReload,
      afterReloadStyles,
      modeLabels,
      afterFillToFixed,
      fixedHeightSource,
      afterFillToFixedStyles,
      fixedHeightModeVisible,
    };
    console.info("fixed-row-frame-sizing", JSON.stringify(evidence));
    await testInfo.attach("fixed-row-frame-sizing.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });

    expect(modeLabels).toHaveLength(2);
    expect(modeLabels).toContain("W sizing mode — Fixed");
    expect(modeLabels.some((label) => /^H \d+ Fill$/.test(label ?? ""))).toBe(
      true,
    );
    expect.soft(afterReload.width).toBeCloseTo(260, 1);
    expect.soft(afterReload.heightStyle).toBe("auto");
    expect.soft(afterReloadStyles).toMatchObject({
      height: "auto",
      alignSelf: "stretch",
    });
    expect.soft(fixedHeightModeVisible).toBe(true);
    expect.soft(fixedHeightSource).toMatch(/^\d+(?:\.\d+)?px$/);
    expect.soft(afterFillToFixedStyles.alignSelf).toBe("auto");
    expect
      .soft(afterFillToFixed.height)
      .toBeCloseTo(Number.parseFloat(fixedHeightSource), 1);
  } finally {
    if (fixture) await action(page, "delete-design", { id: fixture.designId });
  }
});

test("numeric Fixed size sticks on a leaf's column main axis while its cross axis stays Fill", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  let fixture: Awaited<ReturnType<typeof createConstrainedFlexDesign>> | null =
    null;
  try {
    fixture = await createConstrainedFlexDesign(page);
    const { designId, screenId } = fixture;
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await selectLayer(page, "Column Leaf");
    await setSizingMode(page, "W", "Fill", "Fill");
    await expect
      .poll(() =>
        readInlineSizingStyles(page, designId, screenId, COLUMN_LEAF_ID),
      )
      .toMatchObject({ width: "auto", alignSelf: "stretch" });
    const afterFillContainer = await readLiveGeometry(
      page,
      screenId,
      COLUMN_LEAF_ID,
    );
    await expect(sizingMode(page, "W", "Fill")).toBeVisible();
    await expect(sizingMode(page, "H", "Fixed")).toBeVisible();

    await setDimension(page, "H", 220);
    await expect
      .poll(() =>
        readSourceStyle(page, designId, screenId, COLUMN_LEAF_ID, "height"),
      )
      .toBe("220px");
    const beforeReload = await readLiveGeometry(page, screenId, COLUMN_LEAF_ID);

    await reloadEditor(page, screenId);
    await expandAllLayers(page);
    await selectLayer(page, "Column Leaf");
    const afterReload = await readLiveGeometry(page, screenId, COLUMN_LEAF_ID);
    const afterReloadStyles = await readInlineSizingStyles(
      page,
      designId,
      screenId,
      COLUMN_LEAF_ID,
    );
    const modeLabels = await page
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => button.getAttribute("aria-label"))
          .filter(
            (label) =>
              /^W(?: sizing mode — | \d+ )Fill$/.test(label ?? "") ||
              /^H sizing mode — Fixed$/.test(label ?? ""),
          ),
      );
    await setSizingMode(page, "W", "Fill", "Fixed");
    await expect
      .poll(() =>
        readInlineSizingStyles(page, designId, screenId, COLUMN_LEAF_ID),
      )
      .toMatchObject({ width: "164px" });
    const afterFillToFixed = await readLiveGeometry(
      page,
      screenId,
      COLUMN_LEAF_ID,
    );
    const fixedWidthSource = await readSourceStyle(
      page,
      designId,
      screenId,
      COLUMN_LEAF_ID,
      "width",
    );
    const afterFillToFixedStyles = await readInlineSizingStyles(
      page,
      designId,
      screenId,
      COLUMN_LEAF_ID,
    );
    const fixedWidthModeVisible = await sizingMode(page, "W", "Fixed")
      .isVisible()
      .catch(() => false);
    const evidence = {
      designId,
      screenId,
      expectedHeight: 220,
      persistedHeight: await readSourceStyle(
        page,
        designId,
        screenId,
        COLUMN_LEAF_ID,
        "height",
      ),
      beforeReload,
      afterFillContainer,
      afterReload,
      afterReloadStyles,
      modeLabels,
      afterFillToFixed,
      fixedWidthSource,
      afterFillToFixedStyles,
      fixedWidthModeVisible,
    };
    console.info("fixed-column-leaf-sizing", JSON.stringify(evidence));
    await testInfo.attach("fixed-column-leaf-sizing.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });

    expect(modeLabels).toHaveLength(2);
    expect(modeLabels).toContain("H sizing mode — Fixed");
    expect(modeLabels.some((label) => /^W \d+ Fill$/.test(label ?? ""))).toBe(
      true,
    );
    expect.soft(afterReload.height).toBeCloseTo(220, 1);
    expect.soft(afterReload.widthStyle).toBe("auto");
    expect.soft(afterReloadStyles).toMatchObject({
      width: "auto",
      alignSelf: "stretch",
    });
    expect.soft(fixedWidthModeVisible).toBe(true);
    expect.soft(fixedWidthSource).toMatch(/^\d+(?:\.\d+)?px$/);
    expect.soft(afterFillToFixedStyles.alignSelf).toBe("auto");
    expect
      .soft(afterFillToFixed.width)
      .toBeCloseTo(Number.parseFloat(fixedWidthSource), 1);
  } finally {
    if (fixture) await action(page, "delete-design", { id: fixture.designId });
  }
});
