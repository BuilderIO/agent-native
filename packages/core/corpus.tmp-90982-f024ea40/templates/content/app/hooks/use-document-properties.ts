import { useActionMutation, useActionQuery } from "@agent-native/core/client";
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
import { useQueryClient } from "@tanstack/react-query";

import {
  applyDocumentPropertiesToDatabaseResponse,
  applyDocumentPropertyValueToDatabaseResponse,
  contentDatabaseQueryFilter,
  contentDatabaseQueryKey,
  removeDocumentPropertyFromDatabaseResponse,
} from "./use-content-database";

export function useDocumentProperties(documentId: string | null) {
  return useActionQuery<DocumentPropertiesResponse>(
    "list-document-properties",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      placeholderData: (prev) => prev,
    },
  );
}

export function useConfigureDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
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
        queryKey: ["action", "list-document-properties", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
}

export function useSetDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentPropertiesResponse,
    SetDocumentPropertyRequest
  >("set-document-property", {
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
        queryKey: [
          "action",
          "list-document-properties",
          { documentId: variables.documentId },
        ],
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
}

export function useDuplicateDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
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
        queryKey: ["action", "list-document-properties", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
}

export function useReorderDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentPropertiesResponse,
    ReorderDocumentPropertyRequest
  >("reorder-document-property", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-document-properties", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(databaseDocumentId),
      });
    },
  });
}

export function useDeleteDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
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
        queryKey: ["action", "list-document-properties", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({
        ...contentDatabaseQueryFilter(databaseDocumentId),
      });
    },
  });
}
