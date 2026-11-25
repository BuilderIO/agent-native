// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { DocumentProperty } from "@shared/api";
import { act, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { i18nCatalog } from "@/i18n";
import { byLabel, click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import { DatabaseFilterMenu } from "./DatabaseFilterMenu";
import { databaseFilterOptionChoices } from "./DatabaseView";
import { contentFilterFields, useContentFilterKitState } from "./filter-kit";
import type { DatabaseFilter, DatabaseFilterMode } from "./types";

const status: DocumentProperty = {
  definition: {
    id: "status",
    databaseId: "database",
    name: "Status",
    type: "select",
    visibility: "always_show",
    options: {
      options: [
        { id: "done", name: "Done", color: "green" },
        { id: "doing", name: "Doing", color: "blue" },
      ],
    },
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
  editable: true,
};

const properties = [status];

function nameFilter(
  value: string,
  group: Partial<DatabaseFilter> = {},
): DatabaseFilter {
  return { key: "name", label: "Name", operator: "contains", value, ...group };
}

async function renderMenu(
  initialFilters: DatabaseFilter[],
  initialMode: DatabaseFilterMode = "and",
) {
  const latest = { filters: initialFilters, filterMode: initialMode };

  function Menu() {
    const [query, setQuery] = useState(latest);
    latest.filters = query.filters;
    latest.filterMode = query.filterMode;
    const fields = useMemo(
      () =>
        contentFilterFields(properties, {
          nameLabel: "Name",
          choices: (property) =>
            databaseFilterOptionChoices(property.definition.id, properties),
        }),
      [],
    );
    const kit = useContentFilterKitState({
      filters: query.filters,
      filterMode: query.filterMode,
      properties,
      fields,
      nameLabel: "Name",
      onChange: (filters, filterMode) => setQuery({ filters, filterMode }),
    });
    return (
      <DatabaseFilterMenu
        fields={fields}
        state={kit.state}
        onChange={kit.setState}
        optionClass={() => undefined}
        hint="Filter"
      >
        <button type="button">Open filters</button>
      </DatabaseFilterMenu>
    );
  }

  renderUi(
    <AgentNativeI18nProvider
      initialLocale="en-US"
      persistPreference={false}
      catalog={i18nCatalog}
    >
      <TooltipProvider>
        <Menu />
      </TooltipProvider>
    </AgentNativeI18nProvider>,
  );
  await click(button("Open filters"));
  return latest;
}

function button(name: string) {
  const buttons = [...document.querySelectorAll<HTMLElement>("button")];
  const match = buttons.find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent.trim() === name,
  );
  if (!match) {
    const names = buttons.map(
      (candidate) =>
        candidate.getAttribute("aria-label") ?? candidate.textContent.trim(),
    );
    throw new Error(`No button named ${name} among: ${names.join(" | ")}`);
  }
  return match;
}

async function pickJoin(line: string, from: string, to: "and" | "or") {
  const joiner = button(`“${from}” before ${line}. Change`);
  act(() => {
    joiner.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ].find((candidate) => candidate.textContent.trim().startsWith(to));
  if (!item) throw new Error(`No "${to}" item`);
  await click(item);
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
}

// oracle-change(templates/content/app/components/editor/database/DatabaseView.filter-kit.ui.test.tsx): it tested the filter chips under the toolbar, which the Filter menu's lines replace
describe("the Filter menu's lines", () => {
  it("names a saved option filter's option and removes its line", async () => {
    const latest = await renderMenu([
      {
        key: "status",
        label: "Status",
        operator: "does_not_equal",
        value: "done",
      },
    ]);
    expect(byLabel("Filter").textContent).toMatch(/^Filter.*Where/);
    await click(button("Remove filter: Status: not Done"));
    expect(latest.filters).toEqual([]);
  });

  it("switches a two-line view between and and or from the word", async () => {
    const latest = await renderMenu([nameFilter("a"), nameFilter("b")]);
    await pickJoin("Name: contains “b”", "and", "or");
    expect(latest.filterMode).toBe("or");
    expect(latest.filters.map((filter) => filter.value)).toEqual(["a", "b"]);
    expect(latest.filters.some((filter) => filter.filterGroupId)).toBe(false);
  });

  it("boxes the lines an and still joins when a later word becomes or", async () => {
    const latest = await renderMenu([
      nameFilter("a"),
      nameFilter("b"),
      nameFilter("c"),
    ]);
    await pickJoin("Name: contains “c”", "and", "or");
    expect(latest.filterMode).toBe("or");
    const filters: readonly (DatabaseFilter | undefined)[] = latest.filters;
    const [a, b, c] = filters;
    expect(a?.filterGroupId).toBeTruthy();
    expect(b?.filterGroupId).toBe(a?.filterGroupId);
    expect(a?.filterGroupMode).toBe("and");
    expect(c?.filterGroupId).toBeFalsy();
    expect(byLabel("Group: every line must be true")).toBeDefined();
  });

  it("opens a group with its own word", async () => {
    await renderMenu([
      nameFilter("a"),
      nameFilter("b", { filterGroupId: "either", filterGroupMode: "or" }),
      nameFilter("c", { filterGroupId: "either", filterGroupMode: "or" }),
    ]);
    const box = byLabel("Group: either is enough");
    expect(box.textContent).toMatch(/^and\s*either/);
    expect(byLabel("Remove filter: Name: contains “b”", box)).toBeDefined();
    expect(byLabel("Remove filter: Name: contains “c”", box)).toBeDefined();
  });

  it("opens the line already filtering a choice instead of adding another", async () => {
    const latest = await renderMenu([
      { key: "status", label: "Status", operator: "equals", value: "doing" },
    ]);
    await click(button("Add filter"));
    const statusOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent.trim() === "Status");
    if (!statusOption) throw new Error("No Status option");
    await click(statusOption);
    await settle();
    expect(latest.filters).toHaveLength(1);
    expect(document.body.textContent).toContain("Status is already a filter");
    expect(button("Close this filter")).toBeDefined();
  });
});
