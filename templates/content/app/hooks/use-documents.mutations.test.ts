import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const invalidateQueries = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({
    invalidateQueries,
    getQueryCache: () => ({ findAll: () => [] }),
    getQueriesData: () => [],
  }),
}));

import { withContentSaveOrigin } from "@/lib/content-save-telemetry";

import {
  useCreateDocument,
  useUpdateDocument,
  useUpdatePreviewDocumentDraft,
} from "./use-documents";

describe("useUpdateDocument request telemetry", () => {
  beforeEach(() => useActionMutation.mockReset());

  it("keeps recovery metadata in headers and preserves ordinary save options", () => {
    useActionMutation.mockImplementation((_name, options) => options);
    useUpdateDocument();
    const options = useActionMutation.mock.calls.find(
      ([name]) => name === "update-document",
    )![1];
    const payload = { id: "page", content: "draft" };
    expect(options.headers(payload)).toBeUndefined();
    expect(options.headers(withContentSaveOrigin(payload, "recovery"))).toEqual(
      { "X-Content-Save-Origin": "recovery" },
    );
    expect(options.skipActionQueryInvalidation).toBe(true);
    expect(options.onSuccess).toBeTypeOf("function");
    expect(payload).toEqual({ id: "page", content: "draft" });
  });

  it("tags every page-load recovery save without adding payload fields", () => {
    useActionMutation.mockImplementation((_name, options) => options);
    useUpdateDocument({ saveOrigin: "recovery" });
    const options = useActionMutation.mock.calls.find(
      ([name]) => name === "update-document",
    )![1];
    expect(options.headers({ id: "page" })).toEqual({
      "X-Content-Save-Origin": "recovery",
    });
  });
});

describe("useUpdatePreviewDocumentDraft", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
    invalidateQueries.mockReset();
  });

  it("keeps originating-tab draft autosaves out of generic action invalidation", () => {
    useActionMutation.mockImplementation((_name, options) => options);

    useUpdatePreviewDocumentDraft();

    expect(useActionMutation).toHaveBeenCalledWith(
      "update-preview-document-draft",
      expect.objectContaining({
        skipActionQueryInvalidation: true,
      }),
    );
  });
});

describe("useCreateDocument", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
  });

  it("lets creation flows invalidate document lists after optimistic writes settle", () => {
    useActionMutation.mockImplementation((_name, options) => options);

    useCreateDocument();

    expect(useActionMutation).toHaveBeenCalledWith(
      "create-document",
      expect.objectContaining({
        skipActionQueryInvalidation: true,
      }),
    );
    const options = useActionMutation.mock.calls[0]?.[1];
    options.onSuccess({ id: "new-page", parentId: "parent", spaceId: "space" });
    const { predicate } = invalidateQueries.mock.calls[0]![0];
    const query = (queryKey: unknown[]) => ({ queryKey, state: {} });
    const branch = (parentId: string | null) =>
      query([
        "action",
        "query-content-database-items",
        { databaseId: "files", navigation: { parentId } },
      ]);
    expect(predicate(branch("parent"))).toBe(true);
    expect(predicate(branch("other"))).toBe(false);
    expect(
      predicate(
        query(["action", "get-content-navigation-context", { id: "new-page" }]),
      ),
    ).toBe(true);
    expect(predicate(query(["action", "list-documents", undefined]))).toBe(
      false,
    );
  });
});
