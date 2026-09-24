import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

import {
  documentPropertiesResponseMatchesScope,
  useConfigureDocumentProperty,
  useSetDocumentProperty,
  useUpdateDatabaseItems,
} from "./use-document-properties";

describe("documentPropertiesResponseMatchesScope", () => {
  it("rejects placeholder data from another database for the same row", () => {
    expect(
      documentPropertiesResponseMatchesScope("row-1", "database-2", {
        documentId: "row-1",
        databaseId: "database-1",
        properties: [],
      }),
    ).toBe(false);
  });

  it("accepts data only when both active identities match", () => {
    expect(
      documentPropertiesResponseMatchesScope("row-1", "database-1", {
        documentId: "row-1",
        databaseId: "database-1",
        properties: [],
      }),
    ).toBe(true);
  });
});

describe("useUpdateDatabaseItems", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
    useActionMutation.mockImplementation((_name, options) => options);
  });

  it("refreshes active filtered memberships without fetching inactive or unrelated results", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    useQueryClient.mockReturnValue(queryClient);
    const returnedPage = {
      items: [{ id: "item-1", document: { id: "row-1" } }],
    };
    const boundedKey = [
      "action",
      "query-content-database-items",
      { documentId: "database-page", tableQuery: { filters: ["matching"] } },
    ] as const;
    const legacyKey = [
      "action",
      "get-content-database",
      { documentId: "database-page", tableQuery: { filters: ["matching"] } },
    ] as const;
    const inactiveKey = [
      "action",
      "query-content-database-items",
      { documentId: "database-page", tableQuery: { filters: ["inactive"] } },
    ] as const;
    const unrelatedKey = [
      "action",
      "query-content-database-items",
      { documentId: "other-database", tableQuery: { filters: ["matching"] } },
    ] as const;
    const reads = [boundedKey, legacyKey, inactiveKey, unrelatedKey].map(
      (queryKey) => {
        const queryFn = vi.fn(async () => returnedPage);
        queryClient.setQueryData(queryKey, { items: [] });
        const observer = new QueryObserver(queryClient, { queryKey, queryFn });
        return { queryKey, queryFn, observer };
      },
    );
    const subscriptions = [reads[0], reads[1], reads[3]].map(({ observer }) =>
      observer.subscribe(() => {}),
    );

    try {
      useUpdateDatabaseItems("database-page");
      const mutation = useActionMutation.mock.calls.find(
        ([name]) => name === "update-database-items",
      )![1];
      mutation.onSuccess();

      await vi.waitFor(() => {
        expect(queryClient.getQueryData(boundedKey)).toEqual(returnedPage);
        expect(queryClient.getQueryData(legacyKey)).toEqual(returnedPage);
      });
      expect(reads[0].queryFn).toHaveBeenCalledTimes(1);
      expect(reads[1].queryFn).toHaveBeenCalledTimes(1);
      expect(reads[2].queryFn).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
      expect(reads[3].queryFn).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(
        false,
      );
    } finally {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      queryClient.clear();
    }
  });
});

