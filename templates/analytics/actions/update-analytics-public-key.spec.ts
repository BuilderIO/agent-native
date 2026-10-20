import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "member@example.com" as string | null,
  orgId: "org-1" as string | null,
  update: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/action")>();
  return { ...actual, defineAction: (definition: unknown) => definition };
});
vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getRequestOrgId: () => state.orgId,
    getRequestUserEmail: () => state.email,
  };
});
vi.mock("../server/lib/first-party-analytics.js", () => ({
  updateAnalyticsPublicKeyOrigins: state.update,
}));

const { default: updateAnalyticsPublicKey } =
  await import("./update-analytics-public-key");
const action = updateAnalyticsPublicKey as any;

describe("update-analytics-public-key", () => {
  beforeEach(() => {
    state.email = "member@example.com";
    state.orgId = "org-1";
    state.update.mockReset();
  });

  it("adds origins within the caller's active organization and returns safe metadata", async () => {
    state.update.mockResolvedValue({
      id: "apk-1",
      publicKeyPrefix: "anpk_safe",
      replayAllowedOrigins: [
        "https://clips.agent-native.com",
        "https://beta.clips.agent-native.com",
      ],
      addedOrigins: ["https://beta.clips.agent-native.com"],
      changed: true,
    });

    const result = await action.run({
      id: "apk-1",
      addReplayAllowedOrigins: ["https://beta.clips.agent-native.com"],
    });

    expect(state.update).toHaveBeenCalledWith(
      { userEmail: "member@example.com", orgId: "org-1" },
      "apk-1",
      ["https://beta.clips.agent-native.com"],
    );
    expect(result).not.toHaveProperty("publicKey");
    expect(result.replayAllowedOrigins).toContain(
      "https://clips.agent-native.com",
    );
  });

  it("rejects origins that are not exact HTTPS origins", () => {
    const parse = (origin: string) =>
      action.schema.safeParse({
        id: "apk-1",
        addReplayAllowedOrigins: [origin],
      });

    expect(parse("https://app.example.com").success).toBe(true);
    expect(parse("http://app.example.com").success).toBe(false);
    expect(parse("https://app.example.com/settings").success).toBe(false);
    expect(parse("https://app.example.com/?x=1").success).toBe(false);
  });

  it("requires a signed-in caller before reading or writing a key", async () => {
    state.email = null;

    await expect(
      action.run({
        id: "apk-1",
        addReplayAllowedOrigins: ["https://beta.clips.agent-native.com"],
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("does not report a key that is outside the caller's scope as accessible", async () => {
    state.update.mockResolvedValue(null);

    await expect(
      action.run({
        id: "other-org-key",
        addReplayAllowedOrigins: ["https://beta.clips.agent-native.com"],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
