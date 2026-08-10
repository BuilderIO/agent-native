import { beforeEach, describe, expect, it, vi } from "vitest";

const featureFlagMocks = vi.hoisted(() => ({
  getRules: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/feature-flags", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/feature-flags")
  >("@agent-native/core/feature-flags");
  return {
    ...actual,
    getFeatureFlagRules: featureFlagMocks.getRules,
    isFeatureFlagEnabled: featureFlagMocks.isEnabled,
  };
});

vi.mock("@agent-native/core/a2a", () => ({ signA2AToken: vi.fn() }));
vi.mock("@agent-native/core/org", () => ({ getOrgDomain: vi.fn() }));
vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(() => ({ use: vi.fn() })),
  getSession: vi.fn(),
}));
vi.mock("@agent-native/core/shared", () => ({
  signInJourney: vi.fn(() => ({ signInHref: "/_agent-native/sign-in" })),
}));

const { canAttemptWorkspaceSso, isWorkspaceSsoEnabledForSession } =
  await import("./identity-sso.js");

describe("Desktop workspace SSO rollout availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.getRules.mockResolvedValue({
      version: 1,
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
      updatedAt: null,
      updatedBy: null,
    });
    featureFlagMocks.isEnabled.mockResolvedValue(false);
  });

  it.each([
    ["explicit off", { mode: "off" }],
    ["missing state", null],
    ["malformed state", { mode: "rules", emails: "alice@example.com" }],
  ])("fails closed for %s", async (_label, rules) => {
    featureFlagMocks.getRules.mockResolvedValue(rules);
    await expect(canAttemptWorkspaceSso()).resolves.toBe(false);
  });

  it("fails closed when rollout storage cannot be read", async () => {
    featureFlagMocks.getRules.mockRejectedValue(new Error("unavailable"));
    await expect(canAttemptWorkspaceSso()).resolves.toBe(false);
  });

  it("allows a ceremony attempt only when configured rules have a target", async () => {
    featureFlagMocks.getRules.mockResolvedValue({
      version: 1,
      mode: "rules",
      emails: ["alice@example.com"],
      orgIds: [],
      percentage: 0,
      updatedAt: 1,
      updatedBy: "operator@example.com",
    });
    await expect(canAttemptWorkspaceSso()).resolves.toBe(true);
  });

  it("evaluates the authenticated Dispatch identity without replacing auth", async () => {
    featureFlagMocks.isEnabled.mockResolvedValue(true);
    await expect(
      isWorkspaceSsoEnabledForSession({
        email: "alice@example.com",
        orgId: "org-1",
      } as never),
    ).resolves.toBe(true);
    expect(featureFlagMocks.isEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "desktop.workspace-sso" }),
      {
        userEmail: "alice@example.com",
        userKey: "alice@example.com",
        orgId: "org-1",
      },
    );
  });

  it("fails closed when authenticated evaluation errors", async () => {
    featureFlagMocks.isEnabled.mockRejectedValue(new Error("unavailable"));
    await expect(
      isWorkspaceSsoEnabledForSession({
        email: "alice@example.com",
      } as never),
    ).resolves.toBe(false);
  });
});
