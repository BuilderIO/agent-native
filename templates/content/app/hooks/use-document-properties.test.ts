import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient,
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
          filters.queryKey[0] === "action",
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
});
