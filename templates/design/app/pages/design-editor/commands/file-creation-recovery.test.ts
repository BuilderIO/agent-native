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
