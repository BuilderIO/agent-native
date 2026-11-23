import { expect, test, uniqueName } from "./fixtures";
import { cellAt, seedNotebook } from "./notebook.helpers";
import {
  createCollection,
  openListRowMenu,
  publish,
  searchResponse,
  seedThread,
} from "./objects.helpers";
import { createConnection, deleteConnections } from "./setup.helpers";
import {
  FAST,
  LOAD,
  createThread,
  expectFailedLoad,
  expectNoOverlay,
  failAction,
  menuItems,
  openHome,
  openProjectView,
  openSettings,
  patchAction,
  sidebar,
} from "./views.helpers";

const emptyRecents =
  (kind: "projects" | "threads") => (shell: Record<string, unknown>) => {
    const recents = shell.homeRecents as Record<string, unknown[]>;
    recents[kind] = [];
  };

test("VIEWS-01 home hero shows the prompt and the Ask and Build entry tiles", async ({
  daily,
}) => {
  // FINDING COV-VIEWS-01: Home has no "Explore ad hoc questions" / "Dive deeper and publish findings" entry tiles.
  test.fail();
  await openHome(daily);
  await expect(
    daily.page.getByRole("textbox", {
      name: /Message agent|Ask a data question/,
    }),
  ).toBeVisible();
  await daily.check({ url: /\/home$/ });
  await daily.page.getByRole("button", { name: "Ask", exact: true }).hover();
  await expect(
    daily.page.getByText("Explore ad hoc questions", { exact: true }),
  ).toBeVisible();
  await daily.page.getByRole("button", { name: "Build", exact: true }).hover();
  await expect(
    daily.page.getByText("Dive deeper and publish findings", { exact: true }),
  ).toBeVisible();
});

