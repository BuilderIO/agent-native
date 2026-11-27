// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { byLabel, click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import { DatabaseSortWords, SortMenu } from "./DatabaseSortMenu";
import {
  ColumnHeaderMenuContent,
  databaseColumnHeaderStateLabel,
} from "./DatabaseView";
import type { DatabaseSort } from "./types";

function property(
  id: string,
  name: string,
  type: DocumentProperty["definition"]["type"],
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: null,
    editable: true,
  };
}

const properties = [
  property("due", "Due", "date"),
  property("estimate", "Estimate", "number"),
  property("done", "Done", "checkbox"),
];

function button(text: string) {
  const match = [...document.querySelectorAll<HTMLElement>("button")].find(
    (candidate) => candidate.textContent.trim() === text,
  );
  if (!match) throw new Error(`No button "${text}"`);
  return match;
}

function menuItemTexts() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.textContent.trim(),
  );
}

function menuItem(text: string) {
  const match = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((candidate) => candidate.textContent.trim() === text);
  if (!match) throw new Error(`No menu item "${text}"`);
  return match;
}

describe("sort directions named for the column", () => {
  it("offers a date column's sorts as old and new from its header menu", async () => {
    const latest: { sorts: DatabaseSort[] } = { sorts: [] };
    renderUi(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <button type="button">Due</button>
        </DropdownMenuTrigger>
        <ColumnHeaderMenuContent
          columnKey="due"
          label="Due"
          propertyType="date"
          sorts={[]}
          filters={[]}
          onSortsChange={(sorts) => {
            latest.sorts = sorts;
          }}
          onFiltersChange={() => {}}
        />
      </DropdownMenu>,
    );

    await click(menuItem("Sort"));
    expect(menuItemTexts()).toEqual(
      expect.arrayContaining(["Old → new", "New → old"]),
    );
    expect(menuItemTexts()).not.toContain("Sort ascending");

    await click(menuItem("New → old"));
    expect(latest.sorts).toEqual([
      { key: "due", label: "Due", direction: "desc" },
    ]);
  });

  it("names a checkbox sort's direction in the Sort menu and its hint", async () => {
    const latest: { sorts: DatabaseSort[] } = {
      sorts: [{ key: "done", label: "Done", direction: "asc" }],
    };

    function Menu() {
      const [sorts, setSorts] = useState(latest.sorts);
      latest.sorts = sorts;
      return (
        <SortMenu
          properties={properties}
          sorts={sorts}
          onSortsChange={setSorts}
        />
      );
    }

    renderUi(<Menu />);

    await click(byLabel("1 active sorts"));
    await click(button("Unchecked → checked"));
    expect(latest.sorts).toEqual([
      { key: "done", label: "Done", direction: "desc" },
    ]);
    expect(button("Checked → unchecked")).toBeDefined();
  });

  it("lists the sorts in words for the Sort button's hint", () => {
    const view = renderUi(
      <DatabaseSortWords
        properties={properties}
        sorts={[
          { key: "done", label: "Done", direction: "desc" },
          { key: "due", label: "Due", direction: "asc" },
        ]}
      />,
    );
    expect(
      [...view.container.querySelectorAll("li")].map((item) =>
        item.textContent.trim(),
      ),
    ).toEqual(["Done, Checked → unchecked", "Due, Old → new"]);
  });

  it("removes a sort line and clears every sort from the Sort menu", async () => {
    const latest: { sorts: DatabaseSort[] } = {
      sorts: [
        { key: "estimate", label: "Estimate", direction: "asc" },
        { key: "due", label: "Due", direction: "desc" },
      ],
    };

    function Menu() {
      const [sorts, setSorts] = useState(latest.sorts);
      latest.sorts = sorts;
      return (
        <SortMenu
          properties={properties}
          sorts={sorts}
          onSortsChange={setSorts}
        />
      );
    }

    renderUi(<Menu />);

    await click(byLabel("2 active sorts"));
    expect(document.body.textContent).not.toContain("then by");
    await click(byLabel("Remove sort: Estimate"));
    expect(latest.sorts).toEqual([
      { key: "due", label: "Due", direction: "desc" },
    ]);
    await click(button("Clear sorts"));
    expect(latest.sorts).toEqual([]);
  });

  it("toggles a number sort between low and high in the Sort menu", async () => {
    const latest: { sorts: DatabaseSort[] } = {
      sorts: [{ key: "estimate", label: "Estimate", direction: "asc" }],
    };

    function Menu() {
      const [sorts, setSorts] = useState(latest.sorts);
      latest.sorts = sorts;
      return (
        <SortMenu
          properties={properties}
          sorts={sorts}
          onSortsChange={setSorts}
        />
      );
    }

    renderUi(<Menu />);

    await click(byLabel("1 active sorts"));
    await click(button("Low → high"));
    expect(latest.sorts).toEqual([
      { key: "estimate", label: "Estimate", direction: "desc" },
    ]);
    expect(button("High → low")).toBeDefined();
  });

  it("says how a sorted column header is sorted", () => {
    expect(
      databaseColumnHeaderStateLabel(
        { sortDirection: "desc", activeFilterCount: 0 },
        "due",
        "date",
      ),
    ).toBe("Sorted New → old");
    expect(
      databaseColumnHeaderStateLabel(
        { sortDirection: "asc", activeFilterCount: 1 },
        "name",
      ),
    ).toBe("Sorted A → Z, 1 active filter");
  });
});
