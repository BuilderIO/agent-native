import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  ConfigureDocumentPropertyRequest,
  ContentDatabaseItemsPageResponse,
  ContentDatabaseResponse,
  DeleteDocumentPropertyRequest,
  DocumentPropertiesResponse,
  DocumentPropertyValue,
  DuplicateDocumentPropertyRequest,
  ReorderDocumentPropertyRequest,
  SetDocumentPropertyRequest,
  UpdateDatabaseItemsRequest,
  UpdateDatabaseItemsResponse,
} from "@shared/api";
import { useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { dbText } from "../components/editor/database/text";
import {
  applyDocumentPropertiesToDatabaseResponse,
  applyDocumentPropertyValueToDatabaseResponse,
  contentDatabaseQueryFilter,
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseQueryKey,
  removeDocumentPropertyFromDatabaseResponse,
} from "./use-content-database";
import {
  documentPropertiesQueryKey,
  documentQueryFilter,
} from "./use-documents";

type DatabaseScopedRequest = { databaseId: string };

type DocumentPropertyMutationContext = {
  previous?: Array<[readonly unknown[], unknown]>;
  mutationKey: string;
  sequence: number;
};

type SetDocumentPropertyOptions = {
  errorNotification?: "shared" | "caller";
};

const documentPropertyMutationSequences = new WeakMap<
  object,
  Map<string, number>
>();

function nextDocumentPropertyMutationSequence(
  queryClient: object,
  documentId: string,
  propertyId: string,
) {
  let sequences = documentPropertyMutationSequences.get(queryClient);
  if (!sequences) {
    sequences = new Map();
    documentPropertyMutationSequences.set(queryClient, sequences);
  }
  const mutationKey = `${documentId}:${propertyId}`;
  const sequence = (sequences.get(mutationKey) ?? 0) + 1;
  sequences.set(mutationKey, sequence);
  return { mutationKey, sequence };
}

function isLatestDocumentPropertyMutation(
  queryClient: object,
  context: DocumentPropertyMutationContext | undefined,
) {
  if (!context?.mutationKey) return true;
  return (
    documentPropertyMutationSequences
      .get(queryClient)
      ?.get(context.mutationKey) === context.sequence
  );
}

export function documentPropertiesResponseMatchesScope(
  documentId: string,
  databaseId: string | null,
  data: DocumentPropertiesResponse | undefined,
): data is DocumentPropertiesResponse {
  return data?.documentId === documentId && data.databaseId === databaseId;
}

function withDatabaseScope<
  TData,
  TVariables extends DatabaseScopedRequest,
  TContext,
>(
  mutation: UseMutationResult<TData, Error, TVariables, TContext>,
  databaseId: string,
) {
  type ScopedVariables = Omit<TVariables, "databaseId">;
  return {
    ...mutation,
    mutate: (variables: ScopedVariables, options?: unknown) =>
      mutation.mutate(
        { ...variables, databaseId } as TVariables,
        options as never,
      ),
    mutateAsync: (variables: ScopedVariables, options?: unknown) =>
      mutation.mutateAsync(
        { ...variables, databaseId } as TVariables,
        options as never,
      ),
  } as UseMutationResult<TData, Error, ScopedVariables, TContext>;
}

export function useDocumentProperties(
  documentId: string | null,
  databaseId: string | null,
) {
  return useActionQuery<DocumentPropertiesResponse>(
    "list-document-properties",
    documentId
      ? { documentId, ...(databaseId ? { databaseId } : {}) }
      : undefined,
    {
      enabled: !!documentId,
      placeholderData: (prev) => prev,
    },
  );
}

export function useConfigureDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    ConfigureDocumentPropertyRequest
  >("configure-document-property", {
    skipActionQueryInvalidation: true,
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) => applyDocumentPropertiesToDatabaseResponse(current, data),
      );
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
      );
    },
  });
  return withDatabaseScope(mutation, databaseId);
}

