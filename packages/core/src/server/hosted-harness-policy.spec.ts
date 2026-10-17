import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOrgSettingMock } = vi.hoisted(() => ({
  getOrgSettingMock: vi.fn(),
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: (...args: unknown[]) => getOrgSettingMock(...args),
}));

import {
  isHostedHarnessEnvEnabled,
  loadHostedHarnessConfig,
  resolveHostedHarnessPolicy,
} from "./hosted-harness-policy.js";

describe("loadHostedHarnessConfig", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the build-embedded value over a missing config file", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "hosted-harness-config-"),
    );
    temporaryRoots.push(root);
    vi.stubEnv(
      "AGENT_NATIVE_BUILD_HARNESS",
      JSON.stringify({ runtimes: ["codex"] }),
    );

    await expect(loadHostedHarnessConfig(root)).resolves.toEqual({
      runtimes: ["codex"],
    });
  });

  it("falls back to a disk read when the build recorded nothing", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "hosted-harness-config-"),
    );
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.mts"),
      `export default ${JSON.stringify({ harness: true })};\n`,
    );
    vi.stubEnv("AGENT_NATIVE_BUILD_HARNESS", undefined);

    await expect(loadHostedHarnessConfig(root)).resolves.toBe(true);
  });
});

describe("hosted harness environment gate", () => {
  beforeEach(() => {
    getOrgSettingMock.mockReset();
    vi.stubEnv("AGENT_NATIVE_HOSTED_HARNESS", "false");
  });

  it.each(["1", "true", "yes", "on"])("accepts %s", (value) => {
    expect(
      isHostedHarnessEnvEnabled({ AGENT_NATIVE_HOSTED_HARNESS: value }),
    ).toBe(true);
  });

  it.each([undefined, "0", "false", "off", "no"])("rejects %s", (value) => {
    expect(
      isHostedHarnessEnvEnabled({ AGENT_NATIVE_HOSTED_HARNESS: value }),
    ).toBe(false);
  });

  it("uses one organization boolean as the per-org opt-in", async () => {
    getOrgSettingMock.mockResolvedValue({ enabled: true });

    await expect(
      resolveHostedHarnessPolicy({
        config: true,
        orgId: "org-1",
        userEmail: "owner@example.com",
      }),
    ).resolves.toMatchObject({
      enabled: true,
      configEnabled: true,
      envEnabled: false,
      organizationEnabled: true,
      runtimes: ["claude-code", "codex", "pi", "opencode"],
    });
    expect(getOrgSettingMock).toHaveBeenCalledWith(
      "org-1",
      "agent-harness.enabled",
    );
  });

  it("defaults every organization on when the deployment flag is enabled", async () => {
    vi.stubEnv("AGENT_NATIVE_HOSTED_HARNESS", "true");

    await expect(
      resolveHostedHarnessPolicy({
        config: { runtimes: ["codex"] },
        orgId: "org-1",
      }),
    ).resolves.toMatchObject({
      enabled: true,
      configEnabled: true,
      envEnabled: true,
      organizationEnabled: true,
      runtimes: ["codex"],
    });
    expect(getOrgSettingMock).toHaveBeenCalledWith(
      "org-1",
      "agent-harness.enabled",
    );
  });

  it("does not enable an opted-in app without an org or env gate", async () => {
    await expect(
      resolveHostedHarnessPolicy({ config: { runtimes: ["codex"] } }),
    ).resolves.toMatchObject({
      enabled: false,
      configEnabled: true,
      organizationEnabled: false,
      runtimes: ["codex"],
    });
    expect(getOrgSettingMock).not.toHaveBeenCalled();
  });
});
