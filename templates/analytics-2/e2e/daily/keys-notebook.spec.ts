import type { Daily } from "./fixtures";
import { expect, test } from "./fixtures";
import {
  MOD,
  SAMPLE_CONNECTION,
  cellAt,
  cellLocator,
  editorOf,
  enterCommandMode,
  openNotebook,
  rowsSummary,
  sampleSql,
  seedNotebook,
  selectedCellIndexes,
  storedCells,
  type Notebook,
  type SeedCell,
} from "./notebook.helpers";

// Cell editor keys and notebook command-mode keys, driven from the keyboard.

const FAST = { timeout: 400 };

async function notebook(
  daily: Daily,
  seeds: SeedCell[] = [1, 2, 3].map((n) => ({
    kind: "sql",
    text: sampleSql(n),
  })),
) {
  const nb = await seedNotebook(
    daily,
    seeds.map((seed) =>
      seed.kind === "sql" && seed.connection === undefined
        ? { ...seed, connection: SAMPLE_CONNECTION }
        : seed,
    ),
  );
  await openNotebook(daily, nb);
  return nb;
}

const at = (nb: Notebook) => new RegExp(`/project/${nb.id}/latest$`);
const cell = (daily: Daily, index: number) => cellAt(daily.page, index);
const editor = (daily: Daily, index: number) => editorOf(cell(daily, index));

async function editIn(daily: Daily, nb: Notebook, index: number) {
  await editor(daily, index).focus();
  await daily.check({ url: at(nb), focus: editor(daily, index) });
}

async function commandModeOn(daily: Daily, nb: Notebook, index: number) {
  await enterCommandMode(daily, index);
  await daily.check({ url: at(nb), focus: cell(daily, index) });
}

async function expectSelected(daily: Daily, indexes: number[]) {
  await expect
    .poll(() => selectedCellIndexes(daily.page), FAST)
    .toEqual(indexes);
}

