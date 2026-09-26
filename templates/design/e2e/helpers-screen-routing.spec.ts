import { expect, test } from "@playwright/test";

import {
  activeOverlays,
  newDesign,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";
import { appPath, designFrame, selectByText } from "./helpers";

test.beforeEach(async ({}, testInfo) => setBaseURL(testInfo));

const DUPLICATE_TEXT = "Duplicate route target";

function screenHtml(nodeId: string): string {
  return `<!doctype html>
<html><body style="margin:0;width:800px;height:600px">
  <button data-agent-native-node-id="${nodeId}" data-agent-native-layer-name="${DUPLICATE_TEXT}"
    style="position:absolute;left:100px;top:100px;width:180px;height:60px">${DUPLICATE_TEXT}</button>
</body></html>`;
}

test("screen route aliases target the authored iframe, not a board or neighboring Screen", async ({
  page,
}) => {
  const designId = await newDesign(page, screenHtml("first-target"));
  try {
    await postAction(page, "create-file", {
      designId,
      filename: "settings.html",
      content: screenHtml("second-target"),
      fileType: "html",
    });
    await openEditor(page, designId);

    const screenIframes = page.locator(
      "iframe[data-design-preview-iframe][data-screen-iframe-id]",
    );
    await expect(screenIframes).toHaveCount(2);
    const screens = await screenIframes.evaluateAll((iframes) =>
      iframes.map((iframe) => {
        const shell = iframe.closest("[data-screen-shell]");
        return {
          id: shell?.getAttribute("data-frame-id"),
          filename: shell
            ?.querySelector("[data-frame-title]")
            ?.getAttribute("title"),
        };
      }),
    );
    const firstScreen = screens.find(
      (screen) => screen.filename === "index.html",
    );
    const secondScreen = screens.find(
      (screen) => screen.filename === "settings.html",
    );
    expect(firstScreen?.id).toBeTruthy();
    expect(secondScreen?.id).toBeTruthy();

    const routeTargets = [
      { parameter: "screen", value: firstScreen!.id! },
      { parameter: "fileId", value: firstScreen!.id! },
      { parameter: "filename", value: firstScreen!.id! },
      { parameter: "screen", value: "index.html" },
      { parameter: "fileId", value: "index.html" },
      { parameter: "filename", value: "index.html" },
      { parameter: "screen", value: "./INDEX.HTML" },
    ];

    for (const { parameter, value } of routeTargets) {
      const query = new URLSearchParams({ view: "overview" });
      query.set(parameter, value);
      await page.goto(appPath(`/design/${designId}?${query.toString()}`), {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate(() => {
        const boardPreview = document.createElement("iframe");
        boardPreview.dataset.designPreviewIframe = "";
        boardPreview.title = "runtime board preview";
        boardPreview.style.cssText =
          "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none";
        document.body.prepend(boardPreview);
      });
      expect(
        await page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .getAttribute("data-screen-iframe-id"),
        "the board preview should be first, before authored Screen iframes",
      ).toBeNull();
      await expect(
        page.getByRole("button", { name: "Move", exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      const selection = await selectByText(page, DUPLICATE_TEXT);
      expect(selection.sourceId).toBe("first-target");
      await expect.poll(() => activeOverlays(page)).toContain("selection");
      expect(await activeOverlays(page, secondScreen!.id!)).not.toContain(
        "selection",
      );
      await expect(
        designFrame(page).locator('[data-agent-native-node-id="first-target"]'),
      ).toBeVisible();
    }
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});
