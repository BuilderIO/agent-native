import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyWithDelivery: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notifyWithDelivery: mocks.notifyWithDelivery,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

const { notifyGenerationRunFinished } =
  await import("./generation-run-notifications.js");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run_1",
    libraryId: "lib_1",
    prompt: "A red bicycle",
    mediaType: "video",
    status: "completed",
    error: null,
    ownerEmail: "Owner@Example.com",
    ...overrides,
  } as never;
}

describe("notifyGenerationRunFinished", () => {
  beforeEach(() => {
    mocks.notifyWithDelivery.mockReset().mockResolvedValue(undefined);
    mocks.getUserSetting.mockReset().mockResolvedValue(null);
  });

  it("does nothing when the run has no owner", async () => {
    const result = await notifyGenerationRunFinished(
      run({ ownerEmail: null }),
      "completed",
    );

    expect(result).toEqual({ status: "no-recipient", emailed: false });
    expect(mocks.notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("emails the requester when no preference is stored", async () => {
    const result = await notifyGenerationRunFinished(run(), "completed");

    expect(result).toEqual({ status: "notified", emailed: true });
    const [input, meta] = mocks.notifyWithDelivery.mock.calls[0];
    expect(meta).toEqual({ owner: "owner@example.com" });
    expect(input.channels).toEqual(["inbox", "email"]);
    expect(input.metadata.emailRecipients).toEqual(["owner@example.com"]);
    expect(input.severity).toBe("info");
  });

  it("keeps the inbox entry but skips email when opted out", async () => {
    mocks.getUserSetting.mockResolvedValue({ emailNotifications: false });

    const result = await notifyGenerationRunFinished(run(), "completed");

    expect(result).toEqual({ status: "notified", emailed: false });
    const [input] = mocks.notifyWithDelivery.mock.calls[0];
    expect(input.channels).toEqual(["inbox"]);
    expect(input.metadata.emailRecipients).toBeUndefined();
  });

  it("reports the failure reason on a failed run", async () => {
    await notifyGenerationRunFinished(
      run({ status: "failed", error: "Provider timed out" }),
      "failed",
    );

    const [input] = mocks.notifyWithDelivery.mock.calls[0];
    expect(input.severity).toBe("warning");
    expect(input.title).toBe("Generation failed");
    expect(input.body).toContain("Provider timed out");
  });

  it("does not turn a delivery failure into a thrown generation error", async () => {
    mocks.notifyWithDelivery.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyGenerationRunFinished(run(), "completed");

    expect(result).toEqual({ status: "notification-error", emailed: false });
  });
});
