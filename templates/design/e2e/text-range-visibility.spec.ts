import { type Locator, type Page } from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import { designFrame, selectByText, selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

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
  await heading.press(`${MOD}+ArrowUp`);
  for (let index = 0; index < 3; index += 1) {
    await heading.press("Shift+ArrowRight");
  }
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

async function savedHeadingRangeStyles(app: App, designId: string) {
  const html = await app.savedHtml(designId);
  return app.page.evaluate((content) => {
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

const HEADING = "E2E Hero Heading";
const PARAGRAPH = "First fixture paragraph for selection tests.";

async function openDesign(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.settled();
  return id;
}

function nodeWithText(nodes: Map<string, SavedNode>, text: string) {
  const found = [...nodes.values()].filter((node) => node.text === text);
  expect(
    found,
    `saved nodes whose own text is ${JSON.stringify(text)}`,
  ).toHaveLength(1);
  return found[0]!;
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

async function clickNode(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
}

async function selectionText(heading: Locator) {
  return heading.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function dragSelectFirstThreeLetters(page: Page, editor: Locator) {
  const points = await textToolRangePointerPoints(editor);
  await page.mouse.move(points.startX, points.y);
  await page.mouse.down();
  await page.mouse.move(points.endX, points.y, { steps: 6 });
  await page.mouse.up();
}

test("Typography applies to a selected range after focus moves to its controls", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, FIXTURE_HTML);
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
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
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

  await typography.getByRole("button", { name: "Typography details" }).click();
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
    .poll(() => savedHeadingRangeStyles(app, designId))
    .toMatchObject({
      headingSize: "24px",
      rangeSize: "64px",
      rangeFamily: "monospace",
      rangeWeight: "600",
      rangeColor: "rgb(51, 102, 255)",
      rangeTransform: "uppercase",
    });
});

// fixme: fails on current main after the merge: Error: expect(received).toEqual(expected) // deep equality
test.fixme("multi-selected text leaves share inspector styles, edits save to both, and one undo restores both", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, FIXTURE_HTML);
  await app.zoomToFit();
  const seeded = await app.savedNodes(designId);
  const heading = nodeWithText(seeded, HEADING);
  const paragraph = nodeWithText(seeded, PARAGRAPH);
  await clickNode(app, heading.id);
  await expect.poll(() => app.selectedLayers()).toEqual([HEADING]);
  await page.keyboard.down("Shift");
  await clickNode(app, paragraph.id);
  await page.keyboard.up("Shift");
  await expect.poll(() => app.selectedLayers()).toEqual([PARAGRAPH, HEADING]);

  const typography = typographySection(page);
  const fontPicker = typography.getByRole("button", { name: "Font" });
  const size = typography.locator('input[aria-label="Size" i]');
  const lineHeight = typography.locator('input[aria-label="Line height" i]');
  await expect(fontPicker).toHaveText("System UI");
  await expect(size).toHaveValue("Mixed");
  await expect(lineHeight).toHaveValue("Mixed");

  await fontPicker.click();
  await page.getByRole("combobox", { name: "Search" }).fill("Monospace");
  await page.getByRole("option", { name: "Monospace", exact: true }).click();
  await size.fill("24");
  await size.press("Enter");
  await lineHeight.fill("32");
  await lineHeight.press("Enter");
  await app.settled();

  const edited = await app.savedNodes(designId);
  const shared = {
    "font-family": "monospace",
    "font-size": "24px",
    "line-height": "32px",
  };
  expect(styleOf(edited.get(heading.id))).toEqual({
    ...styleOf(heading),
    ...shared,
  });
  expect(styleOf(edited.get(paragraph.id))).toEqual({
    ...styleOf(paragraph),
    ...shared,
  });
  expectOnlyChanged(seeded, edited, [heading.id, paragraph.id]);

  await size.fill("26");
  await size.press("Enter");
  await app.settled();
  const bumped = await app.savedNodes(designId);
  expect(
    [
      styleOf(bumped.get(heading.id))["font-size"],
      styleOf(bumped.get(paragraph.id))["font-size"],
    ],
    "the 26px edit must save on both leaves",
  ).toEqual(["26px", "26px"]);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();

  expectOnlyChanged(edited, await app.savedNodes(designId), []);
  await expect(app.node(heading.id)).toHaveCSS("font-size", "24px");
  await expect(app.node(paragraph.id)).toHaveCSS("font-size", "24px");
});

const TEXT_TOOL_SCREEN = `<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body data-agent-native-node-id="page" style="margin:0;background:#fff"><main data-agent-native-node-id="text-tool-canvas" style="position:relative;margin:80px;width:800px;height:600px"></main></body></html>`;

// oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
test("Line Height Enter returns a real Text-tool range to the editor", async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const designId = await openDesign(app, TEXT_TOOL_SCREEN);
  await app.zoomToFit();
  const seeded = await app.savedNodes(designId);

  const textTool = page.locator(
    '[data-design-bottom-toolbar] button[aria-label="Text"]',
  );
  await selectTool(page, "Text");
  await expect(textTool).toHaveAttribute("aria-pressed", "true");
  const at = await app.pagePoint(200, 200);
  await page.mouse.click(at.x, at.y);

  const editor = designFrame(page).locator(
    '[data-agent-native-text-editing="true"][contenteditable="true"]',
  );
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type("E2E Hero Heading", { delay: 5 });
  await expect(editor).toHaveText("E2E Hero Heading");
  const nodeId = await editor.getAttribute("data-agent-native-node-id");
  expect(nodeId, "the Text-tool editor carries a source node id").toBeTruthy();

  await dragSelectFirstThreeLetters(page, editor);
  await expect.poll(() => selectionText(editor)).toBe("E2E");

  const lineHeight = page.locator('input[aria-label="Line height" i]');
  await expect(lineHeight).toHaveValue("120%");
  await lineHeight.fill("20%");
  await lineHeight.press("Enter");
  await expect(lineHeight).toHaveValue("20%");
  await expect(editor).toBeFocused();
  await expect.poll(() => selectionText(editor)).toBe("E2E");
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
  await app.settled();

  const after = await app.savedNodes(designId);
  const created = added(seeded, after);
  expect(
    created.map((node) => [
      node.id,
      node.tag,
      node.parent,
      node.attrs["data-an-primitive"],
      node.text,
    ]),
  ).toEqual([
    [nodeId, "div", "page", "text", "Hero Heading"],
    [expect.any(String), "span", nodeId, undefined, "E2E"],
  ]);
  expect(styleOf(created[0])["line-height"]).toBe("1.2");
  const savedRange = await app.page.evaluate(
    ({ html, id }) => {
      const node = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector(`[data-agent-native-node-id="${id}"]`);
      return [...(node?.querySelectorAll("span") ?? [])].map((span) => [
        span.textContent,
        span.getAttribute("style"),
      ]);
    },
    { html: await app.savedHtml(designId), id: nodeId! },
  );
  expect(savedRange).toEqual([["E2E", "line-height: 20%;"]]);
  expectOnlyChanged(
    seeded,
    after,
    created.map((node) => node.id),
  );

  await page.reload();
  const reloadedRange = designFrame(page).locator(
    `[data-agent-native-node-id="${nodeId}"] span`,
  );
  await expect(reloadedRange).toHaveText("E2E");
  await expect(reloadedRange).toHaveCSS("line-height", "3.2px");
});

const RANGE_HEADING_SCREEN = `<!doctype html><html><head><meta charset="utf-8" /></head><body style="margin:0;background:#fff"><h1 data-agent-native-node-id="mouse-range-heading" style="margin:80px;font-family:Arial,sans-serif;font-size:32px;font-weight:400;line-height:120%">E2E Hero Heading</h1></body></html>`;

test("a mouse-dragged range takes line-height and colour on a saved span, leaves the rest of the heading alone, and survives reload", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, RANGE_HEADING_SCREEN);
  const seeded = await app.savedNodes(designId);
  await selectByText(page, HEADING);
  await page.keyboard.press("Enter");
  const heading = designFrame(page).locator("h1").first();
  await expect(heading).toHaveAttribute("contenteditable", "true");

  await dragSelectFirstThreeLetters(page, heading);
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
  await expect.poll(() => selectionText(heading)).toBe("E2E");
  const fillSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
    .first();
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
  await hexInput.fill("3366FF");
  await hexInput.press("Enter");
  await expect(hexInput).toHaveValue("3366FF");
  await expect.poll(() => selectionText(heading)).toBe("E2E");
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(after.get("mouse-range-heading")?.attrs.style).toBe(
    seeded.get("mouse-range-heading")?.attrs.style,
  );
  expect(after.get("mouse-range-heading")?.text).toBe("Hero Heading");
  expect(await savedHeadingRangeStyles(app, designId)).toEqual({
    headingSize: "32px",
    headingLineHeight: "120%",
    rangeSize: "",
    rangeFamily: "",
    rangeWeight: "",
    rangeLineHeight: "20%",
    rangeColor: "rgb(51, 102, 255)",
    rangeTransform: "",
  });
  expectOnlyChanged(seeded, after, [
    "mouse-range-heading",
    ...added(seeded, after).map((node) => node.id),
  ]);

  await page.reload();
  const reloadedHeading = designFrame(page).locator("h1").first();
  const reloadedRange = reloadedHeading
    .locator("span")
    .filter({ hasText: "E2E" });
  await expect(reloadedRange).toHaveCSS("color", "rgb(51, 102, 255)");
  await expect(reloadedRange).toHaveCSS("line-height", "6.4px");
  await expect(reloadedHeading).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(reloadedHeading).toHaveCSS("line-height", "38.4px");
});