test.describe("cell editor keys", () => {
  test("KEYS-37 Escape enters command mode", async ({ daily }) => {
    const nb = await notebook(daily);
    await editIn(daily, nb, 1);
    await daily.press("Escape");
    await expect(cell(daily, 1)).toBeFocused();
    await expectSelected(daily, [1]);
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
    // Command-mode keys are live: j moves the selection.
    await daily.press("j");
    await daily.check({ url: at(nb), focus: cell(daily, 2) });
  });

  test("KEYS-38 Shift+Escape enters command mode", async ({ daily }) => {
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press("Shift+Escape");
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
  });

  test("KEYS-39 Mod+Enter runs the cell and keeps focus in the editor", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+Enter`);
    await expect(cell(daily, 0).locator(".nb-output-title")).toHaveText(
      rowsSummary(1),
      { timeout: 15_000 },
    );
    await daily.check({ url: at(nb), focus: editor(daily, 0) });
    await expect.poll(() => editor(daily, 0).innerText()).toBe(sampleSql(1));
  });

  test("KEYS-40 Shift+Enter runs the cell and selects the cell below", async ({
    daily,
  }) => {
    // FINDING F10: Shift+Enter now runs, but opens the next cell's editor instead of selecting the cell (command mode).
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press("Shift+Enter");
    await expect(cell(daily, 0).locator(".nb-output-title")).toHaveText(
      rowsSummary(1),
      { timeout: 15_000 },
    );
    await expect.poll(() => editor(daily, 0).innerText()).toBe(sampleSql(1));
    await expect(
      cell(daily, 1),
      "the cell below is selected in command mode",
    ).toBeFocused(FAST);
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
  });

  test("KEYS-41 Alt+Enter runs the cell and inserts an empty cell below", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press("Alt+Enter");
    await expect(cell(daily, 0).locator(".nb-output-title")).toHaveText(
      rowsSummary(1),
      { timeout: 15_000 },
    );
    await expect(cellLocator(daily.page)).toHaveCount(4);
    await expect.poll(() => editor(daily, 1).innerText()).toBe("");
    await expect(editor(daily, 1)).toBeFocused();
    await expect.poll(() => editor(daily, 2).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb), focus: editor(daily, 1) });
  });

  test("KEYS-42 Mod+Shift+Enter clears the cache and reruns in place", async ({
    daily,
  }) => {
    // Known failure: the cache-clearing shortcut moves focus to the next cell instead of rerunning in place.
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+Shift+Enter`);
    await expect(cell(daily, 0).locator(".nb-output-title")).toHaveText(
      rowsSummary(1),
      { timeout: 15_000 },
    );
    await expect(
      editor(daily, 0),
      "focus stays in the rerun cell's editor",
    ).toBeFocused(FAST);
    await expect(cellLocator(daily.page)).toHaveCount(3);
    await daily.check({ url: at(nb), focus: editor(daily, 0) });
  });

  test("KEYS-43 Mod+D opens the data connection picker", async ({ daily }) => {
    // FINDING COV-CELLKEYS-02: Mod+D is not bound in the SQL editor; the connection picker only opens by pointer.
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+d`, { feedback: false });
    await expect(daily.menu(), "connection picker menu").toBeVisible(FAST);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-44 Mod+G opens the agent prompt bar in the cell", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-03: no in-cell agent prompt bar; Mod+G does nothing in the editor.
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+g`, { feedback: false });
    const prompt = cell(daily, 0).locator(
      "input, textarea:not(.nb-cell-source), [contenteditable=true]:not(.cm-content)",
    );
    await expect(
      prompt.first(),
      "agent prompt bar inside the cell",
    ).toBeVisible(FAST);
    await expect(prompt.first()).toBeFocused();
    await daily.check({ url: at(nb) });
  });

  test("KEYS-48 Mod+Shift+Y splits CTEs into cells", async ({ daily }) => {
    // FINDING COV-CELLKEYS-04: Split CTEs is not available; Mod+Shift+Y does nothing.
    test.fail();
    const nb = await notebook(daily, [
      {
        kind: "sql",
        text: "with recent as (select * from orders limit 5)\nselect * from recent",
      },
    ]);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+Shift+y`, { feedback: false });
    await expect(
      cellLocator(daily.page),
      "one cell per CTE plus the final select",
    ).toHaveCount(2, FAST);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-49 Ctrl+Shift+- splits the cell at the caret", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-05: Split cell is not available; Ctrl+Shift+- and Ctrl+Shift+S do nothing.
    test.fail();
    const first = sampleSql(1);
    const nb = await notebook(daily, [
      { kind: "sql", text: `${first}\n${sampleSql(2)}` },
    ]);
    await editIn(daily, nb, 0);
    await editor(daily, 0).press("ControlOrMeta+Home");
    await editor(daily, 0).press("ArrowDown");
    await editor(daily, 0).press("Home");
    await daily.press("Control+Shift+Minus", { feedback: false });
    await expect(
      cellLocator(daily.page),
      "the cell splits in two at the caret",
    ).toHaveCount(2, FAST);
    await expect.poll(() => editor(daily, 0).innerText()).toBe(first);
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb) });
  });

  test("KEYS-50 Ctrl+Shift+U toggles the casing of the selection", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-06: Toggle casing is not bound in the SQL editor.
    test.fail();
    const nb = await notebook(daily, [{ kind: "sql", text: sampleSql(1) }]);
    await editIn(daily, nb, 0);
    await editor(daily, 0).press("ControlOrMeta+Home");
    for (let i = 0; i < 6; i++)
      await editor(daily, 0).press("Shift+ArrowRight");
    await daily.press("Control+Shift+U", { feedback: false });
    await expect
      .poll(() => editor(daily, 0).innerText(), FAST)
      .toBe(`SELECT${sampleSql(1).slice(6)}`);
    await daily.check({ url: at(nb), focus: editor(daily, 0) });
  });

  test("KEYS-51 Mod+Shift+M opens the generate bar; Escape closes it", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-07: no in-cell generate bar; Mod+Shift+M does nothing in the editor.
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+Shift+m`, { feedback: false });
    const bar = daily.page.locator(
      "input:focus, textarea:focus:not(.nb-cell-source), [contenteditable=true]:focus:not(.cm-content)",
    );
    await expect(bar, "generate prompt bar focused").toBeVisible(FAST);
    await daily.press("Escape");
    await expect(bar).toHaveCount(0);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-52 Mod+Shift+. explains the cell", async ({ daily }) => {
    // FINDING COV-CELLKEYS-08: Explain is not bound; Mod+Shift+. does nothing in the editor.
    test.fail();
    const nb = await notebook(daily);
    await editIn(daily, nb, 0);
    await daily.press(`${MOD}+Shift+Period`, { feedback: false });
    await expect(
      daily.page.getByText(/explain/i).first(),
      "explain runs for the cell",
    ).toBeVisible(FAST);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-101 Tab indents inside the SQL editor", async ({ daily }) => {
    const nb = await notebook(daily, [{ kind: "sql", text: sampleSql(1) }]);
    await editIn(daily, nb, 0);
    await editor(daily, 0).press("ControlOrMeta+Home");
    await daily.press("Tab");
    await expect
      .poll(() => editor(daily, 0).innerText())
      .toBe(`  ${sampleSql(1)}`);
    await daily.check({ url: at(nb), focus: editor(daily, 0) });
    await daily.press("Shift+Tab", { feedback: false });
    await daily.check({ url: at(nb), focus: editor(daily, 0) });
    await daily.press("Escape");
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
  });
});

