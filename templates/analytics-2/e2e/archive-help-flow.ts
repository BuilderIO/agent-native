import { expect, type Locator, type Page } from "@playwright/test";

export interface ProjectHeaderGeometry {
  iconTitleCenterDelta: number;
  titleToSubtitleGap: number;
  subtitleToControlsGap: number;
  subtitleLeftOffset: number;
}

export async function measureProjectHeaderGeometry(
  root: Locator,
): Promise<ProjectHeaderGeometry> {
  return root.evaluate((element) => {
    const icon = element.querySelector(".ws-projects-heading-icon");
    const title = element.querySelector(".ws-projects-title");
    const subtitle = element.querySelector("header .ws-projects-subtitle");
    const controls = element.querySelector(".ws-projects-controls");
    if (!icon || !title || !subtitle || !controls) {
      throw new Error("Project list header geometry elements missing");
    }
    const iconRect = icon.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const subtitleRect = subtitle.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const iconCenterY = iconRect.top + iconRect.height / 2;
    const titleCenterY = titleRect.top + titleRect.height / 2;
    return {
      iconTitleCenterDelta: Math.abs(iconCenterY - titleCenterY),
      titleToSubtitleGap: subtitleRect.top - titleRect.bottom,
      subtitleToControlsGap: controlsRect.top - subtitleRect.bottom,
      subtitleLeftOffset: subtitleRect.left - iconRect.left,
    };
  });
}

export async function openTrashHeader(page: Page, base: string) {
  await page.goto(`${base}/home/trash`);
  const root = page.locator(".ws-projects");
  await expect(
    root.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
  const help = root.locator("header .ws-projects-subtitle");
  await expect(help).toBeVisible();
  await expect(help).toContainText(
    "Projects and components that have been in the trash for more than 30 days will be permanently deleted",
  );
  const pill = root.getByRole("button", {
    name: "Created by you",
    exact: true,
  });
  await expect(pill).toBeVisible();
  return { root, help };
}

export async function openArchiveHelp(page: Page, base: string) {
  await page.goto(`${base}/home/archive`);
  const root = page.locator(".ws-projects");
  await expect(
    root.getByRole("heading", { name: "Archive", exact: true }),
  ).toBeVisible();
  const help = root.locator("header .ws-projects-subtitle");
  const link = help.getByRole("link", { name: "Learn more", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "#archive-help");
  const pill = root.getByRole("button", {
    name: "Created by you",
    exact: true,
  });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(
    root.getByRole("button", { name: "Created by you", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await root
    .getByRole("button", { name: "Created by you", exact: true })
    .click();
  await expect(
    root.getByRole("button", { name: "Created by you", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  return { root, help, link };
}

export async function checkArchiveHelp(page: Page, base: string) {
  const { link } = await openArchiveHelp(page, base);
  await link.click();
  const guide = page.getByRole("dialog", {
    name: "About Archive",
    exact: true,
  });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Archiving does not delete");
  await expect(guide).toContainText("Unarchive");
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(link).toBeFocused();
}
