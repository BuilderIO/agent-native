import { type Page } from "@playwright/test";

import { expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main data-agent-native-node-id="main" style="position:relative;width:640px;height:480px"><div data-agent-native-node-id="border-rectangle" data-agent-native-layer-name="Border Rectangle" data-an-primitive="rectangle" style="position:absolute;left:80px;top:80px;width:180px;height:120px;background:#fff;border-width:6px;border-style:solid;border-color:#111827"></div></main></body></html>`;

async function borderState(app: App) {
  return app.node("border-rectangle").evaluate((node) => {
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

async function borderPixels(app: App) {
  const png = (await app.node("border-rectangle").screenshot()).toString(
    "base64",
  );
  return app.page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not decode border screenshot");
    context.drawImage(image, 0, 0);
    // The middle of the 6px left border, in screenshot pixels of the 192px-wide border box.
    const borderMiddleX = Math.round((3 * image.width) / 192);
    const sample = (y: number) =>
      Array.from(context.getImageData(borderMiddleX, y, 1, 1).data.slice(0, 3));
    return {
      width: image.width,
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

// oracle: none — only the paint type button changed (Linear is now Gradient); no Figma behavior is claimed.
test("HTML rectangle border gradient paints, persists, reloads, and returns to solid", async ({
  app,
  page,
}) => {
  const designId = await app.seed(HTML);
  await app.open(designId);
  await app.settled();
  const before = await app.savedNodes(designId);
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
    popover.getByRole("button", { name: "Gradient", exact: true }),
  ).toBeVisible();
  await popover.getByRole("button", { name: "Gradient", exact: true }).click();

  await expect
    .poll(() => borderState(app))
    .toMatchObject({
      borderImageSlice: "1",
      borderWidth: "6px",
    });
  await expect
    .poll(async () => (await borderState(app)).borderImageSource)
    .toContain("linear-gradient");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  const fitted = JSON.stringify(
    await app.node("border-rectangle").boundingBox(),
  );
  await page.keyboard.press("Shift+2");
  let previous = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(
        await app.node("border-rectangle").boundingBox(),
      );
      const stable = now === previous && now !== fitted;
      previous = now;
      return stable;
    })
    .toBe(true);
  const renderedBorder = await borderPixels(app);
  expect(
    renderedBorder.width,
    "zoomed to the rectangle, so its 6px border paints whole pixels clear of the selection outline",
  ).toBeGreaterThanOrEqual(384);
  expect(renderedBorder.firstStop).not.toEqual(renderedBorder.lastStop);
  expect(renderedBorder.firstStop).not.toEqual([255, 255, 255]);
  expect(
    (await borderState(app)).borderImageSource,
    "the gradient starts from the solid's colour",
  ).toMatch(/^linear-gradient\(rgb\(17, 24, 39\) 0%, /);
  await app.settled();
  const gradient = await app.savedNodes(designId);
  const gradientStyle = styleOf(gradient.get("border-rectangle"));
  expect(gradientStyle["--an-css-border-gradient"]).toMatch(
    /^linear-gradient\(/,
  );
  expect(gradientStyle["border-image-slice"]).toBe("1");
  expectOnlyChanged(before, gradient, ["border-rectangle"]);

  await page.reload();
  await selectBorderRectangle(page);
  await expect
    .poll(async () => (await borderState(app)).borderImageSource)
    .toContain("linear-gradient");
  expect(
    styleOf((await app.savedNodes(designId)).get("border-rectangle")),
  ).toEqual(gradientStyle);

  const reloadedSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Stroke$/i }) })
    .first();
  const reloadedPicker = reloadedSection.getByRole("button", {
    name: "Open color picker",
  });
  await reloadedPicker.click();
  const reloadedPopoverId = await reloadedPicker.getAttribute("aria-controls");
  const reloadedPopover = page.locator(`[id="${reloadedPopoverId}"]`);
  await reloadedPopover
    .getByRole("button", { name: "Solid", exact: true })
    .click();

  await expect
    .poll(() => borderState(app))
    .toMatchObject({
      source: "",
      gradient: "",
      borderImageSource: "none",
      borderColor: "rgb(17, 24, 39)",
    });
  await expect
    .poll(async () => app.savedHtml(designId))
    .not.toContain("--an-css-border-gradient");
  await app.settled();
  const after = await app.savedNodes(designId);
  expect(
    styleOf(after.get("border-rectangle")),
    "back to exactly the original solid border",
  ).toEqual(styleOf(before.get("border-rectangle")));
  expectOnlyChanged(before, after, ["border-rectangle"]);
});
