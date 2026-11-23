import { expect, test } from "@playwright/test";

import {
  measureProjectHeaderGeometry,
  openArchiveHelp,
  openTrashHeader,
} from "./archive-help-flow";
import { ARCHIVE_SHOT_DIR, E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const width of [945, 780, 390]) {
  test(`Archive help reserves space above its filters at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { root, help } = await openArchiveHelp(page, BASE);
    await expect(
      help.getByRole("link", { name: "Learn more", exact: true }),
    ).toBeVisible();
    const helpBox = await help.boundingBox();
    const toolbarBox = await root
      .locator(".ws-projects-controls")
      .boundingBox();
    expect(helpBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    if (!helpBox || !toolbarBox) throw new Error("Archive layout missing");
    expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(toolbarBox.y);
    const geometry = await measureProjectHeaderGeometry(root);
    expect(geometry.iconTitleCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.titleToSubtitleGap).toBeGreaterThanOrEqual(11);
    expect(geometry.subtitleToControlsGap).toBeGreaterThanOrEqual(12);
    const headerPadding = await root.locator("header").evaluate((element) => ({
      left: getComputedStyle(element).paddingLeft,
      right: getComputedStyle(element).paddingRight,
      top: getComputedStyle(element).paddingTop,
    }));
    expect(headerPadding).toEqual({ left: "16px", right: "16px", top: "16px" });
    await page.screenshot({
      path: `${ARCHIVE_SHOT_DIR}/archive-help-${width}.png`,
    });
  });
}

for (const width of [1440, 945, 780, 390]) {
  test(`Trash header aligns icon with title and separates description and filters at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { root } = await openTrashHeader(page, BASE);
    const geometry = await measureProjectHeaderGeometry(root);
    expect(geometry.iconTitleCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.titleToSubtitleGap).toBeGreaterThanOrEqual(11);
    expect(geometry.subtitleToControlsGap).toBeGreaterThanOrEqual(12);
    expect(geometry.subtitleLeftOffset).toBeGreaterThanOrEqual(2);
    expect(geometry.subtitleLeftOffset).toBeLessThanOrEqual(6);
    if (width <= 945) {
      const headerPadding = await root
        .locator("header")
        .evaluate((element) => ({
          left: getComputedStyle(element).paddingLeft,
          right: getComputedStyle(element).paddingRight,
          top: getComputedStyle(element).paddingTop,
        }));
      expect(headerPadding).toEqual({
        left: "16px",
        right: "16px",
        top: "16px",
      });
    }
  });
}
