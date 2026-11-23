import { expect, test, uniqueName, type Daily } from "./fixtures";
import {
  FAST,
  MOD,
  nextAction,
  openProjectView,
  pressFor,
  trashProject,
} from "./keys.helpers";
import {
  SAMPLE_CONNECTION,
  cellAt,
  cellLocator,
  delayRuns,
  enterCommandMode,
  seedNotebook,
  type Notebook,
} from "./notebook.helpers";
import { publish } from "./objects.helpers";

// Project-level shortcuts (notebook, app builder, graph, command palette). Each test starts the way
// a daily user does: the project open, a cell selected in command mode.

const SQL = (text: string) => ({
  kind: "sql" as const,
  text,
  connection: SAMPLE_CONNECTION,
});

async function project(
  daily: Daily,
  cells = 2,
  view: "" | "/app" = "",
): Promise<Notebook> {
  const nb = await seedNotebook(
    daily,
    Array.from({ length: cells }, (_, i) => SQL(`select ${i + 1} as n`)),
    uniqueName("Keys project"),
  );
  await openProjectView(daily, nb.id, view === "" ? cells : 0, view);
  return nb;
}

const at = (nb: Notebook, view = "") =>
  new RegExp(`/project/${nb.id}/latest${view}(?:[?#].*)?$`);
const palette = (daily: Daily) =>
  daily.page
    .getByRole("dialog")
    .filter({ has: daily.page.getByRole("textbox") })
    .or(daily.page.getByRole("combobox"))
    .first();
const graph = (daily: Daily) =>
  daily.page.locator('[aria-label*="graph" i], [data-view="graph"]').first();

test.afterEach(async ({ daily }) => {
  const id = /\/project\/([^/?#]+)/.exec(daily.page.url())?.[1] ?? null;
  await trashProject(daily, id);
});

test("KEYS-09 alt+shift+` toggles the left sidebar", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-09: alt+shift+` toggles the left sidebar is unavailable.
  const nb = await project(daily);
  await enterCommandMode(daily, 0);
  const rail = daily.page.getByRole("navigation", { name: "Workspace tools" });
  await expect(rail).toBeVisible();
  await pressFor(daily, "Alt+Shift+Backquote", () =>
    expect(rail).toBeHidden(FAST),
  );
  await daily.check({ url: at(nb) });
  await pressFor(daily, "Alt+Shift+Backquote", () =>
    expect(rail).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-10 alt+shift+1 goes to the notebook view", async ({ daily }) => {
  const nb = await project(daily, 1, "/app");
  await daily.page
    .getByRole("button", { name: "Notebook", exact: true })
    .focus();
  await pressFor(daily, "Alt+Shift+Digit1", () =>
    expect(daily.page).toHaveURL(
      new RegExp(`/project/${nb.id}/latest(?:/logic)?$`),
      FAST,
    ),
  );
  await expect(cellLocator(daily.page)).toHaveCount(1);
  await daily.check({
    url: new RegExp(`/project/${nb.id}/latest(?:/logic)?$`),
  });
});

test("KEYS-11 alt+shift+2 goes to the app builder", async ({ daily }) => {
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+Shift+Digit2", () =>
    expect(daily.page).toHaveURL(at(nb, "/app"), FAST),
  );
  await daily.check({ url: at(nb, "/app") });
});

test("KEYS-12 alt+shift+3 opens split screen", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-12: alt+shift+3 opens split screen is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+Shift+Digit3", () =>
    expect(daily.page).toHaveURL(
      new RegExp(`/project/${nb.id}/[^?#]*split`),
      FAST,
    ),
  );
  await daily.check();
});

test("KEYS-13 alt+shift+4 toggles the graph", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-13: alt+shift+4 toggles the graph is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+Shift+Digit4", () =>
    expect(graph(daily)).toBeVisible(FAST),
  );
  await daily.check({ url: new RegExp(`/project/${nb.id}/`) });
});

