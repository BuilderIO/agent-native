// Compile-time contract for `defineAction`, checked by `tsconfig.type-tests.json`
// (vitest does not type-check specs). A line marked `@ts-expect-error` that
// starts compiling fails the typecheck.
import { z } from "zod";

import { defineAction, defineActionErrors } from "./action.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const assertType = <T extends true>(_: T) => {};

const withOutput = defineAction({
  description: "Read a thread.",
  schema: z.object({ id: z.string() }),
  outputSchema: z.object({
    id: z.string(),
    archivedAt: z.string().nullable().default(null),
  }),
  run: async ({ id }) => ({ id }),
});
assertType<
  Equal<
    Awaited<ReturnType<typeof withOutput.run>>,
    { id: string; archivedAt: string | null }
  >
>(true);

defineAction({
  description: "Return the wrong shape.",
  schema: z.object({ id: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  // @ts-expect-error `run` must return what `outputSchema` accepts.
  run: async () => ({ id: 1 }),
});

const withoutOutput = defineAction({
  description: "Untyped result.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => ({ id, extra: true }),
});
assertType<
  Equal<
    Awaited<ReturnType<typeof withoutOutput.run>>,
    { id: string; extra: boolean }
  >
>(true);

const errors = defineActionErrors("thread_not_found", "thread_locked");
assertType<
  Equal<(typeof errors.codes)[number], "thread_not_found" | "thread_locked">
>(true);
export const failsWithDeclaredCode = () =>
  errors.fail("Thread not found.", "thread_not_found", { statusCode: 404 });
// @ts-expect-error a code outside the declared set does not compile.
export const failsWithUnknownCode = () => errors.fail("Nope.", "not_declared");

defineAction({
  description: "Declares its failures.",
  schema: z.object({ id: z.string() }),
  outputSchema: z.object({ ok: z.literal(true) }),
  errors,
  run: async () => ({ ok: true as const }),
});
