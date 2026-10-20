import path from "node:path";

import { type Frame, type Page } from "@playwright/test";

import { appPath, enterDirectMode, gotoEditor } from "./helpers";
import { expect, expectOnlyChanged, test } from "./rails";

const SVG_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/play-button-icon.svg",
);
const SCREEN_HTML = `<!doctype html><html><body style="margin:0"><main style="position:relative;width:640px;height:480px"></main></body></html>`;

async function readImportedFile(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) return undefined;
  const result = await response.json();
  return result.files?.find(
    (file: { content?: unknown }) =>
      typeof file.content === "string" &&
      file.content.includes('data-agent-native-layer-name="Pasted SVG"'),
  );
}

async function importedSvgFrame(page: Page): Promise<Frame> {
  const selector = 'svg[data-agent-native-layer-name="Pasted SVG"]';
  for (const frame of page.frames()) {
    if ((await frame.locator(selector).count()) > 0) return frame;
  }
  throw new Error(
    `Pasted SVG absent from iframe documents: ${page
      .frames()
      .map((frame) => frame.url())
      .join(", ")}`,
  );
}

// Covers local SVG editing and persistence after reopening the design.
test("imported local SVG remains editable after reopening the design", async ({
  app,
  page,
}) => {
  const designId = await app.seed(SCREEN_HTML);
  await app.open(designId);
  await enterDirectMode(page);
  await app.zoomToFit();
  await app.settled();
  const before = await app.savedNodes(designId);
  await page.getByRole("button", { name: "Shapes options" }).click();
  await page.getByRole("menuitem", { name: "Image/video..." }).click();
  const fileInput = page.locator(
    '[data-design-bottom-toolbar] input[type="file"]',
  );
  await expect(fileInput).toHaveCount(1);
  await expect(fileInput).toHaveAttribute("accept", "image/*,video/*");
  await fileInput.setInputFiles(SVG_FIXTURE);

  await expect.poll(() => readImportedFile(page, designId)).toBeTruthy();
  const importedFile = await readImportedFile(page, designId);
  if (typeof importedFile?.id !== "string") {
    throw new Error("SVG import was not saved to a design file");
  }
  const svg = (await importedSvgFrame(page)).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  await expect(svg).toHaveAttribute("data-an-primitive", "pasted-svg");
  const paths = svg.locator("path");
  await expect(paths).toHaveCount(2);
  await expect(paths.first()).toHaveAttribute("fill", "#132745");

  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Pasted SVG", exact: true })
    .click();
  const selectionColors = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Selection colors",
        exact: true,
      }),
    })
    .first();
  const showColors = selectionColors.getByRole("button", {
    name: "Show selection colors",
  });
  if (await showColors.count()) await showColors.click();
  await selectionColors.getByRole("button", { name: "#132745" }).click();
  const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
  await hexInput.fill("3B82F6");
  await hexInput.press("Enter");

  await expect(paths.first()).toHaveCSS("fill", "rgb(59, 130, 246)");
  await expect(paths.nth(1)).toHaveCSS("fill", "rgb(255, 255, 255)");
  await expect
    .poll(async () => (await readImportedFile(page, designId))?.content ?? "")
    .toMatch(/fill=["']#3b82f6["']/i);
  await app.settled();
  const after = await app.savedNodes(designId);
  const svgIds = [...after.values()]
    .filter((node) => node.attrs["data-an-primitive"] === "pasted-svg")
    .map((node) => node.id);
  expect(
    svgIds,
    "exactly one SVG, imported into the centred screen",
  ).toHaveLength(1);
  const insideSvg = (nodeId: string): boolean =>
    nodeId === svgIds[0] ||
    (after.get(nodeId)?.parent != null &&
      insideSvg(after.get(nodeId)!.parent!));
  const added = [...after.keys()].filter((nodeId) => !before.has(nodeId));
  expect(
    added.filter((nodeId) => !insideSvg(nodeId)),
    "only the SVG and its own paths are new",
  ).toEqual([]);
  expectOnlyChanged(before, after, added);

  await gotoEditor(page, designId);
  await enterDirectMode(page);
  const reloadedSvg = (await importedSvgFrame(page)).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  await expect(reloadedSvg).toHaveAttribute("data-an-primitive", "pasted-svg");
  await expect(reloadedSvg.locator("path").first()).toHaveCSS(
    "fill",
    "rgb(59, 130, 246)",
  );
  await expect(reloadedSvg.locator("path").nth(1)).toHaveCSS(
    "fill",
    "rgb(255, 255, 255)",
  );
});
