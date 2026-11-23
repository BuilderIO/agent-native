import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalImportAssetPrivateBlobProvider,
  createLocalImportAssetUploadProvider,
} from "./local-import-asset-upload.js";

// The local QA providers write under a temp root. Their fs calls wrap the real
// functions, so each write still lands on disk and each one reports first.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    writeFile: vi.fn(actual.writeFile),
    rm: vi.fn(actual.rm),
  };
});

type WriteSpy = { mock: { invocationCallOrder: number[] } };

/** The save reported itself with `channel`, and before the first `write` call. */
function expectReportedBefore(write: WriteSpy, channel: string) {
  expect(write.mock.invocationCallOrder.length).toBeGreaterThan(0);
  expect(mocks.noteExternalWrite).toHaveBeenCalledWith(channel);
  expect(
    Math.min(...mocks.noteExternalWrite.mock.invocationCallOrder),
  ).toBeLessThan(Math.min(...write.mock.invocationCallOrder));
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OWNER = "owner@example.test";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "design-import-observed-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("local import-asset upload provider", () => {
  it("reports an image upload before creating its folder and writing the file", async () => {
    const provider = createLocalImportAssetUploadProvider({
      rootDir,
      enabled: () => true,
    });

    const result = await provider.upload({
      data: PNG_BYTES,
      mimeType: "image/png",
      ownerEmail: OWNER,
    });

    expect(result.url).toBe(`/api/qa-import-assets/${result.id}`);
    expectReportedBefore(vi.mocked(mkdir), "local-disk");
    expectReportedBefore(vi.mocked(writeFile), "local-disk");
    expect(Math.min(...vi.mocked(mkdir).mock.invocationCallOrder)).toBeLessThan(
      Math.min(...vi.mocked(writeFile).mock.invocationCallOrder),
    );
  });
});

describe("local import-asset private blob provider", () => {
  it("reports a blob put before creating its folder and writing the blob", async () => {
    const provider = createLocalImportAssetPrivateBlobProvider({
      rootDir,
      enabled: () => true,
    });

    const handle = await provider.put({
      data: PNG_BYTES,
      mimeType: "image/png",
    });

    expect(handle.provider).toBe("design-local-import-assets-private");
    expectReportedBefore(vi.mocked(mkdir), "local-disk");
    expectReportedBefore(vi.mocked(writeFile), "local-disk");
    expect(Math.min(...vi.mocked(mkdir).mock.invocationCallOrder)).toBeLessThan(
      Math.min(...vi.mocked(writeFile).mock.invocationCallOrder),
    );
  });

  it("reports a blob delete before removing the blob", async () => {
    const provider = createLocalImportAssetPrivateBlobProvider({
      rootDir,
      enabled: () => true,
    });
    const handle = await provider.put({
      data: PNG_BYTES,
      mimeType: "image/png",
    });
    vi.clearAllMocks();

    const deleted = await provider.delete(handle);

    expect(deleted).toEqual({ deleted: true, provider: handle.provider });
    expectReportedBefore(vi.mocked(rm), "local-disk");
    await expect(provider.read(handle)).rejects.toThrow();
  });
});
