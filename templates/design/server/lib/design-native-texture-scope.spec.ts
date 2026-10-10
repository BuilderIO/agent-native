import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  accessFilter: vi.fn(() => ({ scoped: true })),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  resolveAccess: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...terms) => terms),
  eq: vi.fn((left, right) => [left, right]),
  inArray: vi.fn((left, right) => [left, right]),
  like: vi.fn((left, right) => [left, right]),
  or: vi.fn((...terms) => terms),
  sql: Object.assign(
    vi.fn(() => ({ expression: true })),
    {},
  ),
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    designs: { id: "designs.id" },
    designShares: {},
    designFiles: {
      id: "files.id",
      designId: "files.designId",
      fileType: "files.fileType",
      content: "files.content",
    },
  },
}));
vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class extends Error {},
  readUploadedFile: vi.fn(),
}));

import {
  findReadableNativeTextureBoundFile,
  verifiedNativeTextureSourceReferences,
} from "./design-native-texture-assets";

const path =
  "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png";

function queryResult(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  };
}

describe("native texture scoped file lookup", () => {
  it("normalizes malformed native manifests into a classified asset failure", () => {
    expect(() =>
      verifiedNativeTextureSourceReferences(
        "html",
        '<script type="application/x-agent-native-effects">{broken</script>',
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "DesignNativeTextureAssetError",
        code: "invalid-reference",
      }),
    );
  });
  it("checks access in one metadata query before one bounded content read", async () => {
    mocks.select.mockReset();
    mocks.accessFilter.mockClear();
    mocks.select
      .mockReturnValueOnce(queryResult([{ id: "allowed" }]))
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "allowed",
            fileId: "screen",
            byteLength: Buffer.byteLength(`<img src="${path}">`),
          },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "allowed",
            fileId: "screen",
            fileType: "html",
            content: `<img src="${path}">`,
          },
        ]),
      );
    const candidates = Array.from({ length: 256 }, (_, index) => ({
      designId: index === 255 ? "allowed" : `private-${index}`,
      fileId: index === 255 ? "screen" : `private-file-${index}`,
    }));
    const result = await findReadableNativeTextureBoundFile(candidates, path);
    expect(result?.fileId).toBe("screen");
    expect(mocks.accessFilter).toHaveBeenCalledTimes(1);
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      "viewer",
      { includePublic: true },
    );
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(mocks.select.mock.calls[0]?.[0]).toEqual({ id: "designs.id" });
    expect(mocks.select.mock.calls[1]?.[0]).not.toHaveProperty("content");
    expect(mocks.select.mock.calls[2]?.[0]).toHaveProperty("content");
  });

  it("never requests file content when access returns no readable Design", async () => {
    mocks.select.mockReset();
    mocks.select.mockReturnValueOnce(queryResult([]));
    expect(
      await findReadableNativeTextureBoundFile(
        [{ designId: "private", fileId: "file" }],
        path,
      ),
    ).toBeNull();
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("continues past a comment-only textual match to a later canonical source", async () => {
    mocks.select.mockReset();
    const comment = `<!-- ${path} -->`;
    const live = `<img src="${path}">`;
    mocks.select
      .mockReturnValueOnce(queryResult([{ id: "public-design" }]))
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "public-design",
            fileId: "a-comment",
            byteLength: Buffer.byteLength(comment),
          },
          {
            designId: "public-design",
            fileId: "b-live",
            byteLength: Buffer.byteLength(live),
          },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "public-design",
            fileId: "a-comment",
            fileType: "html",
            content: comment,
          },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "public-design",
            fileId: "b-live",
            fileType: "html",
            content: live,
          },
        ]),
      );
    expect(
      await findReadableNativeTextureBoundFile(
        [
          { designId: "public-design", fileId: "a-comment" },
          { designId: "public-design", fileId: "b-live" },
        ],
        path,
      ),
    ).toMatchObject({ fileId: "b-live" });
    expect(mocks.select).toHaveBeenCalledTimes(4);
  });

  it("reports the typed parse failure if no later authorized source is valid", async () => {
    mocks.select.mockReset();
    const comment = `<!-- ${path} -->`;
    mocks.select
      .mockReturnValueOnce(queryResult([{ id: "public-design" }]))
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "public-design",
            fileId: "a-comment",
            byteLength: Buffer.byteLength(comment),
          },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "public-design",
            fileId: "a-comment",
            fileType: "html",
            content: comment,
          },
        ]),
      );
    await expect(
      findReadableNativeTextureBoundFile(
        [{ designId: "public-design", fileId: "a-comment" }],
        path,
      ),
    ).rejects.toMatchObject({ code: "invalid-reference" });
  });

  it("charges actual grown source bytes against the aggregate read budget", async () => {
    mocks.select.mockReset();
    const grown = `<img src="${path}">` + "x".repeat(2_100_000);
    mocks.select
      .mockReturnValueOnce(queryResult([{ id: "allowed" }]))
      .mockReturnValueOnce(
        queryResult([
          { designId: "allowed", fileId: "a-grown", byteLength: 100 },
          { designId: "allowed", fileId: "b-later", byteLength: 2_100_000 },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            designId: "allowed",
            fileId: "a-grown",
            fileType: "html",
            content: grown,
          },
        ]),
      );
    await expect(
      findReadableNativeTextureBoundFile(
        [
          { designId: "allowed", fileId: "a-grown" },
          { designId: "allowed", fileId: "b-later" },
        ],
        path,
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect(mocks.select).toHaveBeenCalledTimes(3);
  });
});
