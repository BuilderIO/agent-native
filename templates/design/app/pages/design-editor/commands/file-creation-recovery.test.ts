import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { designMetadataQueryKey } from "../design-query-key";
import {
  captureDesignFileIds,
  createMayHaveSaved,
  findPersistedFile,
  isPersistedFilePresent,
  reconcileCreatedFile,
  savedFilenameFromResult,
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
      content: '<p data-agent-native-node-id="copy-a">hello</p>',
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

describe("file creation under a free name", () => {
  it("reads the saved name from the create result, falling back to the one asked for", () => {
    expect(
      savedFilenameFromResult(
        { filename: "home-copy-2.html" },
        "home-copy.html",
      ),
    ).toBe("home-copy-2.html");
    expect(savedFilenameFromResult({ id: "new" }, "home-copy.html")).toBe(
      "home-copy.html",
    );
    expect(savedFilenameFromResult(undefined, "home-copy.html")).toBe(
      "home-copy.html",
    );
  });

  it("recovers a lost create saved under a free name by its content, not another tab's copy", async () => {
    const queryClient = new QueryClient();
    const mine = {
      id: "mine",
      filename: "home-copy-2.html",
      fileType: "html" as const,
      content: '<p data-agent-native-node-id="copy-mine">mine</p>',
      createdAt: "1",
      updatedAt: "1",
    };
    const theirs = {
      ...mine,
      id: "theirs",
      filename: "home-copy.html",
      content: '<p data-agent-native-node-id="copy-theirs">theirs</p>',
    };
    const unrelated = {
      ...mine,
      id: "unrelated",
      filename: "home-copy-final.html",
    };
    queryClient.setQueryData(designMetadataQueryKey("d"), {
      files: [unrelated, theirs, mine].map(({ id, filename, fileType }) => ({
        id,
        filename,
        fileType,
      })),
    });
    mocks.read.mockClear();

    expect(
      await reconcileCreatedFile({
        queryClient,
        designId: "d",
        filename: "home-copy.html",
        fileType: "html",
        content: mine.content,
        files: [unrelated, theirs, mine],
        knownFileIds: new Set(),
      }),
    ).toEqual(mine);
  });
});

describe("file creation recovery without node ids", () => {
  // A URL-backed screen's markup has no node ids, so every copy of it is the
  // same and only a single new match can be this one's.
  const markup = "<main></main>";
  const copy = (id: string, filename: string) => ({
    id,
    filename,
    fileType: "html" as const,
    content: markup,
    updatedAt: "1",
  });

  function serve(files: ReturnType<typeof copy>[]) {
    mocks.read.mockReset();
    mocks.read.mockImplementation(async (_name, args) => ({
      files: args.fileId
        ? files.filter((file) => file.id === args.fileId)
        : files.map(({ id, filename, fileType }) => ({
            id,
            filename,
            fileType,
          })),
    }));
  }

  it("takes no file when two new copies match, and the one when only it does", async () => {
    const queryClient = new QueryClient();
    const recover = () =>
      reconcileCreatedFile({
        queryClient,
        designId: "d",
        filename: "home-copy.html",
        fileType: "html",
        content: markup,
        files: [],
        knownFileIds: new Set(["home"]),
      });

    serve([copy("theirs", "home-copy.html"), copy("mine", "home-copy-2.html")]);
    expect(await recover()).toBeUndefined();

    serve([copy("mine", "home-copy-2.html")]);
    expect(await recover()).toEqual(copy("mine", "home-copy-2.html"));
  });

  it("does not take a cached copy without asking the server", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(designMetadataQueryKey("d"), {
      files: [copy("theirs", "home-copy.html")],
    });
    serve([copy("theirs", "home-copy.html"), copy("mine", "home-copy-2.html")]);

    expect(
      await reconcileCreatedFile({
        queryClient,
        designId: "d",
        filename: "home-copy.html",
        fileType: "html",
        content: markup,
        files: [],
        knownFileIds: new Set(),
      }),
    ).toBeUndefined();
    expect(mocks.read).toHaveBeenCalled();
  });
});

describe("file creation outcomes", () => {
  it("counts a create as maybe saved unless the server refused it", () => {
    const withStatus = (status: number) =>
      Object.assign(new Error("failed"), { status });
    expect(createMayHaveSaved(new TypeError("Failed to fetch"))).toBe(true);
    expect(createMayHaveSaved(withStatus(408))).toBe(true);
    expect(createMayHaveSaved(withStatus(502))).toBe(true);
    expect(createMayHaveSaved(withStatus(400))).toBe(false);
    expect(createMayHaveSaved(withStatus(409))).toBe(false);
  });

  it("finds a saved file with the name it was saved under", async () => {
    mocks.read.mockReset();
    mocks.read.mockResolvedValue({
      files: [{ id: "mine", filename: "home-copy-2.html", fileType: "html" }],
    });
    const lookup = (fileId: string) =>
      findPersistedFile({
        queryClient: new QueryClient(),
        designId: "d",
        fileId,
      });

    expect(await lookup("mine")).toEqual({
      id: "mine",
      filename: "home-copy-2.html",
      fileType: "html",
    });
    expect(await lookup("gone")).toBeNull();
  });
});
