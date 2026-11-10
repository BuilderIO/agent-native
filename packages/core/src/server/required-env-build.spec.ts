import { afterEach, describe, expect, it, vi } from "vitest";

import { readRequiredEnvBuildConfig } from "./required-env-build.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readRequiredEnvBuildConfig", () => {
  it("reports nothing recorded when the build never embedded a value", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", undefined);
    expect(readRequiredEnvBuildConfig()).toEqual({
      recorded: false,
      names: [],
    });

    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", "");
    expect(readRequiredEnvBuildConfig()).toEqual({
      recorded: false,
      names: [],
    });
  });

  it("reads the names the build embedded, including an empty list", () => {
    vi.stubEnv(
      "AGENT_NATIVE_BUILD_REQUIRED_ENV",
      JSON.stringify(["NOTION_API_KEY", "GOOGLE_CLIENT_ID"]),
    );
    expect(readRequiredEnvBuildConfig()).toEqual({
      recorded: true,
      names: ["NOTION_API_KEY", "GOOGLE_CLIENT_ID"],
    });

    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", "[]");
    expect(readRequiredEnvBuildConfig()).toEqual({ recorded: true, names: [] });
  });

  it("throws on a value that is not a list of names", () => {
    for (const raw of ["not json", '"NOTION_API_KEY"', "[1]", "{}"]) {
      vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", raw);
      expect(() => readRequiredEnvBuildConfig()).toThrow(
        /Invalid embedded AGENT_NATIVE_BUILD_REQUIRED_ENV value/,
      );
    }
  });
});
