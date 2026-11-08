import { describe, expect, it } from "vitest";

import {
  freezeRuleKeys,
  freezeRuleOf,
  frozenBlocksFieldMessage,
  frozenBlocksFields,
  keepRuledOptions,
  tabsFrozenBy,
  toggledFreezeRule,
  type ColumnRuleDefinition,
} from "./column-rules";
import { parsePropertyOptions, serializePropertyOptions } from "./properties";

const status: ColumnRuleDefinition = {
  id: "status",
  name: "Status",
  type: "status",
  options: {
    options: [
      { id: "draft", name: "Draft", color: "gray" },
      { id: "approved", name: "Approved", color: "green" },
    ],
  },
};

const spec: ColumnRuleDefinition = {
  id: "spec",
  name: "Spec",
  type: "blocks",
  options: {
    blocks: {
      primary: false,
      freezeWhen: { propertyId: "status", optionIds: ["approved"] },
    },
  },
};

const notes: ColumnRuleDefinition = {
  id: "notes",
  name: "Notes",
  type: "blocks",
  options: { blocks: { primary: false } },
};

const definitions = [status, spec, notes];

describe("a tab's freeze rule", () => {
  it("is read back from stored options, with its values deduplicated", () => {
    const stored = serializePropertyOptions({
      blocks: {
        primary: false,
        freezeWhen: {
          propertyId: "status",
          optionIds: ["approved", "approved", "", 3 as never],
        },
      },
    });
    expect(parsePropertyOptions(stored).blocks).toEqual({
      primary: false,
      freezeWhen: { propertyId: "status", optionIds: ["approved"] },
    });
  });

  it("is dropped when it names no column or no values", () => {
    for (const freezeWhen of [
      null,
      "status",
      { propertyId: "", optionIds: ["approved"] },
      { propertyId: "status", optionIds: [] },
      { propertyId: "status", optionIds: "approved" },
    ]) {
      expect(
        parsePropertyOptions(
          JSON.stringify({ blocks: { primary: false, freezeWhen } }),
        ).blocks,
      ).toEqual({ primary: false });
    }
  });

  it("never holds on the page body", () => {
    const body = parsePropertyOptions(
      JSON.stringify({
        blocks: {
          primary: true,
          freezeWhen: { propertyId: "status", optionIds: ["approved"] },
        },
      }),
    );
    expect(body.blocks).toEqual({ primary: true });
    expect(
      freezeRuleOf({
        id: "body",
        name: "Content",
        type: "blocks",
        options: {
          blocks: {
            primary: true,
            freezeWhen: { propertyId: "status", optionIds: ["approved"] },
          },
        },
      }),
    ).toBeNull();
    expect(freezeRuleOf(notes)).toBeNull();
    expect(freezeRuleOf(spec)).toEqual({
      propertyId: "status",
      optionIds: ["approved"],
    });
  });
});

describe("which tabs are frozen", () => {
  it("freezes a tab while its column holds a named value, by ID or name", () => {
    expect(
      frozenBlocksFields(definitions, (id) =>
        id === "status" ? "approved" : null,
      ),
    ).toEqual([
      {
        propertyId: "spec",
        fieldName: "Spec",
        keyPropertyId: "status",
        keyPropertyName: "Status",
        optionId: "approved",
        optionName: "Approved",
      },
    ]);
    expect(
      frozenBlocksFields(definitions, (id) =>
        id === "status" ? "Approved" : null,
      ).map((field) => field.propertyId),
    ).toEqual(["spec"]);
  });

  it("leaves every tab open for any other value, none, or a missing column", () => {
    expect(frozenBlocksFields(definitions, () => "draft")).toEqual([]);
    expect(frozenBlocksFields(definitions, () => null)).toEqual([]);
    expect(frozenBlocksFields([spec, notes], () => "approved")).toEqual([]);
    expect(
      frozenBlocksFields(
        [{ ...status, type: "text" }, spec, notes],
        () => "approved",
      ),
    ).toEqual([]);
  });

  it("tells whoever was refused what reopens the tab", () => {
    expect(
      frozenBlocksFields(definitions, () => "approved").map((field) =>
        frozenBlocksFieldMessage(field),
      ),
    ).toEqual([
      "The Spec tab can't change while Status is Approved: a rule on this collection freezes it. Move Status off Approved to edit it, or comment on the page instead.",
    ]);
  });

  it("knows which columns rules key on, and which tabs each one freezes", () => {
    expect(freezeRuleKeys(definitions)).toEqual(
      new Map([["status", new Set(["approved"])]]),
    );
    expect(tabsFrozenBy(definitions, "status").map((tab) => tab.id)).toEqual([
      "spec",
    ]);
    expect(tabsFrozenBy(definitions, "notes")).toEqual([]);
  });
});

describe("checking a value in a tab's menu", () => {
  const rule = { propertyId: "status", optionIds: ["approved"] };

  it("adds and removes values of the rule's column", () => {
    expect(toggledFreezeRule(rule, "status", "draft", true)).toEqual({
      propertyId: "status",
      optionIds: ["approved", "draft"],
    });
    expect(toggledFreezeRule(rule, "status", "approved", true)).toEqual(rule);
    expect(
      toggledFreezeRule(
        { propertyId: "status", optionIds: ["approved", "draft"] },
        "status",
        "approved",
        false,
      ),
    ).toEqual({ propertyId: "status", optionIds: ["draft"] });
  });

  it("clears the rule with its last value", () => {
    expect(toggledFreezeRule(rule, "status", "approved", false)).toBeNull();
    expect(toggledFreezeRule(null, "status", "approved", false)).toBeNull();
  });

  it("starts a new rule on another column", () => {
    expect(toggledFreezeRule(rule, "stage", "final", true)).toEqual({
      propertyId: "stage",
      optionIds: ["final"],
    });
    expect(toggledFreezeRule(undefined, "status", "draft", true)).toEqual({
      propertyId: "status",
      optionIds: ["draft"],
    });
  });
});

describe("a source rewriting a column's options", () => {
  const upstream = [{ id: "draft", name: "Draft", color: "gray" as const }];

  it("keeps an option a rule names that the source left out", () => {
    expect(
      keepRuledOptions(
        definitions,
        "status",
        status.options.options,
        upstream,
      ).map((option) => option.id),
    ).toEqual(["draft", "approved"]);
  });

  it("takes the source's options as they are on a column no rule keys on", () => {
    expect(
      keepRuledOptions(
        [status, notes],
        "status",
        status.options.options,
        upstream,
      ),
    ).toEqual(upstream);
  });
});