export function useSetDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
  options: SetDocumentPropertyOptions = {},
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    SetDocumentPropertyRequest
  >("set-document-property", {
    skipActionQueryInvalidation: true,
    scope: {
      id: `content-document-properties:${databaseId}`,
    },
    onMutate: async (variables) => {
      const sequence = nextDocumentPropertyMutationSequence(
        queryClient,
        variables.documentId,
        variables.propertyId,
      );
      await Promise.all([
        queryClient.cancelQueries(
          contentDatabaseQueryFilter(databaseDocumentId),
        ),
        queryClient.cancelQueries(
          contentDatabaseConstrainedQueryFilter(databaseDocumentId),
        ),
      ]);
      const previous: Array<[readonly unknown[], unknown]> = [
        ...queryClient.getQueriesData<ContentDatabaseResponse>(
          contentDatabaseQueryFilter(databaseDocumentId),
        ),
        ...queryClient.getQueriesData<ContentDatabaseItemsPageResponse>(
          contentDatabaseConstrainedQueryFilter(databaseDocumentId),
        ),
      ];
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) =>
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: variables.documentId,
            propertyId: variables.propertyId,
            value: variables.value,
          }),
      );
      queryClient.setQueriesData<ContentDatabaseItemsPageResponse>(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
        (current) =>
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: variables.documentId,
            propertyId: variables.propertyId,
            value: variables.value,
          }),
      );
      return { previous, ...sequence };
    },
    onError: (error, variables, context) => {
      if (options.errorNotification !== "caller") {
        toast.error(dbText("somethingWentWrong"), {
          description: error.message,
        });
      }
      const rollback = context as DocumentPropertyMutationContext | undefined;
      if (!isLatestDocumentPropertyMutation(queryClient, rollback)) return;
      for (const [queryKey, data] of rollback?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(variables.documentId, databaseId),
      });
      void queryClient.invalidateQueries(
        contentDatabaseQueryFilter(databaseDocumentId),
      );
      void queryClient.invalidateQueries(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
      );
    },
    onSuccess: (data, variables, context) => {
      const mutationContext = context as
        | DocumentPropertyMutationContext
        | undefined;
      if (!isLatestDocumentPropertyMutation(queryClient, mutationContext)) {
        return;
      }
      const savedValue =
        data.properties.find(
          (property) => property.definition.id === variables.propertyId,
        )?.value ?? variables.value;
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) =>
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: variables.documentId,
            propertyId: variables.propertyId,
            value: savedValue as DocumentPropertyValue,
          }),
      );
      queryClient.setQueriesData<ContentDatabaseItemsPageResponse>(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
        (current) =>
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: variables.documentId,
            propertyId: variables.propertyId,
            value: savedValue as DocumentPropertyValue,
          }),
      );
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(variables.documentId, databaseId),
      });
      void queryClient.invalidateQueries(
        documentQueryFilter(variables.documentId),
      );
      void queryClient.invalidateQueries(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
      );
      void queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database-source",
          { documentId: databaseDocumentId },
        ],
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}

export function useUpdateDatabaseItems(databaseDocumentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    UpdateDatabaseItemsResponse,
    UpdateDatabaseItemsRequest
  >("update-database-items", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries(
        contentDatabaseQueryFilter(databaseDocumentId),
      );
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    },
  });
}

export function useDuplicateDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    DuplicateDocumentPropertyRequest
  >("duplicate-document-property", {
    skipActionQueryInvalidation: true,
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) => applyDocumentPropertiesToDatabaseResponse(current, data),
      );
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}

export function useReorderDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    ReorderDocumentPropertyRequest
  >("reorder-document-property", {
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(databaseDocumentId),
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}

export function useDeleteDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    DeleteDocumentPropertyRequest
  >("delete-document-property", {
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      await queryClient.cancelQueries(
        contentDatabaseQueryFilter(databaseDocumentId),
      );
      const previous = queryClient.getQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
      );
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) =>
          removeDocumentPropertyFromDatabaseResponse(
            current,
            variables.propertyId,
          ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const rollback = context as
        | {
            previous?: Array<[readonly unknown[], unknown]>;
          }
        | undefined;
      for (const [queryKey, data] of rollback?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
        (current) => applyDocumentPropertiesToDatabaseResponse(current, data),
      );
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}
