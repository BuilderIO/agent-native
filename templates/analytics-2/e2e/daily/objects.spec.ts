import { checkRecentProjectControls } from "../recent-project-controls";
import { createBigQueryConnection, deleteConnection } from "./dash.helpers";
import { expect, test, uniqueName, type Daily } from "./fixtures";
import { cellAt, cellLocator, cellTitles, editorOf } from "./notebook.helpers";
import {
  FAST,
  MOD,
  createCollection,
  grantClipboard,
  headerTitle,
  listPage,
  listRow,
  openHome,
  openListRowMenu,
  openProject,
  openProjectMenu,
  projectUrl,
  publish,
  seedProject,
  seedThread,
} from "./objects.helpers";

// Objects: create, open, edit, rename, move, duplicate, archive, trash, restore, delete, undo.

const trash = (daily: Daily, id: string) => daily.cleanupProject(id);
const menuItem = (daily: Daily, name: string | RegExp) =>
  daily.page.getByRole("menuitem", { name });
const PROJECT_URL = /\/project\/[^/]+\/latest$/;

async function projectTitle(daily: Daily, id: string): Promise<string> {
  const r = await daily.action<{ project: { title: string } }>(
    "get-project",
    { projectId: id },
    "GET",
  );
  return r.project.title;
}

test("OBJECTS-01 create project from the sidebar New control", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-01: Project opens a dialog instead of creating and opening a project.
  await openHome(daily);
  await daily.click(
    daily.page.getByRole("button", { name: "Project", exact: true }),
  );
  await expect(daily.page).toHaveURL(PROJECT_URL, { timeout: 5_000 });
  await expect(headerTitle(daily.page)).toBeVisible();
  await daily.check({ url: PROJECT_URL });
  const id = /\/project\/([^/]+)/.exec(daily.page.url())![1]!;
  await trash(daily, id);
});

test("OBJECTS-02 /new-project creates and redirects into the notebook", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-15: /new-project renders a blank page and creates nothing
  await daily.open("/new-project");
  await expect(daily.page).toHaveURL(PROJECT_URL, { timeout: 5000 });
  await expect(headerTitle(daily.page)).toBeVisible({ timeout: 30_000 });
  await daily.check({ url: PROJECT_URL });
  await trash(daily, /\/project\/([^/]+)/.exec(daily.page.url())![1]!);
});

test("OBJECTS-03 open a project from Jump back in", async ({ daily }) => {
  const draft = await seedProject(daily, uniqueName("Jump draft"));
  const published = await seedProject(daily, uniqueName("Jump published"), [
    "markdown",
  ]);
  await publish(daily, published.id);
  try {
    await openHome(daily);
    const link = daily.page
      .getByRole("tabpanel")
      .getByRole("link", { name: draft.title });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(daily.page).toHaveURL(projectUrl(draft.id));
    await daily.check({ url: projectUrl(draft.id) });
    await daily.back();
    const pubLink = daily.page
      .getByRole("tabpanel")
      .getByRole("link", { name: published.title });
    await expect(pubLink).toBeVisible({ timeout: 30_000 });
    await pubLink.hover();
    await expect(
      daily.page.getByRole("button", { name: "Edit draft" }),
    ).toBeVisible(FAST);
  } finally {
    await trash(daily, draft.id);
    await trash(daily, published.id);
  }
});

