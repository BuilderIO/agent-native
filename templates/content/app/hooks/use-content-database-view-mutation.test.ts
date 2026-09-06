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
    const older = { database: { viewConfig: { activeViewId: "older" } } };
    const newer = { database: { viewConfig: { activeViewId: "newer" } } };

    options.onSuccess(older, {}, olderContext);
    options.onSettled(older, undefined, {}, olderContext);
    expect(queryClient.setQueriesData).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    options.onSuccess(newer, {}, newerContext);
    expect(queryClient.cancelQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.setQueriesData).toHaveBeenCalledTimes(1);

    const [filter, updater] = queryClient.setQueriesData.mock.calls[0];
    const current = {
      database: { viewConfig: { activeViewId: "current" } },
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
      database: newer.database,
    });

    options.onSettled(newer, undefined, {}, newerContext);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
