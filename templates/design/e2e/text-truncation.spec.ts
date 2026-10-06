import { writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  selectByText,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CLASS_TITLE =
  "A stylesheet title that continues across several lines while editing";
const INLINE_TITLE =
  "An inline title that continues across several lines while editing";
const FIXED_TITLE = "A fixed title with an existing one-line clamp";

const TRUNCATION_FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      .class-title {
        display: inline-block;
        overflow: clip;
      }
    </style>
  </head>
  <body>
    <h1 data-agent-native-node-id="class-title" class="class-title" style="width:182px;height:auto;white-space:normal;margin:0 0 28px;font:700 16px/20px Arial,sans-serif">${CLASS_TITLE}</h1>
    <h1 data-agent-native-node-id="inline-title" style="display:inline-block;overflow:clip;width:182px;height:auto;margin:0 0 28px;font:700 16px/20px Arial,sans-serif">${INLINE_TITLE}</h1>
    <h1 data-agent-native-node-id="fixed-title" style="display:-webkit-box;overflow:hidden;width:182px;height:20px;margin:0;font:700 16px/20px Arial,sans-serif;-webkit-box-orient:vertical;-webkit-line-clamp:1;--agent-native-truncate-original-display:&quot;inline-block&quot;;--agent-native-truncate-original-overflow:&quot;clip&quot;">${FIXED_TITLE}</h1>
  </body>
</html>`;

type DesignFile = { id: string; filename?: string; content?: string };
type DesignRecord = { files?: DesignFile[] };

async function postAction(
  page: Page,
  action: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${action}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${action} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function prepareDesign(page: Page) {
  const designId = await createFixtureDesign(page, "Text truncation proof");
  try {
    const response = await page.request.get(
      appPath(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      ),
    );
    if (!response.ok()) throw new Error(await response.text());
    const design = (await response.json()) as DesignRecord;
    const file = design.files?.find(
      (candidate) => candidate.filename === "index.html",
    );
    if (!file?.id) throw new Error("design is missing index.html");
    await postAction(page, "update-file", {
      id: file.id,
      content: TRUNCATION_FIXTURE,
    });
    return designId;
  } catch (error) {
    await postAction(page, "delete-design", { id: designId });
    throw error;
  }
}

function title(page: Page, nodeId: string) {
  return designFrame(page).locator(`[data-agent-native-node-id="${nodeId}"]`);
}

async function openTruncationBasics(page: Page) {
  await page.getByRole("button", { name: "Typography details" }).click();
  await page.getByRole("tab", { name: "Basics" }).click();
  await expect(
    page.getByRole("switch", { name: "Truncate text" }),
  ).toBeVisible();
}

async function closeTypographyDetails(page: Page) {
  const details = page.getByRole("button", { name: "Typography details" });
  if ((await details.getAttribute("aria-pressed")) === "true") {
    await details.click();
  }
}

async function selectLayer(page: Page, layerName: string) {
  await page.getByRole("button", { name: layerName, exact: true }).click();
  const row = page.getByRole("treeitem").filter({ hasText: layerName }).last();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function readStyle(page: Page, nodeId: string, property: string) {
  return title(page, nodeId).evaluate((element, name) => {
    const style = getComputedStyle(element);
    return style.getPropertyValue(name);
  }, property);
}

async function readInlineStyle(page: Page, nodeId: string, property: string) {
  return title(page, nodeId).evaluate((element, name) => {
    return (element as HTMLElement).style.getPropertyValue(name);
  }, property);
}

async function readSource(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(await response.text());
  const design = (await response.json()) as DesignRecord;
  const content = design.files?.find(
    (file) => file.filename === "index.html",
  )?.content;
  if (!content) throw new Error("design is missing index.html content");
  return content;
}

async function prepareBlankDesign(page: Page) {
  const designId = await createFixtureDesign(page, "Fresh title truncation");
  try {
    const response = await page.request.get(
      appPath(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      ),
    );
    if (!response.ok()) throw new Error(await response.text());
    const design = (await response.json()) as DesignRecord;
    const file = design.files?.find(
      (candidate) => candidate.filename === "index.html",
    );
    if (!file?.id) throw new Error("design is missing index.html");
    await postAction(page, "update-file", {
      id: file.id,
      content:
        '<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body style="margin:0;background:#fff"><main data-agent-native-node-id="fresh-title-canvas" style="position:relative;margin:80px;width:800px;height:600px"></main></body></html>',
    });
    return { designId, screenId: file.id };
  } catch (error) {
    await postAction(page, "delete-design", { id: designId });
    throw error;
  }
}

function nodeTag(source: string, nodeId: string) {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = source.match(
    new RegExp(`<[^>]*data-agent-native-node-id=["']${escaped}["'][^>]*>`),
  )?.[0];
  if (!tag) throw new Error(`source is missing node ${nodeId}`);
  return tag;
}