test("VIEWS-02 home Jump back in tabs and View all", async ({ daily }) => {
  await openHome(daily);
  const tabs = daily.page.getByRole("tablist", { name: "Jump back in" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "Projects",
    "Threads",
    "Explorations",
    "Data",
  ]);
  await expect(tabs.getByRole("tab", { name: "Projects" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await daily.click(tabs.getByRole("tab", { name: "Threads" }));
  await expect(tabs.getByRole("tab", { name: "Threads" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await daily.check({ url: /\/home/ });
  await daily.click(tabs.getByRole("tab", { name: "Projects" }));
  await daily.click(daily.page.getByRole("link", { name: "View all" }));
  await expect(daily.page).toHaveURL(/\/home\/all$/);
  await expect(
    daily.page.getByRole("button", { name: "New project" }).first(),
  ).toBeVisible(LOAD);
  await daily.check({ url: /\/home\/all$/ });
});

test("VIEWS-03 home projects tab empty state", async ({ daily }) => {
  await patchAction(
    daily.page,
    "get-workspace-activity",
    emptyRecents("projects"),
  );
  await openHome(daily);
  await expect(
    daily.page.getByText(
      "Analyze and visualize your data in a notebook and publish interactive apps",
      { exact: true },
    ),
  ).toBeVisible();
  const panel = daily.page.getByRole("tabpanel");
  await expect(
    panel.getByRole("button", { name: "New project" }),
  ).toBeVisible();
  await daily.check({ url: /\/home$/ });
});

test("VIEWS-04 home projects tab load failure", async ({ daily }) => {
  await failAction(daily, "get-workspace-activity");
  await daily.open("/home");
  await expect(
    daily.page.getByText("There was an error loading recent projects", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    daily.page.getByRole("tablist", { name: "Jump back in" }),
  ).toBeVisible(FAST);
  await daily.check({ url: /\/home$/, allowErrorText: true });
});

test("VIEWS-05 home threads tab empty state", async ({ daily }) => {
  await patchAction(
    daily.page,
    "get-workspace-activity",
    emptyRecents("threads"),
  );
  await openHome(daily);
  await daily.click(daily.page.getByRole("tab", { name: "Threads" }));
  await expect(
    daily.page.getByText("Chat with Analytics to explore your data", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    daily.page.getByRole("tabpanel").getByRole("button", { name: /thread/i }),
  ).toBeVisible();
  await daily.check({ url: /\/home$/ });
});

test("VIEWS-06 home threads tab load failure", async ({ daily }) => {
  await failAction(daily, "get-workspace-activity");
  await daily.open("/home");
  await daily.click(daily.page.getByRole("tab", { name: "Threads" }), {
    within: 400,
  });
  await expect(
    daily.page.getByText("There was an error loading recent threads", {
      exact: true,
    }),
  ).toBeVisible(FAST);
  await daily.check({ url: /\/home$/, allowErrorText: true });
});

test("VIEWS-07 home suggestions empty state opens Context Studio", async ({
  daily,
}) => {
  await openHome(daily);
  await expect(
    daily.page.getByText("No suggestions yet", { exact: true }),
  ).toBeVisible();
  await expect(
    daily.page.getByText(
      "Suggestions will appear here as Analytics identifies improvements from your team's agent conversations and data activity.",
      { exact: true },
    ),
  ).toBeVisible();
  await daily.check({ url: /\/home$/ });
  await daily.click(
    daily.page.getByRole("button", { name: "Open Context Studio" }),
  );
  await expect(daily.page).toHaveURL(/\/context-studio/, LOAD);
  await daily.check({ url: /\/context-studio/ });
});

test("VIEWS-08 left sidebar sections and New menu", async ({ daily }) => {
  // FINDING COV-VIEWS-08: the sidebar has no Favorite projects / Favorite data / Favorite collections / Threads sections, and the New menu lacks New component, New collection, Upload component and New folder.
  test.fail();
  await openHome(daily);
  const nav = sidebar(daily.page);
  await expect(nav.getByRole("region", { name: /recents/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await daily.click(nav.getByRole("button", { name: "Create new" }));
  const items = await menuItems(daily.menu());
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({
    url: /\/home$/,
    focus: nav.getByRole("button", { name: "Create new" }),
  });
  expect(items).toEqual([
    "Project",
    "New classic thread",
    "New component",
    "New collection",
    "Upload project",
    "Upload component",
    "New folder",
  ]);
  for (const section of [
    "Favorite projects",
    "Favorite data",
    "Favorite collections",
    "Threads",
  ])
    await expect(
      nav.getByRole("button", { name: new RegExp(`^${section}$`, "i") }),
    ).toBeVisible(FAST);
});

test("VIEWS-09 row 125 account Help links", async ({ daily }) => {
  const { checkAccountMenu } = await import("../account-menu");
  await checkAccountMenu(daily.page, daily.server.base);
});

test("VIEWS-09 sidebar footer account menu", async ({ daily }) => {
  // FINDING COV-VIEWS-09: the account menu has no Keyboard shortcuts, What's new?, Chat with us... or Log out items.
  test.fail();
  await openHome(daily);
  const trigger = sidebar(daily.page).getByRole("button", {
    name: /account menu/,
  });
  await daily.click(trigger);
  const menu = daily.page.getByRole("menu", { name: "Account menu" });
  await expect(menu).toBeVisible();
  const text = await menu.innerText();
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({ url: /\/home$/, focus: trigger });
  for (const item of [
    "Keyboard shortcuts",
    "Documentation",
    "Changelog",
    "Email support",
    "What's new?",
    "Chat with us...",
    "Log out",
  ])
    expect(text).toContain(item);
});

test("VIEWS-10 notifications panel and its empty state", async ({ daily }) => {
  // FINDING COV-VIEWS-10: the empty inbox reads "No notifications yet" instead of "Inbox zero!" / "No unread notifications.".
  test.fail();
  await openHome(daily);
  const bell = sidebar(daily.page).getByRole("button", {
    name: "Notifications",
  });
  await daily.click(bell);
  const panel = daily.dialog();
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("Notifications", { exact: true }).first(),
  ).toBeVisible();
  const text = await panel.innerText();
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({ url: /\/home$/, focus: bell });
  expect(text).toContain("Mark all as read");
  expect(text).toMatch(/Inbox zero!|No unread notifications\./);
});

test("VIEWS-11 data page tabs keep the tab in the URL", async ({ daily }) => {
  await daily.open("/home/data");
  const tabs = daily.page.getByRole("tablist", { name: "Data browser" });
  await expect(tabs.getByRole("tab")).toHaveText(
    ["Warehouse", "Data models", "Recents", "Favorites", "Curation"],
    LOAD,
  );
  await daily.check({ url: /\/home\/data/ });
  await daily.click(tabs.getByRole("tab", { name: "Recents" }));
  await expect(tabs.getByRole("tab", { name: "Recents" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await daily.check({ url: /\/home\/data/ });
  await expect(daily.page).toHaveURL(/\/home\/data\/recently-used/i, FAST);
});

test("VIEWS-12 data browser drill-down headers and breadcrumbs", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-DATA-BREADCRUMBS: the drill-down lacks the reference breadcrumb navigation.
  const name = uniqueName("View catalog");
  try {
    await createConnection(daily, name);
    await daily.open("/home/data");
    await daily.page.getByText(name, { exact: true }).click();
    await expect(
      daily.page.getByRole("columnheader", { name: /^Schemas [(]3[)]$/i }),
    ).toBeVisible();
    await daily.page
      .getByRole("table")
      .getByRole("button", { name: "daily_sales", exact: true })
      .click();
    await expect(
      daily.page.getByRole("columnheader", { name: /^Tables [(]2[)]$/i }),
    ).toBeVisible();
    await expect(
      daily.page.locator("main").getByText("/", { exact: true }).first(),
    ).toBeVisible(FAST);
    await daily.check({ url: /\/home\/data/ });
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("VIEWS-13 data browser empty schema says No tables found", async ({
  daily,
}) => {
  const name = uniqueName("Empty view catalog");
  try {
    await daily.scenario({ tables: [], emptyDatasets: ["empty_dataset"] });
    await createConnection(daily, name);
    await daily.open("/home/data");
    await daily.page.getByText(name, { exact: true }).click();
    await daily.page
      .getByRole("table")
      .getByRole("button", { name: "empty_dataset", exact: true })
      .click();
    await expect(
      daily.page.getByText("No tables found", { exact: true }).first(),
    ).toBeVisible();
    await daily.check({ url: /\/home\/data/ });
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("VIEWS-14 notebook shell header and left rail", async ({ daily }) => {
  // FINDING COV-VIEWS-14: the project rail has no Scheduled runs item.
  test.fail();
  const nb = await seedNotebook(daily, []);
  await openProjectView(daily, nb.id);
  await expect(
    daily.page.getByRole("button", { name: "Project options" }).first(),
  ).toBeVisible();
  const views = daily.page.getByRole("navigation", { name: "Project views" });
  await expect(views.getByRole("button", { name: "Notebook" })).toBeVisible();
  await expect(
    views.getByRole("button", { name: "App builder" }),
  ).toBeVisible();
  await expect(
    daily.page.getByRole("button", { name: "Publish app" }),
  ).toBeVisible();
  await daily.check({ url: new RegExp(`/project/${nb.id}/latest$`) });
  const rail = daily.page.getByRole("navigation", { name: "Workspace tools" });
  for (const item of [
    "Table of contents",
    "Find",
    "Environment",
    "Files",
    "Variables",
    "History & versions",
    "Help & support",
    "Scheduled runs",
  ])
    await expect(
      rail.getByRole("button", { name: item, exact: true }),
    ).toBeVisible(FAST);
});

test("VIEWS-15 table of contents panel", async ({ daily }) => {
  // FINDING COV-VIEWS-15: the table of contents has no Outline / Graph switch with the cell-type filter chips.
  test.fail();
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: "select 1 as a" },
  ]);
  await openProjectView(daily, nb.id);
  await daily.click(
    daily.page.getByRole("button", { name: "Table of contents", exact: true }),
  );
  await daily.check({ url: new RegExp(`/project/${nb.id}/latest$`) });
  await expect(daily.page.getByText("Outline", { exact: true })).toBeVisible(
    FAST,
  );
  await expect(daily.page.getByText("Graph", { exact: true })).toBeVisible(
    FAST,
  );
  for (const chip of [
    "Python",
    "Components",
    "Inputs",
    "Sections",
    "SQL",
    "Text",
    "Transformations",
    "Visualizations",
    "Writeback",
  ])
    await expect(
      daily.page.getByRole("button", { name: chip, exact: true }),
    ).toBeVisible(FAST);
});

test("VIEWS-17 empty notebook offers Add cell and the data browser's empty lists", async ({
  daily,
}) => {
  const nb = await seedNotebook(daily, []);
  await openProjectView(daily, nb.id);
  await expect(
    daily.page.getByRole("button", { name: "Browse all data", exact: true }),
  ).toBeVisible(FAST);
  await daily.page
    .getByRole("button", { name: "Browse all data", exact: true })
    .click();
  await daily.check({ url: new RegExp(`/project/${nb.id}/latest$`) });
  await expect(
    daily.page.getByText("Recently Used", { exact: true }),
  ).toBeVisible(FAST);
  await expect(
    daily.page.getByText("No recently used tables", { exact: true }),
  ).toBeVisible(FAST);
  await expect(
    daily.page.getByText("No favorited data", { exact: true }),
  ).toBeVisible(FAST);
});

test("VIEWS-18 cell menu items", async ({ daily }) => {
  // FINDING COV-VIEWS-18: the cell menu lacks Add to section, Duplicate to chart, Select cell and..., New component, Copy link, Embed and Open cell debugger, and says "Duplicate cell" for "Duplicate".
  test.fail();
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: "select 1 as a" },
  ]);
  await openProjectView(daily, nb.id);
  const cell = cellAt(daily.page, 0);
  await cell.hover();
  const trigger = cell.getByRole("button", { name: /^More actions for / });
  await daily.click(trigger);
  await expect(daily.menu()).toBeVisible();
  const items = await menuItems(daily.menu());
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({
    url: new RegExp(`/project/${nb.id}/latest$`),
    focus: trigger,
  });
  for (const item of [
    "Add below",
    "Move up",
    "Move down",
    "Add to section",
    "Duplicate",
    "Duplicate to chart",
    "Select cell and...",
    "New component",
    "Copy cell",
    "Copy link",
    "Embed",
    "Full screen",
    "Open cell debugger",
    "Delete cell",
  ])
    expect(items).toContain(item);
});

test("VIEWS-19 project errors panel after a failed run", async ({ daily }) => {
  // FINDING COV-VIEWS-19: a failed run shows only the cell's banner; there is no "Project errors" panel with Debug app / Rerun app.
  test.fail();
  const nb = await seedNotebook(daily, [
    {
      kind: "sql",
      text: "select * from no_such_table_daily",
      connection: "builtin-sample-data",
    },
  ]);
  await openProjectView(daily, nb.id);
  daily.allowResponse.push(/run-project-cell/);
  await daily.click(daily.page.getByRole("button", { name: /^Run / }).first());
  await expect(
    daily.page.getByText("Project errors", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    daily.page.getByText("The app couldn't successfully run top to bottom.", {
      exact: true,
    }),
  ).toBeVisible(FAST);
  await expect(
    daily.page.getByRole("button", { name: "Rerun app" }),
  ).toBeVisible(FAST);
});

test("VIEWS-20 search groups threads and projects", async ({ daily }) => {
  const word = uniqueName("Group query").replaceAll(" ", "");
  const project = await daily.createProject(`${word} project`);
  const threadId = await seedThread(daily, `${word} thread`);
  try {
    await daily.action("rename-thread", { threadId, title: `${word} thread` });
    await daily.action("touch-project", { projectId: project.id });
    await openHome(daily);
    await daily.click(
      sidebar(daily.page).getByRole("button", { name: "Search", exact: true }),
    );
    const dialog = daily.dialog();
    await expect(dialog.getByText("Recents", { exact: true })).toBeVisible();
    const loaded = searchResponse(daily, word);
    await daily.type(word);
    await loaded;
    await expect(dialog.getByText("My Threads", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Projects", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(`${word} thread`, { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(`${word} project`, { exact: true }),
    ).toBeVisible();
    await daily.check({ url: /\/home$/ });
  } finally {
    await daily.cleanupAction("delete-thread", { threadId });
  }
});

test("VIEWS-21 thread page chrome", async ({ daily }) => {
  // FINDING COV-VIEWS-21: the thread composer says "Ask a data question..." instead of "Ask a data question and chat in a thread...", and the page has no New thread action.
  test.fail();
  const id = await createThread(daily);
  await daily.open(`/thread/${id}`);
  const composer = daily.page.getByRole("textbox", {
    name: /Message agent|Ask a data question/,
  });
  await expect(composer).toBeVisible(LOAD);
  await daily.check({ url: new RegExp(`/thread/${id}$`) });
  await expect(
    daily.page.getByRole("button", { name: "New thread" }),
  ).toBeVisible(FAST);
  await expect(composer).toContainText(
    "Ask a data question and chat in a thread...",
    FAST,
  );
});

test("VIEWS-22 missing thread shows Thread not found", async ({ daily }) => {
  // FINDING COV-VIEWS-22: a missing thread shows an alert under a spinner that never ends ("Loading chat...") and a disabled composer, not a "Thread not found" page.
  test.fail();
  expectFailedLoad(daily, /get-thread-summary|agent-chat\/threads\//);
  await daily.open("/thread/thread-that-does-not-exist");
  await expect(
    daily.page.getByText("Thread not found", { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(daily.page.getByText("Loading chat...")).toHaveCount(0, FAST);
  await daily.check({ url: /\/thread\/thread-that-does-not-exist$/ });
});

test("VIEWS-23 missing project shows Project not found", async ({ daily }) => {
  expectFailedLoad(daily, /get-project/);
  await daily.open("/project/prj-does-not-exist/latest");
  await expect(daily.page.getByText(/not found/i).first()).toBeVisible(LOAD);
  await expect(
    daily.page.getByText("Project not found", { exact: true }),
  ).toBeVisible(FAST);
  await daily.check({ url: /\/project\/prj-does-not-exist\/latest$/ });
});

test("VIEWS-24 settings shell groups, title and filter", async ({ daily }) => {
  // FINDING COV-VIEWS-24: settings has no Plan & billing group and no settings filter ("No matching settings").
  test.fail();
  await openSettings(daily);
  await expect(daily.page).toHaveTitle("Settings");
  await daily.check({ url: /\/settings/ });
  for (const group of [
    "Account",
    "Workspace",
    "Features",
    "Projects",
    "Access & Security",
  ])
    await expect(
      daily.page.getByText(group, { exact: true }).first(),
    ).toBeVisible();
  await expect(
    daily.page.getByText("Plan & billing", { exact: true }),
  ).toBeVisible(FAST);
  const filter = daily.page
    .getByRole("searchbox")
    .or(daily.page.getByPlaceholder(/search|filter/i))
    .first();
  await filter.fill("zzzz-no-such-setting", FAST);
  await expect(
    daily.page.getByText("No matching settings", { exact: true }),
  ).toBeVisible(FAST);
});

test("VIEWS-25 collection page sort, add and members", async ({ daily }) => {
  const collection = await createCollection(
    daily,
    uniqueName("Views collection"),
  );
  try {
    await daily.open(`/collection/${collection.id}`);
    await expect(daily.page.getByText(collection.name).first()).toBeVisible(
      LOAD,
    );
    await daily.check({ url: new RegExp(`/collection/${collection.id}`) });
    await expect(
      daily.page
        .getByText("Recent additions", { exact: true })
        .or(daily.page.getByRole("button", { name: /Sort/ }))
        .first(),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByText("Collection managers & members", { exact: true }),
    ).toBeVisible(FAST);
  } finally {
    await daily.cleanupAction("delete-collection", {
      collectionId: collection.id,
    });
  }
});

test("VIEWS-26 trash view rows offer Restore and Permanently delete", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Views trashed"));
  await daily.action("trash-project", { projectId: project.id });
  await daily.open("/home/trash");
  await openListRowMenu(daily.page, project.title);
  const menu = daily.menu();
  await expect(menu.getByRole("menuitem", { name: "Restore" })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /Permanently delete/ }),
  ).toBeVisible();
  await daily.press("Escape");
  await expectNoOverlay(daily.page);
  await daily.check({ url: /\/home\/trash$/ });
});

test("VIEWS-27 drafts and folders views", async ({ daily }) => {
  // FINDING COV-VIEWS-27: /home/drafts and /home/folders/<id> show "Page not found".
  test.fail();
  await daily.open("/home/drafts");
  await expect(sidebar(daily.page)).toBeVisible(LOAD);
  await expect(daily.page.getByText("Page not found")).toHaveCount(0, FAST);
  await daily.check({ url: /\/home\/drafts$/ });
});

test("VIEWS-28 tab titles follow the view", async ({ daily }) => {
  // FINDING F6: the browser tab title does not follow the project (it stays the app name).
  test.fail();
  const project = await daily.createProject(uniqueName("Views titled"));
  await openSettings(daily);
  await expect(daily.page).toHaveTitle("Settings");
  await openProjectView(daily, project.id);
  await daily.check({ url: new RegExp(`/project/${project.id}/latest$`) });
  await expect(daily.page).toHaveTitle(project.title, FAST);
});

test("VIEWS-29 archived project shows the archived banner", async ({
  daily,
}) => {
  // FINDING COV-VIEWS-29: an archived project opens with no "This project has been archived" banner or Unarchive action.
  test.fail();
  const project = await daily.createProject(uniqueName("Views archived"));
  await daily.action("archive-project", { projectId: project.id });
  try {
    await openProjectView(daily, project.id);
    await daily.check({ url: new RegExp(`/project/${project.id}/latest$`) });
    await expect(
      daily.page.getByText("This project has been archived"),
    ).toBeVisible(FAST);
    await expect(
      daily.page.getByRole("button", { name: "Unarchive" }),
    ).toBeVisible(FAST);
  } finally {
    await daily.cleanupAction("unarchive-project", { projectId: project.id });
  }
});

test("VIEWS-30 published app run log", async ({ daily }) => {
  // FINDING COV-VIEWS-30: a published app has no Run log ("No previous runs yet" when empty).
  test.fail();
  const project = await daily.createProject(uniqueName("Views published"));
  await publish(daily, project.id);
  await daily.open(`/app/${project.id}`);
  await expect(
    sidebar(daily.page).or(daily.page.locator("main")).first(),
  ).toBeVisible(LOAD);
  await daily.check({ url: new RegExp(`/app/${project.id}`) });
  await expect(daily.page.getByText("Run log", { exact: true })).toBeVisible(
    FAST,
  );
  await expect(
    daily.page.getByText("No previous runs yet", { exact: true }),
  ).toBeVisible(FAST);
});