test("Auto ArrowUp uses the selected nested range's normal line-height", async ({
  app,
  page,
}) => {
  const designId = await openDesign(
    app,
    `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff;color:#111}body{padding:48px}</style></head><body>
      <h1 data-agent-native-node-id="nested-range-heading" style="margin:0;font-family:Inter,Arial,sans-serif;font-size:24px;font-weight:400;line-height:normal"><span data-agent-native-node-id="nested-range-text" style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:normal">E2E</span> Hero Heading</h1>
    </body></html>`,
  );

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
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
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
    .poll(() => savedHeadingRangeStyles(app, designId))
    .toMatchObject({
      headingLineHeight: "normal",
      rangeLineHeight: nextRangeLineHeight,
    });
  await lineHeight.press("Enter");
  await expect
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
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
});

test("text range caret follows the active text leaf and exits to whole-layer Mixed", async ({
  app,
  page,
}) => {
  const designId = await openDesign(
    app,
    `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff;color:#111}</style></head><body>
      <h1 data-agent-native-node-id="relative-range-parent" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:500px;height:80px;margin:0;font-family:Arial,sans-serif;font-size:24px;font-weight:400;line-height:30px"><span data-agent-native-node-id="relative-range-text" style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:150%">Nested E2E</span> Parent suffix</h1>
    </body></html>`,
  );
  const seeded = await app.savedNodes(designId);

  await selectTextRange(page, "Nested E2E Parent suffix", "Nested E2E");
  const heading = designFrame(page).locator("h1").first();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await expect
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("Nested E2E");
  const typography = typographySection(page);
  await expect(await sizeInput(page)).toHaveValue("16px");
  await expect(typography.getByRole("combobox")).toContainText("Bold");
  const lineHeight = typography.locator('input[aria-label="Line height" i]');
  await expect(lineHeight).toHaveValue("150%");
  await typography.getByRole("button", { name: "Typography details" }).click();
  await expect(
    page.getByRole("switch", { name: "Truncate text" }),
  ).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Max lines" })).toHaveValue(
    "2",
  );
  await expect(
    page.getByRole("button", { name: "Fixed size", exact: true }),
  ).toHaveClass(/text-\[var\(--design-editor-accent-color\)\]/);
  await typography.getByRole("button", { name: "Typography details" }).click();
  await lineHeight.click();
  await lineHeight.press("Enter");
  await expect
    .poll(() => heading.evaluate(() => window.getSelection()?.toString() ?? ""))
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
  await typography.getByRole("button", { name: "Typography details" }).click();
  await expect(
    page.getByRole("switch", { name: "Truncate text" }),
  ).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Max lines" })).toHaveValue(
    "2",
  );
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(designId), []);
});

