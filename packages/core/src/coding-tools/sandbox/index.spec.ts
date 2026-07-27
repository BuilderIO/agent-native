import { afterEach, describe, expect, it } from "vitest";

import { createRunCodeEntry } from "../run-code.js";
import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
} from "./adapter.js";
import {
  LocalChildProcessAdapter,
  getSandboxAdapter,
  registerSandboxAdapter,
  resetSandboxAdapterForTests,
} from "./index.js";

afterEach(() => {
  resetSandboxAdapterForTests();
  delete process.env.AGENT_NATIVE_SANDBOX;
});

/** Minimal stub adapter that records the request and returns canned output. */
class StubAdapter implements SandboxAdapter {
  readonly id = "stub";
  lastRequest: SandboxRunRequest | undefined;
  constructor(private readonly result: SandboxRunResult) {}
  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    this.lastRequest = request;
    return this.result;
  }
}

describe("sandbox adapter selection", () => {
  it("returns the local child-process adapter by default", () => {
    const adapter = getSandboxAdapter();
    expect(adapter).toBeInstanceOf(LocalChildProcessAdapter);
    expect(adapter.id).toBe("local-child-process");
  });

  it("returns the same default adapter instance across calls", () => {
    expect(getSandboxAdapter()).toBe(getSandboxAdapter());
  });

  it("falls back to the local adapter for unknown AGENT_NATIVE_SANDBOX values", () => {
    process.env.AGENT_NATIVE_SANDBOX = "does-not-exist";
    expect(getSandboxAdapter()).toBeInstanceOf(LocalChildProcessAdapter);
  });

  it("uses the local adapter when AGENT_NATIVE_SANDBOX is explicitly 'local'", () => {
    process.env.AGENT_NATIVE_SANDBOX = "local";
    expect(getSandboxAdapter()).toBeInstanceOf(LocalChildProcessAdapter);
  });

  it("prefers a programmatically registered adapter over the default", () => {
    const stub = new StubAdapter({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    registerSandboxAdapter(stub);
    expect(getSandboxAdapter()).toBe(stub);
  });

  it("clears the registered adapter when passed null", () => {
    const stub = new StubAdapter({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    registerSandboxAdapter(stub);
    registerSandboxAdapter(null);
    expect(getSandboxAdapter()).toBeInstanceOf(LocalChildProcessAdapter);
  });
});

describe("run-code uses the active sandbox adapter", () => {
  const tool = {
    description: "test action",
    parameters: { type: "object", properties: {} },
  };

  it("routes execution through a registered adapter and receives its output", async () => {
    const stub = new StubAdapter({
      stdout: "hello from stub",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    registerSandboxAdapter(stub);

    const entry = createRunCodeEntry(() => ({}));
    const result = await entry.run({
      code: `console.log("ignored — stub returns canned output");`,
      timeoutMs: 5_000,
    });

    expect(result).toContain("hello from stub");
    // The adapter receives a prepared module + scrubbed env + bridge port.
    expect(stub.lastRequest).toBeDefined();
    expect(stub.lastRequest!.moduleSource).toContain("console.log");
    expect(stub.lastRequest!.bridgePort).toBeGreaterThan(0);
    expect(stub.lastRequest!.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(stub.lastRequest!.timeoutMs).toBe(5_000);
  });

  it("surfaces adapter exitCode and timedOut in the formatted result", async () => {
    registerSandboxAdapter(
      new StubAdapter({
        stdout: "",
        stderr: "boom",
        exitCode: 7,
        timedOut: true,
      }),
    );

    const entry = createRunCodeEntry(() => ({}));
    const result = await entry.run({
      code: `console.log("x");`,
      timeoutMs: 1_000,
    });

    expect(result).toContain("timedOut: true (1000ms)");
    expect(result).toContain("exitCode: 7");
    expect(result).toContain("stderr:\nboom");
  });
});

describe("LocalChildProcessAdapter preserves real execution behavior", () => {
  const adapter = new LocalChildProcessAdapter();

  it("runs a module, captures stdout, and exits cleanly", async () => {
    const result = await adapter.run({
      moduleSource: `console.log("sandbox-ok");`,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 30_000,
      bridgePort: 0,
    });

    expect(result.stdout).toContain("sandbox-ok");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("reports a non-zero exit code from the sandbox process", async () => {
    const result = await adapter.run({
      moduleSource: `console.error("nope"); process.exit(3);`,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 30_000,
      bridgePort: 0,
    });

    expect(result.stderr).toContain("nope");
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it("times out a long-running module", async () => {
    const result = await adapter.run({
      moduleSource: `await new Promise((r) => setTimeout(r, 60_000));`,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 500,
      bridgePort: 0,
    });

    expect(result.timedOut).toBe(true);
  });

  it("does not leak the parent's env (only the supplied scrubbed vars)", async () => {
    process.env.AN_SANDBOX_LEAK_PROBE = "should-not-be-visible";
    try {
      const result = await adapter.run({
        moduleSource: `console.log("leak=" + (process.env.AN_SANDBOX_LEAK_PROBE ?? "absent"));`,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 30_000,
        bridgePort: 0,
      });
      expect(result.stdout).toContain("leak=absent");
    } finally {
      delete process.env.AN_SANDBOX_LEAK_PROBE;
    }
  });
});