test("KEYS-14 mod+i toggles the agent", async ({ daily }) => {
  test.fail(); // FINDING COV-AGENT-TOGGLE: Mod+I leaves the agent visible.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const prompt = daily.page
    .getByRole("complementary", { name: "Agent" })
    .getByRole("textbox", { name: /Message agent/ });
  const wasOpen = await prompt.isVisible();
  await pressFor(daily, `${MOD}+KeyI`, () =>
    wasOpen
      ? expect(prompt).toBeHidden(FAST)
      : expect(prompt).toBeVisible(FAST),
  );
  await daily.check({ url: new RegExp(`/project/${nb.id}/`) });
  await expect(cellLocator(daily.page)).toHaveCount(1);
  await pressFor(daily, `${MOD}+KeyI`, () =>
    wasOpen
      ? expect(prompt).toBeVisible(FAST)
      : expect(prompt).toBeHidden(FAST),
  );
  await daily.check({ url: new RegExp(`/project/${nb.id}/`) });
});

test("KEYS-15 mod+; moves focus between the agent prompt and the notebook", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-AGENT-FOCUS: Mod+; leaves focus outside the agent prompt.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const prompt = daily.page
    .getByRole("complementary", { name: "Agent" })
    .getByRole("textbox", { name: /Message agent/ });
  await pressFor(daily, `${MOD}+Semicolon`, () =>
    expect(prompt).toBeFocused(FAST),
  );
  await daily.check({ url: at(nb) });
  await pressFor(daily, `${MOD}+Semicolon`, () =>
    expect(prompt).not.toBeFocused(FAST),
  );
  await expect
    .poll(
      () =>
        daily.page.evaluate(
          () => !!document.activeElement?.closest("[data-notebook-cell]"),
        ),
      FAST,
    )
    .toBe(true);
  await daily.check({ url: at(nb) });
});

test("KEYS-16 mod+p opens the command palette; Escape closes it", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-16: mod+p opens the command palette; Escape closes it is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, `${MOD}+KeyP`, () =>
    expect(palette(daily)).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
  await daily.press("Escape");
  await expect(palette(daily)).toBeHidden();
  await daily.check({ url: at(nb) });
});

test("KEYS-17 mod+shift+p opens Publish app", async ({ daily }) => {
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const dialog = daily.page.getByRole("dialog", { name: "Publish app" });
  await pressFor(daily, `${MOD}+Shift+KeyP`, () =>
    expect(dialog).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb), focus: dialog.getByRole("textbox") });
  await daily.press("Escape");
  await expect(dialog).toBeHidden();
  await daily.check({ url: at(nb) });
});

test("KEYS-18 mod+f opens project Find with the input focused", async ({
  daily,
}) => {
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const input = daily.page.getByRole("searchbox", { name: "Find..." });
  await pressFor(daily, `${MOD}+KeyF`, () => expect(input).toBeFocused(FAST));
  await daily.check({ url: at(nb), focus: input });
});

test("KEYS-19 mod+shift+f opens project Find", async ({ daily }) => {
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const input = daily.page.getByRole("searchbox", { name: "Find..." });
  await pressFor(daily, `${MOD}+Shift+KeyF`, () =>
    expect(input).toBeFocused(FAST),
  );
  await daily.check({ url: at(nb), focus: input });
});

