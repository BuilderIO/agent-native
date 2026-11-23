// @vitest-environment happy-dom
import assert from "node:assert/strict";

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import * as secondaryFeatures from "@/components/shell/secondary-features";
import enUS from "@/i18n/en-US";
import { addCellMenuEntries } from "@/lib/model/cell-types";

import { AddCellBar, InsertCellBar, MoreCellsMenu } from "./AddCellBar";
import { RENDERABLE_INPUT_TYPES } from "./InputCellControl";

const openMenu = (trigger: HTMLElement) =>
  act(() => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent.trim() === label,
  );

it("opens Inputs from its own trigger and picks a typed input from the portal", async () => {
  const label = "Inputs";
  const onPick = vi.fn();
  const onAdd = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <AddCellBar
          onAdd={onAdd}
          onPick={onPick}
          entries={[
            { kind: "sql", name: "SQL" },
            { kind: "input", name: "Slider", inputType: "SLIDER" },
            { kind: "input", name: "Text input", inputType: "TEXT_INPUT" },
          ]}
        />,
      );
    });
    const trigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    );
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    const menu = document.getElementById(
      trigger?.getAttribute("aria-controls") ?? "",
    );
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(container.contains(menu)).toBe(false);
    const choices = [
      ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Slider",
      "Text input",
    ]);
    expect(onPick).not.toHaveBeenCalled();
    await act(async () => {
      choices.at(-1)?.click();
    });
    expect(onPick).toHaveBeenCalledWith({
      kind: "input",
      name: "Text input",
      inputType: "TEXT_INPUT",
    });
    expect(onAdd).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it.each([true, false])(
  "offers the Python cell only when supported (supported=%s)",
  (supported) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          <AddCellBar
            onAdd={() => {}}
            onPick={() => {}}
            entries={[]}
            supportedKinds={supported ? ["sql", "code"] : ["sql"]}
          />,
        ),
      );
      const labels = [...container.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      );
      expect(labels.includes("Python")).toBe(supported);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  },
);

