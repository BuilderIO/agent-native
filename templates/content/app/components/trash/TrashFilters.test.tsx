// @vitest-environment happy-dom

import type { FilterState } from "@agent-native/toolkit/app/filters";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { trashFilterFields } from "./trash-filter-model";
import { TrashFilters } from "./TrashFilters";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: () => "",
    formatNumber: (value: number) => String(value),
    formatList: (values: readonly string[]) => values.join(", "),
  }),
}));

const fields = trashFilterFields(
  {
    createdBy: "Created by",
    updatedBy: "Last edited by",
    deletedBy: "Deleted by",
    workspace: "Workspace",
    location: "Location",
    kind: "Type",
    page: "Page",
    collection: "Collection",
    deletedAt: "Deleted at",
  },
  {
    people: [{ id: "ana@example.com", label: "Ana" }],
    spaces: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    locations: [],
  },
);
const noFilters: FilterState = { mode: "and", items: [], pinned: {} };
const createdByAna: FilterState = {
  mode: "and",
  items: [
    {
      kind: "rule",
      id: "r-1",
      field: "createdBy",
      operator: "equals",
      value: ["ana@example.com"],
    },
  ],
  pinned: {},
};

function render(filters: object, filterState: FilterState = noFilters) {
  const host = document.createElement("div");
  const onEmptyTrash = vi.fn();
  act(() => {
    createRoot(host).render(
      createElement(TrashFilters, {
        filters,
        onChange: vi.fn(),
        fields,
        filterState,
        onFilterStateChange: vi.fn(),
        onEmptyTrash,
      }),
    );
  });
  return { host, onEmptyTrash };
}

describe("Trash toolbar", () => {
  it("keeps Empty Trash enabled with several workspaces", () => {
    const { host, onEmptyTrash } = render({});
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="trash.emptyTrash"]',
    );

    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  it("counts finished filter chips on the Filter button", () => {
    const { host } = render({}, createdByAna);

    expect(
      host.querySelector('button[aria-label="1 trash.filter"]'),
    ).not.toBeNull();
  });

  it("shows no chip row until a filter, sort, or search is set", () => {
    expect(render({}).host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("puts the sort, filter chips, and search in one chip row", () => {
    const { host } = render(
      { query: "draft", sort: "name", direction: "asc" },
      createdByAna,
    );

    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(
      host.querySelectorAll('button[aria-label="trash.removeFilter"]'),
    ).toHaveLength(2);
    expect(host.textContent).toContain("trash.searchPlaceholder: draft");
  });
});
