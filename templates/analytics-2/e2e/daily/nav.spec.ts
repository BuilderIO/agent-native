import { expect, test, uniqueName } from "./fixtures";
import {
  MOD,
  cellAt,
  editorOf,
  seedNotebook,
  storedCells,
} from "./notebook.helpers";
import { createCollection } from "./objects.helpers";
import { createConnection, deleteConnections } from "./setup.helpers";
import {
  FAST,
  LOAD,
  createThread,
  expectFailedLoad,
  expectNoOverlay,
  openHome,
  openProjectView,
  openSettings,
  sidebar,
} from "./views.helpers";

const projectUrl = (id: string, view = "") =>
  new RegExp(`/project/${id}/latest${view}$`);

test("NAV-01 Escape closes only the top overlay, one layer per press", async ({
  daily,
}) => {
  await openHome(daily);
  const trigger = sidebar(daily.page).getByRole("button", {
    name: /account menu/,
  });
  await daily.click(trigger);
  const menu = daily.page.getByRole("menu", { name: "Account menu" });
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Theme" })
    .or(menu.getByRole("button", { name: "Theme" }))
    .first()
    .hover();
  await expect(daily.page.getByRole("menu")).toHaveCount(2);
  await daily.check({ url: /\/home$/ });
  await daily.press("Escape");
  await expect(daily.page.getByRole("menu")).toHaveCount(1, FAST);
  await expect(menu).toBeVisible();
  await daily.check({ url: /\/home$/ });
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({ url: /\/home$/, focus: trigger });
});

test("NAV-02 Escape in add-connection closes the type grid but not a filled form", async ({
  daily,
}) => {
  await daily.open("/home/data");
  const add = daily.page
    .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
    .first();
  await expect(add).toBeVisible(LOAD);
  await daily.click(add);
  const dialog = daily.dialog();
  await expect(dialog).toBeVisible();
  await daily.check({ url: /\/home\/data/ });
  await daily.press("Escape");
  await expect(dialog).toHaveCount(0, FAST);
  await daily.check({ url: /\/home\/data/, focus: add });
  await daily.click(add);
  await daily.click(dialog.getByRole("button", { name: /BigQuery/ }).first());
  await expect(dialog.getByRole("textbox").first()).toBeVisible();
  await daily.press("Escape", { feedback: false });
  await expect(dialog).toBeVisible();
  await daily.check({ url: /\/home\/data/ });
});

test("NAV-05 Escape in the title input reverts and blurs", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Nav title"));
  await openProjectView(daily, project.id);
  await expect(
    daily.page.getByRole("group", { name: "Add code cell" }),
  ).toBeVisible();
  await daily.click(daily.page.locator(".nb-project-title"));
  const input = daily.page.getByRole("textbox", { name: "Project title" });
  await expect(input).toBeFocused();
  await input.fill("Changed but cancelled");
  await daily.press("Escape");
  await expect(input).toHaveCount(0, FAST);
  await expect(daily.page.locator(".nb-project-title")).toHaveText(
    project.title,
  );
  await daily.check({ url: projectUrl(project.id) });
  const stored = await daily.action<{ project: { title: string } }>(
    "get-project",
    { projectId: project.id },
    "GET",
  );
  expect(stored.project.title).toBe(project.title);
});

test("NAV-06 Escape in the description reverts", async ({ daily }) => {
  const project = await daily.createProject(uniqueName("Nav description"));
  await openProjectView(daily, project.id);
  const description = daily.page.getByRole("textbox", {
    name: "Project description",
  });
  if (!(await description.isVisible()))
    await daily.click(daily.page.getByText("Add description...").first());
  await description.click();
  await daily.type("draft that is cancelled");
  await daily.press("Escape");
  await expect(description).toHaveCount(0, FAST);
  const stored = await daily.action<{ project: { description: string } }>(
    "get-project",
    { projectId: project.id },
    "GET",
  );
  expect(stored.project.description ?? "").toBe("");
  await daily.check({ url: projectUrl(project.id) });
});

test("NAV-07 Escape closes the magic bar", async ({ daily }) => {
  // FINDING COV-NAV-07: Mod+Shift+M in a cell opens no generate bar, so there is nothing for Escape to close.
  test.fail();
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: "select 1 as a" },
  ]);
  await openProjectView(daily, nb.id);
  const editor = editorOf(cellAt(daily.page, 0));
  await editor.click();
  await daily.page.keyboard.press(`${MOD}+Shift+M`);
  const bar = daily.page
    .getByRole("textbox")
    .filter({ hasNot: daily.page.locator("textarea.nb-cell-source") })
    .and(
      daily.page.locator(
        "[data-magic-bar], [aria-label*=generate i], [placeholder*=generate i]",
      ),
    );
  await expect(bar).toBeVisible(FAST);
  await daily.press("Escape");
  await expect(bar).toHaveCount(0, FAST);
  await daily.check({ url: projectUrl(nb.id) });
});

