/**
 * Behavior + drift guards for the skills-CLI telemetry sender.
 *
 * The standalone installer and `@agent-native/core` each ship their own copy of
 * `telemetry.ts` (skills can't depend on the heavyweight core), so the funnel
 * event contract — and therefore the analytics dashboard — only stays correct
 * if the two copies match. The drift guard fails CI if they diverge.
 */
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

/** Strip the leading block comment so the executable code can be compared. */
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

  it("falls back to the embedded public key when no env override is set", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-telemetry-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.AGENT_NATIVE_TELEMETRY_DISABLED;
    // Force the non-test gate off so the embedded default decides whether it sends.
    process.env.NODE_ENV = "production";
    const telemetry = createCliTelemetry({
      cli: "skills-installer",
      cliVersion: "9.9.9",
      command: "add",
      interactive: false,
    });
    telemetry.track("skills_cli started");
    await telemetry.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://analytics.agent-native.com/track");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.publicKey).toBe("anpk_unit_test_key");
    expect(body.event).toBe("skills_cli skills selected");
    expect(typeof body.sessionId).toBe("string");
    expect(body.anonymousId).toBe(body.properties.installId);
    expect(body.properties.cli).toBe("skills-installer");
    expect(body.properties.selectedCount).toBe(2);

    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("telemetry drift guard", () => {
  it("matches the @agent-native/core copy (ignoring the doc comment)", () => {
    if (!fs.existsSync(coreTelemetry)) {
      // Running outside the monorepo (published package) — nothing to compare.
      return;
    }
    const mine = executableSource(
      fs.readFileSync(path.join(here, "telemetry.ts"), "utf8"),
    );
    const theirs = executableSource(fs.readFileSync(coreTelemetry, "utf8"));
    expect(theirs).toBe(mine);
  });
});
