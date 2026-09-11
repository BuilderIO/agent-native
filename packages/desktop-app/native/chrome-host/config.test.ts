import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => mockedFs);

import {
  defaultNativeHostConfigPath,
  legacyNativeHostConfigPath,
  readNativeHostConfig,
} from "./config";

const config = {
  version: 1 as const,
  baseUrl: "http://127.0.0.1:43123",
  bearerToken: "example-browser-host-token-32-chars-long",
};

beforeEach(() => {
  mockedFs.readFile.mockReset();
  mockedFs.stat.mockReset();
});

describe("native host config", () => {
  it("falls back to the legacy path only when the canonical file is missing", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    mockedFs.stat
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ mode: 0o600 });
    mockedFs.readFile.mockResolvedValue(JSON.stringify(config));

    await expect(readNativeHostConfig()).resolves.toEqual(config);
    expect(mockedFs.stat).toHaveBeenNthCalledWith(
      1,
      defaultNativeHostConfigPath(),
    );
    expect(mockedFs.stat).toHaveBeenNthCalledWith(
      2,
      legacyNativeHostConfigPath(),
    );
  });

  it("does not fall back for an explicit path or an invalid canonical config", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    mockedFs.stat.mockRejectedValue(missing);

    await expect(
      readNativeHostConfig("/tmp/custom-native-host.json"),
    ).rejects.toBe(missing);
    expect(mockedFs.stat).toHaveBeenCalledTimes(1);

    mockedFs.stat.mockResolvedValue({ mode: 0o600 });
    mockedFs.readFile.mockResolvedValue('{"version":0}');
    await expect(readNativeHostConfig()).rejects.toThrow(
      "Native host config is invalid.",
    );
    expect(mockedFs.stat).toHaveBeenCalledTimes(2);
  });
});
