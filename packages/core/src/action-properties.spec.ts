import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  arbitraryFromJsonSchema,
  checkActionProperties,
  UnsupportedSchemaError,
} from "./action-properties.js";
import { defineAction, fail } from "./action.js";

const context = { caller: "tool" as const };

const correct = defineAction({
  description: "Double a labelled count",
  schema: z.object({
    label: z.string().min(1),
    count: z.number().int().min(0).max(20),
  }),
  outputSchema: z.object({ label: z.string(), total: z.number() }),
  run: async ({ label, count }) => {
    if (count >= 15) fail("count is too high");
    return { label, total: count * 2 };
  },
});

const throwsTypeError = defineAction({
  description: "Double a count, badly above seven",
  schema: z.object({ count: z.number().int().min(0).max(20) }),
  run: async ({ count }) => {
    if (count > 7) throw new TypeError("count is over the limit");
    return { count };
  },
});

const badOutput = defineAction({
  description: "Double a count into a capped total",
  schema: z.object({ count: z.number().int().min(0).max(20) }),
  outputSchema: z.object({ total: z.number().int().max(10) }),
  run: async ({ count }) => ({ total: count * 2 }),
});

describe("checkActionProperties", () => {
  it("passes an action that returns or refuses with a contract error", async () => {
    await expect(
      checkActionProperties(correct, { context, seed: 1 }),
    ).resolves.toBeUndefined();
  });

  it("fails an action that throws a raw TypeError, with a shrunk counterexample", async () => {
    const failure = checkActionProperties(throwsTypeError, {
      context,
      seed: 1,
    });
    await expect(failure).rejects.toThrow(/TypeError: count is over the limit/);
    await expect(failure).rejects.toThrow(/Counterexample: \[\{"count":8\}\]/);
    await expect(failure).rejects.toThrow(/seed/);
  });

  it("fails an action whose return violates its outputSchema, with a counterexample", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failure = checkActionProperties(badOutput, { context, seed: 1 });
      await expect(failure).rejects.toThrow(/outputSchema/);
      await expect(failure).rejects.toThrow(
        /Counterexample: \[\{"count":6\}\]/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("never runs the handler for an input its schema rejects", async () => {
    const run = vi.fn(async ({ count }: { count: number }) => ({ count }));
    const action = defineAction({
      description: "Echo a count",
      schema: z.object({ label: z.string(), count: z.number().int() }),
      run,
    });

    await checkActionProperties(action, { context, runs: 20, seed: 7 });

    // One handler call per valid generated input, and none for the invalid cases.
    expect(run).toHaveBeenCalledTimes(20);
  });

  it("fails when the schema accepts an input the generator marks invalid", async () => {
    const action = defineAction({
      description: "Echo a label",
      schema: z.object({ label: z.coerce.string() }),
      run: async ({ label }) => ({ label }),
    });

    await expect(
      checkActionProperties(action, { context, runs: 5, seed: 3 }),
    ).rejects.toThrow(/schema accepts it, so this case proves nothing/);
  });

  it("names the JSON pointer of a shape it cannot generate", async () => {
    const action = defineAction({
      description: "Tag a record",
      schema: z.object({ tags: z.record(z.string(), z.string()) }),
      run: async () => ({}),
    });

    await expect(checkActionProperties(action, { context })).rejects.toThrow(
      UnsupportedSchemaError,
    );
    await expect(checkActionProperties(action, { context })).rejects.toThrow(
      /JSON pointer "\/tags"/,
    );
  });

  it("generates inputs for the common zod shapes", async () => {
    const action = defineAction({
      description: "Record an event",
      schema: z.object({
        id: z.uuid(),
        email: z.email(),
        url: z.url(),
        at: z.iso.datetime(),
        kind: z.enum(["open", "close"]),
        status: z.literal("active"),
        count: z.int().min(1).max(9),
        ratio: z.number().gt(0).lt(1),
        note: z.string().nullable(),
        tags: z.array(z.string().min(1)).max(3),
        flag: z.boolean().optional(),
        level: z.string().default("info"),
        either: z.union([z.string(), z.number()]),
        shape: z.discriminatedUnion("type", [
          z.object({ type: z.literal("a"), value: z.string() }),
          z.object({ type: z.literal("b"), value: z.number() }),
        ]),
      }),
      run: async () => ({ ok: true }),
    });

    await expect(
      checkActionProperties(action, { context, runs: 30, seed: 11 }),
    ).resolves.toBeUndefined();
  });

  it("rejects an action with no zod schema instead of passing it", async () => {
    const action = defineAction({
      description: "Ping",
      run: async () => ({ ok: true }),
    });

    await expect(checkActionProperties(action, { context })).rejects.toThrow(
      /needs an action defined with a zod `schema`/,
    );
  });

  it("checks a nested property, labelled by its JSON pointer", async () => {
    const action = defineAction({
      description: "Store an address",
      schema: z.object({ address: z.object({ zip: z.coerce.string() }) }),
      run: async () => ({}),
    });

    await expect(
      checkActionProperties(action, { context, runs: 5, seed: 3 }),
    ).rejects.toThrow(/\/address\/zip set to \S+ is marked invalid/);
  });

  it("checks a nested property inside an array item as a one-element array", async () => {
    const action = defineAction({
      description: "Record labelled items",
      schema: z.object({
        items: z.array(z.object({ label: z.coerce.string() })),
      }),
      run: async () => ({}),
    });

    await expect(
      checkActionProperties(action, { context, runs: 5, seed: 3 }),
    ).rejects.toThrow(/\/items\/0\/label set to \S+ is marked invalid/);
  });

  it("passes nested required removals, objects and arrays of objects that zod rejects", async () => {
    const action = defineAction({
      description: "Record a shipment",
      schema: z.object({
        address: z.object({ street: z.string(), zip: z.string() }),
        lines: z
          .array(z.object({ sku: z.string(), qty: z.int().min(1) }))
          .max(3),
      }),
      run: async () => ({}),
    });

    await expect(
      checkActionProperties(action, { context, runs: 30, seed: 9 }),
    ).resolves.toBeUndefined();
  });

  it("generates only values that match exactly one oneOf branch", async () => {
    const action = defineAction({
      description: "Pick a length band",
      schema: z.object({ x: z.xor([z.string().min(2), z.string().max(5)]) }),
      run: async () => ({}),
    });

    await expect(
      checkActionProperties(action, { context, runs: 50, seed: 1 }),
    ).resolves.toBeUndefined();
  });

  it("generates a formatted string that satisfies both its format and its pattern", async () => {
    const action = defineAction({
      description: "Record a v4 id",
      schema: z.object({ id: z.uuid({ version: "v4" }) }),
      run: async () => ({}),
    });

    await expect(
      checkActionProperties(action, { context, runs: 50, seed: 5 }),
    ).resolves.toBeUndefined();
  });

  it("throws UnsupportedSchemaError naming the path when a pattern rejects nearly every value", async () => {
    const action = defineAction({
      description: "Record a timestamp",
      schema: z.object({ at: z.iso.datetime({ precision: 0 }) }),
      run: async () => ({}),
    });

    await expect(checkActionProperties(action, { context })).rejects.toThrow(
      UnsupportedSchemaError,
    );
    await expect(checkActionProperties(action, { context })).rejects.toThrow(
      /JSON pointer "\/at"/,
    );
  });

  it("refuses an action with outputErrorStrategy fallback, which hides the handler's return", async () => {
    const action = defineAction({
      description: "Double a count into a capped total",
      schema: z.object({ count: z.number().int().min(0).max(20) }),
      outputSchema: z.object({ total: z.number().int().max(10) }),
      outputErrorStrategy: "fallback",
      outputFallback: { total: 0 },
      run: async ({ count }) => ({ total: count * 2 }),
    });

    await expect(
      checkActionProperties(action, { context, seed: 1 }),
    ).rejects.toThrow(/outputErrorStrategy "fallback"/);
  });
});

describe("arbitraryFromJsonSchema", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", pattern: "^x$" },
    },
    required: ["name"],
    additionalProperties: false,
  };

  it("throws UnsupportedSchemaError naming the path of an unsupported keyword", () => {
    expect(() => arbitraryFromJsonSchema(schema)).toThrow(
      UnsupportedSchemaError,
    );
    expect(() => arbitraryFromJsonSchema(schema)).toThrow(
      /JSON pointer "\/name"/,
    );
  });

  it("uses an override for the unsupported path", () => {
    const arb = arbitraryFromJsonSchema(schema, {
      overrides: { "/name": fc.constant("x") },
    });

    expect(fc.sample(arb, { seed: 1, numRuns: 3 })).toEqual([
      { name: "x" },
      { name: "x" },
      { name: "x" },
    ]);
  });

  it("emits only the const and enum values that its type admits", () => {
    const enumArb = arbitraryFromJsonSchema({
      type: "string",
      enum: ["a", 1, null, "b"],
    });

    expect(new Set(fc.sample(enumArb, { seed: 1, numRuns: 100 }))).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("throws when no const value satisfies its type", () => {
    expect(() => arbitraryFromJsonSchema({ type: "string", const: 5 })).toThrow(
      UnsupportedSchemaError,
    );
  });

  it("throws when oneOf branches overlap on every value, naming the path", () => {
    const schema = {
      type: "object",
      properties: {
        x: { oneOf: [{ type: "string" }, { type: "string" }] },
      },
      required: ["x"],
      additionalProperties: false,
    };

    expect(() => arbitraryFromJsonSchema(schema)).toThrow(
      UnsupportedSchemaError,
    );
    expect(() => arbitraryFromJsonSchema(schema)).toThrow(/JSON pointer "\/x"/);
  });
});
