import {
  getCurrentScope,
  onScopeDispose,
  ref,
  watchEffect,
  type Ref,
} from "vue";

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

export interface VueQueryState<TData> {
  readonly data: Ref<TData | undefined>;
  readonly error: Ref<ActionClientError | null>;
  readonly isPending: Ref<boolean>;
  refetch: () => Promise<TData | undefined>;
  stop: () => void;
}

export interface VueMutationState<TData, TInput> {
  readonly data: Ref<TData | undefined>;
  readonly error: Ref<ActionClientError | null>;
  readonly isPending: Ref<boolean>;
  mutate: (input: TInput) => Promise<TData | undefined>;
  mutateAsync: (input: TInput) => Promise<TData>;
}

/**
 * Create typed Vue 3 action composables (`useActionQuery`, `useActionMutation`, `callAction`).
 * Accepts reactive getters `() => input` or plain objects, and supports injecting Nuxt's `useRequestFetch()`.
 */
export function createVueActionHooks<TRegistry = unknown>(
  options: ActionClientOptions = {},
) {
  const client = createActionClient<TRegistry>(options);
  const listeners = new Set<(target?: readonly string[]) => void>();

  function notifyInvalidation(targets?: readonly string[] | false): void {
    if (targets === false) return;
    for (const listener of listeners) {
      listener(Array.isArray(targets) ? targets : undefined);
    }
  }

  function useActionQuery<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?:
      | ActionInputOf<TRegistry, TName>
      | (() => ActionInputOf<TRegistry, TName> | false | null | undefined),
    queryOpts: { method?: "GET" | "POST"; headers?: HeadersInit } = {},
  ): VueQueryState<ActionOutputOf<TRegistry, TName>> {
    const data = ref<ActionOutputOf<TRegistry, TName> | undefined>(
      undefined,
    ) as Ref<ActionOutputOf<TRegistry, TName> | undefined>;
    const error = ref<ActionClientError | null>(null);
    const isPending = ref(false);

    let activeController: AbortController | null = null;

    const execute = async (
      resolvedInput: ActionInputOf<TRegistry, TName> | false | null | undefined,
    ): Promise<ActionOutputOf<TRegistry, TName> | undefined> => {
      if (resolvedInput === false || resolvedInput === null) return undefined;

      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      isPending.value = true;
      error.value = null;
      try {
        const result = await client.call(name, resolvedInput, {
          method: queryOpts.method ?? "GET",
          signal: controller.signal,
          ...(queryOpts.headers ? { headers: queryOpts.headers } : {}),
        });
        if (activeController === controller) {
          data.value = result;
        }
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return undefined;
        }
        if (activeController === controller) {
          error.value =
            err instanceof ActionClientError
              ? err
              : new ActionClientError({
                  actionName: name,
                  message: err instanceof Error ? err.message : String(err),
                  statusCode: 500,
                });
        }
        return undefined;
      } finally {
        if (activeController === controller) {
          isPending.value = false;
        }
      }
    };

    const refetch = async (): Promise<
      ActionOutputOf<TRegistry, TName> | undefined
    > => {
      const resolvedInput =
        typeof input === "function"
          ? (
              input as () =>
                | ActionInputOf<TRegistry, TName>
                | false
                | null
                | undefined
            )()
          : input;
      return execute(resolvedInput);
    };

    const listener = (targets?: readonly string[]) => {
      if (!targets || targets.includes(name)) {
        void refetch();
      }
    };
    listeners.add(listener);

    let stopWatch: (() => void) | undefined;
    if (typeof input === "function") {
      const getter = input as () =>
        | ActionInputOf<TRegistry, TName>
        | false
        | null
        | undefined;
      stopWatch = watchEffect(() => {
        const resolved = getter();
        void execute(resolved);
      });
    } else {
      void execute(input);
    }

    const stop = () => {
      stopWatch?.();
      activeController?.abort();
      listeners.delete(listener);
    };

    if (getCurrentScope()) {
      onScopeDispose(stop);
    }

    return {
      data,
      error,
      isPending,
      refetch,
      stop,
    };
  }

  function useActionMutation<TName extends ActionNameOf<TRegistry>>(
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
  ): VueMutationState<
    ActionOutputOf<TRegistry, TName>,
    ActionInputOf<TRegistry, TName>
  > {
    const data = ref<ActionOutputOf<TRegistry, TName> | undefined>(
      undefined,
    ) as Ref<ActionOutputOf<TRegistry, TName> | undefined>;
    const error = ref<ActionClientError | null>(null);
    const isPending = ref(false);

    const mutateAsync = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName>> => {
      isPending.value = true;
      error.value = null;
      try {
        const result = await client.call(name, input, {
          method: mutationOpts.method ?? "POST",
          ...(mutationOpts.headers ? { headers: mutationOpts.headers } : {}),
          ...(mutationOpts.approvalToken !== undefined
            ? { approvalToken: mutationOpts.approvalToken }
            : {}),
        });
        data.value = result;
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
        error.value = normalized;
        mutationOpts.onError?.(normalized, input);
        throw normalized;
      } finally {
        isPending.value = false;
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
      data,
      error,
      isPending,
      mutate,
      mutateAsync,
    };
  }

  return {
    client,
    callAction: client.call,
    useActionQuery,
    useActionMutation,
    actionErrorMessage,
  };
}

const defaultVueHooks = createVueActionHooks();

export const callAction = defaultVueHooks.callAction;
export const useActionQuery = defaultVueHooks.useActionQuery;
export const useActionMutation = defaultVueHooks.useActionMutation;