function inlineValue(source: string, nodeId: string, property: string) {
  const tag = nodeTag(source, nodeId);
  const style = tag.match(/\sstyle=(['"])(.*?)\1/i)?.[2] ?? "";
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    style
      .match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "i"))?.[1]
      ?.trim() ?? ""
  );
}

async function setMaxLines(page: Page, count: number) {
  const input = page.getByRole("textbox", { name: "Max lines" });
  await input.fill(String(count));
  await input.press("Enter");
  await expect(input).toHaveValue(String(count));
}

async function expectClamp(page: Page, nodeId: string, count: string) {
  await expect
    .poll(() => readStyle(page, nodeId, "-webkit-line-clamp"))
    .toBe(count);
  await expect.poll(() => readStyle(page, nodeId, "overflow")).toBe("hidden");
  await expect
    .poll(() => readInlineStyle(page, nodeId, "display"))
    .toBe("-webkit-box");
}

async function assertTitleVisibleInCanvas(page: Page, nodeId: string) {
  const titleBox = await title(page, nodeId).boundingBox();
  const surfaceBox = await page
    .locator("[data-multi-screen-canvas-world]")
    .locator("..")
    .boundingBox();
  const sidebarBox = await page.locator("[data-layers-panel]").boundingBox();
  if (!titleBox || !surfaceBox || !sidebarBox) {
    throw new Error("canvas title, surface, or Layers panel is not measurable");
  }
  expect(titleBox.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width);
  expect(titleBox.y).toBeGreaterThanOrEqual(surfaceBox.y);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
    surfaceBox.x + surfaceBox.width,
  );
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(
    surfaceBox.y + surfaceBox.height,
  );
  return { titleBox, surfaceBox, sidebarBox };
}

async function zoomAndPanTitleIntoCanvas(page: Page, nodeId: string) {
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

  const world = page.locator("[data-multi-screen-canvas-world]");
  await expect(world).toHaveCount(1);
  const surface = world.locator("..");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const titleBox = await title(page, nodeId).boundingBox();
    const surfaceBox = await surface.boundingBox();
    const sidebarBox = await page.locator("[data-layers-panel]").boundingBox();
    if (!titleBox || !surfaceBox || !sidebarBox) {
      throw new Error(
        "canvas title, surface, or Layers panel is not measurable",
      );
    }
    const isVisible =
      titleBox.x > sidebarBox.x + sidebarBox.width &&
      titleBox.y >= surfaceBox.y &&
      titleBox.x + titleBox.width <= surfaceBox.x + surfaceBox.width &&
      titleBox.y + titleBox.height <= surfaceBox.y + surfaceBox.height;
    if (isVisible) {
      await assertTitleVisibleInCanvas(page, nodeId);
      await page.mouse.move(
        surfaceBox.x + surfaceBox.width - 24,
        surfaceBox.y + surfaceBox.height - 24,
      );
      return;
    }

    const deltaX =
      surfaceBox.x + surfaceBox.width / 2 - (titleBox.x + titleBox.width / 2);
    const deltaY =
      surfaceBox.y + surfaceBox.height / 2 - (titleBox.y + titleBox.height / 2);
    const moveX = Math.max(-320, Math.min(320, deltaX));
    const moveY = Math.max(-280, Math.min(280, deltaY));
    const startX = surfaceBox.x + surfaceBox.width / 2;
    const startY = surfaceBox.y + surfaceBox.height / 2;
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.keyboard.down("Space");
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + moveX, startY + moveY, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");
  }

  await assertTitleVisibleInCanvas(page, nodeId);
}

