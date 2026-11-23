import { expect, test, uniqueName, type Daily } from "./fixtures";
import { searchResponse } from "./objects.helpers";
import {
  FAST,
  MOD,
  openHome,
  openProject,
  projectUrl,
  searchDialog,
  searchInput,
  seedProject,
  seedThread,
} from "./objects.helpers";

// Workspace search and the command palette.

const trash = (daily: Daily, id: string) => daily.cleanupProject(id);

async function openSearch(daily: Daily) {
  await openHome(daily);
  await daily.click(
    daily.page.getByRole("button", { name: "Search", exact: true }),
  );
  await expect(searchInput(daily.page)).toBeFocused();
}

/** A word no other test's object contains, so its results are this test's alone. */
const token = () => uniqueName("Qx").replace(/\s+/g, "");

test("SEARCH-01 open from the sidebar search button", async ({ daily }) => {
  await openHome(daily);
  const button = daily.page.getByRole("button", { name: /^Search/ }).first();
  await expect(button).toContainText("Search");
  await daily.click(button);
  await expect(searchDialog(daily.page)).toBeVisible();
  await daily.check({ url: /\/home$/, focus: searchInput(daily.page) });
});

test("SEARCH-03 empty query shows Recents and the open hint", async ({
  daily,
}) => {
  const p = await seedProject(daily, uniqueName("Recent pick"));
  try {
    await daily.action("touch-project", { projectId: p.id });
    const loaded = searchResponse(daily, "");
    await Promise.all([loaded, openSearch(daily)]);
    const dialog = searchDialog(daily.page);
    await expect(dialog).toContainText(
      "Open the workspace search from anywhere with",
    );
    await daily.check({ url: /\/home$/ });
    await expect(dialog.getByText("Recents", { exact: true })).toBeVisible(
      FAST,
    );
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-04 typing a query lists Projects with the match highlighted", async ({
  daily,
}) => {
  const word = token();
  const p = await seedProject(daily, `Orders ${word}`);
  try {
    await openSearch(daily);
    const loaded = searchResponse(daily, word);
    await daily.type(word);
    await loaded;
    const dialog = searchDialog(daily.page);
    await expect(
      dialog
        .getByRole("menuitem")
        .filter({ has: daily.page.getByText(p.title, { exact: true }) }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      dialog.locator("mark", { hasText: word }).first(),
    ).toBeVisible();
    await daily.check({ url: /\/home$/ });
    await expect(dialog.getByText("Projects", { exact: true })).toBeVisible(
      FAST,
    );
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-05 no results", async ({ daily }) => {
  await openSearch(daily);
  await daily.type("zzzzqq");
  await expect(
    searchDialog(daily.page).getByText("No results found"),
  ).toBeVisible({ timeout: 15_000 });
  await daily.check({ url: /\/home$/ });
});

test("SEARCH-06 a failed search says Something went wrong with the support line", async ({
  daily,
}) => {
  daily.allowResponse = [/search-workspace/];
  await openSearch(daily);
  await daily.page.route(
    "**/_agent-native/actions/search-workspace**",
    (route) => route.fulfill({ status: 500, body: '{"error":"boom"}' }),
  );
  await daily.type("failing query");
  const dialog = searchDialog(daily.page);
  await expect(dialog.getByText("Something went wrong")).toBeVisible({
    timeout: 15_000,
  });
  await daily.check({ url: /\/home$/, allowErrorText: true });
  await expect(dialog).toContainText(
    /Please contact support@\S+ if this persists/,
    FAST,
  );
});

test("SEARCH-07 open a project result with the keyboard", async ({ daily }) => {
  const word = token();
  const p = await seedProject(daily, `Findable ${word}`);
  try {
    await openSearch(daily);
    const loaded = searchResponse(daily, word);
    await daily.type(word);
    await loaded;
    const dialog = searchDialog(daily.page);
    const row = dialog
      .getByRole("menuitem")
      .filter({ has: daily.page.getByText(p.title, { exact: true }) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // First row is "Start a new thread"; the project is next.
    await daily.press("ArrowDown");
    await daily.press("Enter");
    await expect(daily.page).toHaveURL(projectUrl(p.id), { timeout: 15_000 });
    await expect(dialog).toBeHidden();
    await daily.check({ url: projectUrl(p.id) });
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-08 open a thread result", async ({ daily }) => {
  const title = uniqueName("Search daily question");
  const id = await seedThread(daily, title);
  try {
    await daily.action("rename-thread", { threadId: id, title });
    await openSearch(daily);
    let loaded = searchResponse(daily, title);
    await daily.type(title);
    await loaded;
    const dialog = searchDialog(daily.page);
    const row = dialog
      .getByRole("menuitem")
      .filter({ has: daily.page.getByText(title, { exact: true }) });
    await expect(row).toBeVisible();
    await daily.press("ArrowDown");
    await expect(row).toHaveAttribute("data-active", "true");
    await daily.press("Enter");
    await expect(daily.page).toHaveURL(new RegExp(`/thread/${id}$`));
    await daily.check({ url: new RegExp(`/thread/${id}$`) });
    await openSearch(daily);
    loaded = searchResponse(daily, title);
    await daily.type(title);
    await loaded;
    await expect(dialog.getByText("My Threads", { exact: true })).toBeVisible(
      FAST,
    );
  } finally {
    await daily.cleanupAction("delete-thread", { threadId: id });
  }
});

test("SEARCH-09 start a thread from search", async ({ daily }) => {
  await openSearch(daily);
  const question = "How many orders are there?";
  await daily.type(question);
  const dialog = searchDialog(daily.page);
  await expect(
    dialog.getByRole("menuitem", { name: /Start a new thread/ }),
  ).toBeVisible();
  await expect(dialog).toContainText(`Ask “${question}”`);
  await daily.press("Enter");
  await expect(daily.page).toHaveURL(/\/thread\/[^/]+$/, { timeout: 30_000 });
  await expect(daily.page.getByText(question).first()).toBeVisible({
    timeout: 30_000,
  });
  await daily.check({ url: /\/thread\/[^/]+$/ });
  const id = /\/thread\/([^/?#]+)/.exec(daily.page.url())![1]!;
  await daily.open("/home");
  await daily.cleanupAction("delete-thread", { threadId: id });
});

test("SEARCH-10 filters", async ({ daily }) => {
  await openSearch(daily);
  await daily.type("orders");
  const dialog = searchDialog(daily.page);
  const filters = dialog.getByLabel("Search filters");
  for (const name of [
    "Search by",
    "Status",
    "Category",
    "Date",
    "Include archived",
  ])
    await expect(
      filters.getByText(name, { exact: false }).first(),
      name,
    ).toBeVisible();
  await filters.getByText("Search by").first().click();
  await expect(dialog.getByText("Cell contents (text + code)")).toBeVisible();
  await daily.check({ url: /\/home$/ });
});

test("SEARCH-11 Escape closes and returns focus", async ({ daily }) => {
  await openHome(daily);
  const button = daily.page.getByRole("button", { name: /^Search/ }).first();
  await button.click();
  await expect(searchInput(daily.page)).toBeFocused();
  await daily.type("orders");
  await daily.press("Escape");
  await expect(searchDialog(daily.page)).toBeHidden();
  await daily.check({ url: /\/home$/, focus: button });
});

test("SEARCH-12 scrolling reaches every result", async ({ daily }) => {
  const word = token();
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      daily.createProject(`Page ${word} ${String(i).padStart(2, "0")}`),
    ),
  );
  await openSearch(daily);
  const loaded = searchResponse(daily, word);
  await daily.type(word);
  await loaded;
  const dialog = searchDialog(daily.page);
  const rows = dialog.getByRole("menuitem").filter({
    has: daily.page.locator(".ws-search-row-title", {
      hasText: new RegExp(`^Page ${word} `),
    }),
  });
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(30);
  await expect(rows.last()).toBeInViewport();
  await daily.check({ url: /\/home$/ });
});

test("SEARCH-13 find cells in a project", async ({ daily }) => {
  test.fail(); // FINDING COV-SEARCH-06: the project Find panel input is not "Search for cells"
  const p = await seedProject(daily, uniqueName("Find cells"), [
    "sql",
    "markdown",
  ]);
  try {
    await openProject(daily, p.id);
    await daily.page.getByRole("button", { name: "Find", exact: true }).click();
    const input = daily.page.getByPlaceholder("Search for cells");
    await expect(input).toBeVisible(FAST);
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-14 search data in the data panel", async ({ daily }) => {
  test.fail(); // FINDING COV-SEARCH-07: the data browser input is not "Search for tables, models, or projects"
  const p = await seedProject(daily, uniqueName("Data panel"));
  try {
    await openProject(daily, p.id);
    await daily.page
      .getByRole("button", { name: "Data browser", exact: true })
      .click();
    await expect(
      daily.page.getByPlaceholder("Search for tables, models, or projects"),
    ).toBeVisible(FAST);
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-15 command palette applies the dark theme", async ({ daily }) => {
  const p = await seedProject(daily, uniqueName("Palette"));
  try {
    await openProject(daily, p.id);
    await daily.page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur?.(),
    );
    await daily.page.keyboard.press(`${MOD}+p`);
    await daily.page.keyboard.type("dark");
    await expect(daily.page.getByText("Theme: Enable Dark theme")).toBeVisible(
      FAST,
    );
  } finally {
    await trash(daily, p.id);
  }
});

test("SEARCH-16 command palette with no match is empty and Escape closes", async ({
  daily,
}) => {
  const p = await seedProject(daily, uniqueName("Palette none"));
  try {
    await openProject(daily, p.id);
    await daily.page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur?.(),
    );
    await daily.page.keyboard.press(`${MOD}+p`);
    const palette = daily.page.getByRole("dialog");
    await expect(palette).toBeVisible(FAST);
    await daily.page.keyboard.type("qqzzxx");
    await expect(palette.getByRole("option")).toHaveCount(0);
    await daily.press("Escape");
    await expect(palette).toBeHidden();
  } finally {
    await trash(daily, p.id);
  }
});

test("report K-ANA-5-1 opens URL search and restores it on reload and back", async ({
  daily,
}) => {
  const first = token();
  const second = token();
  const a = await seedProject(daily, `Revenue ${first}`);
  const b = await seedProject(daily, `Churn ${second}`);
  const row = (title: string) =>
    searchDialog(daily.page)
      .getByRole("menuitem")
      .filter({ has: daily.page.getByText(title, { exact: true }) });
  try {
    await test.step("direct URL and reload", async () => {
      await daily.open(`/home/search?q=${encodeURIComponent(first)}`);
      await expect(searchInput(daily.page)).toHaveValue(first);
      await expect(row(a.title)).toBeVisible({ timeout: 15_000 });
      await daily.page.reload({
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      await expect(searchInput(daily.page)).toHaveValue(first);
      await expect(row(a.title)).toBeVisible({ timeout: 15_000 });
    });
    await test.step("edit URL query and navigate", async () => {
      await searchInput(daily.page).fill(second);
      await expect(daily.page).toHaveURL(
        (url) =>
          url.pathname.endsWith("/home/search") &&
          url.searchParams.get("q") === second,
      );
      await expect(row(b.title)).toBeVisible({ timeout: 15_000 });
      await daily.open(`/home/search?q=${encodeURIComponent(first)}`);
      await expect(row(a.title)).toBeVisible({ timeout: 15_000 });
    });
    await test.step("back and close", async () => {
      await daily.page.evaluate(() => history.back());
      await expect(daily.page).toHaveURL(
        (url) =>
          url.pathname.endsWith("/home/search") &&
          url.searchParams.get("q") === second,
      );
      await expect(searchInput(daily.page)).toHaveValue(second);
      await expect(row(b.title)).toBeVisible({ timeout: 15_000 });
      const documentBeforeClose = await daily.documentId();
      await searchInput(daily.page).press("Escape");
      await expect(daily.page).toHaveURL(/\/home$/);
      await expect(searchDialog(daily.page)).toBeHidden();
      expect(await daily.documentId()).toBe(documentBeforeClose);
    });
    await test.step("legacy /home?search= param opens search", async () => {
      await daily.open(`/home?search=${encodeURIComponent(first)}`);
      await expect(searchInput(daily.page)).toHaveValue(first);
      await expect(row(a.title)).toBeVisible({ timeout: 15_000 });
      await searchInput(daily.page).press("Escape");
      await expect(daily.page).toHaveURL(/\/home$/);
      await expect(searchDialog(daily.page)).toBeHidden();
    });
  } finally {
    await trash(daily, a.id);
    await trash(daily, b.id);
  }
});
