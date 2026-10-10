import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  userEmail: vi.fn(),
  upload: vi.fn(),
  providerRead: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  commit: vi.fn(),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: { errorCode?: string }) => {
    throw Object.assign(new Error(message), { errorCode: options.errorCode });
  },
}));
vi.mock("@agent-native/core/file-upload/actions/upload-image", () => ({
  default: { run: mocks.upload },
}));
vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class FileUploadReadError extends Error {},
  readUploadedFile: mocks.providerRead,
}));
vi.mock("../server/lib/design-native-texture-provider.js", () => ({
  NativeTextureProviderError: class NativeTextureProviderError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  readDesignNativeTextureProvider: mocks.providerRead,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.userEmail,
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select, insert: mocks.insert }),
  schema: {
    designs: {
      id: "designs.id",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
    },
    designNativeTextureAssets: {
      designId: "designId",
      fileId: "fileId",
      idempotencyKey: "idempotencyKey",
    },
  },
}));
vi.mock("../server/lib/design-native-texture-assets.js", () => ({
  MAX_DESIGN_NATIVE_TEXTURE_BYTES: 1_000_000,
  designNativeTextureMime: (value: string) =>
    value === "image/png" ? value : null,
  designNativeTexturePath: (id: string) =>
    `/api/design-native-texture/${id}.png`,
  validateDesignNativeTextureBytes: () => "same-digest",
}));
vi.mock("../server/lib/design-native-texture-commit.js", () => ({
  commitDesignNativeTextureRegistration: mocks.commit,
  NativeTextureCommitError: class NativeTextureCommitError extends Error {},
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.workspace,
}));

import { NativeTextureProviderError } from "../server/lib/design-native-texture-provider.js";
import action from "./upload-design-native-texture";

const bytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xq8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const data = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
const args = {
  designId: "design-a",
  fileId: "file-a",
  data,
  filename: "photo.png",
  idempotencyKey: "once",
};
const run = (
  action as unknown as { run: (args: typeof args) => Promise<unknown> }
).run;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({
    sourceType: "inline",
    canEdit: true,
    files: [{ id: "file-a", fileType: "html" }],
  });
  mocks.userEmail.mockReturnValue("editor@example.test");
  mocks.upload.mockImplementation(async (input: { cleanup?: string }) =>
    input.cleanup
      ? { released: true }
      : { url: "https://owned.example.test/photo.png" },
  );
  mocks.providerRead.mockResolvedValue({ mimeType: "image/png", data: bytes });
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () =>
          Promise.resolve(
            mocks.select.mock.calls.length === 1
              ? [{ ownerEmail: "owner@example.test", orgId: "org-a" }]
              : mocks.select.mock.calls.length === 2
                ? []
                : [
                    {
                      id: "stored-id",
                      sha256: "same-digest",
                      mimeType: "image/png",
                      providerUrl: "https://owned.example.test/photo.png",
                    },
                  ],
          ),
      }),
    }),
  }));
  mocks.commit.mockResolvedValue({ id: "stored-id", sameProviderObject: true });
  mocks.values.mockImplementation(() => ({
    onConflictDoNothing: () => Promise.resolve(),
  }));
  mocks.insert.mockImplementation(() => ({ values: mocks.values }));
});

