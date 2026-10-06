import { expect, test, type Page } from "@playwright/test";

import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main data-agent-native-node-id="main" style="position:relative;width:640px;height:480px"><div data-agent-native-node-id="border-rectangle" data-agent-native-layer-name="Border Rectangle" data-an-primitive="rectangle" style="position:absolute;left:80px;top:80px;width:180px;height:120px;background:#fff;border-width:6px;border-style:solid;border-color:#111827"></div></main></body></html>`;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function createDesign(page: Page) {
  const design = await action(page, "create-design", {
    title: `CSS border gradient ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: HTML,
  });
  const screenId = file.id ?? file.data?.id;
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
    ],
  });
  return { designId, screenId };
}

async function readSource(page: Page, designId: string, screenId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const html = design.files?.find(
    (file: { id?: string }) => file.id === screenId,
  )?.content;
  if (typeof html !== "string")
    throw new Error("screen source was not returned");
  return html;
}

async function borderState(page: Page, screenId: string) {
  const frame = designFrame(page, screenId);
  return frame
    .locator('[data-agent-native-node-id="border-rectangle"]')
    .evaluate((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      return {
        source: element.style.borderImageSource,
        gradient: element.style.getPropertyValue("--an-css-border-gradient"),
        borderImageSource: style.borderImageSource,
        borderImageSlice: style.borderImageSlice,
        borderWidth: style.borderTopWidth,
        borderColor: style.borderColor,
      };
    });
}

async function borderPixels(page: Page, screenId: string) {
  const border = designFrame(page, screenId).locator(
    '[data-agent-native-node-id="border-rectangle"]',
  );
  const png = (await border.screenshot()).toString("base64");
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not decode border screenshot");
    context.drawImage(image, 0, 0);
    const sample = (y: number) =>
      Array.from(context.getImageData(3, y, 1, 1).data.slice(0, 3));
    return {
      firstStop: sample(Math.round(image.height * 0.1)),
      lastStop: sample(Math.round(image.height * 0.9)),
    };
  }, png);
}

async function selectBorderRectangle(page: Page) {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator('span[title="Border Rectangle"]') })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

test("HTML rectangle border gradient paints, persists, reloads, and returns to solid", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await expandAllLayers(page);
    await page.evaluate(() => {
      (window as any).__debugBridgeSelections = [];
      window.addEventListener(
        "message",
        (event) => {
          if (event.data?.type === "element-select") {
            (window as any).__debugBridgeSelections.push(event.data.payload);
          }
        },
        true,
      );
    });
    await selectBorderRectangle(page);
    const selectedInfo = await page.evaluate(() =>
      (window as any).__debugBridgeSelections.find(
        (payload: any) => payload.sourceId === "border-rectangle",
      ),
    );
    expect(selectedInfo).toMatchObject({
      tagName: "div",
      primitiveKind: "rectangle",
    });
    expect(selectedInfo.inlineStyles).toMatchObject({
      borderWidth: "6px",
      borderStyle: "solid",
    });
    expect(selectedInfo.inlineStyles).not.toHaveProperty("borderTop");
    expect(selectedInfo.inlineStyles).not.toHaveProperty("borderTopWidth");

    const strokeSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Stroke$/i }) })
      .first();
    await expect(strokeSection).toBeVisible();
    const strokePicker = strokeSection.getByRole("button", {
      name: "Open color picker",
    });
    await strokePicker.click();
    const popoverId = await strokePicker.getAttribute("aria-controls");
    expect(popoverId).toBeTruthy();
    const popover = page.locator(`[id="${popoverId}"]`);
    await expect(
      popover.getByRole("button", { name: "Linear", exact: true }),
    ).toBeVisible();
    await popover.getByRole("button", { name: "Linear", exact: true }).click();

    await expect
      .poll(() => borderState(page, screenId))
      .toMatchObject({
        borderImageSlice: "1",
        borderWidth: "6px",
      });
    await expect
      .poll(async () => (await borderState(page, screenId)).borderImageSource)
      .toContain("linear-gradient");
    const renderedBorder = await borderPixels(page, screenId);
    expect(renderedBorder.firstStop).not.toEqual(renderedBorder.lastStop);
    expect(renderedBorder.firstStop).not.toEqual([255, 255, 255]);
    const savedGradient = await readSource(page, designId, screenId);
    expect(savedGradient).toContain("--an-css-border-gradient");
    expect(savedGradient).toContain("border-image-slice: 1");

    await page.reload();
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await selectBorderRectangle(page);
    await expect
      .poll(async () => (await borderState(page, screenId)).borderImageSource)
      .toContain("linear-gradient");
    const reloadedSource = await readSource(page, designId, screenId);
    expect(reloadedSource).toContain("--an-css-border-gradient");

    const reloadedSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Stroke$/i }) })
      .first();
    const reloadedPicker = reloadedSection.getByRole("button", {
      name: "Open color picker",
    });
    await reloadedPicker.click();
    const reloadedPopoverId =
      await reloadedPicker.getAttribute("aria-controls");
    const reloadedPopover = page.locator(`[id="${reloadedPopoverId}"]`);
    await reloadedPopover
      .getByRole("button", { name: "Solid", exact: true })
      .click();

    await expect
      .poll(() => borderState(page, screenId))
      .toMatchObject({
        source: "",
        gradient: "",
        borderImageSource: "none",
        borderColor: "rgb(17, 24, 39)",
      });
    await expect
      .poll(async () => readSource(page, designId, screenId))
      .not.toContain("--an-css-border-gradient");
    const savedSolid = await readSource(page, designId, screenId);
    expect(savedSolid).not.toContain("--an-css-border-gradient");
    expect(savedSolid).not.toContain("border-image-source");
    expect(savedSolid).toContain("border-color: #111827");
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