it("opens the input-type chooser instead of creating a typeless input cell", () => {
  const onAdd = vi.fn();
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <AddCellBar
          onAdd={onAdd}
          onPick={onPick}
          entries={[{ kind: "input", name: "Date", inputType: "DATE" }]}
          supportedKinds={["sql", "code", "input"]}
        />,
      ),
    );
    const inputs = button(container, "Inputs");
    assert.ok(inputs);
    openMenu(inputs);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("opens the available input types above their toolbar button and picks one", () => {
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entries = addCellMenuEntries().filter(
    (entry) =>
      entry.inputType && RENDERABLE_INPUT_TYPES.includes(entry.inputType),
  );
  try {
    act(() =>
      root.render(
        <AddCellBar onAdd={() => {}} entries={entries} onPick={onPick} />,
      ),
    );
    const inputs = button(container, "Inputs");
    assert.ok(inputs);
    openMenu(inputs);
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu);
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(entries.map((entry) => entry.name));
    expect(menu.getAttribute("data-side")).toBe("top");
    act(() => menu.querySelector<HTMLElement>('[role="menuitem"]')?.click());
    expect(onPick).toHaveBeenCalledWith(entries[0]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("inserts the selected input after the requested cell", () => {
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entry = {
    kind: "input" as const,
    name: "Date",
    inputType: "DATE" as const,
  };
  try {
    act(() =>
      root.render(
        <InsertCellBar
          afterCellId="cell-1"
          onAdd={() => {}}
          entries={[entry]}
          onPick={onPick}
        />,
      ),
    );
    const insertButton =
      container.querySelector<HTMLButtonElement>(".nb-insert-button");
    assert.ok(insertButton);
    act(() => insertButton.click());
    const inputs = button(container, "Inputs");
    assert.ok(inputs);
    openMenu(inputs);
    const item = document.querySelector<HTMLElement>('[role="menuitem"]');
    assert.ok(item);
    act(() => item.click());
    expect(onPick).toHaveBeenCalledWith(entry, "cell-1");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("only offers component imports when Labs is enabled", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const gate = vi.spyOn(secondaryFeatures, "secondaryFeaturesEnabled");
  const entries = addCellMenuEntries().filter(
    (entry) => entry.kind === "component-import" || entry.kind === "text",
  );
  const offered = (labs: boolean) => {
    gate.mockReturnValue(labs);
    act(() =>
      root.render(
        <MoreCellsMenu
          key={String(labs)}
          entries={entries}
          disabled={false}
          onPick={() => {}}
          trigger={<button type="button">More</button>}
        />,
      ),
    );
    const trigger = button(container, "More");
    assert.ok(trigger);
    openMenu(trigger);
    return [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
  };
  try {
    const withoutLabs = offered(false);
    expect(withoutLabs).not.toContain("Component");
    expect(withoutLabs).toContain("Text");
    expect(offered(true)).toContain("Component");
  } finally {
    gate.mockRestore();
    act(() => root.unmount());
    container.remove();
  }
});

it("report QA-1795066971.703629 titles the Inputs menu and leaves no Close row", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entries = addCellMenuEntries().filter(
    (entry) =>
      entry.inputType && RENDERABLE_INPUT_TYPES.includes(entry.inputType),
  );
  try {
    // oracle-change: the bar takes one entry list and opens Inputs as a menu from its own trigger.
    act(() =>
      root.render(
        <AddCellBar onAdd={() => {}} entries={entries} onPick={() => {}} />,
      ),
    );
    const inputs = button(container, "Inputs");
    assert.ok(inputs);
    openMenu(inputs);
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu);
    expect(menu.querySelector("h5")?.textContent).toBe("Inputs");
    expect(menu.textContent).toContain(
      "Interactive parameters enabling dynamic inputs.",
    );
    expect(menu.textContent).not.toContain("Close");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("report QA-1795071321.648179 shows Inputs and More beside an input, More titled View all cells", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    // oracle-change: the insert bar between cells replaces the inline plus, so its Inputs and More buttons carry the icons and the View all cells title.
    act(() =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InsertCellBar
            afterCellId="cell-1"
            onAdd={() => {}}
            entries={[{ kind: "input", name: "Date", inputType: "DATE" }]}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const insertButton =
      container.querySelector<HTMLButtonElement>(".nb-insert-button");
    assert.ok(insertButton);
    act(() => insertButton.click());
    const inputs = button(container, "Inputs");
    const more = button(container, "More");
    assert.ok(inputs);
    assert.ok(more);
    expect(more.getAttribute("title")).toBe("View all cells");
    expect([inputs, more].every((b) => b.querySelector("svg") != null)).toBe(
      true,
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("report QA-1795071321.648179 vertical InsertCellBar opens inline Inputs and More menus beside an input", () => {
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const textInputEntry = {
    kind: "input" as const,
    name: "Text input",
    inputType: "TEXT_INPUT" as const,
  };
  const sqlEntry = { kind: "sql" as const, name: "SQL" };
  try {
    act(() =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InsertCellBar
            afterCellId="input-1"
            vertical
            onAdd={() => {}}
            entries={[sqlEntry, textInputEntry]}
            onPick={onPick}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const plusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add cell here"]',
    );
    assert.ok(plusButton);
    act(() => plusButton.click());
    const rootMenu = document.querySelector<HTMLElement>(
      '.nb-inline-add[role="menu"]',
    );
    assert.ok(rootMenu);
    const items = [
      ...rootMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      "Inputs",
      "More",
    ]);
    expect(items[1]?.getAttribute("title")).toBe("View all cells");

    act(() => items[0]?.click());
    const inputsMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Inputs"]',
    );
    assert.ok(inputsMenu);
    const textInputBtn = [
      ...inputsMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent?.trim() === "Text input");
    assert.ok(textInputBtn);
    act(() => textInputBtn.click());
    expect(onPick).toHaveBeenCalledWith(textInputEntry, "input-1");

    act(() => plusButton.click());
    const moreItem = document
      .querySelector<HTMLElement>('.nb-inline-add[role="menu"]')
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]')[1];
    assert.ok(moreItem);
    act(() => moreItem.click());
    const moreMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More"]',
    );
    assert.ok(moreMenu);
    const sqlBtn = moreMenu.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Query"]',
    );
    assert.ok(sqlBtn);
    act(() => sqlBtn.click());
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ kind: sqlEntry.kind }),
      "input-1",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("shows an ordered wide bar and shares the remembered Markdown choice with an anchored gap", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  const entries = addCellMenuEntries();
  function Bars() {
    const [textKind, setTextKind] = useState<"text" | "markdown">("text");
    const preference = { textKind, onTextKindChange: setTextKind };
    return (
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <AddCellBar
          entries={entries}
          onAdd={onAdd}
          onPick={() => {}}
          {...preference}
        />
        <InsertCellBar
          afterCellId="anchor"
          entries={entries}
          onAdd={onAdd}
          onPick={() => {}}
          {...preference}
        />
      </AgentNativeI18nProvider>
    );
  }
  try {
    await act(async () => root.render(<Bars />));
    const bar = container.querySelector(".nb-add-surface");
    assert.ok(bar);
    const tiles = () =>
      [...bar.querySelectorAll(".nb-add-button")].map((tile) =>
        tile.textContent.trim(),
      );
    assert.deepEqual(tiles(), [
      "Query",
      "Python",
      "Text",
      "Chart",
      "Pivot",
      "Single value",
      "Inputs",
      "More",
    ]);
    const text = button(bar, "Text");
    assert.ok(text);
    await act(async () =>
      text.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu);
    const choices = [
      ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    assert.deepEqual(
      choices.map(
        (item) => item.getAttribute("aria-label") ?? item.textContent,
      ),
      ["Text", "Markdown"],
    );
    await act(async () => choices[1]?.click());
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("markdown");
    expect(tiles()[2]).toBe("Markdown");

    const plus =
      container.querySelector<HTMLButtonElement>(".nb-insert-button");
    assert.ok(plus);
    await act(async () => plus.click());
    const gap = container.querySelector(".nb-insert .nb-add-surface");
    assert.ok(gap);
    expect(button(gap, "MarkdownN")).toBeDefined();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(
      container.querySelector(".nb-insert-button"),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("moves visual tiles into More once, then keeps More and Inputs reachable on a narrow bar", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let resize: ((entries: { contentRect: DOMRect }[]) => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: { contentRect: DOMRect }[],
        ) => void,
      ) {}
      observe(element: Element) {
        if (element.classList.contains("nb-add-wrap")) resize = this.callback;
      }
      disconnect() {}
    },
  );
  const setWidth = async (width: number) => {
    assert.ok(resize);
    const bar = container.querySelector(".nb-add-wrap");
    assert.ok(bar);
    const observe = resize;
    await act(async () =>
      observe([{ contentRect: new DOMRect(0, 0, width, 90) }]),
    );
  };
  const onAdd = vi.fn();
  const onPick = vi.fn();
  const onData = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <AddCellBar
            entries={addCellMenuEntries()}
            onAdd={onAdd}
            onPick={onPick}
            tools={{ data: onData }}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const tiles = () =>
      [...container.querySelectorAll(".nb-add-button")].map((tile) =>
        tile.textContent.trim(),
      );
    const items = () => [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    await setWidth(815);
    assert.deepEqual(tiles(), [
      "Query",
      "Python",
      "Text",
      "Chart",
      "Inputs",
      "Data",
      "More",
    ]);
    const more = button(container, "More");
    assert.ok(more);
    openMenu(more);
    assert.deepEqual(
      items().map((item) => item.textContent.trim()),
      ["Pivot", "Single value", "Table", "Metric", "Section"],
    );
    await act(async () => items()[0]?.click());
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("pivot");

    await setWidth(300);
    assert.deepEqual(tiles(), ["Query", "Python", "Text", "More"]);
    expect(more.disabled).toBe(false);
    openMenu(more);
    assert.deepEqual(
      items().map((item) => item.textContent.trim()),
      [
        "Chart",
        "Pivot",
        "Single value",
        "Table",
        "Metric",
        "Section",
        "Inputs",
        "Data",
      ],
    );
    const inputs = items().find((item) => item.textContent.trim() === "Inputs");
    assert.ok(inputs);
    await act(async () => {
      inputs.focus();
      inputs.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const inputMenu = document.getElementById(
      inputs.getAttribute("aria-controls") ?? "",
    );
    assert.ok(inputMenu);
    const options = [
      ...inputMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    assert.deepEqual(
      options.map((item) => item.textContent.trim()),
      [
        "Checkbox",
        "Date",
        "Dropdown",
        "Multiselect",
        "Number input",
        "Slider",
        "Text input",
      ],
    );
    await act(async () => options[6]?.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "input", inputType: "TEXT_INPUT" }),
    );
    openMenu(more);
    await act(async () =>
      items()
        .find((item) => item.textContent.trim() === "Data")
        ?.click(),
    );
    expect(onData).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("row 580: opens the AddCellBar More submenu on hover, keeps it open on hover-then-click, and inserts the chosen cell", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const onAdd = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <AddCellBar
            entries={addCellMenuEntries()}
            onAdd={onAdd}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const more = button(container, "More");
    assert.ok(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      more.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const hoveredMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More"]',
    );
    assert.ok(hoveredMenu);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const hoveredLabels = [
      ...hoveredMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].map((item) => item.textContent?.trim());
    expect(hoveredLabels).toEqual(["Table", "Metric", "Section"]);

    await act(async () => {
      more.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      more.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    const pinnedMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More"]',
    );
    assert.ok(pinnedMenu);
    expect(more.getAttribute("aria-expanded")).toBe("true");

    const tableItem = [
      ...pinnedMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Table");
    assert.ok(tableItem);
    await act(async () => {
      tableItem.click();
    });
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("display-table");
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("row 580: opens the between-cell InsertCellBar More submenu on hover and inserts after the anchor cell", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onAdd = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InsertCellBar
            afterCellId="cel_anchor"
            entries={addCellMenuEntries()}
            onAdd={onAdd}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const plus =
      container.querySelector<HTMLButtonElement>(".nb-insert-button");
    assert.ok(plus);
    await act(async () => plus.click());
    const more = button(container, "More");
    assert.ok(more);
    await act(async () => {
      more.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More"]',
    );
    assert.ok(menu);
    const section = [
      ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Section");
    assert.ok(section);
    await act(async () => section.click());
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("collapsible", "cel_anchor");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("row 580: switches hover submenus cleanly from Inputs to More, closes on leave without stealing focus, and skips disabled More", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <AddCellBar
            entries={addCellMenuEntries()}
            onAdd={() => {}}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const inputs = button(container, "Inputs");
    const more = button(container, "More");
    assert.ok(inputs);
    assert.ok(more);

    await act(async () => {
      inputs.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(
      document.querySelector('[role="menu"][aria-label="Inputs"]'),
    ).not.toBeNull();

    await act(async () => {
      inputs.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      more.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(
      document.querySelector('[role="menu"][aria-label="Inputs"]'),
    ).toBeNull();
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).not.toBeNull();

    await act(async () => {
      more.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).toBeNull();
    expect(document.activeElement).not.toBe(more);

    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <AddCellBar
            entries={[{ kind: "sql", name: "SQL" }]}
            supportedKinds={["sql"]}
            onAdd={() => {}}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const disabledMore = button(container, "More");
    assert.ok(disabledMore);
    expect(disabledMore.disabled).toBe(true);
    await act(async () => {
      disabledMore.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("row 580: keeps a hover-opened compact More menu open while moving into its nested Inputs submenu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let resize: ((entries: { contentRect: DOMRect }[]) => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: { contentRect: DOMRect }[],
        ) => void,
      ) {}
      observe(element: Element) {
        if (element.classList.contains("nb-add-wrap")) resize = this.callback;
      }
      disconnect() {}
    },
  );
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <AddCellBar
            entries={addCellMenuEntries()}
            onAdd={() => {}}
            onPick={onPick}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    assert.ok(resize);
    const observe = resize;
    await act(async () =>
      observe([{ contentRect: new DOMRect(0, 0, 300, 90) }]),
    );
    const more = button(container, "More");
    assert.ok(more);
    await act(async () => {
      more.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const moreMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More"]',
    );
    assert.ok(moreMenu);
    const inputsTrigger = [
      ...moreMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Inputs");
    assert.ok(inputsTrigger);
    await act(async () => {
      more.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      moreMenu.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      inputsTrigger.focus();
      inputsTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const subMenu = document.getElementById(
      inputsTrigger.getAttribute("aria-controls") ?? "",
    );
    assert.ok(subMenu);
    await act(async () => {
      moreMenu.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      subMenu.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).not.toBeNull();
    const textInput = [
      ...subMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Text input");
    assert.ok(textInput);
    await act(async () => textInput.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "input", inputType: "TEXT_INPUT" }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("offers Metric in the vertical inline insert More menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onPick = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InsertCellBar
            vertical
            afterCellId="cell-input-1"
            entries={addCellMenuEntries()}
            onAdd={() => {}}
            onPick={onPick}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add cell here"]',
    );
    assert.ok(trigger);
    await act(async () => trigger.click());
    const more = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "More");
    assert.ok(more);
    expect(more.disabled).toBe(false);
    await act(async () => more.click());
    const metric = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Metric");
    assert.ok(metric);
    await act(async () => metric.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith(
      { kind: "dbt-metric", name: "Metric" },
      "cell-input-1",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps More enabled in the vertical inline insert menu when only dbt-metric is supported", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InsertCellBar
            vertical
            afterCellId="cell-input-2"
            entries={addCellMenuEntries()}
            supportedKinds={["dbt-metric"]}
            onAdd={() => {}}
            onPick={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add cell here"]',
    );
    assert.ok(trigger);
    await act(async () => trigger.click());
    const more = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "More");
    assert.ok(more);
    expect(more.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
