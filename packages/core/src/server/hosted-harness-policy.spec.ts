import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrgSettingMock } = vi.hoisted(() => ({
  getOrgSettingMock: vi.fn(),
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: (...args: unknown[]) => getOrgSettingMock(...args),
}));

import {
  isHostedHarnessEnvEnabled,
  resolveHostedHarnessPolicy,
} from "./hosted-harness-policy.js";

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
