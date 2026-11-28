import { createSubscriber } from "svelte/reactivity";

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

export interface SvelteQueryState<TData> {
  readonly data: TData | undefined;
  readonly error: ActionClientError | null;
  readonly isLoading: boolean;
  refetch: () => Promise<TData | undefined>;
  destroy: () => void;
}

export interface SvelteMutationState<TData, TInput> {
  readonly data: TData | undefined;
  readonly error: ActionClientError | null;
  readonly isPending: boolean;
  mutate: (input: TInput) => Promise<TData | undefined>;
  mutateAsync: (input: TInput) => Promise<TData>;
}

/**
 * Create typed Svelte 5 action helpers (`createActionQuery`, `createActionMutation`, `callAction`)
 * backed by `svelte/reactivity`'s `createSubscriber` so getters participate in fine-grained
 * Svelte 5 tracking without requiring `.svelte.ts` compilation of the library.
 */
export function createSvelteActionHooks<TRegistry = unknown>(
  options: ActionClientOptions = {},
) {
  const client = createActionClient<TRegistry>(options);
  const listeners = new Set<(targets?: readonly string[]) => void>();

  function notifyInvalidation(targets?: readonly string[] | false): void {
    if (targets === false) return;
    for (const listener of listeners) {
      listener(Array.isArray(targets) ? targets : undefined);
    }
  }

  function createActionQuery<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?:
      | ActionInputOf<TRegistry, TName>
      | (() => ActionInputOf<TRegistry, TName> | false | null | undefined),
    queryOpts: { method?: "GET" | "POST"; headers?: HeadersInit } = {},
  ): SvelteQueryState<ActionOutputOf<TRegistry, TName>> {
    let data: ActionOutputOf<TRegistry, TName> | undefined;
    let error: ActionClientError | null = null;
    let isLoading = false;
    let controller: AbortController | null = null;
    let notify: (() => void) | null = null;

    const subscribe = createSubscriber((update) => {
      notify = update;
      return () => {
        notify = null;
      };
    });

    const refetch = async (): Promise<
      ActionOutputOf<TRegistry, TName> | undefined
    > => {
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
      if (resolved === false || resolved === null) return undefined;

      controller?.abort();
      const active = new AbortController();
      controller = active;
      isLoading = true;
      error = null;
      notify?.();
      try {
        const result = await client.call(name, resolved, {
          method: queryOpts.method ?? "GET",
          signal: active.signal,
          ...(queryOpts.headers ? { headers: queryOpts.headers } : {}),
        });
        if (controller === active) {
          data = result;
          notify?.();
        }
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return undefined;
        if (controller === active) {
          error =
            err instanceof ActionClientError
              ? err
              : new ActionClientError({
                  actionName: name,
                  message: err instanceof Error ? err.message : String(err),
                  statusCode: 500,
                });
          notify?.();
        }
        return undefined;
      } finally {
        if (controller === active) {
          isLoading = false;
          notify?.();
        }
      }
    };

    const onInvalidate = (targets?: readonly string[]) => {
      if (!targets || targets.includes(name)) {
        void refetch();
      }
    };
    listeners.add(onInvalidate);
    void refetch();

    return {
      get data() {
        subscribe();
        return data;
      },
      get error() {
        subscribe();
        return error;
      },
      get isLoading() {
        subscribe();
        return isLoading;
      },
      refetch,
      destroy: () => {
        controller?.abort();
        listeners.delete(onInvalidate);
      },
    };
  }

  function createActionMutation<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    mutationOpts: {
      invalidate?: readonly ActionNameOf<TRegistry>[] | false;
      method?: "POST" | "PUT" | "PATCH" | "DELETE";
      headers?: HeadersInit;
      approvalToken?: string;
      onSuccess?: (
        data: ActionOutputOf<TRegistry, TName>,
        input: ActionInputOf<TRegistry, TName>,
      ) => void | Promise<void>;
      onError?: (
        error: ActionClientError,
        input: ActionInputOf<TRegistry, TName>,
      ) => void;
    } = {},
  ): SvelteMutationState<
    ActionOutputOf<TRegistry, TName>,
    ActionInputOf<TRegistry, TName>
  > {
    let data: ActionOutputOf<TRegistry, TName> | undefined;
    let error: ActionClientError | null = null;
    let isPending = false;
    let notify: (() => void) | null = null;

    const subscribe = createSubscriber((update) => {
      notify = update;
      return () => {
        notify = null;
      };
    });

    const mutateAsync = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName>> => {
      isPending = true;
      error = null;
      notify?.();
      try {
        const result = await client.call(name, input, {
          method: mutationOpts.method ?? "POST",
          ...(mutationOpts.headers ? { headers: mutationOpts.headers } : {}),
          ...(mutationOpts.approvalToken !== undefined
            ? { approvalToken: mutationOpts.approvalToken }
            : {}),
        });
        data = result;
        notify?.();
        notifyInvalidation(mutationOpts.invalidate);
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
        error = normalized;
        notify?.();
        mutationOpts.onError?.(normalized, input);
        throw normalized;
      } finally {
        isPending = false;
        notify?.();
      }
    };

    const mutate = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName> | undefined> => {
      try {
        return await mutateAsync(input);
      } catch {
        // coercion-ok: mutateAsync already set reactive error state and called onError
        return undefined;
      }
    };

    return {
      get data() {
        subscribe();
        return data;
      },
      get error() {
        subscribe();
        return error;
      },
      get isPending() {
        subscribe();
        return isPending;
      },
      mutate,
      mutateAsync,
    };
  }

  return {
    client,
    callAction: client.call,
    createActionQuery,
    createActionMutation,
    actionErrorMessage,
  };
}

const defaultSvelteHooks = createSvelteActionHooks();

export const callAction = defaultSvelteHooks.callAction;
export const createActionQuery = defaultSvelteHooks.createActionQuery;
export const createActionMutation = defaultSvelteHooks.createActionMutation;
