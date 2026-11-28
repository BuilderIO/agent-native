import { describe, expect, it } from "vitest";

import {
  AmbiguousToolPlaceholdersError,
  discriminatedBranchIndex,
  normalizeOptionalToolPlaceholders,
  schemaAcceptsToolValue,
} from "./optional-placeholders.js";
import type { AgentNativeJsonSchema } from "./types.js";

const schema: AgentNativeJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    tags: { type: "array", items: { type: "string" } },
    label: { type: "string" },
    meta: { type: "object" },
    flag: { type: "boolean" },
    items: { type: "array", items: { type: "string" }, default: [] },
    status: { type: "string", enum: ["open", "done"] },
  },
  required: ["id"],
};
const write = {};
const read = { readOnly: true };

describe("normalizeOptionalToolPlaceholders", () => {
  it("strips null on an optional field", () => {
    expect(
      normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", title: null },
        write,
      ),
    ).toEqual({ input: { id: "a" }, changed: true });
  });

  it("leaves a sparse call untouched", () => {
    const input = { id: "a", title: "x" };
    const result = normalizeOptionalToolPlaceholders(schema, input, write);
    expect(result).toEqual({ input, changed: false });
    expect(result.input).toBe(input);
  });

  it.each([{}, { nullOnly: true }])(
    "refuses valid empty lists beside rejected nulls by default: %j",
    (options) => {
      const calendar: AgentNativeJsonSchema = {
        type: "object",
        properties: {
          summary: { type: "string" },
          location: { type: "string" },
          description: { type: ["string", "null"] },
          attendees: { type: "array", items: { type: "string" } },
          recurrence: { type: "array", items: { type: "string" } },
          details: {
            type: "object",
            properties: {
              note: { type: ["string", "null"] },
              timezone: { type: "string" },
            },
          },
        },
        required: ["summary"],
      };
      const input = {
        summary: "Meeting",
        location: null,
        description: null,
        attendees: [],
        recurrence: [],
        details: { note: null, timezone: null },
      };
      const result = normalizeOptionalToolPlaceholders(
        calendar,
        input,
        write,
        options,
      );
      expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
      expect(result.input).toBe(input);
      expect(result.changed).toBe(false);
    },
  );

  describe.each([{}, { nullOnly: true }])(
    "safe empty field opt-in: %j",
    (options) => {
      it.each([
        { field: "tags", value: [] },
        { field: "label", value: "" },
        { field: "meta", value: {} },
      ])(
        "preserves an allowlisted top-level empty $field",
        ({ field, value }) => {
          const entry = {
            readOnly: false,
            nullPaddingSafeEmptyFields: [field],
          };
          const result = normalizeOptionalToolPlaceholders(
            schema,
            { id: "a", title: null, [field]: value },
            entry,
            options,
          );
          expect(result).toEqual({
            input: { id: "a", [field]: value },
            changed: true,
          });
        },
      );

      it("refuses a nullable clear alongside an allowlisted empty field and padding", () => {
        const input = { id: "a", title: null, note: null, tags: [] };
        const result = normalizeOptionalToolPlaceholders(
          schema,
          input,
          { readOnly: false, nullPaddingSafeEmptyFields: ["tags"] },
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });

      it("refuses a nullable clear with a default-valued safe empty", () => {
        const input = { id: "a", title: null, note: null, items: [] };
        const result = normalizeOptionalToolPlaceholders(
          schema,
          input,
          { readOnly: false, nullPaddingSafeEmptyFields: ["items"] },
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });

      it("refuses a nested nullable clear alongside a safe empty", () => {
        const nested: AgentNativeJsonSchema = {
          type: "object",
          properties: {
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            details: {
              type: "object",
              properties: { note: { type: ["string", "null"] } },
            },
          },
        };
        const input = { title: null, tags: [], details: { note: null } };
        const result = normalizeOptionalToolPlaceholders(
          nested,
          input,
          { readOnly: false, nullPaddingSafeEmptyFields: ["tags"] },
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });

      it("refuses a mix of allowlisted and other valid empty fields", () => {
        const input = { id: "a", title: null, tags: [], label: "" };
        const entry = { readOnly: false, nullPaddingSafeEmptyFields: ["tags"] };
        const result = normalizeOptionalToolPlaceholders(
          schema,
          input,
          entry,
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });

      it("does not exempt an identically named nested empty field", () => {
        const nested: AgentNativeJsonSchema = {
          type: "object",
          properties: {
            title: { type: "string" },
            patch: {
              type: "object",
              properties: {
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        };
        const input = { title: null, patch: { tags: [] } };
        const entry = { readOnly: false, nullPaddingSafeEmptyFields: ["tags"] };
        const result = normalizeOptionalToolPlaceholders(
          nested,
          input,
          entry,
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });

      it("does not exempt a safe empty field beside a non-null invalid placeholder", () => {
        const input = { id: "a", title: null, status: "", tags: [] };
        const entry = { readOnly: false, nullPaddingSafeEmptyFields: ["tags"] };
        const result = normalizeOptionalToolPlaceholders(
          schema,
          input,
          entry,
          options,
        );
        expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
        expect(result.input).toBe(input);
        expect(result.changed).toBe(false);
      });
    },
  );

  it("keeps null on a nullable field", () => {
    expect(
      normalizeOptionalToolPlaceholders(schema, { id: "a", note: null }, write),
    ).toEqual({ input: { id: "a", note: null }, changed: false });
  });

  it("never strips a required field", () => {
    expect(
      normalizeOptionalToolPlaceholders(schema, { id: null }, write),
    ).toMatchObject({ changed: false });
  });

  it.each([{ id: "a", status: "", label: "" }])(
    "refuses a padded write that could clear data: %j",
    (input) => {
      const result = normalizeOptionalToolPlaceholders(schema, input, write);
      expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
      expect(result.error?.errorCode).toBe("ambiguous_tool_placeholders");
      expect(result.input).toBe(input);
      expect(result.changed).toBe(false);
    },
  );

  it("treats null on a nullable optional field as absent beside other nulls", () => {
    const result = normalizeOptionalToolPlaceholders(
      schema,
      { id: "a", title: null, note: null },
      write,
    );
    expect(result.error).toBeUndefined();
    expect(result.input).toEqual({ id: "a" });
  });

  it("accepts a resources-shaped payload with every unused optional set to null", () => {
    const resources: AgentNativeJsonSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "write"] },
        path: { type: "string" },
        content: { anyOf: [{ type: "string" }, { type: "null" }] },
        scope: { type: "string", enum: ["personal", "shared"] },
        prefix: { type: "string" },
        includeAgentScratch: { type: "boolean" },
      },
      required: ["action"],
    };
    const result = normalizeOptionalToolPlaceholders(
      resources,
      {
        action: "read",
        path: "skills/a/SKILL.md",
        content: null,
        scope: null,
        prefix: null,
        includeAgentScratch: null,
      },
      write,
    );
    expect(result.error).toBeUndefined();
    expect(result.input).toEqual({
      action: "read",
      path: "skills/a/SKILL.md",
    });
  });

  it("keeps a nested nullable null beside a padded top-level null", () => {
    const nested: AgentNativeJsonSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        patch: {
          type: "object",
          properties: {
            color: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      },
      required: ["id"],
    };
    const result = normalizeOptionalToolPlaceholders(
      nested,
      { id: "a", title: null, patch: { color: null } },
      write,
    );
    expect(result.error).toBeUndefined();
    expect(result.input).toEqual({ id: "a", patch: { color: null } });
  });

  it("still refuses a real placeholder value beside null", () => {
    const result = normalizeOptionalToolPlaceholders(
      schema,
      { id: "a", title: null, status: "", label: "" },
      write,
    );
    expect(result.error).toBeInstanceOf(AmbiguousToolPlaceholdersError);
  });

  it("runs an empty equal to the schema default beside a placeholder", () => {
    expect(
      normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", title: null, items: [] },
        write,
      ).error,
    ).toBeUndefined();
  });

  it("treats an empty list as a clear unless the action says it erases nothing", () => {
    const input = { id: "a", status: "", tags: [] };
    expect(
      normalizeOptionalToolPlaceholders(schema, input, write).error,
    ).toBeDefined();
    expect(
      normalizeOptionalToolPlaceholders(schema, input, {
        ...write,
        emptyListsEraseNothing: true,
      }).error,
    ).toBeUndefined();
  });

  it("treats false as never a clear", () => {
    expect(
      normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", title: null, flag: false },
        write,
      ).error,
    ).toBeUndefined();
  });

  it("runs a declared read-only call with the same padding", () => {
    expect(
      normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", status: "", label: "" },
        read,
      ).error,
    ).toBeUndefined();
  });

  it("does not exempt a read-only entry whose plan-mode effect is dynamic", () => {
    const entry = { readOnly: true, planMode: { effect: () => "write" } };
    expect(
      normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", status: "", label: "" },
        entry as never,
      ).error,
    ).toBeInstanceOf(AmbiguousToolPlaceholdersError);
  });

  describe("nullOnly", () => {
    it("strips null but leaves a wrong-typed empty for validation", () => {
      const result = normalizeOptionalToolPlaceholders(
        schema,
        { id: "a", title: null, status: "" },
        write,
        { nullOnly: true },
      );
      expect(result.input).toEqual({ id: "a", status: "" });
    });

    it("drops a wrong-typed empty when padding is tolerated", () => {
      expect(
        normalizeOptionalToolPlaceholders(
          schema,
          { id: "a", status: "" },
          write,
        ).input,
      ).toEqual({ id: "a" });
    });
  });

  it("repairs nested objects and arrays of objects", () => {
    const nested: AgentNativeJsonSchema = {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { a: { type: "string" }, b: { type: "string" } },
            required: ["a"],
          },
        },
      },
    };
    expect(
      normalizeOptionalToolPlaceholders(
        nested,
        { rows: [{ a: "x", b: null }, { a: "y" }] },
        write,
      ),
    ).toEqual({ input: { rows: [{ a: "x" }, { a: "y" }] }, changed: true });
  });

  it("repairs through a union of a union", () => {
    const union: AgentNativeJsonSchema = {
      type: "object",
      properties: {
        intent: {
          anyOf: [
            {
              anyOf: [
                {
                  type: "object",
                  properties: {
                    kind: { type: "string", const: "style" },
                    value: { type: "string" },
                  },
                  required: ["kind"],
                },
                {
                  type: "object",
                  properties: {
                    kind: { type: "string", const: "class" },
                    name: { type: "string" },
                  },
                  required: ["kind"],
                },
              ],
            },
            {
              type: "array",
              items: {
                type: "object",
                properties: { kind: { type: "string", const: "style" } },
              },
            },
          ],
        },
      },
    };
    expect(
      normalizeOptionalToolPlaceholders(
        union,
        { intent: { kind: "class", name: "x", value: null } },
        write,
      ).changed,
    ).toBe(false);
    expect(
      normalizeOptionalToolPlaceholders(
        union,
        { intent: { kind: "style", value: null } },
        write,
      ).input,
    ).toEqual({ intent: { kind: "style" } });
    expect(
      normalizeOptionalToolPlaceholders(
        union,
        { intent: [{ kind: "style" }] },
        write,
      ).changed,
    ).toBe(false);
  });

  it("ignores input that is not an object", () => {
    for (const input of [null, "x", [{ title: null }]]) {
      expect(normalizeOptionalToolPlaceholders(schema, input, write)).toEqual({
        input,
        changed: false,
      });
    }
    expect(
      normalizeOptionalToolPlaceholders(undefined, {}, write).changed,
    ).toBe(false);
  });
});

describe("schemaAcceptsToolValue", () => {
  it("answers from the schema", () => {
    expect(schemaAcceptsToolValue({ type: "string" }, "x")).toBe(true);
    expect(schemaAcceptsToolValue({ type: "string" }, null)).toBe(false);
  });

  it("accepts nothing from a schema it cannot compile", () => {
    expect(schemaAcceptsToolValue({ type: "nonsense" }, "x")).toBe(false);
  });
});

describe("discriminatedBranchIndex", () => {
  const branches: AgentNativeJsonSchema[] = [
    { properties: { kind: { const: "a" } } },
    { properties: { kind: { enum: ["b"] } } },
    { properties: { other: { type: "string" } } },
  ];
  it("matches a const or single-value enum discriminator", () => {
    expect(discriminatedBranchIndex(branches, { kind: "a" })).toBe(0);
    expect(discriminatedBranchIndex(branches, { kind: "b" })).toBe(1);
    expect(discriminatedBranchIndex(branches, { kind: "c" })).toBe(-1);
    expect(discriminatedBranchIndex(branches, [])).toBe(-1);
    expect(discriminatedBranchIndex(branches, null)).toBe(-1);
  });
});
