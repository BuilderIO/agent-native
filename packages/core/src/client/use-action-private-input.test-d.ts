import { expectTypeOf } from "vitest";

import {
  useActionMutation,
  type PrivateActionMutationOptions,
} from "./use-action.js";

declare global {
  interface AgentNativeActionRegistry {
    "store-ui-value": {
      params: { secret: string };
      result: { echoed: string };
    };
  }
}

export function privateMutationTypeContract() {
  const options = {
    privateInputs: true,
    uiOnly: true,
    retry: false,
    retryUiCapability: false,
  } as const;
  const inferred = useActionMutation("store-ui-value", options);
  expectTypeOf(inferred.mutateAsync)
    .parameter(0)
    .toEqualTypeOf<{ secret: string }>();
  expectTypeOf(inferred.mutateAsync).returns.toEqualTypeOf<Promise<void>>();
  expectTypeOf(inferred.variables).toEqualTypeOf<undefined>();
  expectTypeOf(inferred.data).toEqualTypeOf<undefined>();
  // @ts-expect-error Private inputs retain registry typing.
  inferred.mutate({ secret: 1 });
  // @ts-expect-error Mutation callbacks cannot receive raw input or result.
  inferred.mutate({ secret: "value" }, { onSuccess: () => {} });
  const explicit = useActionMutation<void, { secret: string }>(
    "store-ui-value",
    options,
  );
  expectTypeOf(explicit.mutateAsync).returns.toEqualTypeOf<Promise<void>>();
  const invalid: PrivateActionMutationOptions = {
    ...options,
    // @ts-expect-error Private inputs cannot enter a metadata channel.
    meta: { value: "input" },
  };
  const invalidCallback: PrivateActionMutationOptions = {
    ...options,
    // @ts-expect-error No raw input/context callback channel exists.
    onMutate: (_params: { secret: string }) => undefined,
  };
  // @ts-expect-error Private mode cannot enable automatic retries.
  useActionMutation("store-ui-value", { ...options, retry: true });
  // @ts-expect-error Private mode cannot use GET.
  useActionMutation("store-ui-value", { ...options, method: "GET" });
  return { invalid, invalidCallback };
}

export function normalMutationTypeContract() {
  const normal = useActionMutation("store-ui-value", {
    onSuccess: (data, variables) => {
      expectTypeOf(data).toEqualTypeOf<{ echoed: string }>();
      expectTypeOf(variables).toEqualTypeOf<{ secret: string }>();
    },
    headers: (variables) => {
      expectTypeOf(variables).toEqualTypeOf<{ secret: string }>();
      return { "X-Public-Value": "present" };
    },
  });
  expectTypeOf(normal.mutateAsync)
    .parameter(0)
    .toEqualTypeOf<{ secret: string }>();
  expectTypeOf(normal.mutateAsync).returns.toEqualTypeOf<
    Promise<{ echoed: string }>
  >();
}
