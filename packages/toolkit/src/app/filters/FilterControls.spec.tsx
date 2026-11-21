// @vitest-environment happy-dom

import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "./FilterBar.js";
import { FilterDateEditor, FilterValuePicker } from "./FilterEditors.js";
import { FilterButton } from "./FilterPanel.js";
import {
  filterViewNameError,
  FilterViewsControl,
  type FilterSavedView,
  type FilterViewsControlProps,
} from "./FilterViews.js";
import {
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  setPinnedFilter,
  type FilterField,
  type FilterRule,
  type FilterRulePatch,
  type FilterState,
} from "./model.js";
import { useFilterText } from "./text.js";

const sourceField: FilterField = {
  id: "source",
  label: "Where it came from",
  type: "choice",
  options: [
    { id: "clips", label: "Recorded in Clips" },
    { id: "content", label: "Uploaded from Content" },
  ],
  pinned: { default: ["clips"] },
};

const ownerField: FilterField = {
  id: "owner",
  label: "Made by",
  type: "person",
  valueNoun: { one: "person", other: "people" },
  options: [
    { id: "alice", label: "Alice" },
    { id: "agent", label: "An agent" },
  ],
};

const tagsField: FilterField = {
  id: "tags",
  label: "Tags",
  type: "multi",
  options: [{ id: "demo", label: "Demo" }],
};

const fields = [sourceField, ownerField, tagsField];

const createdField: FilterField = {
  id: "created",
  label: "Created",
  type: "date",
  dates: "past",
  alwaysSet: true,
};

const nouns = {
  items: "clips",
  matchCount: (count: number) => `${count} clips match`,
  showCount: (count: number) => `Show ${count} clips`,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(target: Element) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

function click(target: Element) {
  act(() => {
    if (target instanceof HTMLElement) target.click();
  });
}

function openMenu(trigger: Element) {
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
}

function buttonNamed(name: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (button) =>
      button.getAttribute("aria-label") === name ||
      button.textContent.trim() === name,
  );
  if (!match) throw new Error(`No button named ${name}`);
  return match;
}

function buttonStartingWith(text: string) {
  const match = Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent.trim().startsWith(text),
  );
  if (!match) throw new Error(`No button starting with ${text}`);
  return match;
}

function optionNamed(name: string) {
  const match = Array.from(document.querySelectorAll('[role="option"]')).find(
    (option) => option.textContent.includes(name),
  );
  if (!match) throw new Error(`No option named ${name}`);
  return match;
}

function hasButtonNamed(name: string) {
  return Array.from(document.querySelectorAll("button")).some(
    (button) =>
      button.getAttribute("aria-label") === name ||
      button.textContent.trim() === name,
  );
}

function texts(selector: string) {
  return Array.from(document.querySelectorAll(selector)).map((element) =>
    element.textContent.trim(),
  );
}

function menuItem(name: string) {
  const match = Array.from(
    document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'),
  ).find((item) => item.textContent.includes(name));
  if (!match) throw new Error(`No menu item named ${name}`);
  return match;
}

function combobox() {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
  if (!input) throw new Error("No combobox");
  return input;
}

function Picker({
  value = [],
  onChange,
  onDone,
}: {
  value?: string[];
  onChange: (value: string[]) => void;
  onDone: () => void;
}) {
  const text = useFilterText();
  const [rule, setRule] = useState<FilterRule>(() =>
    createFilterRule(ownerField, value),
  );
  return (
    <FilterValuePicker
      field={ownerField}
      rule={rule}
      text={text}
      onChange={(value) => {
        setRule({ ...rule, value });
        onChange(value);
      }}
      onDone={onDone}
    />
  );
}

