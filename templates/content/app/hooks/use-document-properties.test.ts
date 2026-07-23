import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  getBrowserTabId: () => "content-tab-1",
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient,
}));

import { useSetDocumentProperty } from "./use-document-properties";

describe("useSetDocumentProperty", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    useQueryClient.mockReset();
  });

  it("uses origin-tab tagging and only the existing narrow cache reconciliation", () => {
    const queryClient = {
      cancelQueries: vi.fn(),
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    useQueryClient.mockReturnValue(queryClient);
    useActionMutation.mockImplementation((_name, options) => options);

    useSetDocumentProperty("row-1", "database-page-1");

    expect(useActionMutation).toHaveBeenCalledWith(
      "set-document-property",
      expect.objectContaining({
        requestSource: "content-tab-1",
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
    expect(invalidations).not.toContainEqual({ queryKey: ["action"] });
    expect(invalidations).toEqual(
      expect.arrayContaining([
        {
          queryKey: [
            "action",
            "list-document-properties",
            { documentId: "row-1" },
          ],
        },
        {
          queryKey: ["action", "get-document", { id: "row-1" }],
        },
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
});
