import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

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

export interface ActionQueryHookOptions<TData> extends Omit<
  UseQueryOptions<TData, ActionClientError, TData, readonly unknown[]>,
  "queryKey" | "queryFn"
> {
  /** Partition the local query cache by viewer/tenant without sending it to the server. */
  queryKeyScope?: string;
  /** Override HTTP method (defaults to GET for queries). */
  method?: "GET" | "POST";
  headers?: HeadersInit;
}

export interface ActionMutationHookOptions<
  TData,
  TInput,
  TNames extends string,
> extends Omit<
  UseMutationOptions<TData, ActionClientError, TInput>,
  "mutationFn"
> {
  /**
   * Targeted list of query action names to invalidate on success.
   * Defaults to invalidating all active `agent-native-action` queries in this client scope.
   */
  invalidate?: readonly TNames[] | false;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  approvalToken?: string;
}

export function createActionHooks<TRegistry = unknown>(
  options: ActionClientOptions = {},
) {
  const client = createActionClient<TRegistry>(options);

  function actionQueryOptions<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?: ActionInputOf<TRegistry, TName>,
    hookOptions: ActionQueryHookOptions<ActionOutputOf<TRegistry, TName>> = {},
  ) {
    const { queryKeyScope, method = "GET", headers, ...rest } = hookOptions;
    const key = client.queryKey(name, input, queryKeyScope);
    return queryOptions<
      ActionOutputOf<TRegistry, TName>,
      ActionClientError,
      ActionOutputOf<TRegistry, TName>,
      readonly unknown[]
    >({
      queryKey: key,
      queryFn: ({ signal }) =>
        client.call(name, input, {
          method,
          signal,
          ...(headers ? { headers } : {}),
        }),
      ...rest,
    });
  }

  function useActionQuery<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?: ActionInputOf<TRegistry, TName>,
    hookOptions: ActionQueryHookOptions<ActionOutputOf<TRegistry, TName>> = {},
  ): UseQueryResult<ActionOutputOf<TRegistry, TName>, ActionClientError> {
    return useQuery(actionQueryOptions(name, input, hookOptions));
  }

  function useActionMutation<TName extends ActionNameOf<TRegistry>>(
    name: TName,
    hookOptions: ActionMutationHookOptions<
      ActionOutputOf<TRegistry, TName>,
      ActionInputOf<TRegistry, TName>,
      ActionNameOf<TRegistry>
    > = {},
  ): UseMutationResult<
    ActionOutputOf<TRegistry, TName>,
    ActionClientError,
    ActionInputOf<TRegistry, TName>
  > {
    const queryClient = useQueryClient();
    const {
      invalidate,
      method = "POST",
      headers,
      approvalToken,
      onSuccess,
      ...rest
    } = hookOptions;

    return useMutation<
      ActionOutputOf<TRegistry, TName>,
      ActionClientError,
      ActionInputOf<TRegistry, TName>
    >({
      mutationFn: (input) =>
        client.call(name, input, {
          method,
          ...(headers ? { headers } : {}),
          ...(approvalToken !== undefined ? { approvalToken } : {}),
        }),
      onSuccess: async (data, variables, onMutateResult, context) => {
        if (invalidate !== false) {
          if (Array.isArray(invalidate) && invalidate.length > 0) {
            await Promise.all(
              invalidate.map((targetName) =>
                queryClient.invalidateQueries({
                  queryKey: client.scope
                    ? ["agent-native-action", client.scope, targetName]
                    : ["agent-native-action", targetName],
                }),
              ),
            );
          } else {
            await queryClient.invalidateQueries({
              queryKey: client.scope
                ? ["agent-native-action", client.scope]
                : ["agent-native-action"],
            });
          }
        }
        await onSuccess?.(data, variables, onMutateResult, context);
      },
      ...rest,
    });
  }

  return {
    client,
    callAction: client.call,
    actionQueryOptions,
    useActionQuery,
    useActionMutation,
    actionErrorMessage,
  };
}

const defaultReactHooks = createActionHooks();

export const callAction = defaultReactHooks.callAction;
export const actionQueryOptions = defaultReactHooks.actionQueryOptions;
export const useActionQuery = defaultReactHooks.useActionQuery;
export const useActionMutation = defaultReactHooks.useActionMutation;
