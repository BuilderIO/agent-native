import { afterEach, describe, expect, it, vi } from "vitest";

import { readBuildRequiredEnv } from "./required-env-build.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readBuildRequiredEnv", () => {
  it("reads nothing when the build never embedded a value", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", undefined);
    expect(readBuildRequiredEnv()).toEqual([]);

    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", "");
    expect(readBuildRequiredEnv()).toEqual([]);
  });

  it("reads the names the build embedded", () => {
    vi.stubEnv(
      "AGENT_NATIVE_BUILD_REQUIRED_ENV",
      JSON.stringify(["NOTION_API_KEY", "GOOGLE_CLIENT_ID"]),
    );
    expect(readBuildRequiredEnv()).toEqual([
      "NOTION_API_KEY",
      "GOOGLE_CLIENT_ID",
    ]);
  });

  it("throws on a value that is not a list of names", () => {
    for (const raw of ["not json", '"NOTION_API_KEY"', "[1]", "{}"]) {
      vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", raw);
      expect(() => readBuildRequiredEnv()).toThrow(
        /Invalid embedded AGENT_NATIVE_BUILD_REQUIRED_ENV value/,
      );
    }
  });
});
