import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const invalidateQueries = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries }),
}));

import {
  useCreateDocument,
  useUpdatePreviewDocumentDraft,
} from "./use-documents";

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
    options.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["action", "query-content-database-items"],
      }),
    );
  });
});