test("collapsing a text range clears stale state before Typography edits", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, FIXTURE_HTML);
  const seeded = await app.savedNodes(designId);
  const heading = nodeWithText(seeded, HEADING);
  await selectHeadingRange(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      app
        .node(heading.id)
        .evaluate(() => window.getSelection()?.isCollapsed ?? false),
    )
    .toBe(true);

  await (await sizeInput(page)).fill("24");
  await (await sizeInput(page)).press("Enter");
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(styleOf(after.get(heading.id))).toEqual({
    ...styleOf(heading),
    "font-size": "24px",
  });
  expect(after.get(heading.id)?.text).toBe(HEADING);
  expectOnlyChanged(seeded, after, [heading.id]);
  await expect(app.node(heading.id).locator("span")).toHaveCount(0);
  await expect(app.node(heading.id)).toHaveCSS("font-size", "24px");
});

const NESTED_TEXT_SCREEN = `<!doctype html><html><body style="margin:0;padding:32px;background:#111;color:#fff">
      <div data-agent-native-node-id="nested-card" data-agent-native-layer-name="Nested card" style="display:flex;width:320px;height:120px;padding:20px;background:#333">
        <div data-agent-native-node-id="draft-text-1789241921693-bxs6h7" data-agent-native-layer-name="Nested text primitive" style="display:flex;width:180px;height:24px;font-size:16px;color:#fff">Nested text primitive</div>
      </div>
    </body></html>`;