test("NAV-08 Back from a project returns Home with the same tab selected", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Navigation recent"));
  await daily.action("touch-project", { projectId: project.id });
  await openHome(daily);
  await daily.click(daily.page.getByRole("tab", { name: "Threads" }));
  await daily.click(
    sidebar(daily.page).getByRole("link", { name: project.title }),
  );
  await expect(daily.page).toHaveURL(/\/project\/.+\/latest$/, LOAD);
  await daily.back();
  await expect(daily.page).toHaveURL(/\/home/);
  await expect(
    daily.page.getByRole("tablist", { name: "Jump back in" }),
  ).toBeVisible(LOAD);
  await daily.check({ url: /\/home/ });
  await expect(
    daily.page.getByRole("tab", { name: "Threads" }),
  ).toHaveAttribute("aria-selected", "true", FAST);
});

test("NAV-09 Forward after Back restores the project view", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Nav forward"));
  await openHome(daily);
  await daily.page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/project/${project.id}/latest`);
  await expect(
    daily.page.getByRole("navigation", { name: "Project views" }),
  ).toBeVisible(LOAD);
  await daily.click(
    daily.page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "App builder" }),
  );
  await expect(daily.page).toHaveURL(projectUrl(project.id, "/app"));
  await daily.check({ url: projectUrl(project.id, "/app") });
  await daily.back();
  await daily.back();
  await expect(
    daily.page.getByRole("tablist", { name: "Jump back in" }),
  ).toBeVisible(LOAD);
  await daily.check({ url: /\/home$/ });
  await daily.forward();
  await daily.forward();
  await expect(daily.page).toHaveURL(projectUrl(project.id, "/app"));
  await expect(
    daily.page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "App builder" }),
  ).toHaveAttribute("aria-current", "page", LOAD);
  await daily.check({ url: projectUrl(project.id, "/app") });
});

test("NAV-10 deep link to a project opens the notebook", async ({ daily }) => {
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: "select 1 as a" },
  ]);
  await openProjectView(daily, nb.id);
  await expect(cellAt(daily.page, 0)).toBeVisible(LOAD);
  await expect(
    daily.page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Notebook" }),
  ).toHaveAttribute("aria-current", "page");
  await daily.check({ url: projectUrl(nb.id) });
});

test("NAV-11 deep link to the app view opens the app builder", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Nav app link"));
  await openProjectView(daily, project.id, "/app");
  await expect(
    daily.page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "App builder" }),
  ).toHaveAttribute("aria-current", "page");
  await daily.check({ url: projectUrl(project.id, "/app") });
});

test("NAV-12 deep link to a thread, and to a missing one", async ({
  daily,
}) => {
  // FINDING COV-VIEWS-22: a missing thread shows an alert under a spinner that never ends instead of "Thread not found".
  test.fail();
  const id = await createThread(daily);
  await daily.open(`/thread/${id}`);
  await expect(
    daily.page.getByRole("textbox", {
      name: /Message agent|Ask a data question/,
    }),
  ).toBeEditable(LOAD);
  await daily.check({ url: new RegExp(`/thread/${id}$`) });
  expectFailedLoad(daily, /get-thread-summary|agent-chat\/threads\//);
  await daily.open("/thread/nav-missing-thread");
  await expect(
    daily.page.getByText("Thread not found", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  await daily.check({ url: /\/thread\/nav-missing-thread$/ });
});

test("NAV-13 deep link to a collection, with and without its name", async ({
  daily,
}) => {
  const collection = await createCollection(
    daily,
    uniqueName("Nav collection"),
  );
  try {
    await daily.open(
      `/collection/${collection.id}/${encodeURIComponent(collection.name)}`,
    );
    await expect(daily.page.getByText(collection.name).first()).toBeVisible(
      LOAD,
    );
    await daily.check({ url: new RegExp(`/collection/${collection.id}`) });
    await daily.open(`/collection/${collection.id}`);
    await expect(daily.page.getByText(collection.name).first()).toBeVisible(
      LOAD,
    );
    await daily.check({ url: new RegExp(`/collection/${collection.id}`) });
  } finally {
    await daily.cleanupAction("delete-collection", {
      collectionId: collection.id,
    });
  }
});

test("NAV-14 deep link to a settings sub view, and to an unknown one", async ({
  daily,
}) => {
  await openSettings(daily, "/settings/secrets");
  await expect(
    daily.page.getByRole("link", { name: "Secrets", exact: true }),
  ).toBeVisible(LOAD);
  await daily.check({ url: /\/settings\/secrets$/ });
  await openSettings(daily, "/settings/no-such-view");
  await expect(
    daily.page.getByText("The specified view was not found", { exact: false }),
  ).toBeVisible(FAST);
  await daily.check({ url: /\/settings\/no-such-view$/, allowErrorText: true });
});

test("NAV-15 deep link to a data source node survives reload", async ({
  daily,
}) => {
  const name = uniqueName("Navigation source");
  try {
    await createConnection(daily, name);
    await daily.open("/home/data");
    await daily.page.getByText(name, { exact: true }).click();
    await expect(daily.page).toHaveURL(/\/home\/data\/[^/]+\/[^/]+\/[^/]+/);
    const url = daily.path();
    await daily.reload();
    await expect(
      daily.page.getByText("daily_sales", { exact: true }).first(),
    ).toBeVisible();
    await daily.check({ url: new RegExp(`${url}$`) });
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("NAV-16 reload with add-connection open comes back without the dialog", async ({
  daily,
}) => {
  await daily.open("/home/data");
  const add = daily.page
    .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
    .first();
  await expect(add).toBeVisible(LOAD);
  await daily.click(add);
  await expect(daily.dialog()).toBeVisible();
  await daily.reload();
  await expect(
    daily.page
      .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
      .first(),
  ).toBeVisible(LOAD);
  await expect(daily.dialog()).toHaveCount(0);
  await daily.check({ url: /\/home\/data/ });
});

test("NAV-18 reload on a thread keeps the composer draft", async ({
  daily,
}) => {
  const id = await createThread(daily);
  await daily.open(`/thread/${id}`);
  const composer = daily.page.getByRole("textbox", {
    name: /Message agent|Ask a data question/,
  });
  await expect(composer).toBeEditable(LOAD);
  await composer.click();
  await daily.type("draft question kept across reload");
  await daily.reload();
  await expect(
    daily.page.getByRole("textbox", {
      name: /Message agent|Ask a data question/,
    }),
  ).toBeEditable(LOAD);
  await daily.check({ url: new RegExp(`/thread/${id}$`) });
  await expect(
    daily.page.getByRole("textbox", {
      name: /Message agent|Ask a data question/,
    }),
  ).toContainText("draft question kept across reload", FAST);
});

test("NAV-19 Mod-click a project row opens a new tab and leaves this one", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Navigation recent"));
  await daily.action("touch-project", { projectId: project.id });
  await openHome(daily);
  const row = daily.page
    .getByRole("tabpanel")
    .getByRole("link", { name: project.title });
  const opened = daily.context.waitForEvent("page", LOAD);
  await row.click({ modifiers: [MOD] });
  const tab = await opened;
  await expect(tab).toHaveURL(/\/project\/.+\/latest$/, LOAD);
  await tab.close();
  await daily.check({ url: /\/home$/ });
});

test("NAV-20 unknown route shows a not-found page", async ({ daily }) => {
  await daily.open("/nav-no-such-route");
  await expect(sidebar(daily.page)).toBeVisible(LOAD);
  await expect(daily.page).toHaveURL(/\/nav-no-such-route$/, FAST);
  await expect(daily.page.getByText(/was not found/)).toBeVisible(FAST);
});

test("NAV-21 Back from /new-project does not loop into a new project", async ({
  daily,
}) => {
  await openHome(daily);
  await daily.page.evaluate(() => {
    history.pushState(null, "", "/new-project");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(daily.page).toHaveURL(/\/project\/[^/]+\/latest/, {
    timeout: 5000,
  });
  const created = /\/project\/([^/]+)\//.exec(daily.page.url())![1]!;
  try {
    await daily.check({ url: /\/project\/[^/]+\/latest/ });
    await daily.back();
    await expect(daily.page).toHaveURL(/\/home$/, LOAD);
    await expect(
      daily.page.getByRole("tablist", { name: "Jump back in" }),
    ).toBeVisible(LOAD);
    await daily.check({ url: /\/home$/ });
  } finally {
    await daily.cleanupProject(created);
  }
});

test("NAV-22 sidebar Recents opens its target and Back restores the row", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Navigation recent"));
  await daily.action("touch-project", { projectId: project.id });
  await openHome(daily);
  const nav = sidebar(daily.page);
  const link = nav.getByRole("link", { name: project.title });
  await daily.click(link);
  await expect(daily.page).toHaveURL(/\/project\/.+\/latest$/, LOAD);
  await expect(
    daily.page.getByRole("navigation", { name: "Project views" }),
  ).toBeVisible(LOAD);
  await expect(daily.page.locator(".nb-project-title")).toHaveText(
    project.title,
  );
  await daily.check({ url: /\/project\/.+\/latest$/ });
  await daily.back();
  await expect(link).toBeVisible();
  await daily.check({ url: /\/home$/ });
});
