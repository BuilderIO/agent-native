import { waitForSendReady } from "./ask.helpers";
import { expect, test, uniqueName } from "./fixtures";
import {
  FAST,
  MOD,
  blurToBody,
  homePrompt,
  openHome,
  openProjectView,
  pressFor,
  projectIdFromUrl,
  searchDialog,
  searchInput,
  trashProject,
} from "./keys.helpers";
import { searchResponse, seedThread } from "./objects.helpers";
import { createConnection, deleteConnections } from "./setup.helpers";

// Workspace-wide shortcuts: Home, the workspace search, dialogs.

test("KEYS-01 / opens the workspace search from Home", async ({ daily }) => {
  await openHome(daily);
  await pressFor(daily, "Slash", () =>
    expect(searchDialog(daily.page)).toBeVisible(FAST),
  );
  await daily.check({ url: /\/home$/, focus: searchInput(daily.page) });
  await expect(searchInput(daily.page)).toHaveValue("");
  await daily.press("Escape");
  await expect(searchDialog(daily.page)).toBeHidden();
  await daily.check({ url: /\/home$/ });
  // Not on a project view (desktop layout): "/" stays with the page.
  const project = await daily.createProject(uniqueName("Keys slash"));
  await openProjectView(daily, project.id, 0);
  await blurToBody(daily.page);
  await daily.press("Slash", { feedback: false });
  await expect(searchDialog(daily.page)).toBeHidden();
  await daily.check({ url: new RegExp(`/project/${project.id}/`) });
  await trashProject(daily, project.id);
});

for (const view of ["", "/app"] as const) {
  test(`KEYS-02 mod+k opens search inside the ${view ? "app builder title editor" : "notebook editor"}`, async ({
    daily,
  }) => {
    const project = await daily.createProject(uniqueName("Keys modk"));
    if (!view)
      await daily.action("add-project-cell", {
        projectId: project.id,
        kind: "sql",
      });
    await openProjectView(daily, project.id, view ? 0 : 1, view);
    if (view) {
      await daily.page
        .getByRole("button", { name: "Project options", exact: true })
        .click();
      await daily.page
        .getByRole("menuitem", { name: "Rename", exact: true })
        .click();
    }
    const input = view
      ? daily.page.getByRole("textbox", { name: "Project title", exact: true })
      : daily.page.locator(".nb-sql-editor .cm-content").first();
    await expect(input).toBeEditable({ timeout: 30_000 });
    await input.focus();
    await pressFor(daily, `${MOD}+KeyK`, () =>
      expect(searchDialog(daily.page)).toBeVisible(FAST),
    );
    await daily.check({
      url: new RegExp(`/project/${project.id}/latest${view}$`),
      focus: searchInput(daily.page),
    });
    await daily.type("abc");
    await daily.press(`${MOD}+KeyK`, { feedback: false });
    await expect(searchDialog(daily.page)).toBeVisible();
    await expect(searchInput(daily.page)).toHaveValue("abc");
    await daily.press("Escape");
    await daily.check({
      url: new RegExp(`/project/${project.id}/latest${view}$`),
    });
    await trashProject(daily, project.id);
  });
}

test("KEYS-03 mod+shift+/ opens the shortcut list", async ({ daily }) => {
  await openHome(daily);
  const dialog = daily.page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await pressFor(daily, `${MOD}+Shift+Slash`, () =>
    expect(dialog).toBeVisible(FAST),
  );
  await daily.check({
    url: /\/home$/,
    focus: dialog.getByPlaceholder("Filter shortcuts..."),
  });
});