describe("FilterValuePicker", () => {
  it("lists Nobody before the people", () => {
    render(<Picker onChange={vi.fn()} onDone={vi.fn()} />);
    expect(texts('[role="option"]')).toEqual(["Nobody", "Alice", "An agent"]);
  });

  it("applies the highlighted value on Enter and finishes", () => {
    const onChange = vi.fn();
    const onDone = vi.fn();
    render(<Picker onChange={onChange} onDone={onDone} />);
    typeInto(combobox(), "agent");
    expect(texts('[role="option"]')).toEqual(["An agent"]);
    pressEnter(combobox());
    expect(onChange).toHaveBeenLastCalledWith(["agent"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("toggles values on click and stays open", () => {
    const onChange = vi.fn();
    const onDone = vi.fn();
    render(<Picker onChange={onChange} onDone={onDone} />);
    const alice = () =>
      Array.from(document.querySelectorAll('[role="option"]')).find((option) =>
        option.textContent.includes("Alice"),
      );
    const option = alice();
    if (!option) throw new Error("No Alice option");
    click(option);
    expect(onChange).toHaveBeenLastCalledWith(["alice"]);
    expect(alice()?.getAttribute("aria-selected")).toBe("true");
    const again = alice();
    if (!again) throw new Error("No Alice option");
    click(again);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("removes a selected value on Enter and finishes", () => {
    const onChange = vi.fn();
    const onDone = vi.fn();
    render(<Picker value={["agent"]} onChange={onChange} onDone={onDone} />);
    typeInto(combobox(), "agent");
    pressEnter(combobox());
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("marks chosen values as selected, not the highlighted one", () => {
    render(<Picker value={["agent"]} onChange={vi.fn()} onDone={vi.fn()} />);
    expect(
      document
        .querySelector('[role="listbox"]')
        ?.getAttribute("aria-multiselectable"),
    ).toBe("true");
    const selected = Array.from(
      document.querySelectorAll('[role="option"][aria-selected="true"]'),
    ).map((option) => option.textContent);
    expect(selected).toEqual(["An agent"]);
  });

  it("says nothing matches without offering to create a value", () => {
    render(<Picker onChange={vi.fn()} onDone={vi.fn()} />);
    typeInto(combobox(), "zebra");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.body.textContent).toContain(
      "No person called “zebra”. Filters only use people that already exist.",
    );
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});

function DateEditor({
  onChange,
  field = createdField,
  rule = {
    kind: "rule",
    id: "created-rule",
    field: "created",
    operator: "before",
    value: ["2026-11-01"],
  },
}: {
  onChange: (patch: FilterRulePatch) => void;
  field?: FilterField;
  rule?: FilterRule;
}) {
  const text = useFilterText();
  return (
    <FilterDateEditor
      field={field}
      rule={rule}
      text={text}
      onChange={onChange}
      onDone={vi.fn()}
    />
  );
}

describe("FilterDateEditor", () => {
  it("uses a preset's own operator over the rule's exact-date one", () => {
    const onChange = vi.fn();
    render(<DateEditor onChange={onChange} />);
    const yesterday = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent === "Yesterday");
    if (!yesterday) throw new Error("No Yesterday option");
    click(yesterday);
    expect(onChange).toHaveBeenLastCalledWith({
      operator: "equals",
      value: ["yesterday"],
    });
  });

  function dateInput(label: string) {
    const input = document.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    if (!input) throw new Error(`No input named ${label}`);
    return input;
  }

  it("applies a range from a start and an end date", () => {
    const onChange = vi.fn();
    render(
      <DateEditor
        onChange={onChange}
        rule={createFilterRule(createdField, [], "between")}
      />,
    );
    expect(hasButtonNamed("Apply")).toBe(true);
    expect(buttonNamed("Apply").hasAttribute("disabled")).toBe(true);
    typeInto(dateInput("Start date"), "2026-10-01");
    typeInto(dateInput("End date"), "2026-10-31");
    click(buttonNamed("Apply"));
    expect(onChange).toHaveBeenLastCalledWith({
      operator: "between",
      value: ["2026-10-01", "2026-10-31"],
    });
  });

  it("offers only the field's own operators and presets", () => {
    const beforeOnly: FilterField = { ...createdField, operators: ["before"] };
    render(<DateEditor onChange={vi.fn()} field={beforeOnly} />);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(hasButtonNamed("Start date")).toBe(false);
    const operator = document.querySelector("form button");
    if (!operator) throw new Error("No operator menu");
    openMenu(operator);
    expect(
      Array.from(document.querySelectorAll('[role="menuitemradio"]')).map(
        (item) => item.textContent.trim(),
      ),
    ).toEqual(["is before"]);
  });

  it("names each end of a range's day menu by its end", () => {
    render(
      <DateEditor
        onChange={vi.fn()}
        rule={createFilterRule(createdField, ["today", ""], "between")}
      />,
    );
    expect(hasButtonNamed("Start date: Today")).toBe(true);
    expect(hasButtonNamed("End date: Exact date")).toBe(true);
  });

  it("reads a saved relative day with spaces around it", () => {
    render(
      <DateEditor
        onChange={vi.fn()}
        rule={createFilterRule(createdField, [" today "], "before")}
      />,
    );
    expect(dayChoice("Exact date").textContent.trim()).toBe("Today");
    expect(document.querySelector('input[aria-label="Exact date"]')).toBe(null);
  });

  function dayChoice(label: string) {
    const button = document.querySelector(
      `[role="group"][aria-label="${label}"] button`,
    );
    if (!button) throw new Error(`No day choice for ${label}`);
    return button;
  }

  it("ends a range on a relative day", () => {
    const onChange = vi.fn();
    render(
      <DateEditor
        onChange={onChange}
        rule={createFilterRule(createdField, [], "between")}
      />,
    );
    typeInto(dateInput("Start date"), "2026-10-01");
    openMenu(dayChoice("End date"));
    click(menuItem("Today"));
    expect(dayChoice("End date").textContent).toBe("Today");
    expect(document.querySelector('input[aria-label="End date"]')).toBeNull();
    click(buttonNamed("Apply"));
    expect(onChange).toHaveBeenLastCalledWith({
      operator: "between",
      value: ["2026-10-01", "today"],
    });
  });

  it("goes back from a relative day to a date box", () => {
    render(
      <DateEditor
        onChange={vi.fn()}
        rule={createFilterRule(createdField, ["yesterday"], "before")}
      />,
    );
    expect(dayChoice("Exact date").textContent).toBe("Yesterday");
    openMenu(dayChoice("Exact date"));
    click(menuItem("Exact date"));
    const input = dateInput("Exact date");
    expect(input.type).toBe("date");
    expect(input.value).toBe("");
    expect(buttonNamed("Apply").hasAttribute("disabled")).toBe(true);
  });

  it("edits a time an agent wrote as text", () => {
    const timed: FilterField = { ...createdField, times: true };
    render(
      <DateEditor
        onChange={vi.fn()}
        field={timed}
        rule={createFilterRule(timed, ["2026-10-22T09:00"], "after")}
      />,
    );
    const input = dateInput("Exact date");
    expect(input.type).toBe("text");
    expect(input.value).toBe("2026-10-22T09:00");
  });
});

function Bar({
  initial,
  onClear,
  barFields = fields,
  nestedGroups,
}: {
  initial: FilterState;
  onClear?: () => void;
  barFields?: FilterField[];
  nestedGroups?: boolean;
}) {
  const [state, setState] = useState(initial);
  return (
    <FilterBar
      fields={barFields}
      state={state}
      onChange={setState}
      onClear={onClear}
      nestedGroups={nestedGroups}
    />
  );
}

describe("FilterBar", () => {
  it("shows the pinned field as a chip and no Clear by default", () => {
    render(<Bar initial={createFilterState(fields)} />);
    expect(hasButtonNamed("Where it came from: Recorded in Clips")).toBe(true);
    expect(hasButtonNamed("Clear")).toBe(false);
  });

  it("shows a finished rule as a chip that can be removed", () => {
    render(
      <Bar
        initial={addFilterRule(
          createFilterState(fields),
          createFilterRule(ownerField, ["alice"]),
        )}
      />,
    );
    expect(hasButtonNamed("Made by: Alice")).toBe(true);
    expect(hasButtonNamed("Clear")).toBe(true);
    click(buttonNamed("Remove Made by: Alice"));
    expect(hasButtonNamed("Made by: Alice")).toBe(false);
    expect(hasButtonNamed("Clear")).toBe(false);
  });

  it("joins two rules with a switchable and", () => {
    render(
      <Bar
        initial={addFilterRule(
          addFilterRule(
            createFilterState(fields),
            createFilterRule(ownerField, ["alice"]),
          ),
          createFilterRule(tagsField, ["demo"]),
        )}
      />,
    );
    expect(hasButtonNamed("and")).toBe(true);
    openMenu(buttonNamed("and"));
    click(menuItem("One matching rule is enough"));
    expect(hasButtonNamed("or")).toBe(true);
  });

  it("goes back to the default on Clear and tells the app", () => {
    const onClear = vi.fn();
    render(
      <Bar
        onClear={onClear}
        initial={addFilterRule(
          setPinnedFilter(createFilterState(fields), "source", ["content"]),
          createFilterRule(tagsField, ["demo"]),
        )}
      />,
    );
    expect(hasButtonNamed("Where it came from: Uploaded from Content")).toBe(
      true,
    );
    click(buttonNamed("Clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(hasButtonNamed("Where it came from: Recorded in Clips")).toBe(true);
    expect(hasButtonNamed("Tags: Demo")).toBe(false);
  });

  it("offers every field but the pinned one when adding a filter", () => {
    render(<Bar initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    expect(texts('[role="option"]')).toEqual(["Made by", "Tags"]);
  });

  it("adds a rule straight from a value search", () => {
    render(<Bar initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    typeInto(combobox(), "alice");
    expect(texts('[role="option"]')).toEqual(["Made by: Alice"]);
    pressEnter(combobox());
    expect(hasButtonNamed("Made by: Alice")).toBe(true);
  });

  it("adds a yes-or-no rule only once a value is picked", () => {
    const starredField: FilterField = {
      id: "starred",
      label: "Starred",
      type: "boolean",
    };
    const withStarred = [...fields, starredField];
    render(
      <Bar initial={createFilterState(withStarred)} barFields={withStarred} />,
    );
    click(buttonNamed("Filter"));
    click(optionNamed("Starred"));
    click(buttonNamed("Filter"));
    expect(hasButtonNamed("Starred: Yes")).toBe(false);
    click(buttonNamed("Filter"));
    click(optionNamed("Starred"));
    click(optionNamed("Yes"));
    expect(hasButtonNamed("Starred: Yes")).toBe(true);
  });

  it("keeps a group open while its last rule is being changed", () => {
    render(
      <Bar
        initial={addFilterGroup(
          createFilterState(fields),
          createFilterGroup([createFilterRule(ownerField, ["alice"])]),
        )}
      />,
    );
    click(buttonNamed("(Made by: Alice)"));
    click(buttonNamed("Alice"));
    click(optionNamed("Alice"));
    expect(hasButtonNamed("Remove rule")).toBe(true);
    expect(hasButtonNamed("Choose a value")).toBe(true);
  });

  it("names a group inside a group in its own parentheses", () => {
    render(
      <Bar
        nestedGroups
        initial={addFilterGroup(
          createFilterState(fields),
          createFilterGroup([
            createFilterRule(ownerField, ["alice"]),
            createFilterGroup([createFilterRule(tagsField, ["demo"])], "and"),
          ]),
        )}
      />,
    );
    click(buttonNamed("(Made by: Alice or (Tags: Demo))"));
    expect(texts("button").filter((label) => label === "Add group")).toEqual([
      "Add group",
    ]);
    expect(
      Array.from(document.querySelectorAll("button")).filter(
        (button) => button.getAttribute("aria-label") === "Remove group",
      ),
    ).toHaveLength(2);
  });

  it("offers a group inside a group only to apps that opt in", () => {
    render(
      <Bar
        initial={addFilterGroup(
          createFilterState(fields),
          createFilterGroup([createFilterRule(ownerField, ["alice"])]),
        )}
      />,
    );
    click(buttonNamed("(Made by: Alice)"));
    expect(hasButtonNamed("Add rule")).toBe(true);
    expect(hasButtonNamed("Add group")).toBe(false);
  });
});

describe("FilterButton", () => {
  function Panel({ initial }: { initial: FilterState }) {
    const [state, setState] = useState(initial);
    return (
      <FilterButton
        fields={fields}
        state={state}
        onChange={setState}
        nouns={nouns}
        counts={{
          matching: 3,
          hiddenByPinned: 1,
          option: () => 0,
        }}
      />
    );
  }

  it("counts the rules in use for screen readers", () => {
    render(
      <Panel
        initial={addFilterRule(
          createFilterState(fields),
          createFilterRule(ownerField, ["alice"]),
        )}
      />,
    );
    expect(container.textContent).toContain("Rules in use: 1");
  });

  it("puts the all or any switch inside each sentence", () => {
    render(
      <Panel
        initial={addFilterGroup(
          createFilterState(fields),
          createFilterGroup([createFilterRule(tagsField, ["demo"])]),
        )}
      />,
    );
    click(buttonStartingWith("Filter"));
    expect(texts("span + button + span").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Show clips that matchall");
    expect(document.body.textContent).toContain("Match");
    expect(hasButtonNamed("any")).toBe(true);
    expect(document.body.textContent).toContain("of these rules:");
  });

  it("opens the rule panel with the match count", () => {
    vi.stubGlobal("innerWidth", 1280);
    render(<Panel initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    expect(document.body.textContent).toContain("Show clips that match");
    expect(document.body.textContent).toContain("3 clips match");
    expect(hasButtonNamed("Done")).toBe(true);
  });

  it("opens as a sheet with a Show button on a phone", () => {
    vi.stubGlobal("innerWidth", 390);
    render(<Panel initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    click(buttonNamed("Show 3 clips"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens the sheet's pickers as modal popovers so they can scroll", () => {
    vi.stubGlobal("innerWidth", 390);
    render(<Panel initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    const addRule = buttonNamed("Add rule");
    click(addRule);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Choose a field",
    );
    expect(addRule.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("keeps the desktop panel's pickers non-modal", () => {
    render(<Panel initial={createFilterState(fields)} />);
    click(buttonNamed("Filter"));
    const addRule = buttonNamed("Add rule");
    click(addRule);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Choose a field",
    );
    expect(addRule.closest('[aria-hidden="true"]')).toBeNull();
  });
});

const views: FilterSavedView[] = [
  { id: "mine", name: "My demos", shared: false, mine: true },
  { id: "team", name: "Team bugs", shared: true, mine: false, author: "Sam" },
];

function renderViews(props: Partial<FilterViewsControlProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onUpdate: vi.fn(),
    onShare: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <FilterViewsControl
      views={views}
      activeViewId={null}
      defaultLabel="All clips"
      dirty={false}
      suggestedName="Made by Alice"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("filterViewNameError", () => {
  it("needs a name no other view uses", () => {
    expect(filterViewNameError("  ", views)).toBe("required");
    expect(filterViewNameError(" MY DEMOS ", views)).toBe("taken");
    expect(filterViewNameError("My demos", views, "mine")).toBeNull();
    expect(filterViewNameError("Fresh", views)).toBeNull();
    expect(
      filterViewNameError("οσ", [
        { id: "greek", name: "ΟΣ", shared: false, mine: true },
      ]),
    ).toBe("taken");
    expect(
      filterViewNameError("STRAẞE", [
        { id: "german", name: "Straße", shared: false, mine: true },
      ]),
    ).toBe("taken");
  });
});

describe("FilterViewsControl", () => {
  it("shows no save controls while nothing has changed", () => {
    renderViews();
    expect(container.textContent).not.toContain("Not saved");
    expect(hasButtonNamed("Save")).toBe(false);
  });

  it("offers to save a changed view for me or for everyone", () => {
    renderViews({ dirty: true });
    expect(container.textContent).toContain("Not saved");
    openMenu(buttonNamed("Save"));
    expect(texts('[role="menuitem"]')).toEqual([
      "Save for meOnly you see this view.",
      "Save for everyoneEveryone in the workspace sees this view.",
    ]);
  });

  it("starts the name form with the suggested name selected", () => {
    const { onSave } = renderViews({ dirty: true });
    openMenu(buttonNamed("Save"));
    click(menuItem("Save for me"));
    const input = document.querySelector<HTMLInputElement>("form input");
    if (!input) throw new Error("No name input");
    expect(input.value).toBe("Made by Alice");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Made by Alice".length);

    typeInto(input, "my demos");
    expect(document.body.textContent).toContain(
      "A view called “my demos” already exists.",
    );
    const submit = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]',
    );
    expect(submit?.disabled).toBe(true);

    typeInto(input, "  Fresh  ");
    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onSave).toHaveBeenCalledWith({ name: "Fresh", shared: false });
  });

  it("updates my changed view from the save menu", () => {
    const { onUpdate } = renderViews({ dirty: true, activeViewId: "mine" });
    openMenu(buttonNamed("Save"));
    click(menuItem("Update “My demos”"));
    expect(onUpdate).toHaveBeenCalledWith("mine");
  });

  it("manages my view from its menu", () => {
    const { onShare, onDelete } = renderViews({ activeViewId: "mine" });
    openMenu(buttonNamed("Options for My demos"));
    expect(texts('[role="menuitem"]')).toEqual([
      "Update",
      "Share with everyone",
      "Rename",
      "Delete",
    ]);
    expect(menuItem("Update").getAttribute("aria-disabled")).toBe("true");
    click(menuItem("Share with everyone"));
    expect(onShare).toHaveBeenCalledWith("mine");

    openMenu(buttonNamed("Options for My demos"));
    click(menuItem("Delete"));
    expect(document.body.textContent).toContain(
      "Delete “My demos”? This can't be undone.",
    );
    click(buttonNamed("Delete"));
    expect(onDelete).toHaveBeenCalledWith("mine");
  });

  it("shows who shared a team view and no menu to change it", () => {
    renderViews({ activeViewId: "team" });
    expect(container.textContent).toContain("by Sam");
    expect(hasButtonNamed("Options for Team bugs")).toBe(false);
  });
});