test(
  "text truncation restores authored styles through Undo, reload, and text editing",
  {},
  async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const designId = await prepareDesign(page);
    try {
      await page.setViewportSize({ width: 2800, height: 1600 });
      await gotoEditor(page, designId);
      await selectByText(page, CLASS_TITLE);
      await openTruncationBasics(page);

      const classTitle = title(page, "class-title");
      await expect
        .poll(() => readStyle(page, "class-title", "display"))
        .toBe("inline-block");
      await expect
        .poll(() => readStyle(page, "class-title", "overflow"))
        .toBe("clip");
      const classToggle = page.getByRole("switch", { name: "Truncate text" });
      await classToggle.click();
      await expect(classToggle).toBeChecked();
      await expectClamp(page, "class-title", "1");
      await setMaxLines(page, 2);
      await expectClamp(page, "class-title", "2");
      await closeTypographyDetails(page);
      await zoomAndPanTitleIntoCanvas(page, "class-title");
      await selectLayer(page, CLASS_TITLE);
      await assertTitleVisibleInCanvas(page, "class-title");
      await openTruncationBasics(page);

      const enabledSource = await readSource(page, designId);
      expect(
        inlineValue(enabledSource, "class-title", "-webkit-line-clamp"),
      ).toBe("2");
      expect(
        inlineValue(
          enabledSource,
          "class-title",
          "--agent-native-truncate-original-display",
        ),
      ).not.toBe("");
      await cdpScreenshot(
        page,
        testInfo.outputPath("class-title-truncated.png"),
      );
      await classTitle.screenshot({
        path: testInfo.outputPath("class-title-truncated-element.png"),
      });
      await expect
        .poll(async () =>
          inlineValue(
            await readSource(page, designId),
            "class-title",
            "-webkit-line-clamp",
          ),
        )
        .toBe("2");

      await page.reload();
      await zoomAndPanTitleIntoCanvas(page, "class-title");
      await selectLayer(page, CLASS_TITLE);
      await assertTitleVisibleInCanvas(page, "class-title");
      await openTruncationBasics(page);
      await expect(
        page.getByRole("switch", { name: "Truncate text" }),
      ).toBeChecked();
      await expect(
        page.getByRole("textbox", { name: "Max lines" }),
      ).toHaveValue("2");
      await expectClamp(page, "class-title", "2");

      await closeTypographyDetails(page);
      const beforeEdit = await classTitle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      await selectByText(page, CLASS_TITLE);
      await page.keyboard.press("Enter");
      const editable = designFrame(page).locator(
        '[data-agent-native-text-editing="true"]',
      );
      await expect(editable).toBeVisible();
      const duringEdit = await classTitle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          clamp:
            getComputedStyle(element).getPropertyValue("-webkit-line-clamp"),
          overflow: getComputedStyle(element).overflow,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      });
      expect(duringEdit.clamp).toBe("none");
      expect(duringEdit.overflow).toBe("visible");
      expect(duringEdit.width).toBeCloseTo(beforeEdit.width, 0);
      expect(duringEdit.height).toBeCloseTo(beforeEdit.height, 0);
      expect(duringEdit.scrollHeight).toBeGreaterThan(duringEdit.clientHeight);
      await assertTitleVisibleInCanvas(page, "class-title");
      await cdpScreenshot(page, testInfo.outputPath("class-title-editing.png"));
      await classTitle.screenshot({
        path: testInfo.outputPath("class-title-editing-element.png"),
      });
      await page.keyboard.press(`${MOD}+End`);
      await page.keyboard.insertText("!");
      await page.keyboard.press("Escape");
      await expect(editable).toHaveCount(0);
      await expect(title(page, "class-title")).toContainText("!");
      await expectClamp(page, "class-title", "2");
      await assertTitleVisibleInCanvas(page, "class-title");
      await cdpScreenshot(
        page,
        testInfo.outputPath("class-title-reclipped.png"),
      );
      await classTitle.screenshot({
        path: testInfo.outputPath("class-title-reclipped-element.png"),
      });

      await openTruncationBasics(page);
      const classToggleAfterEdit = page.getByRole("switch", {
        name: "Truncate text",
      });
      await classToggleAfterEdit.click();
      await expect(classToggleAfterEdit).not.toBeChecked();
      await expect
        .poll(() => readStyle(page, "class-title", "display"))
        .toBe("inline-block");
      await expect
        .poll(() => readStyle(page, "class-title", "overflow"))
        .toBe("clip");
      await expect
        .poll(async () =>
          inlineValue(
            await readSource(page, designId),
            "class-title",
            "-webkit-line-clamp",
          ),
        )
        .toBe("none");
      await expect
        .poll(async () =>
          inlineValue(
            await readSource(page, designId),
            "class-title",
            "--agent-native-truncate-original-display",
          ),
        )
        .toBe("initial");

      await page.getByRole("button", { name: "Move", exact: true }).click();
      await page.keyboard.press(`${MOD}+z`);
      await expectClamp(page, "class-title", "2");
      await page.reload();
      await selectLayer(page, `${CLASS_TITLE}!`);
      await expectClamp(page, "class-title", "2");

      await selectLayer(page, INLINE_TITLE);
      await openTruncationBasics(page);
      const inlineToggle = page.getByRole("switch", { name: "Truncate text" });
      await inlineToggle.click();
      await expect(inlineToggle).toBeChecked();
      await expectClamp(page, "inline-title", "1");
      const inlineSource = await readSource(page, designId);
      expect(
        inlineValue(
          inlineSource,
          "inline-title",
          "--agent-native-truncate-original-display",
        ),
      ).not.toBe("");
      await expect
        .poll(() =>
          readInlineStyle(
            page,
            "inline-title",
            "--agent-native-truncate-original-display",
          ),
        )
        .toContain("inline-block");
      await page.reload();
      await selectLayer(page, INLINE_TITLE);
      await openTruncationBasics(page);
      await expect(
        page.getByRole("switch", { name: "Truncate text" }),
      ).toBeChecked();
      await expectClamp(page, "inline-title", "1");
      const reloadedInlineBackup = await readInlineStyle(
        page,
        "inline-title",
        "--agent-native-truncate-original-display",
      );
      expect(reloadedInlineBackup).toContain("inline-block");
      const reloadedInlineToggle = page.getByRole("switch", {
        name: "Truncate text",
      });
      await reloadedInlineToggle.click();
      await expect(reloadedInlineToggle).not.toBeChecked();
      await expect
        .poll(() => readStyle(page, "inline-title", "display"))
        .toBe("inline-block");
      await expect
        .poll(() => readStyle(page, "inline-title", "overflow"))
        .toBe("clip");

      await selectLayer(page, FIXED_TITLE);
      await openTruncationBasics(page);
      await expect(
        page.getByRole("switch", { name: "Truncate text" }),
      ).toBeChecked();
      const fixedMaxLines = page.getByRole("textbox", { name: "Max lines" });
      await expect(fixedMaxLines).toBeDisabled();
      const fixedToggle = page.getByRole("switch", {
        name: "Truncate text",
      });
      await fixedToggle.click();
      await expect(fixedToggle).not.toBeChecked();
      await expect
        .poll(() => readStyle(page, "fixed-title", "display"))
        .toBe("inline-block");
      await expect
        .poll(() => readStyle(page, "fixed-title", "overflow"))
        .toBe("clip");
    } finally {
      await postAction(page, "delete-design", { id: designId });
    }
  },
);

