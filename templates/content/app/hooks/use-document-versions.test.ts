import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useActionMutation,
  useActionQuery,
  invalidateQueries,
  patchDocumentCaches,
} = vi.hoisted(() => ({
  useActionMutation: vi.fn((_name, options) => options),
  useActionQuery: vi.fn((_name, _input, options) => options),
  invalidateQueries: vi.fn(),
  patchDocumentCaches: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("./use-documents", () => ({
  documentQueryFilter: (documentId: string) => ({
    queryKey: ["document", documentId],
  }),
  patchDocumentCaches,
}));

import {
  useDocumentHistoryCheckpoint,
  useDocumentHistoryCheckpoints,
  useDocumentHistoryPage,
  useRestoreDocumentVersion,
} from "./use-document-versions";

describe("document history hooks", () => {
  beforeEach(() => {
    useActionMutation.mockClear();
    useActionQuery.mockClear();
    invalidateQueries.mockClear();
    patchDocumentCaches.mockClear();
  });

  it("requests paged metadata without coercing failed responses to empty data", () => {
    useDocumentHistoryPage("page-1", "groups-cursor");
    useDocumentHistoryCheckpoints("page-1", "group-1", "versions-cursor");
    useDocumentHistoryCheckpoint("page-1", "version-1");

    expect(useActionQuery).toHaveBeenNthCalledWith(
      1,
      "list-document-history",
      { documentId: "page-1", limit: 30, cursor: "groups-cursor" },
      expect.objectContaining({ enabled: true }),
    );
    expect(useActionQuery.mock.calls[0]?.[2]).not.toHaveProperty("select");
    expect(useActionQuery).toHaveBeenNthCalledWith(
      2,
      "list-document-history-checkpoints",
      {
        documentId: "page-1",
        groupId: "group-1",
        limit: 50,
        cursor: "versions-cursor",
      },
      expect.objectContaining({ enabled: true }),
    );
    expect(useActionQuery).toHaveBeenNthCalledWith(
      3,
      "get-document-history-checkpoint",
      { documentId: "page-1", versionId: "version-1" },
      { enabled: true },
    );
  });

  it("installs the committed document before invalidating restore queries", () => {
    const options = useRestoreDocumentVersion("page-1") as unknown as {
      onSuccess: (restored: Record<string, unknown>) => void;
    };
    const restored = {
      id: "page-1",
      title: "Draft A",
      content: "Restored body A",
      updatedAt: "2026-09-08T14:00:00.000Z",
      revision: "8:restored-hash",
      bodyRevision: 8,
      contentHash: "restored-hash",
    };
    options.onSuccess(restored);

    expect(patchDocumentCaches).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      {
        title: "Draft A",
        content: "Restored body A",
        updatedAt: "2026-09-08T14:00:00.000Z",
        revision: "8:restored-hash",
        bodyRevision: 8,
        contentHash: "restored-hash",
      },
    );
    expect(patchDocumentCaches.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0]!,
    );

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-document-history"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-document-history-checkpoints"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document-history-checkpoint"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["document", "page-1"],
    });
  });
});
