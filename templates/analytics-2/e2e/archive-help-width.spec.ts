import { expect, test } from "@playwright/test";

import {
  checkArchiveHelp,
  measureProjectHeaderGeometry,
  openArchiveHelp,
  openTrashHeader,
} from "./archive-help-flow";
import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const width of [1440, 390]) {
  test(`Archive help and Learn more stay within their header at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { root, help } = await openArchiveHelp(page, BASE);
    await expect(help).toContainText(
      "Archive projects and components to declutter a workspace, without losing your work.",
    );
    const link = help.getByRole("link", { name: "Learn more", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "#archive-help");
    const geometry = await measureProjectHeaderGeometry(root);
    expect(geometry.iconTitleCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.titleToSubtitleGap).toBeGreaterThanOrEqual(11);
    const bounds = await help.evaluate((element) => {
      const header = element.closest("header")!;
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        header: header.getBoundingClientRect().toJSON(),
        text: [...range.getClientRects()].map((rect) => rect.toJSON()),
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      };
    });
    expect(bounds.text.length).toBeGreaterThan(0);
    for (const rect of bounds.text) {
      expect(rect.left).toBeGreaterThanOrEqual(bounds.header.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.header.right + 1);
    }
    if (width === 1440) {
      expect(
        Math.max(...bounds.text.map((rect) => rect.bottom)) -
          Math.min(...bounds.text.map((rect) => rect.top)),
      ).toBeLessThanOrEqual(bounds.lineHeight + 1);
    }
  });

  test(`Trash header icon, title and retention notice fit within header at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { root, help } = await openTrashHeader(page, BASE);
    const geometry = await measureProjectHeaderGeometry(root);
    expect(geometry.iconTitleCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.titleToSubtitleGap).toBeGreaterThanOrEqual(11);
    expect(geometry.subtitleToControlsGap).toBeGreaterThanOrEqual(12);
    const bounds = await help.evaluate((element) => {
      const header = element.closest("header")!;
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        header: header.getBoundingClientRect().toJSON(),
        text: [...range.getClientRects()].map((rect) => rect.toJSON()),
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      };
    });
    expect(bounds.text.length).toBeGreaterThan(0);
    for (const rect of bounds.text) {
      expect(rect.left).toBeGreaterThanOrEqual(bounds.header.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.header.right + 1);
    }
    if (width === 1440) {
      expect(
        Math.max(...bounds.text.map((rect) => rect.bottom)) -
          Math.min(...bounds.text.map((rect) => rect.top)),
      ).toBeLessThanOrEqual(bounds.lineHeight + 1);
    }
  });
}

test("Archive Learn more opens its guide and returns keyboard focus", async ({
  page,
}) => {
  await checkArchiveHelp(page, BASE);
});
