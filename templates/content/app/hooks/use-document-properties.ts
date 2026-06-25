import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  ConfigureDocumentPropertyRequest,
  DeleteDocumentPropertyRequest,
  DocumentPropertiesResponse,
  DuplicateDocumentPropertyRequest,
  ReorderDocumentPropertyRequest,
  SetDocumentPropertyRequest,
} from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";

import { contentDatabaseQueryKey } from "./use-content-database";

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

export function useSetDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentPropertiesResponse,
    SetDocumentPropertyRequest
  >("set-document-property", {
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

export function useDuplicateDocumentProperty(
  documentId: string,
  databaseDocumentId = documentId,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentPropertiesResponse,
    DuplicateDocumentPropertyRequest
  >("duplicate-document-property", {
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
