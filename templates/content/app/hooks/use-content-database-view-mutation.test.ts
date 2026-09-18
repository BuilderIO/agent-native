import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

import { useUpdateContentDatabaseView } from "./use-content-database";

describe("useUpdateContentDatabaseView", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
  });

  it("serializes full view-config writes for one database", () => {
    useQueryClient.mockReturnValue({});
    useActionMutation.mockImplementation((_name, options) => options);

    useUpdateContentDatabaseView("database-page");

    expect(useActionMutation).toHaveBeenCalledWith(
      "update-content-database-view",
      expect.objectContaining({
        skipActionQueryInvalidation: true,
        scope: { id: "content-database-view:database-page" },
      }),
    );
  });

  it("cancels stale reads and adopts only the newest response metadata", async () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useUpdateContentDatabaseView("database-page");
    const options = useActionMutation.mock.calls[0][1];
    const olderContext = await options.onMutate();
    const newerContext = await options.onMutate();
    const older = {
      receipt: {
        revisions: {
          schemaAfter: "schema-older",
          configurationAfter: "configuration-older",
        },
      },
      value: { activeViewId: "older" },
    };
    const newer = {
      receipt: {
        revisions: {
          schemaAfter: "schema-newer",
          configurationAfter: "configuration-newer",
        },
      },
      value: { activeViewId: "newer" },
    };
    const variables = {
      target: { databaseId: "database-id" },
    };

    options.onSuccess(older, variables, olderContext);
    options.onSettled(older, undefined, variables, olderContext);
    expect(queryClient.setQueriesData).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    options.onSuccess(newer, variables, newerContext);
    expect(queryClient.cancelQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.setQueriesData).toHaveBeenCalledTimes(1);

    const [filter, updater] = queryClient.setQueriesData.mock.calls[0];
    const current = {
      database: { viewConfig: { activeViewId: "current" } },
      configurationRevision: "configuration-current",
      mutationContract: { schemaRevision: "schema-current" },
      items: [{ id: "row-1" }],
      properties: [{ definition: { id: "status" } }],
    };
    expect(filter).toEqual(
      expect.objectContaining({
        queryKey: ["action", "get-content-database"],
        predicate: expect.any(Function),
      }),
    );
    expect(updater(current)).toEqual({
      ...current,
      configurationRevision: "configuration-newer",
      mutationContract: { schemaRevision: "schema-newer" },
      database: {
        ...current.database,
        viewConfig: newer.value,
      },
    });

    options.onSettled(newer, undefined, variables, newerContext);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: [
        "action",
        "get-content-database",
        { databaseId: "database-id" },
      ],
    });
  });

  it("writes a legacy canonical response to both caches and invalidates its database id", async () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      setQueryData: vi.fn(),
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useUpdateContentDatabaseView("database-page");
    const options = useActionMutation.mock.calls[0][1];
    const context = await options.onMutate();
    const legacyResponse = {
      database: {
        id: "legacy-database",
        documentId: "database-page",
        title: "Legacy database",
        systemRole: "files",
        viewConfig: {
          activeViewId: "calendar",
          views: [
            {
              id: "calendar",
              name: "Calendar",
              type: "calendar",
              datePropertyId: "publish-date",
            },
          ],
        },
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:01.000Z",
      },
      properties: [],
      items: [],
      source: null,
      sources: [],
    };
    const variables = {
      databaseId: "legacy-database",
      viewConfig: legacyResponse.database.viewConfig,
    };

    options.onSuccess(legacyResponse, variables, context);
    expect(queryClient.setQueriesData).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["action", "get-content-database"],
      }),
      legacyResponse,
    );
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ["action", "get-content-database", { databaseId: "legacy-database" }],
      legacyResponse,
    );

    options.onSettled(legacyResponse, undefined, variables, context);
    expect(queryClient.invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: [
        "action",
        "get-content-database",
        { databaseId: "legacy-database" },
      ],
    });
  });
});