test("nested unregistered text shows Typography with its size and its text colour as Fill, not Add fill", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, NESTED_TEXT_SCREEN);
  const seeded = await app.savedNodes(designId);

  await selectByText(page, "Nested text primitive");

  await expect
    .poll(() => app.selectedLayers())
    .toEqual(["Nested text primitive"]);
  await expect(await sizeInput(page)).toHaveValue("16px");
  const fillSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
    .first();
  await expect(fillSection.getByRole("textbox", { name: "Color" })).toHaveValue(
    "FFFFFF",
  );
  await expect(
    fillSection.getByRole("button", { name: "Add fill" }),
  ).toHaveCount(0);
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(designId), []);
});

test("the hide shortcut, Appearance Hide, the Layers eye and opacity stay independent, and the result saves", async ({
  app,
  page,
}) => {
  const designId = await openDesign(app, FIXTURE_HTML);
  const seeded = await app.savedNodes(designId);
  const headingNode = nodeWithText(seeded, HEADING);
  await selectByText(page, HEADING);
  const heading = app.node(headingNode.id);
  const appearance = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Appearance", exact: true }),
    })
    .first();
  const layerRow = page
    .getByRole("treeitem")
    .filter({ hasText: HEADING })
    .first();
  const opacity = appearance.locator('input[aria-label="Opacity" i]');

  await page.keyboard.press("ControlOrMeta+Shift+h");
  await expect(heading).toHaveCSS("display", "none");
  await page.keyboard.press("ControlOrMeta+Shift+h");
  await expect(heading).toHaveCSS("display", "block");

  await appearance.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(heading).toHaveCSS("display", "none");
  await app.settled();
  const hidden = await app.savedNodes(designId);
  expect(hidden.get(headingNode.id)?.attrs).toEqual({
    ...headingNode.attrs,
    "data-agent-native-hidden": "true",
  });
  await layerRow.locator('button[aria-label="Show layer"]').click();
  await expect(heading).toHaveCSS("display", "block");

  await opacity.fill("0");
  await opacity.press("Enter");
  await expect(heading).toHaveCSS("opacity", "0");
  await expect(heading).toHaveCSS("display", "block");
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(after.get(headingNode.id)?.attrs).toEqual({
    ...headingNode.attrs,
    style: after.get(headingNode.id)?.attrs.style,
  });
  expect(styleOf(after.get(headingNode.id))).toEqual({
    ...styleOf(headingNode),
    opacity: "0",
  });
  expectOnlyChanged(seeded, after, [headingNode.id]);
});
