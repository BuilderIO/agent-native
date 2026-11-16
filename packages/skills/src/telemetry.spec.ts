import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCliTelemetry } from "./telemetry.js";

function pinHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  return home;
}

describe("createCliTelemetry", () => {
  const savedEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("never sends after telemetry disable in the core CLI", async () => {
    const home = pinHome();
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_unit_test_key";
    delete process.env.DO_NOT_TRACK;
    delete process.env.AGENT_NATIVE_TELEMETRY_DISABLED;
    fs.mkdirSync(path.join(home, ".agent-native"));
    fs.writeFileSync(
      path.join(home, ".agent-native", "telemetry.json"),
      JSON.stringify({ enabled: false }),
    );

    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });
    telemetry.track("skills_cli_started");
    telemetry.captureException(new Error("boom"));
    await telemetry.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("does not create an installation id until an event is tracked", () => {
    const home = pinHome();
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
    const home = pinHome();
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
    const home = pinHome();
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

  it("sends a private skill from a folder named like our catalog as custom", async () => {
    const home = pinHome();
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_unit_test_key";
    delete process.env.DO_NOT_TRACK;
    delete process.env.AGENT_NATIVE_TELEMETRY_DISABLED;
    delete process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT;
    const skill = path.join(home, "BuilderIO/skills/skills/acme-internal");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(
      path.join(skill, "SKILL.md"),
      "---\nname: acme-internal\ndescription: Private.\n---\n",
    );
    vi.spyOn(process, "cwd").mockReturnValue(home);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { runSkillsCli } = await import("./index.js");
    await runSkillsCli(["list", "--json"], { log: () => {} });

    const sent = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );
    const listed = sent.find((e) => e.event === "skills_cli skills listed");
    expect(listed.properties.available).toContain("custom");
    expect(JSON.stringify(sent)).not.toContain("acme-internal");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("posts a bounded exception event when a CLI command fails", async () => {
    const home = pinHome();
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
      extra: { durationMs: 1, attempt: 1 },
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
      exceptionExtra: { durationMs: 1 },
    });
    expect(body.properties.exceptionExtra).not.toHaveProperty("attempt");
    expect(body.properties.exceptionMessage).not.toContain("do-not-send");

    fs.rmSync(home, { recursive: true, force: true });
  });
});