test("OBJECTS-04 rename a project in the header", async ({ daily }) => {
  test.fail(); // FINDING F9: committing an empty title reverts instead of saving "Untitled project"
  const p = await seedProject(daily, uniqueName("Rename me"));
  try {
    await openProject(daily, p.id);
    await headerTitle(daily.page).click();
    const input = daily.page.getByRole("textbox", { name: "Project title" });
    await expect(input).toBeFocused();
    await daily.press(`${MOD}+a`, { feedback: false });
    const next = uniqueName("Renamed");
    await daily.type(next);
    await expect(daily.page).toHaveTitle(new RegExp(next));
    await daily.press("Enter");
    await expect(headerTitle(daily.page)).toHaveText(next);
    await daily.check({ url: projectUrl(p.id) });
    await expect.poll(() => projectTitle(daily, p.id)).toBe(next);
    // Escape reverts an edit in progress.
    await headerTitle(daily.page).click();
    await daily.press(`${MOD}+a`, { feedback: false });
    await daily.type("Throwaway");
    await daily.press("Escape");
    await expect(headerTitle(daily.page)).toHaveText(next);
    // An empty commit saves the default name.
    await headerTitle(daily.page).click();
    await daily.press(`${MOD}+a`, { feedback: false });
    await daily.press("Backspace");
    await daily.press("Enter");
    await expect(headerTitle(daily.page)).toHaveText("Untitled project", FAST);
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-05 rename from the project options menu", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Menu rename"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await daily.click(menuItem(daily, "Rename"));
    const input = daily.page.getByRole("textbox", { name: "Project title" });
    await expect(input).toBeFocused();
    const selected = await input.evaluate((el: HTMLInputElement) =>
      el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe(p.title);
    await daily.check({ url: projectUrl(p.id), focus: input });
    await daily.press("Escape");
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-06 edit the project description, Enter saves", async ({
  daily,
}) => {
  const p = await seedProject(daily, uniqueName("Describe me"));
  try {
    await openProject(daily, p.id);
    await daily.page
      .getByRole("button", { name: "Add description..." })
      .first()
      .click();
    const box = daily.page.getByRole("textbox", {
      name: "Project description",
    });
    await expect(box).toBeFocused();
    await daily.type("Weekly revenue");
    await daily.press("Enter");
    await expect(box).not.toBeFocused(FAST);
    await expect(
      daily.page.getByText("Weekly revenue", { exact: true }),
    ).toBeVisible(FAST);
    await expect
      .poll(
        async () =>
          (
            await daily.action<{ project: { description: string } }>(
              "get-project",
              { projectId: p.id },
              "GET",
            )
          ).project.description,
        { timeout: 5_000 },
      )
      .toBe("Weekly revenue");
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-07 duplicate a project from the options menu", async ({
  daily,
}) => {
  const p = await seedProject(daily, uniqueName("Dup source"), ["markdown"]);
  let copyId = "";
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await menuItem(daily, "Duplicate").click();
    await expect(daily.page).not.toHaveURL(projectUrl(p.id), {
      timeout: 15_000,
    });
    await expect(daily.page).toHaveURL(PROJECT_URL);
    copyId = /\/project\/([^/]+)/.exec(daily.page.url())![1]!;
    await expect(headerTitle(daily.page)).toContainText(p.title, {
      timeout: 15_000,
    });
    await daily.check({ url: PROJECT_URL });
  } finally {
    await trash(daily, p.id);
    if (copyId) await trash(daily, copyId);
  }
});

