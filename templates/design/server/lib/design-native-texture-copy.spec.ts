import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class FileUploadReadError extends Error {},
  readUploadedFile: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: vi.fn() }));
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: {
    designNativeTextureAssets: {},
    designNativeTextureObjects: {},
    designNativeTextureBindings: {},
    designFiles: {},
  },
}));

import { getDb } from "../db/index.js";
import {
  DesignNativeTextureAssetError,
  readDesignNativeTextureAsset,
  type BoundCandidate,
  type DesignNativeTextureReadDependencies,
} from "./design-native-texture-assets";
import { preflightNativeTextureGrants } from "./design-native-texture-bindings";
import { collectNativeTextureSourceReferences } from "./native-texture-source-references";

const id = "12345678-1234-4123-8123-123456789abc";
const path = `/api/design-native-texture/${id}.png`;
const bytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xq8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const shared = {
  id,
  providerUrl: "https://owned.example.test/image.png",
  uploaderEmail: "uploader@example.test",
  mimeType: "image/png",
  byteLength: bytes.byteLength,
  sha256,
  createdAt: null,
};
function dependencies(
  files: Array<{ designId: string; fileId: string; content: string }>,
  allowed: readonly string[],
): DesignNativeTextureReadDependencies {
  return {
    lookupAsset: vi.fn(async () => null),
    lookupSharedObject: vi.fn(async () => shared),
    boundCandidates: vi.fn(async () =>
      files.map(({ designId, fileId }) => ({ designId, fileId })),
    ),
    readMatchingBoundFile: vi.fn(
      async (candidates: readonly BoundCandidate[], searchedPath: string) => {
        const file = files.find(
          (item) =>
            allowed.includes(item.designId) &&
            candidates.some(
              (candidate) =>
                candidate.designId === item.designId &&
                candidate.fileId === item.fileId,
            ) &&
            item.content.includes(searchedPath),
        );
        return file ? { ...file, fileType: "html" } : null;
      },
    ),
    canReadDesign: vi.fn(async (designId) => allowed.includes(designId)),
    fileInDesign: vi.fn(async () => false),
    readProvider: vi.fn(async () => ({ mimeType: "image/png", data: bytes })),
  };
}
function code(error: unknown) {
  return error instanceof DesignNativeTextureAssetError ? error.code : null;
}

describe("copy-retained native texture access", () => {
  it("allows a copied Design after original deletion without provider duplication", async () => {
    const deps = dependencies(
      [
        {
          designId: "copied",
          fileId: "copied-screen",
          content: `<img src="${path}">`,
        },
      ],
      ["copied"],
    );
    expect(await readDesignNativeTextureAsset(path, 1_000_000, deps)).toEqual({
      mimeType: "image/png",
      bytes,
    });
    expect(deps.readProvider).toHaveBeenCalledTimes(1);
  });

  it("rejects a hostile pasted URL without a binding, removed live reference, and unrelated viewer", async () => {
    const noBinding = dependencies([], ["foreign"]);
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, noBinding),
    ).rejects.toSatisfy((error: unknown) => code(error) === "forbidden");
    expect(noBinding.readProvider).not.toHaveBeenCalled();

    const removed = dependencies(
      [
        {
          designId: "copied",
          fileId: "copied-screen",
          content: "<main>Empty</main>",
        },
      ],
      ["copied"],
    );
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, removed),
    ).rejects.toSatisfy((error: unknown) => code(error) === "forbidden");
    expect(removed.readProvider).not.toHaveBeenCalled();

    const foreign = dependencies(
      [
        {
          designId: "copied",
          fileId: "copied-screen",
          content: `<img src="${path}">`,
        },
      ],
      ["foreign"],
    );
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, foreign),
    ).rejects.toSatisfy((error: unknown) => code(error) === "forbidden");
    expect(foreign.readProvider).not.toHaveBeenCalled();
  });

  it("admits the original upload only after its exact file source contains the URL", async () => {
    const original = {
      designId: "source",
      fileId: "screen",
      content: "<main>Before upload attachment</main>",
    };
    const deps = dependencies([original], ["source"]);
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "forbidden");
    expect(deps.readProvider).not.toHaveBeenCalled();
    original.content = `<img src="${path}">`;
    expect(await readDesignNativeTextureAsset(path, 1_000_000, deps)).toEqual({
      mimeType: "image/png",
      bytes,
    });
    expect(deps.readProvider).toHaveBeenCalledTimes(1);
  });

  it("collects only supported exact refs and rejects a srcset URL instead of dropping it", () => {
    expect(
      collectNativeTextureSourceReferences(
        "html",
        `<style>.a{background:url('${path}')}</style>`,
      ),
    ).toEqual([path]);
    expect(() =>
      collectNativeTextureSourceReferences("html", `<img srcset="${path} 2x">`),
    ).toThrow();
  });

  it("accepts a fully parsed large authored source only when it has no private texture references", async () => {
    const largeSource = `<main>${"A".repeat(4_000_000)}</main>`;
    expect(Buffer.byteLength(largeSource)).toBeGreaterThan(4_000_000);
    expect(collectNativeTextureSourceReferences("html", largeSource)).toEqual(
      [],
    );
    vi.mocked(getDb).mockClear();
    expect(
      await preflightNativeTextureGrants({
        designId: "source",
        fileId: "large-screen",
        fileType: "html",
        content: largeSource,
      }),
    ).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
    expect(() =>
      collectNativeTextureSourceReferences(
        "html",
        largeSource.replace("</main>", `<img src="${path}"></main>`),
      ),
    ).toThrowError(/bounded private-reference size/);
    expect(() =>
      collectNativeTextureSourceReferences(
        "html",
        largeSource.replace("</main>", `<img srcset="${path} 2x"></main>`),
      ),
    ).toThrowError(/unsupported source form/);
    expect(() =>
      collectNativeTextureSourceReferences(
        "html",
        largeSource.replace(
          "</main>",
          `<script type="application/x-agent-native-effects">{broken</script></main>`,
        ),
      ),
    ).toThrowError(/unreadable|invalid/i);
    const largeCss = `${".card{color:blue}\n".repeat(240_000)}`;
    expect(Buffer.byteLength(largeCss)).toBeGreaterThan(4_000_000);
    expect(collectNativeTextureSourceReferences("css", largeCss)).toEqual([]);
    expect(() =>
      collectNativeTextureSourceReferences(
        "css",
        `${largeCss}.card{background:url('${path}')}`,
      ),
    ).toThrowError(/bounded private-reference size/);
  });
});
