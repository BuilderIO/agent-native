import { type APIRequestContext, type Page } from "@playwright/test";

import { appPath, gotoEditor } from "./helpers";
import { expect, test } from "./rails";

const SCREEN_A = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>First screen</title></head><body data-agent-native-layer-name="First screen" style="margin:0;background-color:#2F74F5"><main>Shared paint A</main></body></html>`;
const SCREEN_B = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Second screen</title></head><body data-agent-native-layer-name="Second screen" style="margin:0;background-color:#2F74F5"><main>Shared paint B</main></body></html>`;

async function savedSources(request: APIRequestContext, designId: string) {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const design = await response.json();
  return Object.fromEntries(
    design.files.map((file: { filename: string; content: string }) => [
      file.filename,
      file.content,
    ]),
  ) as Record<string, string>;
}

async function renderedScreenColors(page: Page) {
  const iframes = page.locator(
    "iframe[data-design-preview-iframe][data-screen-iframe-id]",
  );
  await expect(iframes).toHaveCount(2);
  const iframeIds = await iframes.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-screen-iframe-id")),
  );
  return Promise.all(
    iframeIds.map(async (iframeId) => {
      if (!iframeId) throw new Error("Missing screen iframe id");
      const body = page
        .frameLocator(
          `iframe[data-design-preview-iframe][data-screen-iframe-id="${iframeId}"]`,
        )
        .locator("body");
      await expect(body).toBeVisible();
      return body.evaluate((node) => getComputedStyle(node).backgroundColor);
    }),
  );
}

test("one Undo restores Selection Colors across two selected Screens", async ({
  app,
  page,
  request,
}) => {
  const designId = await app.seed(SCREEN_A, {
    files: { "second.html": SCREEN_B },
  });
  await gotoEditor(page, designId);

  const layers = page.getByRole("tree", { name: "Layers" });
  const screens = layers.locator('[role="treeitem"][aria-level="1"]');
  await expect(screens).toHaveCount(2);
  await screens.first().locator("[data-layer-row-button]").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await expect(screens).toHaveCount(2);
  await expect(screens.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(screens.nth(1)).toHaveAttribute("aria-selected", "true");

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
  await selectionColors.getByRole("button", { name: /^#2f74f5$/i }).click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(hex).toBeVisible();
  await hex.fill("EC4899");
  await hex.press("Enter");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => {
      const sources = await savedSources(request, designId);
      return [sources["index.html"], sources["second.html"]].map((source) =>
        source.match(/background-color:\s*([^;"']+)/i)?.[1]?.toLowerCase(),
      );
    })
    .toEqual(["#ec4899", "#ec4899"]);
  await expect
    .poll(() => renderedScreenColors(page))
    .toEqual(["rgb(236, 72, 153)", "rgb(236, 72, 153)"]);

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Z" : "Control+Z",
  );
  await expect
    .poll(async () => {
      const sources = await savedSources(request, designId);
      return [sources["index.html"], sources["second.html"]].map((source) =>
        source.match(/background-color:\s*([^;"']+)/i)?.[1]?.toLowerCase(),
      );
    })
    .toEqual(["#2f74f5", "#2f74f5"]);
  await expect
    .poll(() => renderedScreenColors(page))
    .toEqual(["rgb(47, 116, 245)", "rgb(47, 116, 245)"]);

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z",
  );
  await expect
    .poll(async () => {
      const sources = await savedSources(request, designId);
      return [sources["index.html"], sources["second.html"]].map((source) =>
        source.match(/background-color:\s*([^;"']+)/i)?.[1]?.toLowerCase(),
      );
    })
    .toEqual(["#ec4899", "#ec4899"]);
  await expect
    .poll(() => renderedScreenColors(page))
    .toEqual(["rgb(236, 72, 153)", "rgb(236, 72, 153)"]);

  await page.reload();
  const reloaded = await savedSources(request, designId);
  expect(
    [reloaded["index.html"], reloaded["second.html"]].map((source) =>
      source.match(/background-color:\s*([^;"']+)/i)?.[1]?.toLowerCase(),
    ),
  ).toEqual(["#ec4899", "#ec4899"]);
  await expect
    .poll(() => renderedScreenColors(page))
    .toEqual(["rgb(236, 72, 153)", "rgb(236, 72, 153)"]);
});
