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
  readonly data: { readonly value: TData | undefined };
  readonly error: { readonly value: ActionClientError | null };
  readonly isPending: { readonly value: boolean };
  refetch: () => Promise<TData | undefined>;
}

export interface VueMutationState<TData, TInput> {
  readonly data: { readonly value: TData | undefined };
  readonly error: { readonly value: ActionClientError | null };
  readonly isPending: { readonly value: boolean };
  mutate: (input: TInput) => Promise<TData | undefined>;
  mutateAsync: (input: TInput) => Promise<TData>;
}

interface VueRuntime {
  ref: <T>(value: T) => { value: T };
  watchEffect?: (effect: () => void) => () => void;
}

async function loadVueRuntime(): Promise<VueRuntime | null> {
  try {
    const mod = (await import("vue")) as unknown as VueRuntime;
    return typeof mod.ref === "function" ? mod : null;
  } catch {
    // coercion-ok: vue is an optional peer dependency; null signals fallback to plain ref objects
    return null;
  }
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
    const dataRef = {
      value: undefined as ActionOutputOf<TRegistry, TName> | undefined,
    };
    const errorRef = { value: null as ActionClientError | null };
    const pendingRef = { value: false };

    let activeController: AbortController | null = null;

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
      if (resolvedInput === false || resolvedInput === null) return undefined;

      activeController?.abort();
      activeController = new AbortController();
      pendingRef.value = true;
      errorRef.value = null;
      try {
        const result = await client.call(name, resolvedInput, {
          method: queryOpts.method ?? "GET",
          signal: activeController.signal,
          ...(queryOpts.headers ? { headers: queryOpts.headers } : {}),
        });
        dataRef.value = result;
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return undefined;
        }
        errorRef.value =
          err instanceof ActionClientError
            ? err
            : new ActionClientError({
                actionName: name,
                message: err instanceof Error ? err.message : String(err),
                statusCode: 500,
              });
        return undefined;
      } finally {
        pendingRef.value = false;
      }
    };

    const listener = (targets?: readonly string[]) => {
      if (!targets || targets.includes(name)) {
        void refetch();
      }
    };
    listeners.add(listener);

    void loadVueRuntime().then((vue) => {
      if (vue?.watchEffect && typeof input === "function") {
        vue.watchEffect(() => {
          void refetch();
        });
      } else {
        void refetch();
      }
    });

    return {
      data: dataRef,
      error: errorRef,
      isPending: pendingRef,
      refetch,
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
    const dataRef = {
      value: undefined as ActionOutputOf<TRegistry, TName> | undefined,
    };
    const errorRef = { value: null as ActionClientError | null };
    const pendingRef = { value: false };

    const mutateAsync = async (
      input: ActionInputOf<TRegistry, TName>,
    ): Promise<ActionOutputOf<TRegistry, TName>> => {
      pendingRef.value = true;
      errorRef.value = null;
      try {
        const result = await client.call(name, input, {
          method: mutationOpts.method ?? "POST",
          ...(mutationOpts.headers ? { headers: mutationOpts.headers } : {}),
          ...(mutationOpts.approvalToken !== undefined
            ? { approvalToken: mutationOpts.approvalToken }
            : {}),
        });
        dataRef.value = result;
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
        errorRef.value = normalized;
        mutationOpts.onError?.(normalized, input);
        throw normalized;
      } finally {
        pendingRef.value = false;
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
      data: dataRef,
      error: errorRef,
      isPending: pendingRef,
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