describe("Design-scoped native texture upload", () => {
  it("refuses a different Design role or file before provider upload", async () => {
    mocks.workspace.mockResolvedValueOnce({
      sourceType: "inline",
      canEdit: false,
      files: [{ id: "file-a", fileType: "html" }],
    });
    await expect(run(args)).rejects.toMatchObject({
      errorCode: "native_texture_forbidden",
    });
    mocks.workspace.mockResolvedValueOnce({
      sourceType: "inline",
      canEdit: true,
      files: [{ id: "file-b", fileType: "html" }],
    });
    await expect(run(args)).rejects.toMatchObject({
      errorCode: "native_texture_file_not_found",
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("commits only provider-verified bytes in one durable transaction", async () => {
    expect(await run(args)).toEqual({
      url: "/api/design-native-texture/stored-id.png",
      id: "stored-id",
      sha256: "same-digest",
    });
    expect(mocks.providerRead).toHaveBeenCalledWith(
      "https://owned.example.test/photo.png",
      "editor@example.test",
      1_000_000,
    );
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.test",
        orgId: "org-a",
        providerUrl: "https://owned.example.test/photo.png",
      }),
    );
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("deletes a losing concurrent provider object while returning the winning row", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              mocks.select.mock.calls.length === 1
                ? [{ ownerEmail: "owner@example.test", orgId: "org-a" }]
                : mocks.select.mock.calls.length === 2
                  ? []
                  : [
                      {
                        id: "winner",
                        sha256: "same-digest",
                        mimeType: "image/png",
                        providerUrl: "https://owned.example.test/winner.png",
                      },
                    ],
            ),
        }),
      }),
    }));
    mocks.upload.mockImplementation(async (input: { cleanup?: string }) =>
      input.cleanup === "delete"
        ? { deleted: true }
        : { url: "https://owned.example.test/loser.png" },
    );
    mocks.commit.mockResolvedValueOnce({
      id: "winner",
      sameProviderObject: false,
    });
    expect(await run(args)).toMatchObject({
      url: "/api/design-native-texture/winner.png",
    });
    expect(mocks.upload.mock.calls.at(-1)?.[0]).toMatchObject({
      cleanup: "delete",
    });
  });

  it("reports a losing upload cleanup failure while leaving its staged receipt for expiry cleanup", async () => {
    mocks.commit.mockResolvedValueOnce({
      id: "winner",
      sameProviderObject: false,
    });
    mocks.upload.mockImplementation(async (input: { cleanup?: string }) =>
      input.cleanup === "delete"
        ? { deleted: false }
        : { url: "https://owned.example.test/loser.png" },
    );
    await expect(run(args)).rejects.toMatchObject({
      errorCode: "native_texture_commit_failed",
    });
    expect(mocks.upload.mock.calls.at(-1)?.[0]).toMatchObject({
      cleanup: "delete",
    });
  });

  it("returns the same committed reference on a matching retry without touching the receipt", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              mocks.select.mock.calls.length === 1
                ? [{ ownerEmail: "owner@example.test", orgId: "org-a" }]
                : [
                    {
                      id: "stored-id",
                      sha256: "same-digest",
                      mimeType: "image/png",
                    },
                  ],
            ),
        }),
      }),
    }));
    mocks.upload.mockResolvedValue({ alreadyMissing: true });
    expect(await run(args)).toEqual({
      url: "/api/design-native-texture/stored-id.png",
      id: "stored-id",
      sha256: "same-digest",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects images larger than the shared 1 MB exportable asset limit before provider upload", async () => {
    const tooLarge = `data:image/png;base64,${Buffer.alloc(1_000_001).toString("base64")}`;
    await expect(run({ ...args, data: tooLarge })).rejects.toMatchObject({
      errorCode: "native_texture_limit",
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("refuses changed provider bytes and malformed local QA references", async () => {
    mocks.providerRead.mockResolvedValueOnce({
      mimeType: "image/png",
      data: new Uint8Array(3),
    });
    await expect(run(args)).rejects.toMatchObject({
      errorCode: "native_texture_mismatch",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.select.mockClear();
    mocks.upload.mockResolvedValueOnce({
      url: "/api/qa-figma-import-assets/fake.png",
    });
    mocks.providerRead.mockRejectedValueOnce(
      new NativeTextureProviderError(
        "invalid-reference",
        "Malformed local QA texture URL",
      ),
    );
    await expect(run(args)).rejects.toMatchObject({
      errorCode: "native_texture_invalid_reference",
    });
  });
});
