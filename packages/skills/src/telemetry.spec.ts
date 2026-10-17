import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCliTelemetry } from "./telemetry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const coreTelemetry = path.join(
  repoRoot,
  "packages",
  "core",
  "src",
  "cli",
  "telemetry.ts",
);

function executableSource(text: string): string {
  return text.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, "").trim();
}

describe("createCliTelemetry", () => {
  const savedEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  it("never sends when DO_NOT_TRACK is set", async () => {
    process.env.DO_NOT_TRACK = "1";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_test";
    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });
    telemetry.track("skills_cli started");
    await telemetry.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not create an installation id until an event is tracked", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_unit_test_key";

    createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });

    expect(
      fs.existsSync(path.join(home, ".agent-native", "installation-id")),
    ).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("falls back to the embedded public key when no env override is set", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.AGENT_NATIVE_TELEMETRY_DISABLED;
    process.env.NODE_ENV = "production";
    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });
    telemetry.track("skills_cli started");
    await telemetry.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(typeof body.publicKey).toBe("string");
    expect(body.publicKey.startsWith("anpk_")).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("posts a funnel event with the first-party shape when enabled", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_unit_test_key";
    delete process.env.DO_NOT_TRACK;
    delete process.env.AGENT_NATIVE_TELEMETRY_DISABLED;
    delete process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT;

    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: true,
    });
    telemetry.track("skills_cli skills selected", { selectedCount: 2 });
    await telemetry.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    const canonicalBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(url).toBe("https://analytics.agent-native.com/track");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.publicKey).toBe("anpk_unit_test_key");
    expect(body.event).toBe("skills_cli skills selected");
    expect(typeof body.sessionId).toBe("string");
    expect(body.anonymousId).toBe(body.properties.installId);
    expect(body.properties.cli).toBe("skills-installer");
    expect(body.properties.selectedCount).toBe(2);
    expect(canonicalBody.event).toBe("skills_cli_skills_selected");
    expect(canonicalBody.properties).toMatchObject({
      canonical_event_name: "skills_cli_skills_selected",
      legacy_event_name: "skills_cli skills selected",
    });

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("posts a bounded exception event when a CLI command fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_unit_test_key";

    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });
    const error = new Error("failed with token=do-not-send");
    telemetry.captureException(error, {
      handled: false,
      tags: { source: "command" },
      extra: { attempt: 1 },
    });
    await telemetry.flush();

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.event).toBe("$exception");
    expect(body.properties).toMatchObject({
      app: "agent-native-cli",
      runtime: "cli",
      handled: false,
      exceptionTags: { source: "command" },
      exceptionExtra: { attempt: 1 },
    });
    expect(body.properties.exceptionMessage).not.toContain("do-not-send");

    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("telemetry drift guard", () => {
  it("matches the @agent-native/core copy (ignoring the doc comment)", () => {
    if (!fs.existsSync(coreTelemetry)) {
      return;
    }
    const mine = executableSource(
      fs.readFileSync(path.join(here, "telemetry.ts"), "utf8"),
    );
    const theirs = executableSource(fs.readFileSync(coreTelemetry, "utf8"));
    expect(theirs).toBe(mine);
  });
});
