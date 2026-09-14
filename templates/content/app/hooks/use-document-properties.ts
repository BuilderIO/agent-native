import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  ConfigureDocumentPropertyRequest,
  ContentDatabaseItemsPageResponse,
  ContentDatabaseResponse,
  DeleteDocumentPropertyRequest,
  DocumentPropertyDefinition,
  DocumentPropertyOption,
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
import { trackDocumentPropertyWrite } from "./document-property-persistence";
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

type GuardedConfigurePropertyInput =
  | {
      operation: "create";
      target: {
        spaceId: string;
        databaseId: string;
        databaseDocumentId: string;
      };
      expectedSchemaRevision: string;
      idempotencyKey: string;
      definition: Record<string, unknown>;
    }
  | {
      operation: "update";
      target: {
        spaceId: string;
        databaseId: string;
        databaseDocumentId: string;
      };
      expectedSchemaRevision: string;
      idempotencyKey: string;
      propertyId: string;
      patch: Record<string, unknown>;
    };

type GuardedConfigurePropertyResult = {
  receipt: {
    revisions: { schemaAfter: string; configurationAfter: string };
  };
  value: DocumentPropertyDefinition & { naturalKey?: boolean };
};

const guardedOrdinaryPropertyTypes = new Set([
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "place",
  "files_media",
  "checkbox",
  "url",
  "email",
  "phone",
]);

