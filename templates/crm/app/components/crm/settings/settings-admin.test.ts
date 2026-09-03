import { describe, expect, it } from "vitest";

import type { CrmAttributeDefinition } from "../../../../shared/crm-contract";
import {
  applyAttributePatch,
  attributeEditDraft,
  attributeTypeCapabilities,
  AUTHORED_ATTRIBUTE_TYPES,
  buildCreateAttributeInput,
  buildUpdateAttributeInput,
  connectionModeInfo,
  emptyAttributeDraft,
  hasAttributeEdits,
  IMMUTABLE_ATTRIBUTE_FIELDS,
  isImmutableAttributeField,
  moveItem,
  reorderedOptionIds,
  SELECTABLE_CRM_CONNECTION_MODES,
  type AttributeDraft,
} from "./settings-admin";

const target = { target: "object" as const, targetId: "opportunities" };

function draft(patch: Partial<AttributeDraft> = {}): AttributeDraft {
  return { ...emptyAttributeDraft(), title: "Deal Stage", ...patch };
}

function attribute(
  patch: Partial<CrmAttributeDefinition> = {},
): CrmAttributeDefinition {
  return {
    id: "attr_1",
    connectionId: "conn_1",
    target: "object",
    targetId: "opportunities",
    apiSlug: "deal_stage",
    label: "Deal Stage",
    attributeType: "status",
    multi: false,
    authority: "local-authoritative",
    historyTracked: true,
    uniqueValue: false,
    archived: false,
    position: 0,
    inverseAttributeId: null,
    fillMode: null,
    fillConfig: {},
    config: {},
    options: [],
    storagePolicy: "local-authoritative",
    sensitive: false,
    readable: true,
    createable: true,
    updateable: true,
    required: false,
    ...patch,
  };
}

describe("attribute types", () => {
  it("never offers a system-only type", () => {
    expect(AUTHORED_ATTRIBUTE_TYPES).not.toContain("interaction");
    expect(AUTHORED_ATTRIBUTE_TYPES).not.toContain("personal-name");
    expect(AUTHORED_ATTRIBUTE_TYPES).toContain("status");
  });

  it("shows stage fields only for status", () => {
    expect(attributeTypeCapabilities("status")).toEqual({
      supportsMulti: false,
      usesOptions: true,
      showsStageFields: true,
    });
    expect(attributeTypeCapabilities("select")).toEqual({
      supportsMulti: true,
      usesOptions: true,
      showsStageFields: false,
    });
    expect(attributeTypeCapabilities("text")).toEqual({
      supportsMulti: false,
      usesOptions: false,
      showsStageFields: false,
    });
  });

  it("treats the slug and the type as immutable", () => {
    expect(IMMUTABLE_ATTRIBUTE_FIELDS).toEqual(["apiSlug", "attributeType"]);
    expect(isImmutableAttributeField("apiSlug")).toBe(true);
    expect(isImmutableAttributeField("title")).toBe(false);
  });
});

describe("buildCreateAttributeInput", () => {
  it("keeps stage fields on a status attribute", () => {
    const input = buildCreateAttributeInput(
      draft({
        type: "status",
        options: [
          {
            value: "discovery",
            title: "Discovery",
            color: "blue",
            targetDays: 14,
            celebrate: false,
          },
        ],
      }),
      target,
    );
    expect(input.options).toEqual([
      {
        value: "discovery",
        title: "Discovery",
        color: "blue",
        targetDays: 14,
        celebrate: false,
      },
    ]);
  });

  it("drops stage fields for a select attribute", () => {
    const input = buildCreateAttributeInput(
      draft({
        type: "select",
        options: [
          {
            value: "north",
            title: "",
            color: null,
            targetDays: 30,
            celebrate: true,
          },
        ],
      }),
      target,
    );
    expect(input.options).toEqual([{ value: "north", title: "north" }]);
  });

  it("drops options entirely for a type that has none", () => {
    const input = buildCreateAttributeInput(
      draft({
        type: "text",
        options: [
          {
            value: "stale",
            title: "Stale",
            color: null,
            targetDays: null,
            celebrate: false,
          },
        ],
      }),
      target,
    );
    expect(input.options).toBeUndefined();
  });

  it("refuses multi on a type that cannot hold a set", () => {
    expect(
      buildCreateAttributeInput(draft({ type: "status", multi: true }), target)
        .multi,
    ).toBe(false);
    expect(
      buildCreateAttributeInput(draft({ type: "select", multi: true }), target)
        .multi,
    ).toBe(true);
  });
});

describe("buildUpdateAttributeInput", () => {
  it("omits the immutable slug and type", () => {
    const input = buildUpdateAttributeInput(attribute(), {
      ...attributeEditDraft(attribute()),
      title: "Pipeline Stage",
    });
    expect(input).toEqual({ attributeId: "attr_1", title: "Pipeline Stage" });
    expect(input).not.toHaveProperty("apiSlug");
    expect(input).not.toHaveProperty("type");
  });

  it("reports an unchanged draft as having no edits", () => {
    const current = attribute({ description: "Where the deal is" });
    const input = buildUpdateAttributeInput(
      current,
      attributeEditDraft(current),
    );
    expect(hasAttributeEdits(input)).toBe(false);
  });

  it("clears a description with null rather than an empty string", () => {
    const current = attribute({ description: "Where the deal is" });
    const input = buildUpdateAttributeInput(current, {
      ...attributeEditDraft(current),
      description: "   ",
    });
    expect(input.description).toBeNull();
  });
});

describe("option ordering", () => {
  const options = [
    { id: "a", value: "a", title: "A", position: 0, archived: false },
    { id: "b", value: "b", title: "B", position: 1, archived: false },
    { id: "c", value: "c", title: "C", position: 2, archived: false },
  ];

  it("moves an option to a new index", () => {
    expect(reorderedOptionIds(options, 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderedOptionIds(options, 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("leaves the order alone for an out-of-range drag", () => {
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 0)).toEqual([1, 2, 3]);
  });
});

describe("optimistic patching", () => {
  it("replaces only the patched attribute", () => {
    const result = {
      target: "object" as const,
      targetId: "opportunities",
      attributes: [attribute(), attribute({ id: "attr_2" })],
    };
    const patched = applyAttributePatch(result, "attr_2", { archived: true });
    expect(patched?.attributes[0]?.archived).toBe(false);
    expect(patched?.attributes[1]?.archived).toBe(true);
  });

  it("leaves an absent cache absent", () => {
    expect(
      applyAttributePatch(undefined, "attr_1", { archived: true }),
    ).toBeUndefined();
  });
});

describe("connection modes", () => {
  it("never offers the deprecated hybrid mode", () => {
    expect(SELECTABLE_CRM_CONNECTION_MODES).not.toContain("hybrid");
    expect(SELECTABLE_CRM_CONNECTION_MODES).toEqual(["connected", "native"]);
  });

  it("still renders an existing hybrid connection", () => {
    const info = connectionModeInfo("hybrid");
    expect(info).toMatchObject({ mode: "hybrid", deprecated: true });
    expect(info?.labelKey).toBe("connection.modeHybrid");
  });

  it("reports an unrecognized mode as unknown rather than defaulting", () => {
    expect(connectionModeInfo("mirrored")).toBeNull();
  });
});
