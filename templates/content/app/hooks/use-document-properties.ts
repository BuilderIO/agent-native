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

export function useConfigureDocumentProperty(documentId: string) {
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
        queryKey: ["action", "get-content-database"],
      });
    },
  });
}

export function useSetDocumentProperty(documentId: string) {
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
        queryKey: ["action", "get-content-database"],
      });
    },
  });
}

export function useDuplicateDocumentProperty(documentId: string) {
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
        queryKey: ["action", "get-content-database"],
      });
    },
  });
}

export function useReorderDocumentProperty(documentId: string) {
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
        queryKey: ["action", "get-content-database"],
      });
    },
  });
}

export function useDeleteDocumentProperty(documentId: string) {
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
        queryKey: ["action", "get-content-database"],
      });
    },
  });
}
