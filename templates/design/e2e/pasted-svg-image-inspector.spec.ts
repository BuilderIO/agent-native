import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><img data-agent-native-node-id="fit-target" data-agent-native-layer-name="Fit target" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="position:absolute;left:20px;top:20px;width:120px;height:80px" /></main></body></html>`;

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

async function createDesign(page: Page) {
  const design = await action(page, "create-design", {
    title: `Pasted SVG image ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: HTML,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing screen id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 100, y: 100, width: 640, height: 480 },
      },
    ],
  });
  return designId;
}

test("pasted SVG is an editable sized layer and image fit mode writes object-fit", async ({
  page,
}, testInfo) => {
  const designId = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await expandAllLayers(page);
    const imageRow = page
      .getByRole("treeitem")
      .filter({ hasText: "Fit target" })
      .first();
    await imageRow.locator("[data-layer-row-button]").click();
    await page.getByRole("combobox", { name: "Resizing" }).click();
    await page.getByRole("option", { name: "Crop", exact: true }).click();
    await expect
      .poll(() =>
        designFrame(page)
          .locator('[data-agent-native-node-id="fit-target"]')
          .evaluate((node) => (node as HTMLElement).style.objectFit),
      )
      .toBe("cover");
    const savedScreenResponse = await page.request.get(
      appPath(
        `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
      ),
    );
    expect(savedScreenResponse.ok()).toBe(true);
    const savedScreen = await savedScreenResponse.json();
    expect(savedScreen.content).toContain("object-fit: cover");
    await page.reload();
    await expect
      .poll(() =>
        designFrame(page)
          .locator('[data-agent-native-node-id="fit-target"]')
          .evaluate((node) => (node as HTMLElement).style.objectFit),
      )
      .toBe("cover");

    const pasteWasPrevented = await designFrame(page)
      .locator("body")
      .evaluate((body) => {
        const transfer = new DataTransfer();
        transfer.setData(
          "text/plain",
          '<svg width="17" height="9" viewBox="0 0 17 9"><path d="M0 0L17 9"/></svg>',
        );
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        body.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(pasteWasPrevented).toBe(true);
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"]',
      ),
    ).toHaveAttribute("width", "17");
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"]',
      ),
    ).toHaveAttribute("height", "9");
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"]',
      ),
    ).toHaveAttribute("data-an-primitive", "pasted-svg");
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"] path',
      ),
    ).toHaveAttribute("d", "M0 0L17 9");
    await cdpScreenshot(page, testInfo.outputPath("pasted-svg-live.png"));
    await expect
      .poll(async () => {
        const response = await page.request.get(
          appPath(
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
          ),
        );
        if (!response.ok()) return "";
        const source = await response.json();
        return typeof source.content === "string" ? source.content : "";
      })
      .toContain('data-agent-native-layer-name="Pasted SVG"');

    const pastedRow = page
      .getByRole("treeitem")
      .filter({ hasText: "Pasted SVG" })
      .first();
    await expect(pastedRow).toBeVisible();
    await pastedRow.locator("[data-layer-row-button]").click();
    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(fillSection).toBeVisible();
    await fillSection.getByRole("button", { name: "Add fill" }).click();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
    await hexInput.fill("3B82F6");
    await hexInput.press("Enter");
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"] path',
      ),
    ).toHaveCSS("fill", "rgb(59, 130, 246)");
    await expect
      .poll(async () => {
        const response = await page.request.get(
          appPath(
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
          ),
        );
        if (!response.ok()) return "";
        const source = await response.json();
        return typeof source.content === "string" ? source.content : "";
      })
      .toMatch(/<path[^>]*style="[^\"]*fill:\s*#3b82f6/i);
    await page.reload();
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"] path',
      ),
    ).toHaveAttribute("d", "M0 0L17 9");
    await expect(
      designFrame(page).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"] path',
      ),
    ).toHaveCSS("fill", "rgb(59, 130, 246)");
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
