import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_SERVER_READY_FILE_ENV, markDevServerReady } from "./process.js";

type ActivationTelemetry = typeof import("./activation-telemetry.js");

// The create run is one record per process, so each test gets its own.
async function freshModule(): Promise<ActivationTelemetry> {
  vi.resetModules();
  return import("./activation-telemetry.js");
}

describe("create outcome", () => {
  it("is completed only when create returned without cancelling", async () => {
    const m = await freshModule();
    m.noteCreateProject(["chat"], "standalone");
    m.noteCreateStep("scaffold");
    m.noteCreateStep("finish");
    m.noteCreateReturned();
    expect(m.createFinishedProperties(0)).toEqual({
      outcome: "completed",
      templates: "chat",
      projectKind: "standalone",
    });
  });

  it("is cancelled when a prompt exits with 0 before create returned", async () => {
    const m = await freshModule();
    expect(m.createFinishedProperties(0)).toEqual({ outcome: "cancelled" });
  });

  it("is cancelled when create returns from a cancel path", async () => {
    const m = await freshModule();
    m.noteCreateProject(["chat"], "workspace");
    m.noteCreateCancelled();
    m.noteCreateReturned();
    expect(m.createFinishedProperties(0).outcome).toBe("cancelled");
  });

  it("is failed on a non-zero exit, with the step it stopped at", async () => {
    const m = await freshModule();
    m.noteCreateProject(["chat"], "standalone");
    m.noteCreateStep("scaffold");
    expect(m.createFinishedProperties(1)).toEqual({
      outcome: "failed",
      templates: "chat",
      projectKind: "standalone",
      failedStep: "scaffold",
    });
  });

  it("starts at the choose step", async () => {
    const m = await freshModule();
    expect(m.createFinishedProperties(1)).toEqual({
      outcome: "failed",
      failedStep: "choose",
    });
  });
});

describe("template names", () => {
  it("passes our own names and fixed words", async () => {
    const m = await freshModule();
    expect(m.reportableTemplate("chat")).toBe("chat");
    expect(m.reportableTemplate("headless")).toBe("headless");
    expect(m.reportableTemplate("community")).toBe("community");
  });

  it.each([
    "https://github.com/acme/secret-template",
    "acme/secret-template",
    "my-private-app",
    "C:/Users/someone/template",
  ])("reports %s as unknown", async (name) => {
    const m = await freshModule();
    expect(m.reportableTemplate(name)).toBe("unknown");
    m.noteCreateProject(["chat", name]);
    expect(m.createFinishedProperties(1).templates).toBe("chat,unknown");
  });
});

describe("deploy outcome", () => {
  it.each([
    ["vercel", "vercel"],
    ["vercel_edge", "vercel"],
    ["netlify-edge", "netlify"],
    ["cloudflare_module", "cloudflare"],
    ["aws_lambda", "aws"],
    ["NODE_SERVER", "node"],
    ["vercel-static", "vercel"],
    ["node", "node"],
    ["awsome-host", "other"],
    ["nodejitsu", "other"],
    ["my-company-internal-host", "other"],
  ])("reports preset %s as %s", async (preset, reported) => {
    const m = await freshModule();
    expect(m.reportablePreset(preset)).toBe(reported);
  });

  it("keeps the event when the preset marker can't be read", async () => {
    const m = await freshModule();
    const preset = m.readPresetForReport(() => {
      throw new Error("Agent-Native Nitro preset marker is empty");
    });
    expect(
      m.deployFinishedProperties(0, { step: "vite-build", preset }),
    ).toEqual({ outcome: "completed" });
    expect(m.readPresetForReport(() => "vercel")).toBe("vercel");
    expect(m.readPresetForReport(() => undefined)).toBeUndefined();
  });

  it("assumes Node only for a build that finished", async () => {
    const m = await freshModule();
    expect(m.deployFinishedProperties(0, { step: "vite-build" })).toEqual({
      outcome: "completed",
      preset: "node",
    });
    expect(m.deployFinishedProperties(1, { step: "prepare" })).toEqual({
      outcome: "failed",
      failedStep: "prepare",
    });
  });

  it("keeps a known preset on failure", async () => {
    const m = await freshModule();
    expect(
      m.deployFinishedProperties(1, { step: "build", preset: "vercel" }),
    ).toEqual({ outcome: "failed", preset: "vercel", failedStep: "build" });
  });
});