test("KEYS-05 alt+shift+n acknowledges a slow create and opens the project", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-CREATE-FEEDBACK: the shortcut waits for the create response before any visible acknowledgement.
  await openHome(daily);
  await expect(
    daily.page.locator(
      '[aria-busy="true"]:visible, [role="progressbar"]:visible, .animate-spin:visible',
    ),
  ).toHaveCount(0);
  let id: string | null = null;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await daily.page.route(
    /\/_agent-native\/actions\/create-project(?:\?|$)/,
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const result = await response.json();
      id = result.id;
      await gate;
      await route.fulfill({ response });
    },
  );
  try {
    await daily.press("Alt+Shift+KeyN");
    await expect
      .poll(
        () =>
          daily.page.evaluate(() => {
            const record = (
              window as unknown as { __daily: { keys: { t: number }[] } }
            ).__daily.keys.at(-1);
            const projectButton = [...document.querySelectorAll("button")].find(
              (button) => button.textContent?.trim() === "Project",
            );
            const busy = [
              ...document.querySelectorAll(
                '[aria-busy="true"], [role="progressbar"], .animate-spin',
              ),
            ].some((element) => element.getClientRects().length > 0);
            return (
              record !== undefined &&
              performance.now() - record.t <= 400 &&
              (location.pathname !== "/home" ||
                projectButton?.disabled === true ||
                busy)
            );
          }),
        FAST,
      )
      .toBe(true);
    release();
    await expect(daily.page).toHaveURL(/\/project\/[^/]+/, { timeout: 5_000 });
    await expect(
      daily.page.getByRole("button", { name: "Notebook", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await daily.check({ url: /\/project\/[^/]+\/latest/ });
  } finally {
    release();
    await daily.page.unrouteAll({ behavior: "wait" });
    await trashProject(daily, id ?? projectIdFromUrl(daily.page.url()));
  }
});

test("KEYS-06 alt+shift+c creates a new component", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-02: alt+shift+c does nothing (no new component, no upgrade copy)
  await openHome(daily);
  await pressFor(daily, "Alt+Shift+KeyC", () =>
    expect(daily.page).toHaveURL(/\/component\//, FAST),
  );
  await daily.check({ url: /\/component\// });
});

test("KEYS-07 alt+shift+l opens the new-collection dialog", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-03: alt+shift+l does nothing
  await openHome(daily);
  await pressFor(daily, "Alt+Shift+KeyL", () =>
    expect(
      daily.page.getByRole("dialog").filter({ hasText: /collection/i }),
    ).toBeVisible(FAST),
  );
  await daily.check({ url: /\/home\/collections/ });
});

test("KEYS-08 alt+shift+u opens the import-project flow", async ({ daily }) => {
  await openHome(daily);
  await pressFor(daily, "Alt+Shift+KeyU", () =>
    expect(
      daily.page.getByRole("dialog").filter({ hasText: /import/i }),
    ).toBeVisible(FAST),
  );
  await daily.check();
});

test("KEYS-87 Escape closes only the topmost overlay", async ({ daily }) => {
  await openHome(daily);
  await daily.press(`${MOD}+KeyK`);
  await expect(searchDialog(daily.page)).toBeVisible();
  await daily.click(
    searchDialog(daily.page).getByRole("button", { name: /Creator/ }),
    { label: "Creator filter" },
  );
  const submenu = searchDialog(daily.page).locator(
    ".ws-search-filter [role=menu]",
  );
  await expect(submenu).toBeVisible();
  await pressFor(daily, "Escape", () => expect(submenu).toBeHidden(FAST));
  await expect(searchDialog(daily.page)).toBeVisible();
  await daily.check({ url: /\/home$/ });
  await pressFor(daily, "Escape", () =>
    expect(searchDialog(daily.page)).toBeHidden(FAST),
  );
  await daily.check({ url: /\/home$/ });
});

test("KEYS-88 mod+enter confirms the New project dialog", async ({ daily }) => {
  test.fail(); // FINDING COV-CREATE-SUBMIT: Mod+Enter does not submit the new-project dialog.
  await openHome(daily);
  const title = uniqueName("Keys modenter");
  let id: string | null = null;
  try {
    await daily.click(
      daily.page.getByRole("button", { name: "Project", exact: true }),
      { label: "Project" },
    );
    const dialog = daily.page
      .getByRole("dialog")
      .filter({ hasText: "New project" });
    await expect(dialog).toBeVisible();
    await daily.type(title);
    await pressFor(daily, `${MOD}+Enter`, () =>
      expect(daily.page).toHaveURL(/\/project\/[^/]+/, { timeout: 5_000 }),
    );
    id = projectIdFromUrl(daily.page.url());
    await expect(daily.page.getByText(title).first()).toBeVisible({
      timeout: 15_000,
    });
    await daily.check({ url: /\/project\/[^/]+\/latest/ });
  } finally {
    await trashProject(daily, id ?? projectIdFromUrl(daily.page.url()));
  }
});

// Reference: 43a17729:46–68, the rename dialog's Enter handler.
test("KEYS-89 Enter applies a thread rename", async ({ daily }) => {
  const id = await seedThread(daily, uniqueName("Keyboard rename"));
  const thread = { id };
  try {
    await daily.open("/home/threads");
    const row = daily.page
      .locator("main")
      .getByRole("listitem")
      .filter({ has: daily.page.locator(`a[href$="/thread/${thread.id}"]`) });
    await expect(
      daily.page.getByRole("heading", { name: "Threads", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /^Actions for / }).click();
    await daily.page
      .getByRole("menuitem", { name: "Rename", exact: true })
      .click();
    const input = daily.page.getByPlaceholder("Thread title");
    await expect(input).toBeFocused();
    const name = uniqueName("Renamed thread");
    await input.fill(name);
    await pressFor(daily, "Enter", () => expect(input).toBeHidden());
    await expect(row).toContainText(name);
    await daily.check({ url: /\/home\/threads$/ });
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: thread.id });
  }
});

test("KEYS-90 mod+enter in a data-browser table preview queries the table", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-QUERY-TABLE: the table preview has no Query entry or Mod+Enter action.
  const name = uniqueName("Keyboard table");
  try {
    await createConnection(daily, name);
    await daily.open("/home/data");
    await daily.page.getByText(name, { exact: true }).first().click();
    await daily.page.getByText("daily_sales", { exact: true }).first().click();
    await daily.page.getByText("orders", { exact: true }).first().click();
    await expect(
      daily.page.getByRole("button", { name: /Query/ }).first(),
    ).toBeVisible();
    await blurToBody(daily.page);
    await pressFor(daily, `${MOD}+Enter`, () =>
      expect(daily.page).toHaveURL(/\/(project|thread)\//, FAST),
    );
    await daily.check();
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("KEYS-91 Down/Up move the search highlight and clamp at the ends", async ({
  daily,
}) => {
  for (const n of [1, 2, 3]) {
    const project = await daily.createProject(
      uniqueName(`Search highlight ${n}`),
    );
    await daily.action("touch-project", { projectId: project.id });
  }
  await openHome(daily);
  await daily.press(`${MOD}+KeyK`);
  const rows = searchDialog(daily.page).locator(".ws-search-row");
  await expect(rows.nth(2)).toBeVisible({ timeout: 10_000 });
  const active = () =>
    rows.evaluateAll((els) =>
      els.findIndex((e) => e.getAttribute("data-active") === "true"),
    );
  await expect.poll(active).toBe(0);
  await pressFor(daily, "ArrowDown", () => expect.poll(active, FAST).toBe(1));
  await pressFor(daily, "ArrowUp", () => expect.poll(active, FAST).toBe(0));
  await daily.press("ArrowUp", { feedback: false });
  await expect.poll(active).toBe(0);
  await daily.check({ url: /\/home$/, focus: searchInput(daily.page) });
  await expect(searchInput(daily.page)).toHaveAttribute(
    "aria-activedescendant",
    /row-0$/,
  );
});

test("KEYS-93 mod+enter opens the highlighted result in a new tab", async ({
  daily,
}) => {
  const project = await daily.createProject(uniqueName("Keys newtab result"));
  await openHome(daily);
  await daily.press(`${MOD}+KeyK`);
  const loaded = searchResponse(daily, project.title);
  await daily.type(project.title);
  await loaded;
  const row = searchDialog(daily.page)
    .locator(".ws-search-row")
    .filter({ has: daily.page.getByText(project.title, { exact: true }) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await daily.press("ArrowDown");
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(
    searchDialog(daily.page).getByText("Open in new tab"),
  ).toBeVisible();
  const popup = daily.context.waitForEvent("page", { timeout: 5_000 });
  const [tab] = await Promise.all([
    popup,
    pressFor(daily, `${MOD}+Enter`, () =>
      expect(searchDialog(daily.page)).toBeHidden(FAST),
    ),
  ]);
  await expect(tab).toHaveURL(new RegExp(`/project/${project.id}`));
  await tab.close();
  await daily.check({ url: /\/home$/ });
  await trashProject(daily, project.id);
});

test("KEYS-94 search footer hints follow the query", async ({ daily }) => {
  await openHome(daily);
  await daily.press(`${MOD}+KeyK`);
  const footer = searchDialog(daily.page).locator(".ws-search-footer");
  await expect(footer).toContainText(
    "Open the workspace search from anywhere with",
  );
  await expect(footer.locator("kbd")).toHaveText(/K/);
  await daily.type("rev");
  for (const hint of ["Up", "Down", "Open", "Open in new tab"])
    await expect(footer.getByText(hint, { exact: true })).toBeVisible();
  await daily.check({ url: /\/home$/, focus: searchInput(daily.page) });
});

test("KEYS-98 Enter sends the Home question; Shift+Enter inserts a newline", async ({
  daily,
}) => {
  await openHome(daily);
  const prompt = homePrompt(daily.page);
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.click();
  await daily.type("Which orders");
  await daily.press("Shift+Enter");
  await daily.type("are largest?");
  await expect(daily.page).toHaveURL(/\/home$/);
  await expect(prompt).toContainText("are largest?");
  await waitForSendReady(daily.page);
  await pressFor(daily, "Enter", () =>
    expect(daily.page).toHaveURL(/\/thread\/[^/]+/, { timeout: 5_000 }),
  );
  await expect(daily.page.getByText("Which orders").first()).toBeVisible({
    timeout: 15_000,
  });
  await daily.check({ url: /\/thread\/[^/]+/ });
});

test("KEYS-99 / typed in the Home prompt stays a literal slash", async ({
  daily,
}) => {
  await openHome(daily);
  const prompt = homePrompt(daily.page);
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.click();
  await daily.press("Slash");
  await expect(prompt).toContainText("/");
  await expect(searchDialog(daily.page)).toBeHidden();
  await daily.check({ url: /\/home$/, focus: prompt });
});
