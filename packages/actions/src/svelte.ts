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
 * Create typed Svelte 5 action helpers (`createActionQuery`, `createActionMutation`, `callAction`).
 * Pass a custom `fetch` (such as SvelteKit's `event.fetch`) when calling from SSR `load` functions.
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
      controller = new AbortController();
      isLoading = true;
      error = null;
      try {
        const result = await client.call(name, resolved, {
          method: queryOpts.method ?? "GET",
          signal: controller.signal,
          ...(queryOpts.headers ? { headers: queryOpts.headers } : {}),
        });
        data = result;
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return undefined;
        error =
          err instanceof ActionClientError
            ? err
            : new ActionClientError({
                actionName: name,
                message: err instanceof Error ? err.message : String(err),
                statusCode: 500,
              });
        return undefined;
      } finally {
        isLoading = false;
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
        return data;
      },
      get error() {
        return error;
      },
      get isLoading() {
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

    const mutateAsync = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName>> => {
      isPending = true;
      error = null;
      try {
        const result = await client.call(name, input, {
          method: mutationOpts.method ?? "POST",
          ...(mutationOpts.headers ? { headers: mutationOpts.headers } : {}),
          ...(mutationOpts.approvalToken !== undefined
            ? { approvalToken: mutationOpts.approvalToken }
            : {}),
        });
        data = result;
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
        mutationOpts.onError?.(normalized, input);
        throw normalized;
      } finally {
        isPending = false;
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
        return data;
      },
      get error() {
        return error;
      },
      get isPending() {
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