describe("reportAtExit", () => {
  it("sends once, on exit, with the exit code", async () => {
    const m = await freshModule();
    const target = new EventEmitter();
    const telemetry = { trackAtExit: vi.fn() };
    m.reportAtExit(
      telemetry,
      "event",
      (code) => ({ code }),
      target as unknown as NodeJS.Process,
    );
    expect(telemetry.trackAtExit).not.toHaveBeenCalled();
    target.emit("exit", 3);
    target.emit("exit", 4);
    expect(telemetry.trackAtExit.mock.calls).toEqual([["event", { code: 3 }]]);
  });

  it("never lets telemetry change how a command ends", async () => {
    const m = await freshModule();
    const target = new EventEmitter();
    m.reportAtExit(
      {
        trackAtExit: () => {
          throw new Error("offline");
        },
      },
      "event",
      () => ({}),
      target as unknown as NodeJS.Process,
    );
    expect(() => target.emit("exit", 0)).not.toThrow();
  });
});

describe("startDevReadyReport", () => {
  let home: string;
  const files: string[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-ready-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DO_NOT_TRACK", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DISABLED", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const file of files.splice(0)) fs.rmSync(file, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("reports the first listen once, however many servers follow", async () => {
    const m = await freshModule();
    const telemetry = { track: vi.fn() };
    const env = m.startDevReadyReport(
      telemetry,
      { workspace: true, appCount: () => 4 },
      {},
    );
    const file = env[DEV_SERVER_READY_FILE_ENV] as string;
    files.push(file);

    vi.advanceTimersByTime(2_000);
    expect(telemetry.track).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500);
    markDevServerReady(env);
    const firstReady = fs.readFileSync(file, "utf8");
    vi.advanceTimersByTime(1_000);
    markDevServerReady(env);
    markDevServerReady(env);
    vi.advanceTimersByTime(5_000);

    expect(fs.readFileSync(file, "utf8")).toBe(firstReady);
    expect(telemetry.track.mock.calls).toEqual([
      ["cli_dev_ready", { workspace: true, appCount: 4, readySeconds: 3.5 }],
    ]);
  });

  it("keeps watching while the file has no time in it yet", async () => {
    const m = await freshModule();
    const telemetry = { track: vi.fn() };
    const env = m.startDevReadyReport(
      telemetry,
      { workspace: false, appCount: () => 1 },
      {},
    );
    const file = env[DEV_SERVER_READY_FILE_ENV] as string;
    files.push(file);

    fs.writeFileSync(file, "");
    vi.advanceTimersByTime(2_000);
    expect(telemetry.track).not.toHaveBeenCalled();

    fs.writeFileSync(file, String(Date.now()));
    vi.advanceTimersByTime(1_000);
    expect(telemetry.track).toHaveBeenCalledTimes(1);
    expect(telemetry.track.mock.calls[0][1].readySeconds).toBe(2);
  });

  it("leaves the environment alone when telemetry is off", async () => {
    vi.stubEnv("DO_NOT_TRACK", "1");
    const m = await freshModule();
    const env = {};
    expect(
      m.startDevReadyReport(
        { track: vi.fn() },
        { workspace: false, appCount: () => 1 },
        env,
      ),
    ).toBe(env);
  });

  it("leaves it to an outer agent-native dev already watching", async () => {
    const m = await freshModule();
    const telemetry = { track: vi.fn() };
    const env = { [DEV_SERVER_READY_FILE_ENV]: path.join(home, "outer") };
    expect(
      m.startDevReadyReport(
        telemetry,
        { workspace: false, appCount: () => 1 },
        env,
      ),
    ).toBe(env);
    markDevServerReady(env);
    vi.advanceTimersByTime(5_000);
    expect(telemetry.track).not.toHaveBeenCalled();
  });

  it("keeps a failure to send away from the dev server", async () => {
    const m = await freshModule();
    const env = m.startDevReadyReport(
      {
        track: () => {
          throw new Error("offline");
        },
      },
      { workspace: false, appCount: () => 1 },
      {},
    );
    files.push(env[DEV_SERVER_READY_FILE_ENV] as string);
    markDevServerReady(env);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
  });
});
