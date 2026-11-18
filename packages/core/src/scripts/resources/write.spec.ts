import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canWriteLocalWorkspaceResourcePath: vi.fn(),
  countSaveOutcome: vi.fn(),
  getOrgRoleForEmail: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourcePut: vi.fn(),
  resourcePutIfSnapshot: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  WORKSPACE_OWNER: "__workspace__",
  SHARED_OWNER: "__shared__",
  canWriteLocalWorkspaceResourcePath: mocks.canWriteLocalWorkspaceResourcePath,
  resourceGetByPath: mocks.resourceGetByPath,
  resourcePut: mocks.resourcePut,
  resourcePutIfSnapshot: mocks.resourcePutIfSnapshot,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: mocks.getOrgRoleForEmail,
}));

vi.mock("../../save-conflict/server.js", () => ({
  countSaveOutcome: mocks.countSaveOutcome,
}));

import { saveRevisionOf } from "../../save-conflict/index.js";
import { runWithRequestContext } from "../../server/request-context.js";
import resourceWriteScript from "./write.js";

const revisionOf = (content: string) => saveRevisionOf({ content });

function stored(content: string, owner = "alice@example.com") {
  return {
    id: "res-1",
    path: "notes/todo.md",
    owner,
    content,
    size: content.length,
    updatedAt: 1000,
  };
}

async function write(args: string[], orgId?: string) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runWithRequestContext(
      { userEmail: "alice@example.com", ...(orgId ? { orgId } : {}) },
      () =>
        resourceWriteScript([
          "--path",
          "notes/todo.md",
          "--content",
          "mine",
          ...args,
        ]),
    );
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

