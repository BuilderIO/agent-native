import type { DocumentProperty } from "@shared/api";
import { applyContentDatabaseTableQuery } from "@shared/database-query";
import { describe, expect, it } from "vitest";

import {
  contentFilterFields,
  contentFilterQueryKey,
  contentFiltersToKitState,
  kitStateToContentFilters,
} from "./filter-kit";
import type { DatabaseFilter } from "./types";

function property(
  id: string,
  type: DocumentProperty["definition"]["type"],
  options: string[] = [],
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name: `${id} label`,
      type,
      visibility: "always_show",
      options: {
        options: options.map((name) => ({ id: name, name, color: "gray" })),
      },
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: null,
    editable: true,
  };
}

const properties = [
  property("status", "status", ["active", "done", "dropped"]),
  property("tags", "multi_select", ["demo", "docs"]),
  property("owner", "person"),
  property("due", "date"),
  property("created", "created_time"),
  property("files", "files_media"),
  property("summary", "text"),
  property("done", "checkbox"),
];

const nameLabel = "Name";

function roundTrip(filters: DatabaseFilter[], mode: "and" | "or" = "and") {
  return kitStateToContentFilters(
    contentFiltersToKitState(filters, mode, properties),
    properties,
    { nameLabel, previous: filters },
  );
}

// oracle-change(templates/content/app/components/editor/database/filter-chips.test.ts): databaseFilterChipToReopen and foldDatabaseFilterChips went with Content's own chips, which the shared filter kit's chips replace
describe("contentFilterFields", () => {
  const fields = contentFilterFields(properties, {
    nameLabel,
    choices: (candidate) =>
      candidate.definition.id === "owner"
        ? [
            {
              id: "__current_user__:ada@example.com",
              name: "Me",
              filterValue: "ada@example.com",
            },
            { id: "ada@example.com", name: "Ada" },
            { id: "lin@example.com", name: "Lin" },
          ]
        : (candidate.definition.options.options ?? []),
  });
  const field = (id: string) => fields.find((candidate) => candidate.id === id);

  it("maps each property type to the kit's", () => {
    expect(fields.map(({ id, type }) => [id, type])).toEqual([
      ["name", "text"],
      ["status", "choice"],
      ["tags", "multi"],
      ["owner", "multi"],
      ["due", "date"],
      ["created", "date"],
      ["files", "text"],
      ["summary", "text"],
      ["done", "boolean"],
    ]);
    expect(field("due")).toMatchObject({ times: true, dates: "any" });
    expect(field("created")).toMatchObject({ times: true, dates: "past" });
  });

  it("offers only the operators Content's server keeps", () => {
    expect(field("files")?.operators).toEqual([
      "contains",
      "equals",
      "does_not_equal",
      "is_empty",
      "is_not_empty",
    ]);
    expect(field("summary")?.operators).toContain("starts_with");
  });

  it("lists a person once, as Me when it's the viewer", () => {
    expect(field("owner")?.options).toEqual([
      { id: "ada@example.com", label: "Me" },
      { id: "lin@example.com", label: "Lin" },
    ]);
  });
});

describe("contentFiltersToKitState", () => {
  it("reads option rules with the kit's operators", () => {
    const state = contentFiltersToKitState(
      [
        {
          key: "status",
          label: "Status",
          operator: "contains",
          value: '["active","done"]',
        },
        {
          key: "tags",
          label: "Tags",
          operator: "does_not_equal",
          value: "demo",
        },
        {
          key: "owner",
          label: "Owner",
          operator: "contains",
          value: "lin@example.com",
        },
      ],
      "and",
      properties,
    );
    expect(
      state.items.map((item) =>
        item.kind === "rule" ? [item.field, item.operator, item.value] : null,
      ),
    ).toEqual([
      ["status", "equals", ["active", "done"]],
      ["tags", "does_not_contain", ["demo"]],
      ["owner", "contains", ["lin@example.com"]],
    ]);
  });

  it("reads a saved option name as that option, whatever its case", () => {
    const fields = contentFilterFields(properties, {
      nameLabel,
      choices: (candidate) =>
        candidate.definition.id === "status"
          ? [
              { id: "opt-active", name: "Active" },
              { id: "opt-done", name: "Done" },
            ]
          : [],
    });
    const state = contentFiltersToKitState(
      [
        {
          key: "status",
          label: "Status",
          operator: "contains",
          value: '["done","opt-active","Gone"]',
        },
      ],
      "and",
      properties,
      fields,
    );
    expect(state.items).toMatchObject([
      { kind: "rule", value: ["opt-done", "opt-active", "Gone"] },
    ]);
  });

  it("reads a range by its two ends and keeps a half-filled one", () => {
    const state = contentFiltersToKitState(
      [
        {
          key: "due",
          label: "Due",
          operator: "between",
          value: '["2026-10-01","2026-10-01"]',
        },
        {
          key: "due",
          label: "Due",
          operator: "between",
          value: '["2026-10-01T09:00",""]',
        },
      ],
      "and",
      properties,
    );
    expect(
      state.items.map((item) => (item.kind === "rule" ? item.value : null)),
    ).toEqual([
      ["2026-10-01", "2026-10-01"],
      ["2026-10-01T09:00", ""],
    ]);
  });

  it("nests a group inside its parent, with each group's own mode", () => {
    const state = contentFiltersToKitState(
      [
        { key: "done", label: "Done", operator: "is_checked", value: "" },
        {
          key: "status",
          label: "Status",
          operator: "contains",
          value: "active",
          filterGroupId: "advanced",
          filterGroupMode: "or",
        },
        {
          key: "tags",
          label: "Tags",
          operator: "contains",
          value: "demo",
          filterGroupId: "inner",
          filterGroupMode: "and",
          parentFilterGroupId: "advanced",
          parentFilterGroupMode: "or",
        },
      ],
      "and",
      properties,
    );
    expect(state.items).toMatchObject([
      { kind: "rule", field: "done" },
      {
        kind: "group",
        id: "advanced",
        mode: "or",
        rules: [
          { kind: "rule", field: "status" },
          {
            kind: "group",
            id: "inner",
            mode: "and",
            rules: [{ kind: "rule", field: "tags" }],
          },
        ],
      },
    ]);
  });

  it("gives the same filters the same rule ids", () => {
    const filters: DatabaseFilter[] = [
      { key: "summary", label: "Summary", operator: "contains", value: "a" },
      { key: "done", label: "Done", operator: "is_checked", value: "" },
    ];
    expect(contentFiltersToKitState(filters, "and", properties)).toEqual(
      contentFiltersToKitState(filters, "and", properties),
    );
  });
});

