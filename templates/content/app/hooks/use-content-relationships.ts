import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type { DocumentProperty } from "@shared/api";
import {
  canonicalRelationOptionsSchema,
  type CanonicalRelationOptions,
  type ConfigureContentRelationPropertyInput,
  type ConfigureContentRelationPropertyResult,
  type ListContentRelationCandidatesInput,
  type ListContentRelationCandidatesResult,
  type ListContentRelationshipHistoryInput,
  type ListContentRelationshipHistoryResult,
  type ListContentRelationshipsInput,
  type ListContentRelationshipsResult,
  type ListContentRelationshipTypesInput,
  type ListContentRelationshipTypesResult,
  type MutateContentRelationshipsInput,
  type MutateContentRelationshipsResult,
  type PrepareContentRelationshipRemovalInput,
  type PrepareContentRelationshipRemovalResult,
  type RemoveContentRelationPropertyInput,
  type RemoveContentRelationPropertyResult,
  type UndoContentRelationshipRevisionInput,
  type UndoContentRelationshipRevisionResult,
} from "@shared/relationships";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

const relationshipActionNames = [
  "list-content-relationship-types",
  "list-content-relation-candidates",
  "list-content-relationships",
  "list-content-relationship-history",
] as const;

export function contentRelationshipOperationId() {
  return globalThis.crypto.randomUUID();
}

export function relationshipMutationErrorMessage(
  error: unknown,
  interruptedMessage: string,
  fallbackMessage: string,
) {
  const actionMessage = actionErrorMessage(error);
  if (actionMessage) return actionMessage;
  if (error instanceof Error) {
    return /^Action .+ failed: /.test(error.message)
      ? interruptedMessage
      : error.message;
  }
  return fallbackMessage;
}

export class SupersededRelationshipMutationError extends Error {
  constructor() {
    super("A newer relationship intent superseded this request.");
    this.name = "SupersededRelationshipMutationError";
  }
}

export function isSupersededRelationshipMutationError(error: unknown) {
  return error instanceof SupersededRelationshipMutationError;
}

export function createRelationshipMutationRetry<TData, TVariables>(
  execute: (variables: TVariables) => Promise<TData>,
) {
  let failedVariables: TVariables | null = null;
  let intentGeneration = 0;

  async function executeAndRemember(variables: TVariables, generation: number) {
    let result: TData;
    try {
      result = await execute(variables);
    } catch (error) {
      if (intentGeneration !== generation) {
        throw new SupersededRelationshipMutationError();
      }
      failedVariables = variables;
      throw error;
    }
    if (intentGeneration !== generation) {
      throw new SupersededRelationshipMutationError();
    }
    failedVariables = null;
    return result;
  }

  return {
    run(variables: TVariables) {
      intentGeneration += 1;
      failedVariables = null;
      return executeAndRemember(variables, intentGeneration);
    },
    retry() {
      if (failedVariables === null) {
        throw new Error("No failed relationship request is available.");
      }
      return executeAndRemember(failedVariables, intentGeneration);
    },
    clear() {
      intentGeneration += 1;
      failedVariables = null;
    },
    failedVariables() {
      return failedVariables;
    },
  };
}

export function canonicalRelationOptions(
  property: Pick<DocumentProperty, "definition">,
): CanonicalRelationOptions | null {
  const result = canonicalRelationOptionsSchema.safeParse(
    property.definition.options.relation,
  );
  return result.success ? result.data : null;
}

function useRelationshipMutation<TData, TVariables>(name: string) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<TData, TVariables>(name, {
    skipActionQueryInvalidation: true,
    onSuccess: async () => {
      await Promise.all(
        [
          ...relationshipActionNames,
          "get-content-database",
          "list-document-properties",
        ].map((actionName) =>
          queryClient.invalidateQueries({
            queryKey: ["action", actionName],
          }),
        ),
      );
    },
  });
  const executeRef = useRef(
    mutation.mutateAsync as (variables: TVariables) => Promise<TData>,
  );
  executeRef.current = mutation.mutateAsync as (
    variables: TVariables,
  ) => Promise<TData>;
  const retryRef = useRef<ReturnType<
    typeof createRelationshipMutationRetry<TData, TVariables>
  > | null>(null);
  const [, setRetryVersion] = useState(0);
  retryRef.current ??= createRelationshipMutationRetry((variables) =>
    executeRef.current(variables),
  );

  async function mutateAsync(variables: TVariables) {
    try {
      return await retryRef.current!.run(variables);
    } finally {
      setRetryVersion((version) => version + 1);
    }
  }

  async function retryFailed() {
    try {
      return await retryRef.current!.retry();
    } finally {
      setRetryVersion((version) => version + 1);
    }
  }

  function clearFailedRequest() {
    retryRef.current!.clear();
    setRetryVersion((version) => version + 1);
  }

  return {
    ...mutation,
    mutateAsync,
    retryFailed,
    clearFailedRequest,
    failedVariables: retryRef.current.failedVariables(),
  };
}

export function useContentRelationshipTypes(
  input: ListContentRelationshipTypesInput | null,
) {
  return useActionQuery<ListContentRelationshipTypesResult>(
    "list-content-relationship-types",
    input ?? undefined,
    { enabled: !!input, placeholderData: (previous) => previous },
  );
}

export function useContentRelationCandidates(
  input: ListContentRelationCandidatesInput | null,
) {
  return useActionQuery<ListContentRelationCandidatesResult>(
    "list-content-relation-candidates",
    input ?? undefined,
    { enabled: !!input, placeholderData: (previous) => previous },
  );
}

export function useContentRelationships(
  input: ListContentRelationshipsInput | null,
) {
  return useActionQuery<ListContentRelationshipsResult>(
    "list-content-relationships",
    input ?? undefined,
    { enabled: !!input, placeholderData: (previous) => previous },
  );
}

export function useContentRelationshipHistory(
  input: ListContentRelationshipHistoryInput | null,
) {
  return useActionQuery<ListContentRelationshipHistoryResult>(
    "list-content-relationship-history",
    input ?? undefined,
    { enabled: !!input, placeholderData: (previous) => previous },
  );
}

export function useConfigureContentRelationProperty() {
  return useRelationshipMutation<
    ConfigureContentRelationPropertyResult,
    ConfigureContentRelationPropertyInput
  >("configure-content-relation-property");
}

export function useMutateContentRelationships() {
  return useRelationshipMutation<
    MutateContentRelationshipsResult,
    MutateContentRelationshipsInput
  >("mutate-content-relationships");
}

export function usePrepareContentRelationshipRemoval() {
  return useRelationshipMutation<
    PrepareContentRelationshipRemovalResult,
    PrepareContentRelationshipRemovalInput
  >("prepare-content-relationship-removal");
}

export function useRemoveContentRelationProperty() {
  return useRelationshipMutation<
    RemoveContentRelationPropertyResult,
    RemoveContentRelationPropertyInput
  >("remove-content-relation-property");
}

export function useUndoContentRelationshipRevision() {
  return useRelationshipMutation<
    UndoContentRelationshipRevisionResult,
    UndoContentRelationshipRevisionInput
  >("undo-content-relationship-revision");
}
