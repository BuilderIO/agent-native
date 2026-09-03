import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));

import { useUpdatePreviewDocumentDraft } from "./use-documents";

describe("useUpdatePreviewDocumentDraft", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useActionQuery.mockReset();
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