test.describe("command-mode keys", () => {
  test("KEYS-53 Enter edits the selected cell", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("Enter");
    await daily.check({ url: at(nb), focus: editor(daily, 1) });
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(2));
  });

  test("KEYS-54 p opens the command palette", async ({ daily }) => {
    // FINDING F15: no command palette; p does nothing in command mode.
    test.fail();
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("p", { feedback: false });
    await expect(
      daily
        .dialog()
        .getByRole("combobox")
        .or(daily.dialog().getByRole("textbox"))
        .first(),
      "command palette with its filter input",
    ).toBeFocused(FAST);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-55 s opens Save version", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("s", { feedback: false });
    await expect(
      daily.dialog().filter({ hasText: "Save version" }),
      "Save version dialog",
    ).toBeVisible(FAST);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-56 k / ArrowUp select the cell above", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 2);
    await daily.press("k");
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
    await daily.press("ArrowUp");
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
    await expectSelected(daily, [0]);
  });

  test("KEYS-57 j / ArrowDown select the cell below", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("j");
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
    await daily.press("ArrowDown");
    await daily.check({ url: at(nb), focus: cell(daily, 2) });
    await expectSelected(daily, [2]);
  });

  test("KEYS-58 Shift+K / Shift+ArrowUp extend the selection upward", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 2);
    await daily.press("Shift+K", { feedback: false });
    await expectSelected(daily, [1, 2]);
    await daily.press("Shift+ArrowUp", { feedback: false });
    await expectSelected(daily, [0, 1, 2]);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-59 Shift+J / Shift+ArrowDown extend the selection downward", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("Shift+J", { feedback: false });
    await expectSelected(daily, [0, 1]);
    await daily.press("Shift+ArrowDown", { feedback: false });
    await expectSelected(daily, [0, 1, 2]);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-60 Mod+A selects all cells", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press(`${MOD}+a`, { feedback: false });
    await expectSelected(daily, [0, 1, 2]);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-61 a adds an empty cell above and focuses it", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await expect(
      daily.page.getByRole("button", { name: "Run all", exact: true }),
    ).toBeEnabled();
    await daily.press("a");
    await expect(cellLocator(daily.page)).toHaveCount(4);
    await expect.poll(() => editor(daily, 1).innerText()).toBe("");
    await expect(editor(daily, 1)).toBeFocused();
    await expect.poll(() => editor(daily, 2).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb), focus: editor(daily, 1) });
    await expect
      .poll(async () => (await storedCells(daily, nb.id)).length)
      .toBe(4);
  });

  test("KEYS-62 b adds an empty cell below and focuses it", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("b");
    await expect(cellLocator(daily.page)).toHaveCount(4);
    await expect.poll(() => editor(daily, 2).innerText()).toBe("");
    await expect(editor(daily, 2)).toBeFocused();
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb), focus: editor(daily, 2) });
    await expect
      .poll(async () => (await storedCells(daily, nb.id)).length)
      .toBe(4);
  });

  test("KEYS-63 d d deletes the cell and selects its neighbour", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("d", { feedback: false });
    await daily.press("d");
    await expect(cellLocator(daily.page)).toHaveCount(2);
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(3));
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
    await expect
      .poll(async () => (await storedCells(daily, nb.id)).map((c) => c.source))
      .toEqual([sampleSql(1), sampleSql(3)]);
  });

  test("report A2-KEYBOARD-DELETE-BUSY: deletes another cell while an autosave response is pending", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    const pattern = "**/_agent-native/actions/save-project-cell";
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let held = false;
    const handler = async (route: import("@playwright/test").Route) => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
      finish();
    };
    await daily.page.route(pattern, handler);
    try {
      await editor(daily, 0).fill("select 42");
      await expect.poll(() => held).toBe(true);
      await commandModeOn(daily, nb, 1);
      await daily.press("d", { feedback: false });
      await daily.press("d");
      await expect(cellLocator(daily.page)).toHaveCount(2);
      await expect
        .poll(async () =>
          (await storedCells(daily, nb.id)).map((c) => c.source),
        )
        .toEqual(["select 42", sampleSql(3)]);
      const saveResponse = daily.page.waitForResponse((response) =>
        response.url().endsWith("/_agent-native/actions/save-project-cell"),
      );
      release();
      await finished;
      expect((await saveResponse).ok()).toBe(true);
      await expect(
        cell(daily, 0).getByRole("button", { name: /^More actions for / }),
      ).toBeEnabled();
      await expect.poll(() => editor(daily, 0).innerText()).toBe("select 42");
      await expect(cellLocator(daily.page)).toHaveCount(2);
      await daily.open(`/project/${nb.id}/latest`);
      await expect(cellLocator(daily.page)).toHaveCount(2);
      await expect
        .poll(async () =>
          (await storedCells(daily, nb.id)).map((c) => c.source),
        )
        .toEqual(["select 42", sampleSql(3)]);
    } finally {
      release();
      await daily.page.unroute(pattern, handler);
    }
  });

  test("KEYS-64 z undoes the last cell change", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("d", { feedback: false });
    await daily.press("d");
    await expect(cellLocator(daily.page)).toHaveCount(2);
    await daily.check({ url: at(nb) });
    await daily.press("z", { feedback: false });
    await expect(
      cellLocator(daily.page),
      "the deleted cell is restored",
    ).toHaveCount(3, FAST);
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb) });
  });

  test("KEYS-65 c copies the cell", async ({ daily }) => {
    await daily.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("c", { feedback: false });
    await expect(daily.toast("Copied to clipboard!")).toBeVisible(FAST);
    await expect(cellLocator(daily.page)).toHaveCount(3);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-66 x cuts the cell", async ({ daily }) => {
    await daily.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("x", { feedback: false });
    await expect(daily.toast("Copied to clipboard!")).toBeVisible(FAST);
    await expect(cellLocator(daily.page)).toHaveCount(2);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-67 Mod+ArrowUp / Mod+ArrowDown move the cell", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press(`${MOD}+ArrowUp`);
    await expect.poll(() => editor(daily, 0).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
    await daily.press(`${MOD}+ArrowDown`);
    await expect.poll(() => editor(daily, 1).innerText()).toBe(sampleSql(2));
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
    await expect
      .poll(async () => (await storedCells(daily, nb.id)).map((c) => c.source))
      .toEqual([1, 2, 3].map(sampleSql));
  });

  test("KEYS-68 m converts a code cell to Markdown", async ({ daily }) => {
    const nb = await notebook(daily, [{ kind: "code", text: "x = 1" }]);
    await commandModeOn(daily, nb, 0);
    await daily.press("m", { feedback: false });
    await expect
      .poll(async () => (await storedCells(daily, nb.id))[0]?.kind, FAST)
      .toBe("markdown");
    await daily.check({ url: at(nb) });
  });

  test("KEYS-69 y converts a Markdown cell to code", async ({ daily }) => {
    const nb = await notebook(daily, [{ kind: "markdown", text: "Notes" }]);
    await enterCommandMode(daily, 0);
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
    await daily.press("y", { feedback: false });
    await expect
      .poll(async () => (await storedCells(daily, nb.id))[0]?.kind, FAST)
      .toBe("code");
    await daily.check({ url: at(nb) });
  });

  test("KEYS-70 f s / f a format the selected / all cells", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-09: no cell formatting; the f s and f a chords do nothing.
    test.fail();
    const messy = "select   *   from   orders   limit 1";
    const nb = await notebook(daily, [
      { kind: "sql", text: messy },
      { kind: "sql", text: messy },
    ]);
    await commandModeOn(daily, nb, 0);
    await daily.press("f", { feedback: false });
    await daily.press("s", { feedback: false });
    await expect.poll(() => editor(daily, 0).innerText(), FAST).not.toBe(messy);
    await expect.poll(() => editor(daily, 1).innerText()).toBe(messy);
    await daily.press("f", { feedback: false });
    await daily.press("a", { feedback: false });
    await expect.poll(() => editor(daily, 1).innerText(), FAST).not.toBe(messy);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-71 f f opens the cell full screen; Escape returns", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("f", { feedback: false });
    await daily.press("f", { feedback: false });
    const fullscreen = cell(daily, 1).and(daily.page.locator(":fullscreen"));
    await expect(fullscreen).toHaveCount(1);
    await expect(
      fullscreen
        .getByText(sampleSql(2))
        .or(fullscreen.locator("textarea"))
        .first(),
    ).toBeVisible(FAST);
    await daily.press("Escape");
    await expect(fullscreen).toHaveCount(0);
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
  });

  test("KEYS-72 Alt+A opens the focused gap and Escape closes it", async ({
    daily,
  }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    const gap = cell(daily, 0).locator("xpath=..").locator(".nb-insert");
    await expect(
      gap.getByRole("button", { name: "Add cell here" }),
    ).toHaveAttribute("title", "Add cell ⌥A");
    await daily.press("Alt+a");
    const bar = gap.getByRole("group", { name: "Add code cell" });
    await expect(
      bar.getByRole("button", { name: "Query", exact: true }),
    ).toBeFocused();
    await daily.check({ url: at(nb) });
    await daily.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(
      gap.getByRole("button", { name: "Add cell here" }),
    ).toBeFocused();
    await daily.check({ url: at(nb) });
  });

  test("KEYS-73 Mod+Enter runs the selected cell", async ({ daily }) => {
    // FINDING COV-CELLKEYS-11: the run keys are bound only inside the editor; in command mode they do nothing.
    test.fail();
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press(`${MOD}+Enter`, { feedback: false });
    await expect(
      cell(daily, 0).locator(".nb-output-title"),
      "the selected cell runs",
    ).toHaveText(rowsSummary(1), FAST);
    await daily.check({ url: at(nb), focus: cell(daily, 0) });
  });

  test("KEYS-74 Shift+Enter runs and selects the cell below", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-11: the run keys are bound only inside the editor; in command mode they do nothing.
    test.fail();
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("Shift+Enter", { feedback: false });
    await expect(
      cell(daily, 0).locator(".nb-output-title"),
      "the selected cell runs",
    ).toHaveText(rowsSummary(1), FAST);
    await daily.check({ url: at(nb), focus: cell(daily, 1) });
  });

  test("KEYS-75 Alt+Enter runs and inserts a cell below", async ({ daily }) => {
    // FINDING COV-CELLKEYS-11: the run keys are bound only inside the editor; in command mode they do nothing.
    test.fail();
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await daily.press("Alt+Enter", { feedback: false });
    await expect(
      cell(daily, 0).locator(".nb-output-title"),
      "the selected cell runs",
    ).toHaveText(rowsSummary(1), FAST);
    await expect(cellLocator(daily.page)).toHaveCount(4);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-76 Mod+click adds a cell to the selection", async ({ daily }) => {
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 0);
    await cell(daily, 2)
      .locator(".nb-cell-title")
      .click({ modifiers: ["ControlOrMeta"] });
    await expectSelected(daily, [0, 2]);
    await daily.check({ url: at(nb) });
  });

  test("KEYS-102 Shift+H opens the selected cell's history", async ({
    daily,
  }) => {
    // FINDING COV-CELLKEYS-12: no per-cell history; Shift+H does nothing in command mode.
    test.fail();
    const nb = await notebook(daily);
    await commandModeOn(daily, nb, 1);
    await daily.press("Shift+H", { feedback: false });
    await expect(
      daily.page
        .getByRole("dialog")
        .or(daily.page.getByRole("complementary"))
        .filter({ hasText: /History/ })
        .first(),
      "cell history",
    ).toBeVisible(FAST);
    await daily.check({ url: at(nb) });
  });
});