function guardedConfigurePropertyInput(
  request: ConfigureDocumentPropertyRequest,
  snapshot: ContentDatabaseResponse | undefined,
): GuardedConfigurePropertyInput | ConfigureDocumentPropertyRequest {
  const contract = snapshot?.mutationContract;
  if (
    !contract ||
    contract.target.databaseId !== request.databaseId ||
    !guardedOrdinaryPropertyTypes.has(request.type)
  ) {
    return request;
  }
  const { authorityScope: _authorityScope, ...target } = contract.target;
  const guard = {
    target,
    expectedSchemaRevision: contract.schemaRevision,
    idempotencyKey: crypto.randomUUID(),
  };
  const options = request.options?.options;
  if (!request.id) {
    if (
      request.options?.formula !== undefined ||
      request.options?.relation !== undefined ||
      request.options?.rollup !== undefined
    ) {
      throw new Error(
        "Ordinary properties cannot use computed property configuration.",
      );
    }
    return {
      ...guard,
      operation: "create",
      definition: {
        name: request.name,
        type: request.type,
        ...(request.description === undefined
          ? {}
          : { description: request.description }),
        ...(request.visibility === undefined
          ? {}
          : { visibility: request.visibility }),
        ...(request.naturalKey === undefined
          ? {}
          : { naturalKey: request.naturalKey }),
        ...(options === undefined ? {} : { options }),
      },
    };
  }

  const existing = snapshot.properties.find(
    (property) => property.definition.id === request.id,
  )?.definition;
  if (!existing) {
    throw new Error("The property is unavailable. Refresh before editing it.");
  }
  if (existing.type !== request.type) {
    throw new Error(
      "Property type changes are unavailable in ordinary database setup.",
    );
  }
  const patch: Record<string, unknown> = {};
  if (request.name !== existing.name) patch.name = request.name;
  if (
    request.description !== undefined &&
    request.description !== existing.description
  ) {
    patch.description = request.description;
  }
  if (
    request.visibility !== undefined &&
    request.visibility !== existing.visibility
  ) {
    patch.visibility = request.visibility;
  }
  if (request.naturalKey !== undefined) patch.naturalKey = request.naturalKey;
  if (options !== undefined) {
    const current = existing.options.options ?? [];
    const requestedIds = new Set(options.map((option) => option.id));
    if (current.some((option) => !requestedIds.has(option.id))) {
      throw new Error(
        "Removing property options is unavailable because saved values may still reference them.",
      );
    }
    const currentById = new Map(current.map((option) => [option.id, option]));
    const optionEdits: Array<Record<string, unknown>> = [];
    for (const option of options) {
      const saved = currentById.get(option.id);
      if (!saved) {
        optionEdits.push({ operation: "add", option });
        continue;
      }
      const optionPatch: Partial<DocumentPropertyOption> = {};
      if (option.name !== saved.name) optionPatch.name = option.name;
      if (option.color !== saved.color) optionPatch.color = option.color;
      if (option.description !== saved.description) {
        optionPatch.description = option.description;
      }
      if (Object.keys(optionPatch).length > 0) {
        optionEdits.push({
          operation: "update",
          optionId: option.id,
          patch: optionPatch,
        });
      }
    }
    if (options.some((option, index) => current[index]?.id !== option.id)) {
      optionEdits.push({
        operation: "reorder",
        optionIds: options.map((option) => option.id),
      });
    }
    if (optionEdits.length > 0) patch.optionEdits = optionEdits;
  }
  if (Object.keys(patch).length === 0) patch.name = existing.name;
  return {
    ...guard,
    operation: "update",
    propertyId: request.id,
    patch,
  };
}

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
  const getSetupSnapshot = () =>
    queryClient
      .getQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(databaseDocumentId),
      )
      .map(([, value]) => value)
      .find((value) => value?.database.id === databaseId);
  const mutation = useActionMutation<
    DocumentPropertiesResponse | GuardedConfigurePropertyResult,
    ConfigureDocumentPropertyRequest | GuardedConfigurePropertyInput
  >("configure-document-property", {
    skipActionQueryInvalidation: true,
    onSuccess: (data) => {
      if ("receipt" in data) {
        queryClient.setQueriesData<ContentDatabaseResponse>(
          contentDatabaseQueryFilter(databaseDocumentId),
          (current) => {
            if (!current || current.database.id !== databaseId) return current;
            const existing = current.properties.find(
              (property) => property.definition.id === data.value.id,
            );
            const property = {
              definition: data.value,
              value: existing?.value ?? null,
              editable: existing?.editable ?? true,
              ...(existing?.blocksField
                ? { blocksField: existing.blocksField }
                : {}),
            };
            const properties = existing
              ? current.properties.map((candidate) =>
                  candidate.definition.id === data.value.id
                    ? property
                    : candidate,
                )
              : [...current.properties, property];
            return {
              ...current,
              configurationRevision: data.receipt.revisions.configurationAfter,
              mutationContract: current.mutationContract
                ? {
                    ...current.mutationContract,
                    schemaRevision: data.receipt.revisions.schemaAfter,
                  }
                : current.mutationContract,
              properties,
              items: current.items.map((item) => ({
                ...item,
                properties: item.properties.map((candidate) =>
                  candidate.definition.id === data.value.id
                    ? { ...candidate, definition: data.value }
                    : candidate,
                ),
              })),
            };
          },
        );
      } else {
        queryClient.setQueriesData<ContentDatabaseResponse>(
          contentDatabaseQueryFilter(databaseDocumentId),
          (current) => applyDocumentPropertiesToDatabaseResponse(current, data),
        );
      }
      void queryClient.invalidateQueries({
        queryKey: documentPropertiesQueryKey(documentId, databaseId),
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries(
        contentDatabaseConstrainedQueryFilter(databaseDocumentId),
      );
    },
  });
  type ScopedVariables = Omit<ConfigureDocumentPropertyRequest, "databaseId">;
  return {
    ...mutation,
    mutate: (variables: ScopedVariables, options?: unknown) =>
      mutation.mutate(
        guardedConfigurePropertyInput(
          { ...variables, databaseId },
          getSetupSnapshot(),
        ),
        options as never,
      ),
    mutateAsync: (variables: ScopedVariables, options?: unknown) =>
      mutation.mutateAsync(
        guardedConfigurePropertyInput(
          { ...variables, databaseId },
          getSetupSnapshot(),
        ),
        options as never,
      ),
  } as UseMutationResult<
    DocumentPropertiesResponse | GuardedConfigurePropertyResult,
    Error,
    ScopedVariables,
    unknown
  >;
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
  const scoped = withDatabaseScope(mutation, databaseId);
  return {
    ...scoped,
    mutateAsync: (...args: Parameters<typeof scoped.mutateAsync>) =>
      trackDocumentPropertyWrite(args[0].documentId, args[0].propertyId, () =>
        scoped.mutateAsync(...args),
      ),
  };
}

export function useUpdateDatabaseItems(databaseDocumentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    UpdateDatabaseItemsResponse,
    UpdateDatabaseItemsRequest
  >("update-database-items", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      const databaseQueries = contentDatabaseQueryFilter(databaseDocumentId);
      const constrainedQueries =
        contentDatabaseConstrainedQueryFilter(databaseDocumentId);
      void queryClient.invalidateQueries({
        queryKey: ["action"],
        predicate: (query) =>
          databaseQueries.predicate(query) ||
          constrainedQueries.predicate(query),
      });
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