test("KEYS-20 alt+mod+f opens Find with a replace row", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-20: alt+mod+f opens Find with a replace row is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, `Alt+${MOD}+KeyF`, () =>
    expect(
      daily.page
        .getByRole("textbox", { name: /Replace/ })
        .or(daily.page.getByPlaceholder(/Replace/))
        .first(),
    ).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-21 mod+z undoes a cell delete", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-21: mod+z undoes a cell delete is unavailable.
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 0);
  await daily.press("KeyD", { feedback: false });
  await daily.press("KeyD");
  await expect(cellLocator(daily.page)).toHaveCount(1);
  await daily.page.locator("body").click({ position: { x: 5, y: 5 } });
  await pressFor(daily, `${MOD}+KeyZ`, () =>
    expect(cellLocator(daily.page)).toHaveCount(2, FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-22 mod+shift+z redoes the undone delete", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-22: mod+shift+z redoes the undone delete is unavailable.
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 0);
  await daily.press("KeyD", { feedback: false });
  await daily.press("KeyD");
  await expect(cellLocator(daily.page)).toHaveCount(1);
  await daily.page.locator("body").click({ position: { x: 5, y: 5 } });
  await daily.page.keyboard.press(`${MOD}+KeyZ`);
  await expect(cellLocator(daily.page)).toHaveCount(2, FAST);
  await pressFor(daily, `${MOD}+Shift+KeyZ`, () =>
    expect(cellLocator(daily.page)).toHaveCount(1, FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-23 mod+s opens Save version", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-23: mod+s opens Save version is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  const dialog = daily.page.getByRole("dialog", { name: "Save a version" });
  await pressFor(daily, `${MOD}+KeyS`, () => expect(dialog).toBeVisible(FAST));
  await expect(
    dialog.getByRole("button", { name: "Save version" }),
  ).toBeVisible();
  await daily.check({ url: at(nb) });
});

test("KEYS-24 alt+shift+v opens import version", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-24: alt+shift+v opens import version is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+Shift+KeyV", () =>
    expect(
      daily.page.getByRole("dialog").filter({ hasText: /Import/ }),
    ).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-25 alt+shift+e opens export project", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-25: alt+shift+e opens export project is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+Shift+KeyE", () =>
    expect(
      daily.page
        .getByRole("dialog")
        .or(daily.page.getByRole("menu"))
        .filter({ hasText: /Export/ })
        .first(),
    ).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-26 alt+r restarts and runs all", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-26: alt+r restarts and runs all is unavailable.
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 0);
  const ran = nextAction(daily.page, "run-project-cell");
  await daily.page.keyboard.press("Alt+KeyR");
  expect(await ran, "alt+r sent a cell run").toBe(true);
  await daily.check({ url: at(nb) });
});

test("KEYS-27 alt+mod+i interrupts a running cell", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-27: alt+mod+i interrupts a running cell is unavailable.
  await delayRuns(daily.page, 4_000);
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await daily.page.keyboard.press(`${MOD}+Shift+KeyA`);
  await expect(daily.page.getByText(/Running/).first()).toBeVisible(FAST);
  await pressFor(daily, `Alt+${MOD}+KeyI`, () =>
    expect(cellAt(daily.page, 0).getByText("Cancelled")).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-28 mod+shift+a runs all cells with the Running... label", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-28: mod+shift+a runs all cells with the Running... label is unavailable.
  await delayRuns(daily.page, 1_500);
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 0);
  const ran = nextAction(daily.page, "run-project-cell");
  await pressFor(daily, `${MOD}+Shift+KeyA`, () =>
    expect(daily.page.getByRole("button", { name: "Running..." })).toBeVisible(
      FAST,
    ),
  );
  expect(await ran).toBe(true);
  await expect(daily.page.getByRole("button", { name: "Run all" })).toBeVisible(
    { timeout: 10_000 },
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-29 mod+shift+s runs the cell and its upstream", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-29: mod+shift+s runs the cell and its upstream is unavailable.
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 1);
  const ran = nextAction(daily.page, "run-project-cell");
  await daily.page.keyboard.press(`${MOD}+Shift+KeyS`);
  expect(await ran, "mod+shift+s sent a cell run").toBe(true);
  await daily.check({ url: at(nb) });
});

test("KEYS-30 mod+shift+d runs only the selected cell", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-30: mod+shift+d runs only the selected cell is unavailable.
  const nb = await project(daily, 2);
  await enterCommandMode(daily, 1);
  const ran = nextAction(daily.page, "run-project-cell");
  await daily.page.keyboard.press(`${MOD}+Shift+KeyD`);
  expect(await ran, "mod+shift+d sent a cell run").toBe(true);
  await daily.check({ url: at(nb) });
});

test("KEYS-32 alt+up jumps to the top of the project", async ({ daily }) => {
  const nb = await project(daily, 3);
  await enterCommandMode(daily, 2);
  await pressFor(daily, "Alt+ArrowUp", () =>
    expect(cellAt(daily.page, 0)).toBeFocused(FAST),
  );
  await expect(cellAt(daily.page, 0)).toBeInViewport();
  await daily.check({ url: at(nb), focus: cellAt(daily.page, 0) });
});

