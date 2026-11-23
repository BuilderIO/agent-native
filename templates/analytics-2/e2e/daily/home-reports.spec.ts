import { expect, test, uniqueName } from "./fixtures";
import { publish } from "./objects.helpers";

test("report 1794900494.750729 opens all popular apps from a real published visit", async ({
  daily,
}) => {
  const title = uniqueName("Popular report");
  const project = await daily.createProject(title);
  try {
    await publish(daily, project.id);
    await daily.open(`/app/${project.id}/latest`);
    await expect(
      daily.page
        .locator('[data-published-app="true"]')
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await daily.open("/home");
    const section = daily.page.locator(".ws-home-section").filter({
      has: daily.page.getByRole("heading", {
        name: "Popular projects",
        exact: true,
      }),
    });
    const app = section.getByRole("link", { name: title, exact: true });
    await expect(app).toBeVisible();
    await expect(app).toHaveAttribute("href", `/app/${project.id}/latest`);
    const card = app.locator("xpath=ancestor::article");
    const trigger = card.getByRole("button", { name: "Project information" });
    await trigger.hover();
    const information = daily.page.getByRole("dialog", {
      name: "Project Information",
    });
    await expect(information).toBeVisible();
    await expect(
      information.getByText("Published", { exact: true }),
    ).toBeVisible();
    await expect(
      information.getByText("Creator", { exact: true }),
    ).toBeVisible();
    await expect(information.getByText("Owner", { exact: true })).toBeVisible();
    await expect(
      information.getByText("Created on", { exact: true }),
    ).toBeVisible();
    const popular = await daily.action<{
      projects: Array<{
        id: string;
        ownerName: string | null;
        creatorName: string | null;
        createdAt: string;
        lastEditedAt: string;
        namesUnavailable: boolean;
      }>;
    }>("list-popular-projects", {}, "GET");
    const metadata = popular.projects.find((item) => item.id === project.id);
    if (!metadata)
      throw new Error("Published project is absent from popular list");
    const fallback = metadata.namesUnavailable ? "Name unavailable" : "Unknown";
    await expect(
      information.getByText("Creator", { exact: true }).locator(".."),
    ).toContainText(metadata.creatorName ?? fallback);
    await expect(
      information.getByText("Owner", { exact: true }).locator(".."),
    ).toContainText(metadata.ownerName ?? fallback);
    const created = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(metadata.createdAt));
    await expect(
      information.getByText("Created on", { exact: true }).locator(".."),
    ).toContainText(created);
    const edited = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(metadata.lastEditedAt));
    await expect(
      information.getByText("Last updated", { exact: true }).locator(".."),
    ).toContainText(edited);
    await daily.page.mouse.move(0, 0);
    await expect(information).toBeHidden();
    await trigger.click();
    await daily.page.mouse.move(0, 0);
    await expect(information).toBeVisible();
    await daily.page.keyboard.press("Escape");
    await expect(information).toBeHidden();
    await section.getByRole("link", { name: "View all", exact: true }).click();
    await expect(daily.page).toHaveURL(/\/home\/all\?sort=popular$/);
    await daily.page.screenshot({
      path: ".tmp/analytics-owner/report-1794900494-local.png",
    });
    const listedApp = daily.page
      .getByRole("article")
      .getByRole("link", { name: title, exact: true });
    await expect(listedApp).toHaveAttribute(
      "href",
      `/app/${project.id}/latest`,
    );
    await listedApp.click();
    await expect(daily.page).toHaveURL(
      new RegExp(`/app/${project.id}/latest$`),
    );
    await expect(
      daily.page
        .locator('[data-published-app="true"]')
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await daily.check({ url: new RegExp(`/app/${project.id}/latest$`) });
  } finally {
    await daily.cleanupProject(project.id);
  }
});