describe("kitStateToContentFilters", () => {
  it("round-trips saved filters unchanged", () => {
    const filters: DatabaseFilter[] = [
      { key: "name", label: "Name", operator: "contains", value: "plan" },
      {
        key: "status",
        label: "status label",
        operator: "contains",
        value: '["active","done"]',
      },
      {
        key: "tags",
        label: "tags label",
        operator: "does_not_equal",
        value: "demo",
      },
      {
        key: "due",
        label: "due label",
        operator: "between",
        value: '["2026-10-01","2026-10-31T17:00"]',
      },
      {
        key: "created",
        label: "created label",
        operator: "is_within",
        value: "past_7_days",
      },
      {
        key: "due",
        label: "due label",
        operator: "does_not_equal",
        value: "today",
      },
      { key: "done", label: "done label", operator: "is_unchecked", value: "" },
      {
        key: "summary",
        label: "summary label",
        operator: "is_empty",
        value: "",
      },
    ];
    expect(roundTrip(filters)).toEqual(filters);
  });

  it("writes each group's mode onto its rules", () => {
    const filters: DatabaseFilter[] = [
      {
        key: "status",
        label: "status label",
        operator: "contains",
        value: "active",
        filterGroupId: "advanced",
      },
      {
        key: "tags",
        label: "tags label",
        operator: "contains",
        value: "demo",
        filterGroupId: "inner",
        parentFilterGroupId: "advanced",
      },
    ];
    expect(roundTrip(filters, "or")).toEqual([
      { ...filters[0], filterGroupMode: "or" },
      {
        ...filters[1],
        filterGroupMode: "or",
        parentFilterGroupMode: "or",
      },
    ]);
  });

  it("keeps a removed property's label from the saved filter", () => {
    const filters: DatabaseFilter[] = [
      { key: "gone", label: "Old column", operator: "contains", value: "x" },
    ];
    expect(roundTrip(filters)).toEqual(filters);
  });

  it("filters the same rows before and after a round trip", () => {
    const filters: DatabaseFilter[] = [
      {
        key: "status",
        label: "status label",
        operator: "contains",
        value: '["active","done"]',
        filterGroupId: "advanced",
        filterGroupMode: "or",
      },
      {
        key: "tags",
        label: "tags label",
        operator: "does_not_equal",
        value: "demo",
        filterGroupId: "advanced",
        filterGroupMode: "or",
      },
    ];
    const item = (id: string, status: string, tags: string[]) => ({
      document: { id, title: id },
      properties: [
        {
          ...property("status", "status", ["active", "done", "dropped"]),
          value: status,
        },
        { ...property("tags", "multi_select", ["demo", "docs"]), value: tags },
      ],
    });
    const items = [
      item("a", "active", ["demo"]),
      item("b", "dropped", ["docs"]),
      item("c", "dropped", ["demo"]),
    ] as unknown as Parameters<typeof applyContentDatabaseTableQuery>[0];
    const query = (next: DatabaseFilter[]) =>
      applyContentDatabaseTableQuery(items, properties, {
        search: "",
        sorts: [],
        filters: next,
        filterMode: "and",
      }).map((row) => row.document.id);
    expect(query(roundTrip(filters))).toEqual(query(filters));
    expect(query(filters)).toEqual(["a", "b"]);
  });
});

describe("contentFilterQueryKey", () => {
  it("ignores order within a group and spelled-out modes", () => {
    const grouped = (
      key: string,
      value: string,
      mode?: "and" | "or",
    ): DatabaseFilter => ({
      key,
      label: key,
      operator: "contains",
      value,
      filterGroupId: "advanced",
      ...(mode ? { filterGroupMode: mode } : {}),
    });
    const nested: DatabaseFilter = {
      key: "tags",
      label: "tags",
      operator: "contains",
      value: "demo",
      filterGroupId: "inner",
      parentFilterGroupId: "advanced",
    };
    expect(
      contentFilterQueryKey(
        [grouped("status", "active"), nested, grouped("summary", "x")],
        "and",
        properties,
        nameLabel,
      ),
    ).toBe(
      contentFilterQueryKey(
        [grouped("status", "active", "and"), grouped("summary", "x"), nested],
        "and",
        properties,
        nameLabel,
      ),
    );
  });

  it("changes when a value does", () => {
    const filters = (value: string): DatabaseFilter[] => [
      { key: "summary", label: "summary", operator: "contains", value },
    ];
    expect(
      contentFilterQueryKey(filters("a"), "and", properties, nameLabel),
    ).not.toBe(
      contentFilterQueryKey(filters("b"), "and", properties, nameLabel),
    );
  });
});