test("KEYS-33 alt+down jumps to the bottom of the project", async ({
  daily,
}) => {
  const nb = await project(daily, 3);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Alt+ArrowDown", () =>
    expect(cellAt(daily.page, 2)).toBeFocused(FAST),
  );
  await expect(cellAt(daily.page, 2)).toBeInViewport();
  await daily.check({ url: at(nb), focus: cellAt(daily.page, 2) });
});

test("KEYS-34 shift+h opens cell history", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-34: shift+h opens cell history is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await pressFor(daily, "Shift+KeyH", () =>
    expect(daily.page.getByText(/cell history/i).first()).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-35 shift+] jumps to the next active cell", async ({ daily }) => {
  test.fail(); // FINDING COV-KEYS-35: shift+] jumps to the next active cell is unavailable.
  const nb = await project(daily, 3);
  await enterCommandMode(daily, 0);
  await enterCommandMode(daily, 2);
  await daily.page.keyboard.press("Shift+BracketLeft");
  await expect(cellAt(daily.page, 0)).toBeFocused(FAST);
  await pressFor(daily, "Shift+BracketRight", () =>
    expect(cellAt(daily.page, 2)).toBeFocused(FAST),
  );
  await daily.check({ url: at(nb) });
});

test("KEYS-36 shift+[ jumps to the previously active cell", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-36: shift+[ jumps to the previously active cell is unavailable.
  const nb = await project(daily, 3);
  await enterCommandMode(daily, 0);
  await enterCommandMode(daily, 2);
  await pressFor(daily, "Shift+BracketLeft", () =>
    expect(cellAt(daily.page, 0)).toBeFocused(FAST),
  );
  await daily.check({ url: at(nb) });
});

async function publishedApp(daily: Daily) {
  const nb = await seedNotebook(
    daily,
    [{ kind: "markdown", text: "# Keys app" }],
    uniqueName("Keys app"),
  );
  await publish(daily, nb.id);
  await daily.open(`/app/${nb.id}`);
  await expect(daily.page.getByText("Keys app").first()).toBeVisible({
    timeout: 30_000,
  });
  return nb;
}
const presenting = (daily: Daily) =>
  expect
    .poll(
      () =>
        daily.page.evaluate(
          () =>
            !!document.fullscreenElement ||
            !!document.querySelector(
              '[data-presenting], [class*="present" i], [aria-label*="presentation" i]',
            ),
        ),
      FAST,
    )
    .toBe(true);

test("KEYS-77 mod+. presents the app from the current tab", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-77: mod+. presents the app from the current tab is unavailable.
  const nb = await publishedApp(daily);
  await pressFor(daily, `${MOD}+Period`, () => presenting(daily));
  await daily.check({ url: new RegExp(`/app/${nb.id}`) });
  await trashProject(daily, nb.id);
});

test("KEYS-78 shift+mod+. presents the app from the start", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-78: shift+mod+. presents the app from the start is unavailable.
  const nb = await publishedApp(daily);
  await pressFor(daily, `Shift+${MOD}+Period`, () => presenting(daily));
  await daily.check({ url: new RegExp(`/app/${nb.id}`) });
  await trashProject(daily, nb.id);
});

const selectMode = (daily: Daily) =>
  daily.page
    .locator('[aria-pressed="true"], [aria-checked="true"], [data-state="on"]')
    .filter({ hasText: /select/i })
    .or(daily.page.getByText(/select mode/i))
    .first();

test("KEYS-79 mod+e toggles select mode in the app builder", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-79: mod+e toggles select mode in the app builder is unavailable.
  const nb = await project(daily, 1, "/app");
  await daily.page.locator(".nb-project-title").first().focus();
  await daily.page.keyboard.press("Escape");
  await pressFor(daily, `${MOD}+KeyE`, () =>
    expect(selectMode(daily)).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb, "/app") });
});

test("KEYS-80 p / e / i switch preview, select and inspect in the app builder", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-80: p / e / i switch preview, select and inspect in the app builder is unavailable.
  const nb = await project(daily, 1, "/app");
  await daily.page.locator(".nb-project-title").first().focus();
  await daily.page.keyboard.press("Escape");
  await pressFor(daily, "KeyE", () =>
    expect(selectMode(daily)).toBeVisible(FAST),
  );
  await pressFor(daily, "KeyI", () =>
    expect(daily.page.getByText(/inspect/i).first()).toBeVisible(FAST),
  );
  await pressFor(daily, "KeyP", () =>
    expect(selectMode(daily)).toBeHidden(FAST),
  );
  await daily.check({ url: at(nb, "/app") });
});