describe("resource-write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWriteLocalWorkspaceResourcePath.mockResolvedValue(false);
    mocks.getOrgRoleForEmail.mockResolvedValue("admin");
    mocks.resourceGetByPath.mockReset().mockResolvedValue(null);
    mocks.resourcePutIfSnapshot.mockReset().mockResolvedValue(null);
    mocks.resourcePut.mockResolvedValue({
      path: "notes/todo.md",
      content: "hi",
      size: 2,
    });
  });

  it("rejects shared writes by an organization member", async () => {
    mocks.getOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "org-1" },
        () =>
          resourceWriteScript([
            "--path",
            "notes/todo.md",
            "--content",
            "hi",
            "--scope",
            "shared",
          ]),
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can edit organization files",
    );

    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("writes shared resources to the active organization owner", async () => {
    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        resourceWriteScript([
          "--path",
          "notes/todo.md",
          "--content",
          "hi",
          "--scope",
          "shared",
        ]),
    );

    expect(mocks.getOrgRoleForEmail).toHaveBeenCalledWith(
      "org-1",
      "alice@example.com",
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "__organization__:org-1",
      "notes/todo.md",
      "hi",
      "text/markdown",
    );
  });

  it("prints the revision of what it wrote", async () => {
    const out = await write([]);

    expect(out).toContain(`revision ${revisionOf("hi")}`);
  });

  describe("with --expected-revision", () => {
    it("writes over the version it read", async () => {
      const old = stored("old");
      mocks.resourceGetByPath.mockResolvedValue(old);
      mocks.resourcePutIfSnapshot.mockResolvedValue({
        resource: stored("mine"),
      });

      const out = await write(["--expected-revision", revisionOf("old")]);

      expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
        "alice@example.com",
        "notes/todo.md",
        undefined,
      );
      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledExactlyOnceWith({
        previous: old,
        owner: "alice@example.com",
        path: "notes/todo.md",
        content: "mine",
        mimeType: "text/markdown",
        options: {},
      });
      expect(mocks.resourcePut).not.toHaveBeenCalled();
      expect(mocks.countSaveOutcome).toHaveBeenCalledWith(
        "resource_content",
        "written",
      );
      expect(out).toContain(`revision ${revisionOf("mine")}`);
    });

    it("passes where the file shows to the guarded write", async () => {
      mocks.resourceGetByPath.mockResolvedValue(stored("old"));
      mocks.resourcePutIfSnapshot.mockResolvedValue({
        resource: stored("mine"),
      });

      await write([
        "--expected-revision",
        revisionOf("old"),
        "--visibility",
        "workspace",
      ]);

      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ visibility: "workspace" }),
        }),
      );
    });

    it("refuses to write over a newer save and names its revision", async () => {
      mocks.resourceGetByPath.mockResolvedValue(stored("theirs"));

      const error = await write([
        "--expected-revision",
        revisionOf("old"),
      ]).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        errorCode: "save_conflict",
        statusCode: 409,
        details: { currentRevision: revisionOf("theirs") },
      });
      expect((error as Error).message).not.toContain("theirs");
      expect((error as Error).message).toContain(revisionOf("theirs"));
      expect(mocks.resourcePutIfSnapshot).not.toHaveBeenCalled();
      expect(mocks.resourcePut).not.toHaveBeenCalled();
      expect(mocks.countSaveOutcome).toHaveBeenCalledWith(
        "resource_content",
        "conflict",
      );
    });

    it("lets a repeat of a write that landed through, with its options", async () => {
      const landed = stored("mine");
      mocks.resourceGetByPath.mockResolvedValue(landed);
      mocks.resourcePutIfSnapshot.mockResolvedValue({ resource: landed });

      const out = await write([
        "--expected-revision",
        revisionOf("old"),
        "--visibility",
        "workspace",
      ]);

      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          previous: landed,
          content: "mine",
          options: { visibility: "workspace" },
        }),
      );
      expect(mocks.countSaveOutcome).toHaveBeenCalledWith(
        "resource_content",
        "written",
      );
      expect(out).toContain(`revision ${revisionOf("mine")}`);
    });

    it("takes a repeat whose writes keep losing as done", async () => {
      mocks.resourceGetByPath.mockResolvedValue(stored("mine"));

      const out = await write(["--expected-revision", revisionOf("old")]);

      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledTimes(2);
      expect(mocks.countSaveOutcome).toHaveBeenCalledWith(
        "resource_content",
        "already_applied",
      );
      expect(out).toContain(`revision ${revisionOf("mine")}`);
    });

    it("refuses when the file was deleted after the read", async () => {
      await expect(
        write(["--expected-revision", revisionOf("old")]),
      ).rejects.toMatchObject({
        errorCode: "save_conflict",
        details: { current: null, currentRevision: null },
      });
      expect(mocks.resourcePutIfSnapshot).not.toHaveBeenCalled();
      expect(mocks.resourcePut).not.toHaveBeenCalled();
    });

    it("reads again when a save lands between its read and write", async () => {
      mocks.resourceGetByPath
        .mockResolvedValueOnce(stored("old"))
        .mockResolvedValueOnce(stored("theirs"));

      await expect(
        write(["--expected-revision", revisionOf("old")]),
      ).rejects.toMatchObject({
        errorCode: "save_conflict",
        details: { currentRevision: revisionOf("theirs") },
      });
      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledOnce();
    });

    it("gives up with the revision there when the file keeps changing", async () => {
      mocks.resourceGetByPath.mockResolvedValue(stored("old"));

      const error = await write([
        "--expected-revision",
        revisionOf("old"),
      ]).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        errorCode: "save_conflict",
        details: { currentRevision: revisionOf("old") },
      });
      expect((error as Error).message).toContain(revisionOf("old"));
      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledTimes(2);
    });

    it("refuses a workspace file a workspace write can't change", async () => {
      mocks.canWriteLocalWorkspaceResourcePath.mockResolvedValue(true);
      mocks.resourceGetByPath.mockResolvedValue(
        stored("old", "__workspace__:__organization__:org-1"),
      );

      await expect(
        write(
          ["--scope", "workspace", "--expected-revision", revisionOf("old")],
          "org-1",
        ),
      ).rejects.toThrow("isn't the copy a workspace write changes");
      expect(mocks.resourcePutIfSnapshot).not.toHaveBeenCalled();
      expect(mocks.resourcePut).not.toHaveBeenCalled();
    });

    it("makes the organization's own copy of a shared file from before organizations", async () => {
      const legacy = stored("old", "__shared__");
      mocks.resourceGetByPath.mockImplementation(async (owner: string) =>
        owner === "__shared__" ? legacy : null,
      );
      mocks.resourcePutIfSnapshot.mockResolvedValue({
        resource: stored("mine", "__organization__:org-1"),
      });

      await write(
        ["--scope", "shared", "--expected-revision", revisionOf("old")],
        "org-1",
      );

      expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
        "__organization__:org-1",
        "notes/todo.md",
        { orgId: "org-1" },
      );
      expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          previous: null,
          owner: "__organization__:org-1",
          content: "mine",
        }),
      );
    });

    it("rejects a blank revision", async () => {
      await expect(write(["--expected-revision", " "])).rejects.toThrow(
        "--expected-revision must be the revision from your read.",
      );
      expect(mocks.resourcePut).not.toHaveBeenCalled();
    });
  });
});