test(
  "a freshly created title keeps truncation controls in sync without reselection",
  {},
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { designId, screenId } = await prepareBlankDesign(page);
    try {
      await page.setViewportSize({ width: 2800, height: 1600 });
      await gotoEditor(page, designId);

      const body = designFrame(page, screenId).locator("body");
      const bodyBox = await body.boundingBox();
      const card = page.locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
      );
      const cardBox = await card.boundingBox();
      if (!bodyBox || !cardBox) {
        throw new Error("fresh-title Screen canvas is not measurable");
      }
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
      const freshTitle = `A newly created title that needs truncation ${Date.now()}`;
      await page.keyboard.type(freshTitle, { delay: 4 });
      await page.keyboard.press("Escape");
      await expect(editor).toHaveCount(0);

      const selection = await page.evaluate(() => {
        const selected = (window as any).__designSelection?.selectedElement;
        return selected
          ? {
              sourceId: selected.sourceId,
              sourceLayerIdentity: selected.sourceLayerIdentity,
              textContent: selected.textContent,
              hasPortableStyleSnapshot: selected.portableStyleSnapshot != null,
            }
          : null;
      });
      await testInfo.attach("fresh-title-selection", {
        body: JSON.stringify({ designId, screenId, selection }),
        contentType: "application/json",
      });
      const renderedTitle = designFrame(page, screenId)
        .locator("[data-agent-native-node-id]")
        .filter({ hasText: freshTitle })
        .last();
      await expect(renderedTitle).toContainText(freshTitle);
      const nodeId = await renderedTitle.getAttribute(
        "data-agent-native-node-id",
      );
      expect(nodeId).toBeTruthy();
      await page.getByRole("button", { name: "Typography details" }).click();
      const details = page.getByRole("dialog");
      await details.getByRole("tab", { name: "Basics" }).click();
      const truncate = details.getByRole("switch", {
        name: "Truncate text",
      });
      await expect(truncate).toBeVisible();
      await expect(truncate).toBeEnabled();
      await expect(truncate).not.toBeChecked();
      await writeFile(
        testInfo.outputPath("fresh-title-before-toggle.json"),
        JSON.stringify(
          {
            designId,
            screenId,
            nodeId,
            selection,
            checked: await truncate.getAttribute("aria-checked"),
          },
          null,
          2,
        ),
      );

      await truncate.click();
      await expect(truncate).toBeChecked();
      const maxLines = details.getByRole("textbox", { name: "Max lines" });
      await expect(maxLines).toBeVisible();
      await expect(maxLines).toHaveValue("1");
      await expectClamp(page, nodeId!, "1");
      await writeFile(
        testInfo.outputPath("fresh-title-live-style.json"),
        JSON.stringify(
          await renderedTitle.evaluate((element) => ({
            outerHTML: element.outerHTML,
            inlineStyle: (element as HTMLElement).style.cssText,
            clamp:
              getComputedStyle(element).getPropertyValue("-webkit-line-clamp"),
            display: getComputedStyle(element).display,
          })),
          null,
          2,
        ),
      );
      let latestSource = "";
      try {
        await expect
          .poll(async () => {
            latestSource = await readSource(page, designId);
            return inlineValue(latestSource, nodeId!, "-webkit-line-clamp");
          })
          .toBe("1");
      } finally {
        await writeFile(
          testInfo.outputPath("fresh-title-saved-source.html"),
          latestSource,
        );
      }
      const hydratedSelection = await page.evaluate(() => {
        const selected = (window as any).__designSelection?.selectedElement;
        return selected
          ? {
              sourceLayerIdentity: selected.sourceLayerIdentity,
              hasPortableStyleSnapshot: selected.portableStyleSnapshot != null,
            }
          : null;
      });
      await testInfo.attach("fresh-title-selection-after-truncation", {
        body: JSON.stringify(hydratedSelection),
        contentType: "application/json",
      });
      expect
        .soft(hydratedSelection?.sourceLayerIdentity?.screenId)
        .toBe(screenId);
      expect.soft(hydratedSelection?.hasPortableStyleSnapshot).toBe(true);
    } finally {
      await postAction(page, "delete-design", { id: designId });
    }
  },
);
