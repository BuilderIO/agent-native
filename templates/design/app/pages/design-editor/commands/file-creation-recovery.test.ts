import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { designMetadataQueryKey } from "../design-query-key";
import {
  captureDesignFileIds,
  isPersistedFilePresent,
  reconcileCreatedFile,
} from "./file-creation-recovery";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction: mocks.read }));

describe("file creation recovery with metadata-only cache", () => {
  it("finds a hydrated new file when cached metadata has no bodies", async () => {
    const queryClient = new QueryClient();
    const file = {
      id: "new",
      filename: "new.html",
      fileType: "html" as const,
      content: "<p>hello</p>",
      createdAt: "1",
      updatedAt: "1",
    };
    queryClient.setQueryData(designMetadataQueryKey("d"), {
      files: [
        { id: file.id, filename: file.filename, fileType: file.fileType },
      ],
    });
    mocks.read.mockClear();
    expect(
      await reconcileCreatedFile({
        queryClient,
        designId: "d",
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
        files: [file],
        knownFileIds: new Set(),
      }),
    ).toEqual(file);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("reports an unreadable presence check as unknown", async () => {
    const error = new Error("offline");
    mocks.read.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await isPersistedFilePresent({
          queryClient: new QueryClient(),
          designId: "d",
          fileId: "new",
        }),
      ).toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        "Unable to verify recovered file presence",
        error,
      );
    } finally {
      log.mockRestore();
    }
  });

  it("checks presence from metadata and reads only the new candidate body before recovery", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(designMetadataQueryKey("d"), {
      files: [{ id: "old", filename: "old.html", fileType: "html" }],
    });
    const knownFileIds = captureDesignFileIds({
      queryClient,
      designId: "d",
      files: [],
    });
    queryClient.setQueryData(designMetadataQueryKey("d"), {
      files: [
        { id: "old", filename: "old.html", fileType: "html" },
        { id: "new", filename: "new.html", fileType: "html" },
      ],
    });
    const file = {
      id: "new",
      filename: "new.html",
      fileType: "html",
      content: "<p>hello</p>",
      updatedAt: "1",
    };
    mocks.read.mockImplementation(async (_name, args) => ({
      files: args.fileId
        ? [file]
        : [
            { id: "old", filename: "old.html", fileType: "html" },
            { id: "new", filename: "new.html", fileType: "html" },
          ],
    }));
    expect(
      await isPersistedFilePresent({
        queryClient,
        designId: "d",
        fileId: "new",
      }),
    ).toBe(true);
    expect(
      await reconcileCreatedFile({
        queryClient,
        designId: "d",
        filename: "new.html",
        fileType: "html",
        content: file.content,
        files: [],
        knownFileIds,
      }),
    ).toEqual(file);
    expect(mocks.read).toHaveBeenCalledWith(
      "get-design",
      { id: "d", fileId: "new" },
      { method: "GET" },
    );
  });
});
