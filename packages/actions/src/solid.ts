import { createResource, createSignal, type Resource } from "solid-js";

import {
  ActionClientError,
  actionErrorMessage,
  createActionClient,
  type ActionCallOptions,
  type ActionClient,
  type ActionClientOptions,
  type ActionInputOf,
  type ActionNameOf,
  type ActionOutputOf,
} from "./client.js";

export { ActionClientError, actionErrorMessage };
export type { ActionCallOptions, ActionClient, ActionClientOptions };

export interface SolidMutationResult<TData, TInput> {
  readonly pending: boolean;
  readonly error: ActionClientError | null;
  readonly data: TData | undefined;
  mutate: (input: TInput) => Promise<TData | undefined>;
  mutateAsync: (input: TInput) => Promise<TData>;
  reset: () => void;
}

export interface SolidMutationOptions<TData, TInput, TNames extends string> {
  invalidate?: readonly TNames[] | false;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  approvalToken?: string;
  onSuccess?: (data: TData, input: TInput) => void | Promise<void>;
  onError?: (error: ActionClientError, input: TInput) => void;
}

export function createSolidActionHooks<TRegistry = unknown>(
  options: ActionClientOptions = {},
) {
  const client = createActionClient<TRegistry>(options);
  const [globalVersion, setGlobalVersion] = createSignal(0);
  const actionVersions = new Map<
    string,
    readonly [() => number, (v: (prev: number) => number) => number]
  >();

  function getActionVersion(name: string): () => number {
    let pair = actionVersions.get(name);
    if (!pair) {
      pair = createSignal(0);
      actionVersions.set(name, pair);
    }
    return pair[0];
  }

  function invalidateActions(targets?: readonly string[] | false): void {
    if (targets === false) return;
    if (Array.isArray(targets) && targets.length > 0) {
      for (const target of targets) {
        const pair = actionVersions.get(target);
        if (pair) pair[1]((v) => v + 1);
      }
      return;
    }
    setGlobalVersion((v) => v + 1);
  }

  function createActionQuery<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?:
      | ActionInputOf<TRegistry, TName>
      | (() => ActionInputOf<TRegistry, TName> | false | null | undefined),
    queryOpts: { method?: "GET" | "POST"; headers?: HeadersInit } = {},
  ): Resource<ActionOutputOf<TRegistry, TName> | undefined> {
    const readVersion = getActionVersion(name);
    const [resource] = createResource(
      () => {
        const resolved =
          typeof input === "function"
            ? (
                input as () =>
                  | ActionInputOf<TRegistry, TName>
                  | false
                  | null
                  | undefined
              )()
            : input;
        if (resolved === false || resolved === null) return false as const;
        return {
          input: resolved,
          globalTick: globalVersion(),
          actionTick: readVersion(),
        };
      },
      async (source) =>
        client.call(name, source.input, {
          method: queryOpts.method ?? "GET",
          ...(queryOpts.headers ? { headers: queryOpts.headers } : {}),
        }),
    );
    return resource;
  }

  function createActionMutation<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    mutationOpts: SolidMutationOptions<
      ActionOutputOf<TRegistry, TName>,
      ActionInputOf<TRegistry, TName>,
      ActionNameOf<TRegistry>
    > = {},
  ): SolidMutationResult<
    ActionOutputOf<TRegistry, TName>,
    ActionInputOf<TRegistry, TName>
  > {
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal<ActionClientError | null>(null);
    const [data, setData] = createSignal<
      ActionOutputOf<TRegistry, TName> | undefined
    >(undefined);

    const mutateAsync = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName>> => {
      setPending(true);
      setError(null);
      try {
        const result = await client.call(name, input, {
          method: mutationOpts.method ?? "POST",
          ...(mutationOpts.headers ? { headers: mutationOpts.headers } : {}),
          ...(mutationOpts.approvalToken !== undefined
            ? { approvalToken: mutationOpts.approvalToken }
            : {}),
        });
        setData(() => result);
        invalidateActions(mutationOpts.invalidate);
        await mutationOpts.onSuccess?.(result, input);
        return result;
      } catch (err) {
        const normalized =
          err instanceof ActionClientError
            ? err
            : new ActionClientError({
                actionName: name,
                message: err instanceof Error ? err.message : String(err),
                statusCode: 500,
              });
        setError(() => normalized);
        mutationOpts.onError?.(normalized, input);
        throw normalized;
      } finally {
        setPending(false);
      }
    };

    const mutate = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName> | undefined> => {
      try {
        return await mutateAsync(input);
      } catch {
        return undefined;
      }
    };

    return {
      get pending() {
        return pending();
      },
      get error() {
        return error();
      },
      get data() {
        return data();
      },
      mutate,
      mutateAsync,
      reset: () => {
        setError(null);
        setData(() => undefined);
      },
    };
  }

  return {
    client,
    callAction: client.call,
    createActionQuery,
    createActionMutation,
    invalidateActions,
    actionErrorMessage,
  };
}

const defaultSolidHooks = createSolidActionHooks();

export const callAction = defaultSolidHooks.callAction;
export const createActionQuery = defaultSolidHooks.createActionQuery;
export const createActionMutation = defaultSolidHooks.createActionMutation;
