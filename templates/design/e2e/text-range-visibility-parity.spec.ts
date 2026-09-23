import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  expandAllLayers,
  gotoEditor,
  selectByText,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

function typographySection(page: Page) {
  const heading = page.getByRole("heading", {
    name: "Typography",
    exact: true,
  });
  return page.locator("section").filter({ has: heading }).first();
}

async function sizeInput(page: Page) {
  const input = typographySection(page).locator('input[aria-label="Size" i]');
  await expect(input).toBeVisible();
  return input;
}

function layerRow(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function selectTextLayers(page: Page, names: string[]): Promise<void> {
  await expandAllLayers(page);
  await layerRow(page, names[0]).locator("[data-layer-row-button]").click({
    force: true,
  });
  for (const name of names.slice(1)) {
    await layerRow(page, name)
      .locator("[data-layer-row-button]")
      .click({ force: true, modifiers: [MOD] });
  }
  await expect
    .poll(() => page.locator('[role="treeitem"][aria-selected="true"]').count())
    .toBe(names.length);
}

async function textLeafStyles(page: Page) {
  return designFrame(page)
    .locator("body")
    .evaluate(() => {
      const heading = document.querySelector("h1");
      const paragraph = [...document.querySelectorAll("p")].find((node) =>
        node.textContent?.includes("First fixture paragraph"),
      );
      if (!heading || !paragraph) throw new Error("text fixture nodes missing");
      const read = (node: Element) => {
        const styles = getComputedStyle(node);
        return {
          family: styles.fontFamily,
          size: styles.fontSize,
          lineHeight: styles.lineHeight,
          color: styles.color,
        };
      };
      return { heading: read(heading), paragraph: read(paragraph) };
    });
}

async function headingRangeStyles(page: Page) {
  return designFrame(page)
    .locator("h1")
    .first()
    .evaluate((element) => {
      const heading = element as HTMLElement;
      const run = [...heading.querySelectorAll("span")].find(
        (span) => span.textContent === "E2E",
      );
      return {
        rangeSize: run ? getComputedStyle(run).fontSize : "",
        headingSize: getComputedStyle(heading).fontSize,
        rangeFamily: run ? getComputedStyle(run).fontFamily : "",
        headingFamily: getComputedStyle(heading).fontFamily,
        rangeWeight: run ? getComputedStyle(run).fontWeight : "",
        headingWeight: getComputedStyle(heading).fontWeight,
        rangeLineHeight: run ? getComputedStyle(run).lineHeight : "",
        headingLineHeight: getComputedStyle(heading).lineHeight,
        rangeStyle: run ? getComputedStyle(run).fontStyle : "",
        headingStyle: getComputedStyle(heading).fontStyle,
        rangeColor: run ? getComputedStyle(run).color : "",
        headingColor: getComputedStyle(heading).color,
        rangeTransform: run ? getComputedStyle(run).textTransform : "",
        headingTransform: getComputedStyle(heading).textTransform,
      };
    });
}

async function selectHeadingRange(page: Page): Promise<void> {
  await selectByText(page, "E2E Hero Heading");
  await page.keyboard.press("Enter");
  const heading = designFrame(page).locator("h1").first();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await heading.click({ position: { x: 2, y: 10 }, force: true });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("E2E");
}

async function selectTextRange(
  page: Page,
  layerText: string,
  selectedText: string,
): Promise<void> {
  await selectByText(page, layerText);
  await page.keyboard.press("Enter");
  const heading = designFrame(page).locator("h1").first();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await heading.press(`${MOD}+ArrowUp`);
  for (let index = 0; index < selectedText.length; index += 1) {
    await heading.press("Shift+ArrowRight");
  }
  await expect
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe(selectedText);
}

async function deleteDesign(page: Page, designId: string): Promise<void> {
  const response = await page.request.post(
    appPath("/_agent-native/actions/delete-design"),
    { data: { id: designId } },
  );
  if (!response.ok()) {
    throw new Error(`delete-design: ${await response.text()}`);
  }
}

async function savedHeadingRangeStyles(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = (await response.json()) as {
    files?: Array<{ filename?: string; content?: string }>;
  };
  const html = design.files?.find(
    (file) => file.filename === "index.html",
  )?.content;
  if (typeof html !== "string") throw new Error("missing saved index.html");
  return page.evaluate((content) => {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const heading = doc.querySelector("h1");
    const range = [...(heading?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "E2E",
    );
    return {
      headingSize: (heading as HTMLElement | null)?.style.fontSize ?? "",
      headingLineHeight:
        (heading as HTMLElement | null)?.style.lineHeight ?? "",
      rangeSize: (range as HTMLElement | undefined)?.style.fontSize ?? "",
      rangeFamily: (range as HTMLElement | undefined)?.style.fontFamily ?? "",
      rangeWeight: (range as HTMLElement | undefined)?.style.fontWeight ?? "",
      rangeLineHeight:
        (range as HTMLElement | undefined)?.style.lineHeight ?? "",
      rangeColor: (range as HTMLElement | undefined)?.style.color ?? "",
      rangeTransform:
        (range as HTMLElement | undefined)?.style.textTransform ?? "",
    };
  }, html);
}

async function createHtmlDesign(
  page: Page,
  title: string,
  html: string,
): Promise<string> {
  const created = await page.request.post(
    appPath("/_agent-native/actions/create-design"),
    { data: { title, projectType: "prototype" } },
  );
  if (!created.ok()) {
    throw new Error(`create-design: ${await created.text()}`);
  }
  const createdBody = (await created.json()) as {
    id?: string;
    data?: { id?: string };
    design?: { id?: string };
  };
  const designId =
    createdBody.id ?? createdBody.data?.id ?? createdBody.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  const file = await page.request.post(
    appPath("/_agent-native/actions/create-file"),
    {
      data: {
        designId,
        filename: "index.html",
        content: html,
        fileType: "html",
      },
    },
  );
  if (!file.ok()) {
    await deleteDesign(page, designId);
    throw new Error(`create-file: ${await file.text()}`);
  }
  return designId;
}

async function createBlankTextToolScreen(page: Page): Promise<{
  designId: string;
  screenId: string;
}> {
  const designId = await createFixtureDesign(page, "Text tool range focus");
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = (await response.json()) as {
    files?: Array<{ id?: string; filename?: string }>;
  };
  const screenId = design.files?.find(
    (file) => file.filename === "index.html",
  )?.id;
  if (!screenId) throw new Error("Missing fixture Screen ID");

  const updated = await page.request.post(
    appPath("/_agent-native/actions/update-file"),
    {
      data: {
        id: screenId,
        content:
          '<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body style="margin:0;background:#fff"><main data-agent-native-node-id="text-tool-canvas" style="position:relative;margin:80px;width:800px;height:600px"></main></body></html>',
      },
    },
  );
  if (!updated.ok()) {
    await deleteDesign(page, designId);
    throw new Error(`update-file: ${await updated.text()}`);
  }
  return { designId, screenId };
}

async function readSavedFileContent(
  page: Page,
  designId: string,
  fileId: string,
): Promise<string> {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = (await response.json()) as {
    files?: Array<{ id?: string; content?: string }>;
  };
  const content = design.files?.find((file) => file.id === fileId)?.content;
  if (typeof content !== "string") throw new Error("Missing saved Screen HTML");
  return content;
}

async function textToolRangePointerPoints(editor: Locator) {
  return editor.evaluate((element: HTMLElement) => {
    const textNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    ) as Text | undefined;
    if (!textNode) throw new Error("Text tool editor has no text node");
    const range = element.ownerDocument.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const bounds = range.getBoundingClientRect();
    const frame = element.ownerDocument.defaultView
      ?.frameElement as HTMLIFrameElement | null;
    const frameBounds = frame?.getBoundingClientRect();
    const win = element.ownerDocument.defaultView;
    if (!frameBounds || !win)
      throw new Error("Text editor has no frame bounds");
    return {
      startX:
        frameBounds.x +
        (bounds.left + 0.5) * (frameBounds.width / win.innerWidth),
      endX:
        frameBounds.x +
        (bounds.right - 0.5) * (frameBounds.width / win.innerWidth),
      y:
        frameBounds.y +
        (bounds.top + bounds.height / 2) *
          (frameBounds.height / win.innerHeight),
    };
  });
}

test("Typography applies to a selected range after focus moves to its controls", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Text range inspector parity",
  );
  try {
    await gotoEditor(page, designId);
    await selectHeadingRange(page);
    const heading = designFrame(page).locator("h1").first();
    const originalHeadingStyles = await heading.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        family: styles.fontFamily,
        color: styles.color,
        weight: styles.fontWeight,
      };
    });
    const typography = typographySection(page);
    const fontPicker = typography.getByRole("button", { name: "Font" });
    const originalFontLabel = (await fontPicker.textContent())?.trim() || "";
    expect(originalFontLabel).toBeTruthy();
    await expect(fontPicker).toHaveText(originalFontLabel);
    await (await sizeInput(page)).fill("64");
    await (await sizeInput(page)).press("Enter");
    await expect(await sizeInput(page)).toHaveValue("64px");
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        rangeSize: "64px",
        headingSize: "40px",
      });
    await expect
      .poll(() =>
        designFrame(page)
          .locator("body")
          .evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");

    const weightPicker = typography.getByRole("combobox");
    await expect(weightPicker).toHaveCount(1);
    await weightPicker.click();
    const semiBold = page.getByRole("option", {
      name: "Semi Bold",
      exact: true,
    });
    await expect(semiBold).toBeVisible();
    await expect
      .poll(() =>
        semiBold.evaluate((option) =>
          option
            .closest('[data-design-chrome-region="right-panel"]')
            ?.getAttribute("data-design-chrome-region"),
        ),
      )
      .toBe("right-panel");
    await semiBold.click();
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        rangeWeight: "600",
        headingWeight: originalHeadingStyles.weight,
      });

    await fontPicker.click();
    const search = page.getByRole("combobox", { name: "Search" });
    await search.fill("Monospace");
    const monospace = page.getByRole("option", {
      name: "Monospace",
      exact: true,
    });
    await expect(monospace).toBeVisible();
    const fontPopover = page.getByRole("combobox", { name: "Search" });
    await expect
      .poll(() =>
        fontPopover.evaluate((input) =>
          input
            .closest('[data-design-chrome-region="right-panel"]')
            ?.getAttribute("data-design-chrome-region"),
        ),
      )
      .toBe("right-panel");
    await monospace.click();
    await expect(fontPicker).toHaveText("Monospace");
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        rangeFamily: "monospace",
        headingFamily: originalHeadingStyles.family,
      });
    await expect
      .poll(() =>
        designFrame(page)
          .locator("body")
          .evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");

    const fillHeading = page.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    const fillSection = page
      .locator("section")
      .filter({ has: fillHeading })
      .first();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
    await expect
      .poll(() =>
        hexInput.evaluate((input) =>
          input
            .closest('[data-design-chrome-region="right-panel"]')
            ?.getAttribute("data-design-chrome-region"),
        ),
      )
      .toBe("right-panel");
    await hexInput.fill("3366FF");
    await hexInput.press("Enter");
    await expect(hexInput).toHaveValue("3366FF");
    const fillPickerButton = fillSection.getByRole("button", {
      name: "Open color picker",
    });
    await fillPickerButton.click();
    await fillPickerButton.click();
    await expect(hexInput).toHaveValue("3366FF");

    await typography
      .getByRole("button", { name: "Typography details" })
      .click();
    await page.getByRole("tab", { name: "Details" }).click();
    const uppercaseButton = page.getByRole("button", { name: "Uppercase" });
    await uppercaseButton.click();
    await expect(uppercaseButton).toHaveClass(
      /text-\[var\(--design-editor-accent-color\)\]/,
    );

    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        rangeSize: "64px",
        headingSize: "40px",
        rangeFamily: "monospace",
        rangeColor: "rgb(51, 102, 255)",
        rangeWeight: "600",
        headingFamily: originalHeadingStyles.family,
        headingWeight: originalHeadingStyles.weight,
        headingColor: originalHeadingStyles.color,
        rangeStyle: "normal",
        headingStyle: "normal",
        rangeTransform: "uppercase",
        headingTransform: "none",
      });
    await expect
      .poll(() =>
        designFrame(page)
          .locator("body")
          .evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");

    await page
      .getByRole("treeitem")
      .filter({ hasText: "E2E Token Sample" })
      .getByRole("button", { name: "E2E Token Sample", exact: true })
      .click();
    await page
      .getByRole("treeitem")
      .filter({ hasText: "E2E Hero Heading" })
      .getByRole("button", { name: "E2E Hero Heading", exact: true })
      .click();
    await expect
      .poll(() =>
        designFrame(page)
          .locator("h1")
          .first()
          .evaluate((element) => getComputedStyle(element).fontFamily),
      )
      .toBe(originalHeadingStyles.family);
    await expect(fontPicker).toHaveText("Mixed");
    await expect(await sizeInput(page)).toHaveValue("Mixed");
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        headingSize: "40px",
        rangeSize: "64px",
        headingColor: originalHeadingStyles.color,
        rangeColor: "rgb(51, 102, 255)",
      });
    await expect(
      fillSection.getByText("Click + to replace mixed content", {
        exact: true,
      }),
    ).toBeVisible();
    const selectionColorsSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    await selectionColorsSection
      .getByRole("button", { name: "Show selection colors" })
      .click();
    await selectionColorsSection
      .getByRole("button", { name: /^#f4f4f5$/i })
      .click();
    await expect(hexInput).toHaveValue("F4F4F5");
    await page.keyboard.press("Escape");
    await (await sizeInput(page)).fill("24");
    await (await sizeInput(page)).press("Enter");
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({ headingSize: "24px", rangeSize: "64px" });
    await expect
      .poll(() => savedHeadingRangeStyles(page, designId))
      .toMatchObject({
        headingSize: "24px",
        rangeSize: "64px",
        rangeFamily: "monospace",
        rangeWeight: "600",
        rangeColor: "rgb(51, 102, 255)",
        rangeTransform: "uppercase",
      });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("multi-selected text leaves share inspector styles and one undo restores both", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Multi-selected text inspector parity",
  );
  const headingName = "E2E Hero Heading";
  const paragraphName = "First fixture paragraph for selection tests.";
  try {
    await gotoEditor(page, designId);
    // Re-enter through a hard reload so the initial mixed inspector state is
    // proven against persisted source, not just the first render.
    await page.reload();
    await selectTextLayers(page, [headingName, paragraphName]);

    const typography = typographySection(page);
    const fontPicker = typography.getByRole("button", { name: "Font" });
    const lineHeight = typography.locator('input[aria-label="Line height" i]');
    await expect(fontPicker).toHaveText("System UI");
    await expect(await sizeInput(page)).toHaveValue("Mixed");
    await expect(lineHeight).toHaveValue("Mixed");

    await fontPicker.click();
    const search = page.getByRole("combobox", { name: "Search" });
    await search.fill("Monospace");
    await page.getByRole("option", { name: "Monospace", exact: true }).click();
    await expect
      .poll(() => textLeafStyles(page))
      .toMatchObject({
        heading: { family: "monospace" },
        paragraph: { family: "monospace" },
      });

    const sharedSize = await sizeInput(page);
    await sharedSize.fill("24");
    await sharedSize.press("Enter");
    await expect
      .poll(() => textLeafStyles(page))
      .toMatchObject({
        heading: { size: "24px" },
        paragraph: { size: "24px" },
      });
    await lineHeight.fill("32");
    await lineHeight.press("Enter");
    await expect
      .poll(() => textLeafStyles(page))
      .toMatchObject({
        heading: { lineHeight: "32px" },
        paragraph: { lineHeight: "32px" },
      });

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
    for (const sourceColor of ["#f4f4f5", "#a1a1aa"]) {
      await selectionColors
        .getByRole("button", { name: new RegExp(`^${sourceColor}$`, "i") })
        .click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await expect(hex).toBeVisible();
      await hex.fill("3366FF");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      await expect
        .poll(() => textLeafStyles(page))
        .toMatchObject(
          sourceColor === "#f4f4f5"
            ? { heading: { color: "rgb(51, 102, 255)" } }
            : { paragraph: { color: "rgb(51, 102, 255)" } },
        );
    }

    await expect
      .poll(() => textLeafStyles(page))
      .toEqual({
        heading: {
          family: "monospace",
          size: "24px",
          lineHeight: "32px",
          color: "rgb(51, 102, 255)",
        },
        paragraph: {
          family: "monospace",
          size: "24px",
          lineHeight: "32px",
          color: "rgb(51, 102, 255)",
        },
      });

    // Keep the multi-selection active for a second shared write so the next
    // history step is the style transaction, not a selection change.
    const undoSize = await sizeInput(page);
    await undoSize.fill("26");
    await undoSize.press("Enter");
    await expect
      .poll(() => textLeafStyles(page))
      .toMatchObject({
        heading: { size: "26px" },
        paragraph: { size: "26px" },
      });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect
      .poll(() => textLeafStyles(page))
      .toMatchObject({
        heading: { size: "24px" },
        paragraph: { size: "24px" },
      });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("Line Height Enter returns a real Text-tool range to the editor", async ({
  page,
}) => {
  const { designId, screenId } = await createBlankTextToolScreen(page);
  try {
    await page.setViewportSize({ width: 2800, height: 1600 });
    await gotoEditor(page, designId);

    const body = designFrame(page, screenId).locator("body");
    const bodyBox = await body.boundingBox();
    const card = page.locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
    );
    const cardBox = await card.boundingBox();
    if (!bodyBox || !cardBox)
      throw new Error("Text-tool Screen is not measurable");
    const screenWidth = await body.evaluate(
      (element) => element.ownerDocument.documentElement.clientWidth,
    );
    if (!screenWidth) throw new Error("Screen reported no content width");
    const scale = cardBox.width / screenWidth;

    const textTool = page.locator(
      '[data-design-bottom-toolbar] button[aria-label="Text"]',
    );
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(bodyBox.x + 120 * scale, bodyBox.y + 120 * scale);

    const editor = designFrame(page, screenId).locator(
      '[data-agent-native-text-editing="true"][contenteditable="true"]',
    );
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    await page.keyboard.type("E2E Hero Heading", { delay: 5 });
    const nodeId = await editor.getAttribute("data-agent-native-node-id");
    if (!nodeId) throw new Error("Text tool editor has no source node id");

    // Read-only text geometry guides a real pointer drag; the test never sets
    // the iframe's Selection programmatically.
    const points = await textToolRangePointerPoints(editor);
    await page.mouse.move(points.startX, points.y);
    await page.mouse.down();
    await page.mouse.move(points.endX, points.y, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(() =>
        editor.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");

    const lineHeight = page.locator('input[aria-label="Line height" i]');
    await expect(lineHeight).toHaveValue("120%");
    await lineHeight.fill("20%");
    await lineHeight.press("Enter");
    await expect(lineHeight).toHaveValue("20%");
    await expect(editor).toBeFocused();
    await expect
      .poll(() =>
        editor.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        editor.evaluate(() => {
          const selection = window.getSelection();
          return {
            collapsed: selection?.isCollapsed ?? false,
            offset: selection?.anchorOffset ?? -1,
          };
        }),
      )
      .toEqual({ collapsed: true, offset: 3 });

    await expect
      .poll(async () => {
        const html = await readSavedFileContent(page, designId, screenId);
        return page.evaluate(
          ({ content, selectedNodeId }) => {
            const doc = new DOMParser().parseFromString(content, "text/html");
            const node = doc.querySelector(
              `[data-agent-native-node-id="${CSS.escape(selectedNodeId)}"]`,
            );
            const run = node?.querySelector("span");
            return {
              text: run?.textContent ?? "",
              lineHeight: (run as HTMLElement | null)?.style.lineHeight ?? "",
            };
          },
          { content: html, selectedNodeId: nodeId },
        );
      })
      .toEqual({ text: "E2E", lineHeight: "20%" });

    await page.reload();
    const reloadedRange = designFrame(page, screenId).locator(
      `[data-agent-native-node-id="${nodeId}"] span`,
    );
    await expect(reloadedRange).toBeVisible();
    await expect(reloadedRange).toHaveText("E2E");
    await expect
      .poll(() =>
        reloadedRange.evaluate((element) => ({
          lineHeight: (element as HTMLElement).style.lineHeight,
          text: element.textContent,
        })),
      )
      .toEqual({ lineHeight: "20%", text: "E2E" });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("mouse-dragged text range commits line-height and survives reload", async ({
  page,
}) => {
  const designId = await createHtmlDesign(
    page,
    "Mouse text range commit",
    `<!doctype html><html><head><meta charset="utf-8" /></head><body style="margin:0;background:#fff"><h1 data-agent-native-node-id="mouse-range-heading" style="margin:80px;font-family:Arial,sans-serif;font-size:32px;font-weight:400;line-height:120%">E2E Hero Heading</h1></body></html>`,
  );
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "E2E Hero Heading");
    await page.keyboard.press("Enter");

    const heading = designFrame(page).locator("h1").first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    const points = await textToolRangePointerPoints(heading);
    await page.mouse.move(points.startX, points.y);
    await page.mouse.down();
    await page.mouse.move(points.endX, points.y, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const selection = element.ownerDocument.getSelection();
          const range = selection?.rangeCount
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
          return {
            text: selection?.toString() ?? "",
            collapsed: selection?.isCollapsed ?? true,
            visible: Boolean(range && range.width > 0 && range.height > 0),
          };
        }),
      )
      .toEqual({ text: "E2E", collapsed: false, visible: true });

    const lineHeight = page.locator('input[aria-label="Line height" i]');
    await expect(lineHeight).toHaveValue("120%");
    await lineHeight.fill("20%");
    await lineHeight.press("Enter");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");
    await expect
      .poll(
        async () =>
          (await savedHeadingRangeStyles(page, designId)).rangeLineHeight,
      )
      .toBe("20%");

    await page.reload();
    const reloadedHeading = designFrame(page).locator("h1").first();
    await expect(
      reloadedHeading.locator("span").filter({ hasText: "E2E" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await savedHeadingRangeStyles(page, designId)).rangeLineHeight,
      )
      .toBe("20%");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("mouse-dragged text range applies color and survives reload", async ({
  page,
}) => {
  const designId = await createHtmlDesign(
    page,
    "Mouse text range commit",
    `<!doctype html><html><head><meta charset="utf-8" /></head><body style="margin:0;background:#fff"><h1 data-agent-native-node-id="mouse-range-heading" style="margin:80px;font-family:Arial,sans-serif;font-size:32px;font-weight:400;line-height:120%">E2E Hero Heading</h1></body></html>`,
  );
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "E2E Hero Heading");
    await page.keyboard.press("Enter");

    const heading = designFrame(page).locator("h1").first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    const points = await textToolRangePointerPoints(heading);
    await page.mouse.move(points.startX, points.y);
    await page.mouse.down();
    await page.mouse.move(points.endX, points.y, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const selection = element.ownerDocument.getSelection();
          const range = selection?.rangeCount
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
          return {
            text: selection?.toString() ?? "",
            collapsed: selection?.isCollapsed ?? true,
            visible: Boolean(range && range.width > 0 && range.height > 0),
          };
        }),
      )
      .toEqual({ text: "E2E", collapsed: false, visible: true });

    const fillHeading = page.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    const fillSection = page
      .locator("section")
      .filter({ has: fillHeading })
      .first();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
    await hexInput.fill("3366FF");
    await hexInput.press("Enter");
    await expect(hexInput).toHaveValue("3366FF");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");
    await expect
      .poll(
        async () => (await savedHeadingRangeStyles(page, designId)).rangeColor,
      )
      .toBe("rgb(51, 102, 255)");

    await page.reload();
    const reloadedHeading = designFrame(page).locator("h1").first();
    await expect(
      reloadedHeading.locator("span").filter({ hasText: "E2E" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        reloadedHeading
          .locator("span")
          .filter({ hasText: "E2E" })
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(51, 102, 255)");
    await expect
      .poll(
        async () => (await savedHeadingRangeStyles(page, designId)).rangeColor,
      )
      .toBe("rgb(51, 102, 255)");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("Auto ArrowUp uses the selected nested range's normal line-height", async ({
  page,
}) => {
  const designId = await createHtmlDesign(
    page,
    "Nested range normal line-height",
    `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff;color:#111}body{padding:48px}</style></head><body>
      <h1 data-agent-native-node-id="nested-range-heading" style="margin:0;font-family:Inter,Arial,sans-serif;font-size:24px;font-weight:400;line-height:normal"><span data-agent-native-node-id="nested-range-text" style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:normal">E2E</span> Hero Heading</h1>
    </body></html>`,
  );

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    const normalLineHeights = await designFrame(page)
      .locator("body")
      .evaluate((body) => {
        const measure = (selector: string) => {
          const source = body.querySelector<HTMLElement>(selector);
          if (!source) throw new Error(`Missing text target: ${selector}`);
          const style = getComputedStyle(source);
          const probe = document.createElement("span");
          probe.dataset.agentNativeEditOverlay = "";
          Object.assign(probe.style, {
            all: "initial",
            position: "fixed",
            left: "-10000px",
            display: "inline-block",
            whiteSpace: "nowrap",
            width: "max-content",
            margin: "0",
            padding: "0",
            border: "0",
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            fontSize: style.fontSize,
            lineHeight: "normal",
          });
          probe.textContent = source.textContent || "Hg";
          body.append(probe);
          const height = probe.getBoundingClientRect().height;
          probe.remove();
          return height;
        };
        return {
          parent: measure("h1"),
          range: measure('[data-agent-native-node-id="nested-range-text"]'),
        };
      });
    expect(normalLineHeights.range).toBeLessThan(normalLineHeights.parent);

    await selectTextRange(page, "E2E Hero Heading", "E2E");
    const heading = designFrame(page).locator("h1").first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        headingSize: "24px",
        rangeSize: "16px",
        rangeWeight: "700",
        headingLineHeight: "normal",
        rangeLineHeight: "normal",
      });
    const typography = typographySection(page);
    await expect(await sizeInput(page)).toHaveValue("16px");
    await expect(typography.getByRole("combobox")).toContainText("Bold");

    const lineHeight = typography.locator('input[aria-label="Line height" i]');
    await expect(lineHeight).toHaveValue("Auto");
    await lineHeight.press("ArrowUp");
    const nextRangeLineHeight = `${normalLineHeights.range + 1}px`;
    await expect(lineHeight).toHaveValue(nextRangeLineHeight);
    await expect
      .poll(() => headingRangeStyles(page))
      .toMatchObject({
        headingSize: "24px",
        rangeSize: "16px",
        headingLineHeight: "normal",
        rangeLineHeight: nextRangeLineHeight,
      });
    await expect
      .poll(() => savedHeadingRangeStyles(page, designId))
      .toMatchObject({
        headingLineHeight: "normal",
        rangeLineHeight: nextRangeLineHeight,
      });
    await lineHeight.press("Enter");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("E2E");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => heading.evaluate(() => window.getSelection()?.isCollapsed))
      .toBe(true);
    await expect(await sizeInput(page)).toHaveValue("16px");
    await expect(typography.getByRole("combobox")).toContainText("Bold");
    await expect(lineHeight).toHaveValue(nextRangeLineHeight);
    await page.keyboard.press("ArrowRight");
    await expect(await sizeInput(page)).toHaveValue("24px");
    await expect(typography.getByRole("combobox")).toContainText("Regular");
    await expect(lineHeight).toHaveValue("Auto");
    await page.keyboard.press("Escape");
    await expect(await sizeInput(page)).toHaveValue("Mixed");
    await expect(typography.getByRole("combobox")).toContainText("Mixed");
    await expect(lineHeight).toHaveValue("Mixed");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("text range caret follows the active text leaf and exits to whole-layer Mixed", async ({
  page,
}) => {
  const designId = await createHtmlDesign(
    page,
    "Nested range authored line-height",
    `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff;color:#111}</style></head><body>
      <h1 data-agent-native-node-id="relative-range-parent" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:500px;height:80px;margin:0;font-family:Arial,sans-serif;font-size:24px;font-weight:400;line-height:30px"><span data-agent-native-node-id="relative-range-text" style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:150%">Nested E2E</span> Parent suffix</h1>
    </body></html>`,
  );

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await selectTextRange(page, "Nested E2E Parent suffix", "Nested E2E");
    const heading = designFrame(page).locator("h1").first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("Nested E2E");
    const typography = typographySection(page);
    await expect(await sizeInput(page)).toHaveValue("16px");
    await expect(typography.getByRole("combobox")).toContainText("Bold");
    const lineHeight = typography.locator('input[aria-label="Line height" i]');
    await expect(lineHeight).toHaveValue("150%");
    await typography
      .getByRole("button", { name: "Typography details" })
      .click();
    await expect(
      page.getByRole("switch", { name: "Truncate text" }),
    ).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Max lines" })).toHaveValue(
      "2",
    );
    await expect(
      page.getByRole("button", { name: "Fixed size", exact: true }),
    ).toHaveClass(/text-\[var\(--design-editor-accent-color\)\]/);
    await typography
      .getByRole("button", { name: "Typography details" })
      .click();
    await lineHeight.click();
    await lineHeight.press("Enter");
    await expect
      .poll(() =>
        heading.evaluate(() => window.getSelection()?.toString() ?? ""),
      )
      .toBe("Nested E2E");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => heading.evaluate(() => window.getSelection()?.isCollapsed))
      .toBe(true);
    await expect(await sizeInput(page)).toHaveValue("16px");
    await expect(typography.getByRole("combobox")).toContainText("Bold");
    await expect(lineHeight).toHaveValue("150%");
    await page.keyboard.press("ArrowRight");
    await expect(await sizeInput(page)).toHaveValue("24px");
    await expect(typography.getByRole("combobox")).toContainText("Regular");
    await expect(lineHeight).toHaveValue("30px");
    await page.keyboard.press("Escape");
    await expect(await sizeInput(page)).toHaveValue("Mixed");
    await expect(typography.getByRole("combobox")).toContainText("Mixed");
    await expect(lineHeight).toHaveValue("Mixed");
    await typography
      .getByRole("button", { name: "Typography details" })
      .click();
    await expect(
      page.getByRole("switch", { name: "Truncate text" }),
    ).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Max lines" })).toHaveValue(
      "2",
    );
  } finally {
    await deleteDesign(page, designId);
  }
});

test("collapsing a text range clears stale state before Typography edits", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Text selection reset parity",
  );
  try {
    await gotoEditor(page, designId);
    await selectHeadingRange(page);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        designFrame(page)
          .locator("h1")
          .first()
          .evaluate(() => window.getSelection()?.isCollapsed ?? false),
      )
      .toBe(true);
    await (await sizeInput(page)).fill("24");
    await (await sizeInput(page)).press("Enter");

    await expect
      .poll(() =>
        designFrame(page)
          .locator("h1")
          .first()
          .evaluate((element) => {
            const heading = element as HTMLElement;
            return {
              size: getComputedStyle(heading).fontSize,
              styledRange: [...heading.querySelectorAll("span")].some(
                (span) => span.textContent === "E2E",
              ),
            };
          }),
      )
      .toEqual({ size: "24px", styledRange: false });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("nested unregistered text shows Typography and omits Add fill", async ({
  page,
}) => {
  const designId = await createHtmlDesign(
    page,
    "Nested text inspector parity",
    `<!doctype html><html><body style="margin:0;padding:32px;background:#111;color:#fff">
      <div data-agent-native-node-id="nested-card" data-agent-native-layer-name="Nested card" style="display:flex;width:320px;height:120px;padding:20px;background:#333">
        <div data-agent-native-node-id="draft-text-1789241921693-bxs6h7" data-agent-native-layer-name="Nested text primitive" style="display:flex;width:180px;height:24px;font-size:16px;color:#fff">Nested text primitive</div>
      </div>
    </body></html>`,
  );
  try {
    await gotoEditor(page, designId);
    const payload = await selectByText(page, "Nested text primitive");
    expect(payload.primitiveKind).toBeUndefined();
    await expect(typographySection(page)).toBeVisible();
    const fillHeading = page.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    const fillSection = page
      .locator("section")
      .filter({ has: fillHeading })
      .first();
    await expect(
      fillSection.getByRole("button", { name: "Add fill" }),
    ).toHaveCount(0);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("keyboard, Appearance, layer visibility and opacity remain independent", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Visibility interaction parity",
  );
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "E2E Hero Heading");
    const frame = designFrame(page);
    const heading = frame.locator("h1").first();
    const appearanceHeading = page.getByRole("heading", {
      name: "Appearance",
      exact: true,
    });
    const appearance = page
      .locator("section")
      .filter({ has: appearanceHeading })
      .first();
    const layerRow = page
      .getByRole("treeitem")
      .filter({ hasText: "E2E Hero Heading" })
      .first();
    const shortcut = `${MOD}+Shift+h`;
    const initialDisplay = await heading.evaluate(
      (element) => getComputedStyle(element).display,
    );
    const opacityInput = appearance.locator('input[aria-label="Opacity" i]');

    await page.keyboard.press(shortcut);
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe("none");
    await page.keyboard.press(shortcut);
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe(initialDisplay);

    await appearance.getByRole("button", { name: "Hide", exact: true }).click();
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe("none");
    await layerRow.locator('button[aria-label="Show layer"]').click();
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe(initialDisplay);

    await page.keyboard.press(shortcut);
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe("none");
    await page.keyboard.press(shortcut);
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe(initialDisplay);

    await opacityInput.fill("0");
    await opacityInput.press("Enter");
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("0");
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).display),
      )
      .toBe(initialDisplay);
    await opacityInput.fill("100");
    await opacityInput.press("Enter");
  } finally {
    await deleteDesign(page, designId);
  }
});
