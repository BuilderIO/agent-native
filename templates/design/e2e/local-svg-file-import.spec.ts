import path from "node:path";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { appPath, enterDirectMode, gotoEditor } from "./helpers";

const SVG_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/sonora-play-button.svg",
);
const SCREEN_HTML = `<!doctype html><html><body style="margin:0"><main style="position:relative;width:640px;height:480px"></main></body></html>`;

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

test("imported local SVG remains editable and persists after reload", async ({
  page,
}) => {
  const created = await action(page, "create-design", {
    title: `Local SVG import ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  try {
    const screen = await action(page, "create-file", {
      designId,
      filename: "screen.html",
      fileType: "html",
      content: SCREEN_HTML,
    });
    const screenId = screen.id ?? screen.data?.id;
    if (typeof screenId !== "string") throw new Error("missing screen id");

    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await page.getByRole("button", { name: "Rectangle options" }).click();
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

    await page.reload();
    await enterDirectMode(page);
    const reloadedSvg = (await importedSvgFrame(page)).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    );
    await expect(reloadedSvg).toHaveAttribute(
      "data-an-primitive",
      "pasted-svg",
    );
    await expect(reloadedSvg.locator("path").first()).toHaveCSS(
      "fill",
      "rgb(59, 130, 246)",
    );
    await expect(reloadedSvg.locator("path").nth(1)).toHaveCSS(
      "fill",
      "rgb(255, 255, 255)",
    );
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
