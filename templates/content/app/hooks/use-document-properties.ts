import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  ConfigureDocumentPropertyRequest,
  ContentDatabaseResponse,
  DeleteDocumentPropertyRequest,
  DocumentPropertiesResponse,
  DocumentPropertyValue,
  DuplicateDocumentPropertyRequest,
  ReorderDocumentPropertyRequest,
  SetDocumentPropertyRequest,
} from "@shared/api";
import { useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import {
  applyDocumentPropertiesToDatabaseResponse,
  applyDocumentPropertyValueToDatabaseResponse,
  contentDatabaseQueryFilter,
  contentDatabaseQueryKey,
  removeDocumentPropertyFromDatabaseResponse,
} from "./use-content-database";
import { documentPropertiesQueryKey } from "./use-documents";

type DatabaseScopedRequest = { databaseId: string };

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
    documentId && databaseId ? { documentId, databaseId } : undefined,
    {
      enabled: !!documentId && !!databaseId,
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
      queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}

export function useSetDocumentProperty(
  documentId: string,
  databaseId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    DocumentPropertiesResponse,
    SetDocumentPropertyRequest
  >("set-document-property", {
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
          applyDocumentPropertyValueToDatabaseResponse(current, {
            documentId: variables.documentId,
            propertyId: variables.propertyId,
            value: variables.value,
          }),
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
    onSuccess: (data, variables) => {
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
      queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(variables.documentId, databaseId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: variables.documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
      queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
  return withDatabaseScope(mutation, databaseId);
}
