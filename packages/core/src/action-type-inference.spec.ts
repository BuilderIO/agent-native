/**
 * Compile-time type inference tests for `defineAction`.
 *
 * These tests make no runtime assertions — they verify that the type system
 * correctly infers input and return types from `defineAction` declarations.
 * If the overload signatures ever regress to `: any`, the `expectTypeOf`
 * assertions below will produce TypeScript compile errors (caught by tsgo /
 * vitest typecheck), not runtime failures.
 */
import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";

import { defineAction } from "./action.js";
import type { ActionDefinition } from "./action.js";
import type { ActionRegistry } from "./client/use-action.js";

// ---------------------------------------------------------------------------
// 1. defineAction with schema — input type flows from the schema
// ---------------------------------------------------------------------------

const createItemAction = defineAction({
  description: "Create an item",
  schema: z.object({
    title: z.string(),
    count: z.number().int(),
    status: z.enum(["active", "archived"]).default("active"),
  }),
  run: async (args) => {
    return { id: "new-id", title: args.title, count: args.count };
  },
});

describe("defineAction type inference", () => {
  it("schema overload: returns typed ActionDefinition (not any)", () => {
    // The return type must not be `any` — if it were, the conditional below
    // would silently pass for arbitrary types. Using expectTypeOf forces an
    // actual assignability check.
    // TInput is the schema's InferInput (input type — optional defaults allowed).
    // Zod status.default("active") makes status optional on input.
    expectTypeOf(createItemAction).toMatchTypeOf<
      ActionDefinition<
        { title: string; count: number; status?: "active" | "archived" },
        { id: string; title: string; count: number }
      >
    >();
  });

  it("schema overload: run arg type is the schema's input (optional defaults allowed)", () => {
    type RunFn = typeof createItemAction.run;
    // The first parameter carries the schema's INPUT type: defaults are optional.
    type FirstArg = Parameters<RunFn>[0];
    // title and count are required (no default).
    expectTypeOf<FirstArg["title"]>().toEqualTypeOf<string>();
    expectTypeOf<FirstArg["count"]>().toEqualTypeOf<number>();
    // status has a default → optional on input (string | undefined).
    // Just check it's string-assignable (exact union shape is schema-lib detail).
    expectTypeOf<NonNullable<FirstArg["status"]>>().toEqualTypeOf<
      "active" | "archived"
    >();
  });

  it("schema overload: run return type is inferred from the callback (not any)", () => {
    type RunFn = typeof createItemAction.run;
    type ReturnType = Awaited<ReturnType<RunFn>>;
    expectTypeOf<ReturnType>().toHaveProperty("id");
    expectTypeOf<ReturnType["id"]>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType>().toHaveProperty("title");
  });
});

// ---------------------------------------------------------------------------
// 2. defineAction with parameters (legacy) — input inferred from ParameterSchema
// ---------------------------------------------------------------------------

const legacyAction = defineAction({
  description: "Legacy parameter action",
  parameters: {
    name: { type: "string", description: "Resource name" },
  },
  run: async (args) => {
    return { ok: true, name: args.name };
  },
});

describe("defineAction legacy parameters overload", () => {
  it("parameters overload: returns ActionDefinition (not any)", () => {
    // Params overload: InferParams<TParams> yields { name?: string }
    // (all legacy params are optional string fields).
    expectTypeOf(legacyAction).toMatchTypeOf<
      ActionDefinition<{ name?: string }, unknown>
    >();
  });
});

// ---------------------------------------------------------------------------
// 3. ActionDefinition type structure — run signature is preserved
// ---------------------------------------------------------------------------

describe("ActionDefinition structure", () => {
  it("action.run is a function accepting the typed input", () => {
    expectTypeOf(createItemAction.run).toBeFunction();
  });

  it("action.run result is awaitable to the return type", async () => {
    type RunResult = Awaited<ReturnType<typeof createItemAction.run>>;
    expectTypeOf<RunResult["id"]>().toEqualTypeOf<string>();
  });
});

// ---------------------------------------------------------------------------
// 4. Registry augmentation smoke-test — ActionRegistry maps names to types
//
// We cannot import the generated .generated/action-types.d.ts from the core
// package itself (it only exists inside template projects). Instead we verify
// the ambient augmentation mechanism: declare a synthetic augmentation here
// and confirm the helper types resolve correctly.
// ---------------------------------------------------------------------------

declare module "./client/use-action.js" {
  interface ActionRegistry {
    "test-create-item": {
      params: { title: string; count: number };
      result: { id: string; title: string; count: number };
    };
    "test-list-items": {
      params: Record<string, never>;
      result: { items: Array<{ id: string }> };
    };
  }
}

describe("ActionRegistry augmentation", () => {
  it("augmented registry has the correct params type for a registered action", () => {
    type Params = ActionRegistry["test-create-item"]["params"];
    expectTypeOf<Params["title"]>().toEqualTypeOf<string>();
    expectTypeOf<Params["count"]>().toEqualTypeOf<number>();
  });

  it("augmented registry has the correct result type for a registered action", () => {
    type Result = ActionRegistry["test-create-item"]["result"];
    expectTypeOf<Result["id"]>().toEqualTypeOf<string>();
  });
});
