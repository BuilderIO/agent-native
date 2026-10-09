import { expect, test } from "@playwright/test";

import {
  cdpScreenshot,
  enterInteractView,
  gotoEditor,
  readSeedDesignId,
} from "./helpers";

/**
 * With nothing selected, the inspector must address the scope you are actually
 * looking at. Standalone that is always the board surround: `single` here is
 * the responsive interactive view, not a screen you are editing, so the
 * document section must not appear there.
 */
const sectionTitle = (name: string) =>
  `h3.design-sidebar-section-title:text-is("${name}")`;

// oracle: none — checks which scope the inspector addresses with nothing selected, not measured Figma behavior.
test("nothing-selected inspector addresses the canvas surround, never a screen's document", async ({
  page,
}, testInfo) => {
  const designId = await readSeedDesignId();
  await gotoEditor(page, designId);

  await expect(page.locator(sectionTitle("Canvas"))).toBeVisible();
  await expect(page.locator(sectionTitle("Screen"))).toHaveCount(0);
  await cdpScreenshot(page, testInfo.outputPath("panel-board.png"));

  await enterInteractView(page);

  // Interact is a preview, not a place to edit: it has no inspector at all.
  await expect(
    page.locator('[data-design-chrome-region="right-panel"]'),
  ).toHaveCount(0);
  await expect(page.locator(sectionTitle("Screen"))).toHaveCount(0);
  await cdpScreenshot(page, testInfo.outputPath("panel-interact.png"));
});

// oracle: none — checks where the Interact controls sit against the left panel, not measured Figma geometry.
test("Interact controls stay clear of the absolute left panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, await readSeedDesignId());
  await enterInteractView(page);

  const leftShell = page.locator('[data-design-chrome-region="left-shell"]');
  const leftShellBox = await leftShell.boundingBox();
  const devicePickerBox = await page
    .locator("[data-design-interact-device]")
    .boundingBox();
  const zoomBox = await page
    .locator("[data-design-interact-zoom]")
    .boundingBox();

  expect(leftShellBox).not.toBeNull();
  expect(devicePickerBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect(devicePickerBox!.x).toBeGreaterThanOrEqual(
    leftShellBox!.x + leftShellBox!.width,
  );
  expect(zoomBox!.x + zoomBox!.width).toBeLessThanOrEqual(1440);
});
