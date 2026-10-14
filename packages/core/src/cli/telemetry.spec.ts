import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCliTelemetry } from "./telemetry.js";

function sentExceptions(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    .filter((body) => body.event === "$exception");
}

describe("CLI telemetry exceptions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-telemetry-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DO_NOT_TRACK", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DISABLED", "");
    fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function telemetry() {
    return createCliTelemetry({
      cli: "core",
      cliVersion: "0.9.1",
      command: "build",
      interactive: false,
    });
  }

  it("never reports the fuzz harness's intercepted process.exit", () => {
    const cli = telemetry();
    const fuzz = new Error("fuzz-intercepted-process-exit");
    fuzz.stack =
      "Error: fuzz-intercepted-process-exit\n    at process.fuzzInterceptedProcessExit [as exit] (fuzz-exports.js:98:9)";

    cli.captureException(fuzz, { handled: false });

    expect(sentExceptions(fetchMock)).toHaveLength(0);
  });

  it("still reports a real CLI failure, stamped with the CLI release", () => {
    const cli = telemetry();

    cli.captureException(new Error('Build step "deploy-build" failed'), {
      handled: false,
      tags: { source: "build-step" },
      extra: { stderrTail: "error: nope" },
    });

    const [event] = sentExceptions(fetchMock);
    expect(event.properties).toMatchObject({
      exceptionMessage: 'Build step "deploy-build" failed',
      release: "agent-native-cli@0.9.1",
      exceptionTags: { source: "build-step" },
      exceptionExtra: { stderrTail: "error: nope" },
    });
  });
});
