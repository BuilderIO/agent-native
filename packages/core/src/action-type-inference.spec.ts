import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";

import { defineAction } from "./action.js";
import type { ActionDefinition } from "./action.js";
import type { ActionRegistry } from "./client/use-action.js";


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
    expectTypeOf(createItemAction).toMatchTypeOf<
      ActionDefinition<
        { title: string; count: number; status?: "active" | "archived" },
        { id: string; title: string; count: number }
      >
    >();
  });

  it("schema overload: run arg type is the schema's input (optional defaults allowed)", () => {
    type RunFn = typeof createItemAction.run;
    type FirstArg = Parameters<RunFn>[0];
    expectTypeOf<FirstArg["title"]>().toEqualTypeOf<string>();
    expectTypeOf<FirstArg["count"]>().toEqualTypeOf<number>();
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
    expectTypeOf(legacyAction).toMatchTypeOf<
      ActionDefinition<{ name?: string }, unknown>
    >();
  });
});


describe("ActionDefinition structure", () => {
  it("action.run is a function accepting the typed input", () => {
    expectTypeOf(createItemAction.run).toBeFunction();
  });

  it("action.run result is awaitable to the return type", async () => {
    type RunResult = Awaited<ReturnType<typeof createItemAction.run>>;
    expectTypeOf<RunResult["id"]>().toEqualTypeOf<string>();
  });
});


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