test("KEYS-81 mod+shift+c / mod+shift+v copy and paste chart style", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-CHART-STYLE: copying a chart style gives no confirmation.
  const nb = await seedNotebook(
    daily,
    [{ kind: "chart" }, { kind: "chart" }],
    uniqueName("Keys charts"),
  );
  await openProjectView(daily, nb.id, 2);
  await enterCommandMode(daily, 0);
  await pressFor(daily, `${MOD}+Shift+KeyC`, () =>
    expect(daily.toast(/cop/i).first()).toBeVisible(FAST),
  );
  await enterCommandMode(daily, 1);
  await pressFor(daily, `${MOD}+Shift+KeyV`, () =>
    expect(daily.toast(/(paste|appl)/i).first()).toBeVisible(FAST),
  );
  await daily.check({ url: at(nb) });
});

for (const row of [
  { id: "KEYS-82", name: "ctrl+r reflows the graph", key: "Control+KeyR" },
  {
    id: "KEYS-83",
    name: "meta+shift+= zooms the graph in",
    key: "Meta+Shift+Equal",
  },
  { id: "KEYS-84", name: "meta+- zooms the graph out", key: "Meta+Minus" },
  { id: "KEYS-85", name: "meta+1 zooms the graph to fit", key: "Meta+Digit1" },
  { id: "KEYS-86", name: "meta+0 zooms the graph to 100%", key: "Meta+Digit0" },
]) {
  test(`${row.id} ${row.name}`, async ({ daily }) => {
    test.fail(); // FINDING COV-GRAPH: the graph cannot be opened; its shortcuts are blocked at that entry point.
    const nb = await project(daily, 2);
    await enterCommandMode(daily, 0);
    await daily.page.keyboard.press("Alt+Shift+Digit4");
    await expect(graph(daily)).toBeVisible(FAST);
    const before = await graph(daily).evaluate((el) => el.innerHTML);
    await pressFor(daily, row.key, () =>
      expect
        .poll(() => graph(daily).evaluate((el) => el.innerHTML), FAST)
        .not.toBe(before),
    );
    await daily.check({ url: new RegExp(`/project/${nb.id}/`) });
  });
}

test("KEYS-95 command palette filters by typed text and shows each combo", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-95: command palette filters by typed text and shows each combo is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await daily.page.keyboard.press(`${MOD}+KeyP`);
  await expect(palette(daily)).toBeVisible(FAST);
  await daily.type("run");
  for (const title of [
    "Run cell",
    "Run cell and select below",
    "Run cell and insert below",
    "Restart and run all",
  ])
    await expect(
      daily.page.getByRole("option", { name: new RegExp(`^${title}`) }).first(),
    ).toBeVisible();
  await daily.check({ url: at(nb) });
});

test("KEYS-96 Enter runs the picked palette command and closes the palette", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-96: Enter runs the picked palette command and closes the palette is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await daily.page.keyboard.press(`${MOD}+KeyP`);
  await expect(palette(daily)).toBeVisible(FAST);
  await daily.type("Toggle Graph");
  await pressFor(daily, "Enter", () => expect(palette(daily)).toBeHidden(FAST));
  await expect(graph(daily)).toBeVisible(FAST);
  await daily.check({ url: new RegExp(`/project/${nb.id}/`) });
});

test("KEYS-97 Escape closes the palette and returns focus to the cell", async ({
  daily,
}) => {
  test.fail(); // FINDING COV-KEYS-97: Escape closes the palette and returns focus to the cell is unavailable.
  const nb = await project(daily, 1);
  await enterCommandMode(daily, 0);
  await daily.page.keyboard.press(`${MOD}+KeyP`);
  await expect(palette(daily)).toBeVisible(FAST);
  await pressFor(daily, "Escape", () =>
    expect(palette(daily)).toBeHidden(FAST),
  );
  await daily.check({ url: at(nb), focus: cellAt(daily.page, 0) });
});
