import { QueryClient } from "@tanstack/react-query";
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
  useSetDocumentProperty,
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