describe("useConfigureDocumentProperty", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
  });

  it("adapts a rendered ordinary option edit to the guarded setup contract", async () => {
    const transportMutateAsync = vi.fn(async () => undefined);
    const queryClient = {
      getQueriesData: vi.fn(() => [
        [
          ["action", "get-content-database"],
          {
            database: { id: "database-1" },
            mutationContract: {
              target: {
                authorityScope: { kind: "personal", id: "owner@test.dev" },
                spaceId: "space-1",
                databaseId: "database-1",
                databaseDocumentId: "database-page-1",
              },
              schemaRevision: "schema-rendered",
            },
            properties: [
              {
                definition: {
                  id: "status",
                  databaseId: "database-1",
                  name: "Status",
                  description: "",
                  type: "status",
                  visibility: "always_show",
                  systemRole: null,
                  options: {
                    options: [{ id: "draft", name: "Draft", color: "gray" }],
                  },
                },
                value: null,
                editable: true,
              },
            ],
          },
        ],
      ]),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: transportMutateAsync,
    });

    const configure = useConfigureDocumentProperty(
      "database-page-1",
      "database-1",
    );
    await configure.mutateAsync({
      id: "status",
      documentId: "database-page-1",
      name: "Workflow",
      type: "status",
      visibility: "always_show",
      options: {
        options: [
          { id: "draft", name: "Drafting", color: "blue" },
          { id: "ready", name: "Ready", color: "green" },
        ],
      },
    });

    expect(transportMutateAsync).toHaveBeenCalledWith(
      {
        operation: "update",
        target: {
          spaceId: "space-1",
          databaseId: "database-1",
          databaseDocumentId: "database-page-1",
        },
        expectedSchemaRevision: "schema-rendered",
        idempotencyKey: expect.any(String),
        propertyId: "status",
        patch: {
          name: "Workflow",
          optionEdits: [
            {
              operation: "update",
              optionId: "draft",
              patch: { name: "Drafting", color: "blue" },
            },
            {
              operation: "add",
              option: { id: "ready", name: "Ready", color: "green" },
            },
            {
              operation: "reorder",
              optionIds: ["draft", "ready"],
            },
          ],
        },
      },
      undefined,
    );
  });

  it("uses the synchronous receipt cache for a second metadata edit before rerender", async () => {
    const queryClient = new QueryClient();
    useQueryClient.mockReturnValue(queryClient);
    const key = [
      "action",
      "get-content-database",
      { documentId: "database-page-1" },
    ];
    const definition = {
      id: "text-1",
      databaseId: "database-1",
      name: "Name",
      description: "",
      type: "text",
      visibility: "always_show",
      systemRole: null,
      options: null,
    };
    queryClient.setQueryData(key, {
      database: { id: "database-1" },
      mutationContract: {
        target: {
          spaceId: "space-1",
          databaseId: "database-1",
          databaseDocumentId: "database-page-1",
        },
        schemaRevision: "S0",
      },
      configurationRevision: "C0",
      properties: [{ definition, value: null, editable: true }],
      items: [],
    });
    let onSuccess!: (data: unknown) => void;
    const transport = vi.fn(async (_input: unknown) => {
      onSuccess({
        value: { ...definition, name: "Renamed" },
        receipt: { revisions: { schemaAfter: "S1", configurationAfter: "C1" } },
      });
    });
    useActionMutation.mockImplementation((_name, options) => {
      onSuccess = options.onSuccess;
      return { mutateAsync: transport };
    });
    const configure = useConfigureDocumentProperty(
      "database-page-1",
      "database-1",
    );
    await configure.mutateAsync({
      documentId: "database-page-1",
      id: "text-1",
      name: "Renamed",
      type: "text",
    });
    await configure.mutateAsync({
      documentId: "database-page-1",
      id: "text-1",
      name: "Renamed",
      description: "Details",
      type: "text",
    });
    expect(transport.mock.calls[0][0]).toMatchObject({
      expectedSchemaRevision: "S0",
    });
    expect(transport.mock.calls[1][0]).toMatchObject({
      expectedSchemaRevision: "S1",
      patch: { description: "Details" },
    });
  });

  it("preserves the legacy request for computed property editing", async () => {
    const transportMutateAsync = vi.fn(async () => undefined);
    useQueryClient.mockReturnValue({
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    });
    useActionMutation.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: transportMutateAsync,
    });
    const configure = useConfigureDocumentProperty(
      "database-page-1",
      "database-1",
    );

    await configure.mutateAsync({
      id: "formula-1",
      documentId: "database-page-1",
      name: "Score",
      type: "formula",
      options: { formula: "1 + 1" },
    });

    expect(transportMutateAsync).toHaveBeenCalledWith(
      {
        id: "formula-1",
        documentId: "database-page-1",
        databaseId: "database-1",
        name: "Score",
        type: "formula",
        options: { formula: "1 + 1" },
      },
      undefined,
    );
  });

  it("rejects ordinary option removal without sending a legacy replacement", () => {
    const transportMutateAsync = vi.fn(async () => undefined);
    useQueryClient.mockReturnValue({
      getQueriesData: vi.fn(() => [
        [
          ["action", "get-content-database"],
          {
            database: { id: "database-1" },
            mutationContract: {
              target: {
                authorityScope: { kind: "personal", id: "owner@test.dev" },
                spaceId: "space-1",
                databaseId: "database-1",
                databaseDocumentId: "database-page-1",
              },
              schemaRevision: "schema-rendered",
            },
            properties: [
              {
                definition: {
                  id: "status",
                  databaseId: "database-1",
                  name: "Status",
                  description: "",
                  type: "status",
                  visibility: "always_show",
                  systemRole: null,
                  options: {
                    options: [
                      { id: "draft", name: "Draft", color: "gray" },
                      { id: "ready", name: "Ready", color: "green" },
                    ],
                  },
                },
                value: null,
                editable: true,
              },
            ],
          },
        ],
      ]),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    });
    useActionMutation.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: transportMutateAsync,
    });
    const configure = useConfigureDocumentProperty(
      "database-page-1",
      "database-1",
    );

    expect(() =>
      configure.mutateAsync({
        id: "status",
        documentId: "database-page-1",
        name: "Status",
        type: "status",
        visibility: "always_show",
        options: {
          options: [{ id: "draft", name: "Draft", color: "gray" }],
        },
      }),
    ).toThrow("Removing property options is unavailable");
    expect(transportMutateAsync).not.toHaveBeenCalled();
  });

  it("sends an ordinary semantic no-op through schema CAS", async () => {
    const transportMutateAsync = vi.fn(async () => undefined);
    useQueryClient.mockReturnValue({
      getQueriesData: vi.fn(() => [
        [
          ["action", "get-content-database"],
          {
            database: { id: "database-1" },
            mutationContract: {
              target: {
                authorityScope: { kind: "personal", id: "owner@test.dev" },
                spaceId: "space-1",
                databaseId: "database-1",
                databaseDocumentId: "database-page-1",
              },
              schemaRevision: "schema-rendered",
            },
            properties: [
              {
                definition: {
                  id: "publish-date",
                  databaseId: "database-1",
                  name: "Publish date",
                  description: "",
                  type: "date",
                  visibility: "always_show",
                  systemRole: null,
                  options: {},
                },
                value: null,
                editable: true,
              },
            ],
          },
        ],
      ]),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    });
    useActionMutation.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: transportMutateAsync,
    });
    const configure = useConfigureDocumentProperty(
      "database-page-1",
      "database-1",
    );

    await configure.mutateAsync({
      id: "publish-date",
      documentId: "database-page-1",
      name: "Publish date",
      type: "date",
      visibility: "always_show",
      options: {},
    });

    expect(transportMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update",
        expectedSchemaRevision: "schema-rendered",
        propertyId: "publish-date",
        patch: { name: "Publish date" },
      }),
      undefined,
    );
  });
});

