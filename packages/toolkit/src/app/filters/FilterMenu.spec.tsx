// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { FilterMenu, FilterMenuWords } from "./FilterMenu.js";
import {
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  setPinnedFilter,
  type FilterCounts,
  type FilterField,
  type FilterState,
} from "./model.js";

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

const statusField: FilterField = {
  id: "status",
  label: "Status",
  type: "choice",
  options: [
    { id: "doing", label: "Doing" },
    { id: "done", label: "Done" },
  ],
};

const nameField: FilterField = {
  id: "name",
  label: "Name",
  type: "text",
};

const fields = [statusField, nameField];

const counts: FilterCounts = {
  matching: 3,
  hiddenByPinned: 2,
  option: (fieldId, optionId) =>
    fieldId === "source" ? (optionId === "clips" ? 3 : 2) : undefined,
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
});

function render(node: ReactNode) {
  act(() => root.render(<TooltipProvider>{node}</TooltipProvider>));
}

function click(target: Element) {
  act(() => {
    if (target instanceof HTMLElement) target.click();
  });
}

function firstButton() {
  const button = document.querySelector("button");
  if (!button) throw new Error("No button");
  return button;
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

function labelled(name: string) {
  const match = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-label]"),
  ).find((element) => element.getAttribute("aria-label") === name);
  if (!match) throw new Error(`Nothing labelled ${name}`);
  return match;
}

function nameText(value: string) {
  return addFilterRule(
    createFilterState(fields),
    createFilterRule(nameField, [value], "contains"),
  );
}

function Menu({
  initial,
  menuFields = fields,
  onState,
  onClear,
}: {
  initial: FilterState;
  menuFields?: readonly FilterField[];
  onState?: (state: FilterState) => void;
  onClear?: () => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <FilterMenu
      fields={menuFields}
      state={state}
      counts={counts}
      onClear={onClear}
      onChange={(next) => {
        onState?.(next);
        setState(next);
      }}
    />
  );
}

function openMenu() {
  click(buttonNamed("Filter"));
}

describe("FilterMenu", () => {
  it("opens from the kit's Filter button, which counts the lines in use", () => {
    render(<Menu initial={nameText("a")} />);
    const trigger = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.includes("Rules in use: 1"),
    );
    if (!trigger) throw new Error("No Filter button");
    expect(trigger.textContent).toContain("Filter");
    click(trigger);
    expect(labelled("Filter").textContent).toMatch(/^Filter.*Where/);
  });

  it("removes a line", () => {
    let latest: FilterState | undefined;
    render(
      <Menu
        initial={addFilterRule(
          createFilterState(fields),
          createFilterRule(statusField, ["done"], "does_not_equal"),
        )}
        onState={(next) => {
          latest = next;
        }}
      />,
    );
    click(firstButton());
    click(buttonNamed("Remove filter: Status: not Done"));
    expect(latest?.items).toEqual([]);
    expect(document.body.textContent).toContain("No filters.");
  });

  it("opens a group with its own word", () => {
    const start = nameText("a");
    const group = createFilterGroup(
      [
        createFilterRule(nameField, ["b"], "contains"),
        createFilterRule(nameField, ["c"], "contains"),
      ],
      "or",
    );
    render(<Menu initial={addFilterGroup(start, group)} />);
    click(firstButton());
    const box = labelled("Group: either is enough");
    expect(box.textContent).toMatch(/^and\s*either/);
    expect(
      box.querySelector('[aria-label="Remove filter: Name: contains “b”"]'),
    ).not.toBeNull();
    expect(
      box.querySelector('[aria-label="Remove filter: Name: contains “c”"]'),
    ).not.toBeNull();
  });

  it("opens the line already filtering a choice instead of adding another", async () => {
    const onState = vi.fn();
    render(
      <Menu
        initial={addFilterRule(
          createFilterState(fields),
          createFilterRule(statusField, ["doing"]),
        )}
        onState={onState}
      />,
    );
    click(firstButton());
    click(buttonNamed("Add filter"));
    const statusOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent.trim() === "Status");
    if (!statusOption) throw new Error("No Status option");
    click(statusOption);
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(onState).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-filter-line]")).toHaveLength(1);
    expect(document.body.textContent).toContain("Status is already a filter");
    expect(buttonNamed("Close this filter")).toBeDefined();
  });

  it("shows a pinned field's options with counts and puts it back on Clear", () => {
    const onClear = vi.fn();
    let latest: FilterState | undefined;
    render(
      <Menu
        initial={createFilterState([sourceField, ...fields])}
        menuFields={[sourceField, ...fields]}
        onClear={onClear}
        onState={(next) => {
          latest = next;
        }}
      />,
    );
    openMenu();
    const options = labelled("Where it came from");
    expect(options.textContent).toContain("Recorded in Clips3");
    expect(options.textContent).toContain("Uploaded from Content2");
    expect(() => buttonNamed("Clear filters")).toThrow();

    click(options.querySelectorAll('[role="checkbox"]')[1]);
    expect(latest?.pinned.source).toEqual(["clips", "content"]);

    click(buttonNamed("Clear filters"));
    expect(latest?.pinned.source).toEqual(["clips"]);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the menu's words in the reader's language", async () => {
    const catalog = createToolkitI18nCatalog({ messages: {} });
    render(
      <AgentNativeI18nProvider
        catalog={catalog}
        initialLocale="fr-FR"
        initialPreference="fr-FR"
        persistPreference={false}
      >
        <Menu initial={createFilterState(fields)} />
      </AgentNativeI18nProvider>,
    );
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Filtrer");
    });
    click(firstButton());
    expect(document.body.textContent).toContain("Aucun filtre.");
    expect(buttonNamed("Ajouter un filtre")).toBeDefined();
  });
});

describe("FilterMenuWords", () => {
  it("lists a changed pinned field before the lines", () => {
    const menuFields = [{ ...sourceField, shortLabel: "Source" }, ...fields];
    const state = addFilterRule(
      setPinnedFilter(createFilterState(menuFields), "source", ["content"]),
      createFilterRule(nameField, ["a"], "contains"),
    );
    render(
      <FilterMenuWords
        fields={menuFields}
        state={addFilterRule(state, createFilterRule(statusField, ["doing"]))}
        heading="Showing clips where"
      />,
    );
    const items = Array.from(container.querySelectorAll("li")).map((item) =>
      item.textContent.trim(),
    );
    expect(items).toEqual([
      "Source: Uploaded from Content",
      "Name: contains “a”",
      "and Status: Doing",
    ]);
    expect(container.textContent).toMatch(/^Showing clips where/);
  });
});
