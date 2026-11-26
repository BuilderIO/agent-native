import { describe, expect, it } from "vitest";

import {
  deriveSettingsSummary,
  flattenSettingsRows,
  settingsCoverage,
  validateSettingsSections,
} from "./model.js";
import type {
  SettingsRowDefinition,
  SettingsSectionDefinition,
  SettingsSummary,
} from "./schema.js";

const OPTIONS = ["Assignments", "Mentions", "Reviews", "Updates and news"].map(
  (label) => ({ value: label.split(" ")[0]!.toLowerCase(), label }),
);

const STATUS: SettingsSummary = {
  when: "always",
  content: {
    kind: "selection-status",
    enabledBy: "settings.notifications.email.enabled",
    selectedOptionsFrom: "settings.notifications.email.categories",
    disabled: "Disabled",
    none: "Enabled",
    all: "Enabled for all",
    partial: "Enabled for {list}",
    list: {
      labelCase: "lowercase",
      separator: ", ",
      pair: {
        template: "{first} and {second}",
        useSeparatorIfLabelIncludes: "and",
      },
      overflow: { maxNamed: 2, template: "{remaining} others" },
    },
  },
};

function channel(enabled: boolean, selected: string[]): SettingsRowDefinition {
  return {
    id: "settings.notifications.email",
    kind: "disclosure",
    label: "Email",
    expanded: false,
    setExpanded: () => {},
    summary: STATUS,
    rows: [
      {
        id: "settings.notifications.email.enabled",
        kind: "toggle",
        label: "Enabled",
        binding: { value: enabled },
      },
      {
        id: "settings.notifications.email.categories",
        kind: "checkbox-group",
        label: "Categories",
        options: OPTIONS,
        binding: { value: selected },
      },
    ],
  };
}

function summarize(row: SettingsRowDefinition) {
  if (row.kind !== "disclosure" || !row.summary) throw new Error("no summary");
  return deriveSettingsSummary(row, row.summary, row.rows);
}

describe("settings summaries", () => {
  it.each([
    [false, ["assignments"], "Disabled"],
    [true, [], "Enabled"],
    [
      true,
      ["assignments", "mentions", "reviews", "updates"],
      "Enabled for all",
    ],
    [true, ["assignments"], "Enabled for assignments"],
    [true, ["assignments", "mentions"], "Enabled for assignments and mentions"],
    [
      true,
      ["assignments", "updates"],
      "Enabled for assignments, updates and news",
    ],
    [
      true,
      ["assignments", "mentions", "reviews"],
      "Enabled for assignments, mentions, 1 others",
    ],
  ])("enabled=%s selected=%j reads %s", (enabled, selected, expected) => {
    expect(summarize(channel(enabled, selected))).toBe(expected);
  });

  it("leaves a stored option with no label out of the list", () => {
    expect(summarize(channel(true, ["assignments", "retired"]))).toBe(
      "Enabled for assignments",
    );
  });

  it("counts a checkbox group's own stored selection", () => {
    const row: SettingsRowDefinition = {
      id: "settings.notifications.priority-categories",
      kind: "checkbox-group",
      label: "Priority categories",
      options: OPTIONS,
      binding: { value: ["assignments", "retired", "reviews"] },
      disclosure: {
        expanded: false,
        setExpanded: () => {},
        summary: {
          when: "always",
          content: {
            kind: "count",
            source: { kind: "selected-options", row: "self" },
            template: "{count} types",
          },
        },
      },
    };
    expect(deriveSettingsSummary(row, row.disclosure!.summary!, [row])).toBe(
      "3 types",
    );
  });

  it("returns null when a reference does not resolve", () => {
    const row = channel(true, []);
    if (row.kind !== "disclosure") throw new Error("unreachable");
    expect(deriveSettingsSummary(row, STATUS, [])).toBeNull();
  });
});

describe("settings sections", () => {
  const sections: SettingsSectionDefinition[] = [
    {
      id: "push",
      rows: [
        channel(true, ["assignments"]),
        {
          id: "settings.notifications.preview",
          kind: "custom",
          label: "Preview",
          reason: "A drawn preview of the message",
          component: () => null,
        },
        {
          id: "settings.notifications.hidden",
          kind: "toggle",
          label: "Hidden",
          condition: { visible: false },
          binding: { value: false },
        },
      ],
    },
  ];

  it("validates ids and summary references", () => {
    expect(validateSettingsSections(sections)).toEqual([]);
    expect(
      validateSettingsSections([
        {
          id: "Bad Id",
          rows: [
            {
              id: "settings.x" as const,
              kind: "toggle",
              label: "X",
              binding: { value: true },
            },
          ],
        },
        {
          id: "two",
          rows: [
            {
              id: "settings.x" as const,
              kind: "toggle",
              label: "X",
              binding: { value: true },
            },
          ],
        },
      ]),
    ).toEqual([
      "Section id is not lowercase and hyphenated: Bad Id",
      "Duplicate row id: settings.x",
    ]);
  });

  it("flattens visible rows, parents first", () => {
    expect(flattenSettingsRows(sections).map((row) => row.id)).toEqual([
      "settings.notifications.email",
      "settings.notifications.email.enabled",
      "settings.notifications.email.categories",
      "settings.notifications.preview",
    ]);
  });

  it("counts custom rows as not covered and includes hidden rows", () => {
    const coverage = settingsCoverage(sections);
    expect(coverage).toMatchObject({ total: 5, covered: 4, custom: 1 });
    expect(coverage.customRows).toEqual([
      {
        id: "settings.notifications.preview",
        reason: "A drawn preview of the message",
      },
    ]);
  });
});