describe("useSetDocumentProperty", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
    toastError.mockReset();
  });

  it("uses only the existing narrow cache reconciliation", () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page-1");

    expect(useActionMutation).toHaveBeenCalledWith(
      "set-document-property",
      expect.objectContaining({
        skipActionQueryInvalidation: true,
        scope: {
          id: "content-document-properties:database-1",
        },
      }),
    );

    const options = useActionMutation.mock.calls[0][1];
    options.onSuccess(
      {
        properties: [
          {
            definition: { id: "status" },
            value: "Published",
          },
        ],
      },
      {
        documentId: "row-1",
        propertyId: "status",
        value: "Draft",
      },
    );

    const invalidations = queryClient.invalidateQueries.mock.calls.map(
      ([filters]) => filters,
    );
    expect(
      invalidations.some(
        (filters) =>
          Array.isArray(filters.queryKey) &&
          filters.queryKey.length === 1 &&
          filters.queryKey[0] === "action" &&
          filters.predicate === undefined,
      ),
    ).toBe(false);
    expect(invalidations).toEqual(
      expect.arrayContaining([
        {
          queryKey: [
            "action",
            "list-document-properties",
            { documentId: "row-1", databaseId: "database-1" },
          ],
        },
        expect.objectContaining({
          queryKey: ["action", "get-document"],
          predicate: expect.any(Function),
        }),
        {
          queryKey: [
            "action",
            "get-content-database-source",
            { documentId: "database-page-1" },
          ],
        },
      ]),
    );
  });

  it("refetches the field revision after a rejected stale write", () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page-1");
    const options = useActionMutation.mock.calls[0][1];
    options.onError(
      new Error("Blocks field revision conflict"),
      {
        documentId: "row-1",
        propertyId: "notes",
        value: "stale edit",
        expectedBlocksFieldRevision: 2,
      },
      { previous: [] },
    );

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "action",
        "list-document-properties",
        { documentId: "row-1", databaseId: "database-1" },
      ],
    });
  });

  it("leaves error notification to a caller that opts into caller ownership", () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page-1", {
      errorNotification: "caller",
    });
    const options = useActionMutation.mock.calls[0][1];
    options.onError(
      new Error("Update failed"),
      {
        documentId: "row-1",
        propertyId: "status",
        value: "Draft",
      },
      { previous: [[["cached"], { value: "Published" }]] },
    );

    expect(toastError).not.toHaveBeenCalled();
    expect(queryClient.setQueryData).toHaveBeenCalledWith(["cached"], {
      value: "Published",
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "action",
        "list-document-properties",
        { documentId: "row-1", databaseId: "database-1" },
      ],
    });
  });

  it("patches the bounded result and reconciles its filtered membership", async () => {
    const queryClient = new QueryClient();
    const baseKey = [
      "action",
      "get-content-database",
      { documentId: "database-page", limit: 100 },
    ] as const;
    const pageKey = [
      "action",
      "query-content-database-items",
      {
        documentId: "database-page",
        limit: 100,
        tableQuery: {
          search: "",
          filters: [
            {
              key: "checked",
              label: "Checked",
              operator: "is_checked",
              value: "",
            },
          ],
          sorts: [],
          filterMode: "and",
        },
      },
    ] as const;
    const property = {
      definition: { id: "checked", position: 0 },
      value: true,
    };
    const item = {
      id: "item-1",
      databaseId: "database-1",
      position: 0,
      document: { id: "row-1" },
      properties: [property],
    };
    queryClient.setQueryData(baseKey, {
      database: { id: "database-1" },
      properties: [property],
      items: [item],
    });
    queryClient.setQueryData(pageKey, {
      items: [item],
      pagination: {
        offset: 0,
        limit: 100,
        totalItems: 1,
        returnedItems: 1,
        hasMore: false,
      },
    });
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page");
    const options = useActionMutation.mock.calls[0][1];
    const variables = {
      documentId: "row-1",
      databaseId: "database-1",
      propertyId: "checked",
      value: false,
    };
    const context = await options.onMutate(variables);

    expect(
      queryClient.getQueryData<{ items: (typeof item)[] }>(pageKey)?.items[0]
        ?.properties[0]?.value,
    ).toBe(false);

    options.onSuccess(
      {
        properties: [{ ...property, value: false }],
      },
      variables,
      context,
    );

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
  });

  it("does not let an older property response overwrite a newer edit", async () => {
    const queryClient = new QueryClient();
    const pageKey = [
      "action",
      "query-content-database-items",
      {
        documentId: "database-page",
        limit: 100,
        tableQuery: {
          search: "",
          filters: [],
          sorts: [],
          filterMode: "and",
        },
      },
    ] as const;
    const property = {
      definition: { id: "date", position: 0 },
      value: "2026-09-01",
    };
    queryClient.setQueryData(pageKey, {
      items: [
        {
          id: "item-1",
          databaseId: "database-1",
          position: 0,
          document: { id: "row-1" },
          properties: [property],
        },
      ],
    });
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page");
    const options = useActionMutation.mock.calls[0][1];
    const older = {
      documentId: "row-1",
      databaseId: "database-1",
      propertyId: "date",
      value: "2026-09-02",
    };
    const newer = { ...older, value: "2026-09-03" };
    const olderContext = await options.onMutate(older);
    const newerContext = await options.onMutate(newer);

    options.onSuccess(
      { properties: [{ ...property, value: "2026-09-03" }] },
      newer,
      newerContext,
    );
    options.onSuccess(
      { properties: [{ ...property, value: "2026-09-02" }] },
      older,
      olderContext,
    );

    expect(
      queryClient.getQueryData<{
        items: Array<{ properties: (typeof property)[] }>;
      }>(pageKey)?.items[0]?.properties[0]?.value,
    ).toBe("2026-09-03");
  });

  it("refetches canonical database results when a series of writes all fail", async () => {
    const queryClient = new QueryClient();
    const baseKey = [
      "action",
      "get-content-database",
      { documentId: "database-page", limit: 100 },
    ] as const;
    const pageKey = [
      "action",
      "query-content-database-items",
      {
        documentId: "database-page",
        limit: 100,
        tableQuery: {
          search: "",
          filters: [],
          sorts: [],
          filterMode: "and",
        },
      },
    ] as const;
    const property = {
      definition: { id: "date", position: 0 },
      value: "2026-09-01",
    };
    const item = {
      id: "item-1",
      databaseId: "database-1",
      position: 0,
      document: { id: "row-1" },
      properties: [property],
    };
    queryClient.setQueryData(baseKey, {
      database: { id: "database-1" },
      properties: [property],
      items: [item],
    });
    queryClient.setQueryData(pageKey, { items: [item] });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-1", "database-page");
    const options = useActionMutation.mock.calls[0][1];
    const first = {
      documentId: "row-1",
      databaseId: "database-1",
      propertyId: "date",
      value: "2026-09-02",
    };
    const second = { ...first, value: "2026-09-03" };
    const firstContext = await options.onMutate(first);
    const secondContext = await options.onMutate(second);

    options.onError(new Error("first failed"), first, firstContext);
    options.onError(new Error("second failed"), second, secondContext);

    expect(toastError).toHaveBeenNthCalledWith(1, "Something went wrong", {
      description: "first failed",
    });
    expect(toastError).toHaveBeenNthCalledWith(2, "Something went wrong", {
      description: "second failed",
    });

    const databaseInvalidations = invalidateQueries.mock.calls
      .map(([filter]) => filter)
      .filter(
        (filter) =>
          filter !== undefined &&
          Array.isArray(filter.queryKey) &&
          filter.queryKey[0] === "action" &&
          typeof filter.predicate === "function",
      );
    expect(databaseInvalidations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queryKey: ["action", "get-content-database"],
        }),
        expect.objectContaining({ queryKey: ["action"] }),
      ]),
    );
    expect(queryClient.getQueryState(baseKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
  });
});
