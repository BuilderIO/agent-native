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

test("nothing-selected inspector addresses the canvas surround, never a screen's document", async ({
  page,
}, testInfo) => {
  const designId = await readSeedDesignId();
  await gotoEditor(page, designId);

  await expect(page.locator(sectionTitle("Canvas"))).toBeVisible();
  await expect(page.locator(sectionTitle("Screen"))).toHaveCount(0);
  await cdpScreenshot(page, testInfo.outputPath("panel-board.png"));

  await enterInteractView(page);

  await expect(page.locator(sectionTitle("Screen"))).toHaveCount(0);
  await cdpScreenshot(page, testInfo.outputPath("panel-interact.png"));
});
