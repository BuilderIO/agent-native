import { afterEach, describe, expect, it, vi } from "vitest";

import { readHostedHarnessBuildConfig } from "./hosted-harness-build-mode.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readHostedHarnessBuildConfig", () => {
  it("reports unrecorded when the build never embedded a value", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", undefined);
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: false,
      value: undefined,
    });

    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", "");
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: false,
      value: undefined,
    });
  });

  it('distinguishes a recorded "not configured" from unrecorded', () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", "null");
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: true,
      value: undefined,
    });
  });

  it("decodes a recorded boolean", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", "true");
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: true,
      value: true,
    });

    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", "false");
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: true,
      value: false,
    });
  });

  it("decodes a recorded runtimes object", () => {
    vi.stubEnv(
      "AGENT_NATIVE_BUILD_HARNESS",
      JSON.stringify({ runtimes: ["codex"] }),
    );
    expect(readHostedHarnessBuildConfig()).toEqual({
      recorded: true,
      value: { runtimes: ["codex"] },
    });
  });

  it("throws on an unparseable embedded value instead of returning undefined", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", "not json");
    expect(() => readHostedHarnessBuildConfig()).toThrow(
      /Invalid embedded AGENT_NATIVE_BUILD_HARNESS value/,
    );
  });

  it("throws on a recorded value of the wrong shape", () => {
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", JSON.stringify(["codex"]));
    expect(() => readHostedHarnessBuildConfig()).toThrow(
      /Invalid embedded AGENT_NATIVE_BUILD_HARNESS value/,
    );

    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", JSON.stringify("codex"));
    expect(() => readHostedHarnessBuildConfig()).toThrow(
      /Invalid embedded AGENT_NATIVE_BUILD_HARNESS value/,
    );
  });
});
