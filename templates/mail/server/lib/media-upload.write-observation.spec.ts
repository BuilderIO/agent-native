import fs, { type Stats } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeMediaUpload } from "./media-upload.js";

// The dev-only local fallback writes to disk, so it reports that write before
// the first mkdir or writeFile. Production never reaches that write.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock("./upload-store.js", () => ({
  getStoredUpload: vi.fn(),
  putStoredUpload: vi.fn(),
}));

type WriteSpy = { mock: { invocationCallOrder: number[] } };

/** The save reported itself with `channel`, and before the first `write` call. */
function expectReportedBefore(write: WriteSpy, channel: string) {
  expect(write.mock.invocationCallOrder.length).toBeGreaterThan(0);
  expect(mocks.noteExternalWrite).toHaveBeenCalledWith(channel);
  expect(
    Math.min(...mocks.noteExternalWrite.mock.invocationCallOrder),
  ).toBeLessThan(Math.min(...write.mock.invocationCallOrder));
}

const upload = {
  ownerEmail: "owner@example.com",
  data: new Uint8Array([1, 2, 3]),
  filename: "upload-1.png",
  originalName: "photo.png",
};

describe("storeMediaUpload local fallback", () => {
  beforeEach(() => {
    mocks.uploadFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.noteExternalWrite.mockClear();
    mocks.uploadFile.mockReset();
  });

  it("reports the disk save before creating the folder and writing the file", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const mkdirSync = vi
      .spyOn(fs, "mkdirSync")
      .mockImplementation(() => undefined);
    const writeFileSync = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation(() => undefined);
    vi.spyOn(fs, "statSync").mockImplementation(
      () => ({ size: upload.data.byteLength }) as Stats,
    );

    const result = await storeMediaUpload(upload);

    expect(result.url).toBe("/api/media/upload-1.png");
    expectReportedBefore(mkdirSync, "local-disk");
    expectReportedBefore(writeFileSync, "local-disk");
    expect(Math.min(...mkdirSync.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...writeFileSync.mock.invocationCallOrder),
    );
  });

  it("throws the setup error before reporting anything in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mkdirSync = vi
      .spyOn(fs, "mkdirSync")
      .mockImplementation(() => undefined);
    const writeFileSync = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation(() => undefined);

    await expect(storeMediaUpload(upload)).rejects.toMatchObject({
      storageSetupRequired: true,
    });
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
