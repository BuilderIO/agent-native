import { validateActionArgs } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

import { FIELD_TYPES } from "../server/lib/validate-fields.js";

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    buildDeepLink: (input: { to?: string }) =>
      `https://forms.agent-native.test${input.to ?? ""}`,
    getAppProductionUrl: () => "https://forms.agent-native.test",
  };
});

const { default: createForm } = await import("./create-form.js");
const { default: updateForm } = await import("./update-form.js");
const { default: patchFormFields } = await import("./patch-form-fields.js");

type JsonSchemaProperty = {
  type?: string | string[];
  anyOf?: unknown[];
};

type ActionEntry = {
  schema: Parameters<typeof validateActionArgs>[0];
  tool: { parameters?: { properties?: Record<string, JsonSchemaProperty> } };
};

function parameterSchema(
  action: unknown,
  name: string,
): JsonSchemaProperty | undefined {
  return (action as ActionEntry).tool.parameters?.properties?.[name];
}

async function validate(action: unknown, args: unknown): Promise<unknown> {
  const entry = action as ActionEntry;
  return validateActionArgs(entry.schema, args, entry.tool.parameters as never);
}

async function rejection(action: unknown, args: unknown): Promise<string> {
  try {
    await validate(action, args);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the payload to be rejected, but it validated");
}

describe("structured payloads are never declared as plain strings", () => {
  it.each([
    ["create-form", "fields", "array", () => createForm],
    ["create-form", "settings", "object", () => createForm],
    ["update-form", "fields", "array", () => updateForm],
    ["update-form", "settings", "object", () => updateForm],
    ["patch-form-fields", "ops", "array", () => patchFormFields],
  ])("%s %s is declared as %s", (_name, param, expectedType, action) => {
    const spec = parameterSchema(action(), param);

    expect(spec?.type).toBe(expectedType);
    expect(spec?.anyOf).toBeUndefined();
  });
});

describe("a field with no type is rejected before it reaches storage", () => {
  const reported =
    '[{"label":"Your Name","required":true},{"type":"email","label":"Email","required":true}]';

  it("rejects the reported create-form payload at the schema boundary", async () => {
    const message = await rejection(createForm, {
      title: "Contact",
      fields: reported,
    });

    expect(message).toContain("fields.0.type");
    for (const type of FIELD_TYPES) expect(message).toContain(type);
  });

  it("rejects the same payload on update-form", async () => {
    const message = await rejection(updateForm, {
      id: "form-1",
      fields: reported,
    });

    expect(message).toContain("fields.0.type");
  });

  it("rejects a type outside the enum", async () => {
    const message = await rejection(createForm, {
      fields: '[{"type":"phone","label":"Phone","required":true}]',
    });

    expect(message).toContain("fields.0.type");
  });

  it("rejects an array payload exactly like a stringified one", async () => {
    const message = await rejection(createForm, {
      fields: [{ label: "Your Name", required: true }],
    });

    expect(message).toContain("fields.0.type");
  });

  it("reports a non-JSON string as the wrong type instead of parsing it", async () => {
    const message = await rejection(createForm, { fields: "[{oops" });

    expect(message).toContain("expected array");
  });
});

describe("stringified JSON still works for CLI and gateway callers", () => {
  it("parses a valid create-form fields string into a real array", async () => {
    const validated = (await validate(createForm, {
      title: "Contact",
      fields: '[{"type":"text","label":"Your Name","required":true}]',
      settings: '{"submitText":"Send"}',
    })) as { fields: unknown[]; settings: Record<string, unknown> };

    expect(validated.fields).toEqual([
      { type: "text", label: "Your Name", required: true },
    ]);
    expect(validated.settings).toEqual({ submitText: "Send" });
  });

  it("still lets a field omit id so it can be generated from the label", async () => {
    const validated = (await validate(createForm, {
      fields: [{ type: "text", label: "Your Name", required: true }],
    })) as { fields: Array<{ id?: string }> };

    expect(validated.fields[0].id).toBeUndefined();
  });
});

describe("patch-form-fields ops are validated per operation", () => {
  it("names the property a stringified upsert left out", async () => {
    const message = await rejection(patchFormFields, {
      id: "form-1",
      ops: '[{"op":"upsert","field":{"id":"name","label":"Name","required":true}}]',
    });

    expect(message).toContain("ops.0.field.type");
  });

  it("names the op itself when the operation is unknown", async () => {
    const message = await rejection(patchFormFields, {
      id: "form-1",
      ops: '[{"op":"delete","id":"name"}]',
    });

    expect(message).toContain("ops.0.op");
    expect(message).toContain("upsert");
  });

  it("accepts a valid stringified op list", async () => {
    const validated = (await validate(patchFormFields, {
      id: "form-1",
      ops: '[{"op":"reorder","ids":["a","b"]}]',
    })) as { ops: unknown[] };

    expect(validated.ops).toEqual([{ op: "reorder", ids: ["a", "b"] }]);
  });
});