test("OBJECTS-08 project options menu contents", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Menu contents"));
  const c = await createCollection(daily, uniqueName("Menu coll"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await daily.check({ url: projectUrl(p.id) });
    for (const name of [
      "Rename",
      /Favorite|Add to favorites/,
      "Duplicate",
      "Export as",
      "Clear outputs",
      "Transfer project owner",
      "Add to collection",
      "Archive",
      "Move to...",
      "Move to trash",
      "New project",
    ])
      await expect(menuItem(daily, name), String(name)).toBeVisible(FAST);
    await menuItem(daily, "Export as").hover();
    await expect(menuItem(daily, "Analytics project (.yaml)")).toBeVisible(
      FAST,
    );
    await expect(menuItem(daily, "Jupyter notebook (.ipynb)")).toBeVisible(
      FAST,
    );

    await listPage(daily, "/home/all", p.title);
    await openListRowMenu(daily.page, p.title);
    for (const name of [
      "Duplicate",
      "Add to collection",
      "Move to...",
      "Clear outputs",
      "Archive",
      "Move to trash",
    ]) {
      const item = menuItem(daily, name);
      await expect(item, String(name)).toBeVisible(FAST);
      await expect(item, String(name)).toBeEnabled(FAST);
    }
  } finally {
    await trash(daily, p.id);
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

test("OBJECTS-09 archive from the project options menu", async ({ daily }) => {
  test.fail(); // FINDING F17: the project options menu has no "Archive"
  const p = await seedProject(daily, uniqueName("Archive me"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await menuItem(daily, "Archive").click(FAST);
    await expect(daily.toast("Project archived")).toBeVisible();
    await expect(daily.page).toHaveURL(/\/home$/);
    await daily.check({ url: /\/home$/ });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-10 unarchive from the archived banner", async ({ daily }) => {
  test.fail(); // FINDING COV-UNARCHIVE: archived notebook has no Unarchive banner control.
  const p = await seedProject(daily, uniqueName("Unarchive me"));
  await daily.action("archive-project", { projectId: p.id });
  try {
    await openProject(daily, p.id);
    const unarchive = daily.page.getByRole("button", {
      name: "Unarchive",
      exact: true,
    });
    await expect(unarchive).toBeVisible();
    await daily.check({ url: projectUrl(p.id) });
    await unarchive.click();
    await expect(unarchive).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (
            await daily.action<{ project: { archivedAt?: string | null } }>(
              "get-project",
              { projectId: p.id },
              "GET",
            )
          ).project.archivedAt ?? null,
      )
      .toBeNull();
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-11 bulk archive selected rows from the list", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-02: the project list has no row selection or bulk "Archive"
  const a = await seedProject(daily, uniqueName("Bulk A"));
  const b = await seedProject(daily, uniqueName("Bulk B"));
  try {
    await listPage(daily, "/home/all", a.title);
    for (const t of [a.title, b.title])
      await listRow(daily.page, t).getByRole("checkbox").check(FAST);
    await daily.page.getByRole("button", { name: "Archive" }).click(FAST);
    await expect(
      daily.dialog().getByText("Confirm move to archive"),
    ).toBeVisible();
    await daily
      .dialog()
      .getByRole("button", { name: "Move to archive" })
      .click();
    await expect(daily.toast("Projects archived")).toBeVisible();
    await daily.check({ url: /\/home\/all$/ });
  } finally {
    await trash(daily, a.id);
    await trash(daily, b.id);
  }
});

test("OBJECTS-12 move a project to trash from the options menu", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-TRASH-CONFIRM: trash confirmation differs from the reference.
  const p = await seedProject(daily, uniqueName("Trash me"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await menuItem(daily, "Move to trash").click();
    const dialog = daily.dialog();
    await expect(dialog.getByText("Confirm move to trash")).toBeVisible();
    await expect(dialog).toContainText(
      `Are you sure you want to move ${p.title} to trash?`,
    );
    await expect(dialog).toContainText(
      "Deleted projects will be removed from the trash after",
    );
    await daily.check({ url: projectUrl(p.id) });
    await dialog.getByRole("button", { name: "Move to trash" }).click();
    await expect(daily.toast("Project moved to trash")).toBeVisible();
    await daily.check();
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-13 a trashed project shows the trash banner", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-TRASH-BANNER: a trashed project omits the reference banner.
  const p = await seedProject(daily, uniqueName("Trashed banner"));
  await trash(daily, p.id);
  await openProject(daily, p.id);
  await expect(
    daily.page.getByText("This project has been moved to trash."),
  ).toBeVisible();
  await expect(
    daily.page.getByRole("button", { name: "Restore project" }),
  ).toBeVisible();
  await expect(
    daily.page.getByRole("button", { name: "Permanently delete" }),
  ).toBeVisible();
  await daily.check({ url: projectUrl(p.id) });
});

test("OBJECTS-14 restore a project from the trash list", async ({ daily }) => {
  test.fail(); // FINDING COV-RESTORE-FEEDBACK: restoring a project omits its confirmation toast.
  const p = await seedProject(daily, uniqueName("Restore me"));
  await trash(daily, p.id);
  try {
    await listPage(daily, "/home/trash", p.title);
    await openListRowMenu(daily.page, p.title);
    await menuItem(daily, "Restore").click();
    await expect(daily.toast("Project restored.")).toBeVisible();
    await expect(listRow(daily.page, p.title)).toBeHidden();
    await daily.check({ url: /\/home\/trash$/ });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-15 permanently delete a project from the trash", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-03: delete dialog and toast copy differ from "Permanently delete project" / "<Project> permanently deleted"
  const p = await seedProject(daily, uniqueName("Delete me"));
  await trash(daily, p.id);
  await listPage(daily, "/home/trash", p.title);
  await openListRowMenu(daily.page, p.title);
  await menuItem(daily, "Permanently delete").click();
  const dialog = daily.dialog();
  await expect(
    dialog.getByText("Permanently delete project", { exact: true }),
  ).toBeVisible(FAST);
  await expect(dialog).toContainText(
    "Are you sure you want to permanently delete",
  );
  await dialog.getByRole("button", { name: "Permanently delete" }).click();
  await expect(daily.toast(`${p.title} permanently deleted`)).toBeVisible(FAST);
  await daily.check({ url: /\/home\/trash$/ });
});

test("OBJECTS-16 favorite and unfavorite a project", async ({ daily }) => {
  test.fail(); // FINDING COV-FAVORITE-FEEDBACK: favoriting a project omits its confirmation toast.
  const p = await seedProject(daily, uniqueName("Fave me"));
  try {
    await listPage(daily, "/home/all", p.title);
    await openListRowMenu(daily.page, p.title);
    await menuItem(daily, "Add to favorites").click();
    await expect(daily.toast("Project added to favorites")).toBeVisible();
    await daily.check({ url: /\/home\/all$/ });
    await openListRowMenu(daily.page, p.title);
    await menuItem(daily, "Remove from favorites").click();
    await expect(daily.toast("Project removed from favorites")).toBeVisible();
    await daily.check({ url: /\/home\/all$/ });
  } finally {
    await daily.action("favorite-project", {
      projectId: p.id,
      favorited: false,
    });
    await trash(daily, p.id);
  }
});

test("OBJECTS-16 Jump back in star persists and published row opens its draft", async ({
  daily,
}) => {
  const p = await seedProject(daily, uniqueName("Recent controls"), [
    "markdown",
  ]);
  const savedFavorite = async () => {
    const result = await daily.action<{
      projects: { id: string; favorited: boolean }[];
    }>("list-projects", {}, "GET");
    const project = result.projects.find((project) => project.id === p.id);
    expect(project).toBeDefined();
    return project?.favorited;
  };
  try {
    await publish(daily, p.id);
    await openHome(daily);
    await checkRecentProjectControls({
      page: daily.page,
      base: daily.server.base,
      project: p,
      savedFavorite,
      toast: (text) => daily.toast(text),
    });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-17 move a project to a folder", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Move me"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await menuItem(daily, "Move to...").click(FAST);
    await expect(daily.dialog()).toBeVisible();
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-18 add a project to a collection", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-04: the add-to-collection dialog copy differs ("Add project to collections", "Adding:", "Add project")
  const p = await seedProject(daily, uniqueName("Collect me"));
  const c = await createCollection(daily, uniqueName("Coll add"));
  try {
    await listPage(daily, "/home/all", p.title);
    await openListRowMenu(daily.page, p.title);
    await menuItem(daily, "Add to collection").click();
    const dialog = daily.dialog();
    await expect(dialog.getByText("Add project to collections")).toBeVisible(
      FAST,
    );
    await expect(dialog.getByText("Adding:")).toBeVisible(FAST);
    await expect(
      dialog.getByText("To the following collection(s):"),
    ).toBeVisible(FAST);
    await dialog.getByPlaceholder("Add collections...").fill(c.name);
    await daily.page.getByRole("option", { name: c.name }).click();
    await dialog.getByRole("button", { name: "Add project" }).click();
    await expect(daily.toast("Project added to collections")).toBeVisible();
    await daily.check({ url: /\/home\/all$/ });
  } finally {
    await trash(daily, p.id);
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

async function openCollection(daily: Daily, c: { id: string; name: string }) {
  await daily.open(`/collection/${c.id}`);
  await expect(daily.page.getByText(c.name).first()).toBeVisible({
    timeout: 30_000,
  });
}

test("OBJECTS-19 remove a project from a collection", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-05: removing a project from a collection shows no confirmation toast
  const p = await seedProject(daily, uniqueName("Uncollect me"));
  const c = await createCollection(daily, uniqueName("Coll remove"));
  await daily.action("add-project-to-collection", {
    projectId: p.id,
    collectionId: c.id,
  });
  try {
    await openCollection(daily, c);
    const row = daily.page
      .getByRole("listitem")
      .filter({ has: daily.page.getByRole("link", { name: p.title }) });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row).toBeHidden();
    await expect(daily.toast("Project removed from to collection")).toBeVisible(
      FAST,
    );
    await daily.check();
  } finally {
    await daily.action("remove-project-from-collection", {
      projectId: p.id,
      collectionId: c.id,
    });
    await trash(daily, p.id);
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

test("OBJECTS-21 edit collection settings", async ({ daily }) => {
  test.fail(); // FINDING COV-COLLECTION-EDIT: collection edit dialog omits the reference heading.
  const c = await createCollection(daily, uniqueName("Coll edit"));
  try {
    await openCollection(daily, c);
    await daily.page.getByRole("button", { name: "Edit collection" }).click();
    const dialog = daily.dialog();
    await expect(dialog.getByText("Edit collection settings")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save changes" }),
    ).toBeVisible();
    await daily.check({ url: /\/collection\// });
    await daily.press("Escape");
  } finally {
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

test("OBJECTS-22 add projects to a collection from its page", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-07: the add-projects dialog copy differs ("Add to collection", "Add projects...", "Add")
  const p = await seedProject(daily, uniqueName("Coll page add"));
  const c = await createCollection(daily, uniqueName("Coll page"));
  try {
    await openCollection(daily, c);
    await daily.page.getByRole("button", { name: "Add projects" }).click();
    const dialog = daily.dialog();
    await expect(
      dialog.getByText("Add to collection", { exact: true }),
    ).toBeVisible(FAST);
    await dialog.getByPlaceholder("Add projects...").fill(p.title);
    await daily.page.getByRole("option", { name: p.title }).click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(daily.page.getByRole("link", { name: p.title })).toBeVisible();
    await daily.check({ url: /\/collection\// });
  } finally {
    await trash(daily, p.id);
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

test("OBJECTS-23 delete a collection", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-08: delete dialog reads "Delete collection?" instead of "Permanently delete collection" with the permissions warning
  const c = await createCollection(daily, uniqueName("Coll delete"));
  try {
    await openCollection(daily, c);
    await daily.page.getByRole("button", { name: "Delete collection" }).click();
    const dialog = daily.dialog();
    await expect(dialog.getByText("Permanently delete collection")).toBeVisible(
      FAST,
    );
    await expect(dialog).toContainText(
      "Users accessing projects via the collection will lose their permissions. This cannot be undone.",
    );
    await dialog.getByRole("button", { name: "Delete collection" }).click();
    await daily.check();
  } finally {
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

test("OBJECTS-24 favorite collection appears in the sidebar with Remove favorite", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-OBJECTS-09: the sidebar has no "Favorite collections" section
  const c = await createCollection(daily, uniqueName("Coll fave"));
  await daily.action("favorite-collection", {
    collectionId: c.id,
    favorited: true,
  });
  try {
    await openHome(daily);
    const nav = daily.page.getByRole("navigation").first();
    await expect(nav.getByText("Favorite collections")).toBeVisible(FAST);
    const row = nav.getByRole("link", { name: c.name });
    await row.hover();
    await expect(
      nav.getByRole("button", { name: "Remove favorite" }),
    ).toBeVisible(FAST);
  } finally {
    await daily.cleanupAction("delete-collection", { collectionId: c.id });
  }
});

async function openOwnedThreadMenu(daily: Daily, id: string) {
  await daily.open("/home/threads");
  const row = daily.page
    .locator("main")
    .getByRole("listitem")
    .filter({ has: daily.page.locator(`a[href$="/thread/${id}"]`) });
  await expect(
    daily.page.getByRole("heading", { name: "Threads", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: /^Actions for / }).click();
}

test("OBJECTS-25 rename a thread", async ({ daily }) => {
  const id = await seedThread(daily);
  try {
    await openOwnedThreadMenu(daily, id);
    await menuItem(daily, "Rename").click(FAST);
    const dialog = daily.dialog();
    await expect(dialog.getByText("Rename thread")).toBeVisible();
    const title = uniqueName("Renamed owned thread");
    await dialog.getByPlaceholder("Thread title").fill(title);
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(dialog).toBeHidden();
    await daily.reload();
    await expect(
      daily.page.locator("main").locator(`a[href$="/thread/${id}"]`),
    ).toContainText(title);
    await daily.check({ url: /\/home\/threads$/ });
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: id });
  }
});

test("OBJECTS-26 move a thread to trash", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-11: threads cannot be trashed, only deleted outright
  const id = await seedThread(daily);
  try {
    await openOwnedThreadMenu(daily, id);
    await menuItem(daily, "Move to trash").click(FAST);
    await expect(
      daily.dialog().getByText("Confirm move to trash"),
    ).toBeVisible();
    await daily.dialog().getByRole("button", { name: "Move to trash" }).click();
    await expect(daily.toast("Thread trashed")).toBeVisible();
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: id });
  }
});

test("OBJECTS-27 delete a thread", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-12: delete confirm reads "Delete thread" instead of "Confirm delete" / "Are you sure you want to delete this thread? This cannot be undone."
  const id = await seedThread(daily);
  try {
    await daily.open("/home/threads");
    const row = daily.page.locator("main").locator(`a[href$="/thread/${id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await openOwnedThreadMenu(daily, id);
    await menuItem(daily, /^Delete/).click();
    const dialog = daily.dialog();
    await expect(
      dialog.getByText("Confirm delete", { exact: true }),
    ).toBeVisible(FAST);
    await expect(dialog).toContainText(
      "Are you sure you want to delete this thread? This cannot be undone.",
    );
    await dialog.getByRole("button", { name: /Delete/ }).click();
    await expect(daily.toast("Thread deleted")).toBeVisible();
    await daily.check({ url: /\/home\/threads$/ });
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: id });
  }
});

test("OBJECTS-28 duplicate a thread", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-13: the thread menu has no "Make a copy"
  const id = await seedThread(daily);
  try {
    await openOwnedThreadMenu(daily, id);
    await menuItem(daily, /Make a copy|Copy thread/).click(FAST);
    await expect(daily.page).not.toHaveURL(new RegExp(`/thread/${id}$`));
    await expect(daily.page).toHaveURL(/\/thread\/[^/]+$/);
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: id });
  }
});

test("OBJECTS-29 open a panel thread in the full page", async ({ daily }) => {
  test.fail(); // FINDING COV-OBJECTS-14: the project's agent panel has no "Open full thread"
  const p = await seedProject(daily, uniqueName("Panel thread"));
  try {
    await openProject(daily, p.id);
    await daily.page
      .getByRole("button", {
        name: /thread options|More thread actions|Thread actions/,
      })
      .first()
      .click(FAST);
    await menuItem(daily, "Open full thread").click(FAST);
    await expect(daily.page).toHaveURL(/\/thread\/[^/]+$/);
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-30 add a cell between cells", async ({ daily }) => {
  test.fail(); // FINDING COV-INSERT-FOCUS: inserting a SQL cell leaves its editor unfocused.
  const p = await seedProject(daily, uniqueName("Add cell"), [
    "markdown",
    "markdown",
  ]);
  try {
    await openProject(daily, p.id);
    await expect(cellLocator(daily.page)).toHaveCount(2, { timeout: 30_000 });
    await daily.page
      .getByRole("button", { name: "Add cell here" })
      .first()
      .click();
    await expect(daily.page.locator(".nb-insert.is-open")).toBeVisible();
    await daily.check({ url: projectUrl(p.id) });
    await daily.page
      .locator(".nb-insert.is-open")
      .getByRole("button", { name: "Query", exact: true })
      .click();
    await expect(cellLocator(daily.page)).toHaveCount(3);
    await expect(cellAt(daily.page, 1)).toContainText("SQL");
    const added = cellLocator(daily.page)
      .filter({ has: daily.page.locator(".nb-sql-editor .cm-content") })
      .first();
    await expect(editorOf(added)).toBeFocused();
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

async function cellMenu(daily: Daily, index: number) {
  const cell = cellAt(daily.page, index);
  await cell.hover();
  await cell.getByRole("button", { name: /^More actions for / }).click();
  await expect(daily.menu()).toBeVisible();
}

test("OBJECTS-31 duplicate a cell", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Dup cell"), [
    "sql",
    "markdown",
  ]);
  try {
    await openProject(daily, p.id);
    await expect(cellLocator(daily.page)).toHaveCount(2, { timeout: 30_000 });
    await cellMenu(daily, 0);
    await menuItem(daily, "Duplicate").click();
    await expect(cellLocator(daily.page)).toHaveCount(3);
    const titles = await cellTitles(daily.page);
    expect(titles[2]).toMatch(/Markdown/);
    expect(titles[1]).toMatch(/SQL/);
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-32 move a cell down from the menu", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Move cell"), [
    "sql",
    "markdown",
  ]);
  try {
    await openProject(daily, p.id);
    await expect(cellLocator(daily.page)).toHaveCount(2, { timeout: 30_000 });
    const before = await cellTitles(daily.page);
    await cellMenu(daily, 0);
    await menuItem(daily, "Move down").click();
    await expect
      .poll(() => cellTitles(daily.page))
      .toEqual([before[1], before[0]]);
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-34 copy a cell link", async ({ daily }) => {
  test.fail(); // FINDING F19: copying a cell link shows no "Link copied to clipboard" confirmation
  await grantClipboard(daily);
  const p = await seedProject(daily, uniqueName("Cell link"), ["sql"]);
  try {
    await openProject(daily, p.id);
    await expect(cellLocator(daily.page)).toHaveCount(1, { timeout: 30_000 });
    await cellMenu(daily, 0);
    await menuItem(daily, "Copy link").click(FAST);
    await expect(menuItem(daily, /^Copy link to /)).toBeVisible(FAST);
    await expect(menuItem(daily, /in the latest Published App/)).toBeDisabled(
      FAST,
    );
    await menuItem(daily, /^Copy link to /).click();
    await expect(daily.toast("Link copied to clipboard")).toBeVisible(FAST);
  } finally {
    await trash(daily, p.id);
  }
});

test("OBJECTS-36 edit a connection: prefilled form with Update connection", async ({
  daily,
}) => {
  const conn = await createBigQueryConnection(daily, uniqueName("Edit conn"));
  try {
    await daily.open("/settings/data-sources");
    await daily.page
      .getByRole("button", { name: `${conn.name} options` })
      .click({ timeout: 30_000 });
    await menuItem(daily, "Edit").click();
    await expect(
      daily.page.getByRole("button", { name: "Update connection" }),
    ).toBeVisible();
    await expect(
      daily.page.locator(`input[value="${conn.name}"]`),
    ).toBeVisible();
    expect(await daily.page.locator("body").innerText()).not.toContain(
      "PRIVATE KEY",
    );
    await daily.check({ url: /\/settings\/data-sources/ });
  } finally {
    await deleteConnection(daily, conn.id);
  }
});

test("OBJECTS-37 delete a connection", async ({ daily }) => {
  const conn = await createBigQueryConnection(daily, uniqueName("Delete conn"));
  try {
    await daily.open("/settings/data-sources");
    await daily.page
      .getByRole("button", { name: `${conn.name} options` })
      .click({ timeout: 30_000 });
    await menuItem(daily, "Delete").click();
    await daily.page
      .getByRole("alertdialog", { name: "Confirm delete" })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(daily.page.getByText(conn.name)).toHaveCount(0);
    await daily.check({ url: /\/settings\/data-sources/ });
  } finally {
    await deleteConnection(daily, conn.id);
  }
});

test("OBJECTS-38 transfer project owner", async ({ daily }) => {
  test.fail(); // FINDING COV-TRANSFER-OWNER: transfer dialog has no Transfer ownership action.
  const p = await seedProject(daily, uniqueName("Transfer me"));
  try {
    await openProject(daily, p.id);
    await openProjectMenu(daily);
    await menuItem(daily, "Transfer project owner").click();
    await expect(
      daily.dialog().getByRole("button", { name: "Transfer ownership" }),
    ).toBeVisible();
    await daily.check({ url: projectUrl(p.id) });
    await daily.press("Escape");
  } finally {
    await trash(daily, p.id);
  }
});
