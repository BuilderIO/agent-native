import { expect, test, uniqueName } from "./fixtures";
import { openProject, openProjectMenu, seedProject } from "./objects.helpers";

test("report A2-PROJECT-MENU-FAVORITE persists across reload", async ({
  daily,
}) => {
  const project = await seedProject(daily, uniqueName("Favorite project"));
  const favorite = async () => {
    const result = await daily.action<{
      projects: { id: string; favorited: boolean }[];
    }>("list-projects", {}, "GET");
    const match = result.projects.find((item) => item.id === project.id);
    expect(match).toBeDefined();
    return match?.favorited;
  };
  try {
    expect(await favorite()).toBe(false);
    await openProject(daily, project.id);
    await openProjectMenu(daily);
    await daily.page
      .getByRole("menuitem", { name: "Favorite this project" })
      .click();
    await expect.poll(favorite).toBe(true);
    await daily.page.reload({ waitUntil: "domcontentloaded" });
    await openProjectMenu(daily);
    await expect(
      daily.page.getByRole("menuitem", { name: "Remove from your favorites" }),
    ).toBeVisible();
    expect(await favorite()).toBe(true);
    await daily.page
      .getByRole("menuitem", { name: "Remove from your favorites" })
      .click();
    await expect.poll(favorite).toBe(false);
    await openProjectMenu(daily);
    await expect(
      daily.page.getByRole("menuitem", { name: "Favorite this project" }),
    ).toBeVisible();
  } finally {
    await daily.open("/home");
    await daily.cleanupProject(project.id);
  }
});
