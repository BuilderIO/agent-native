import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAutomation: vi.fn(),
  requireOwnerEmail: vi.fn(),
  db: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/db/index.js", () => ({
  db: mocks.db,
  schema: {
    emailAutomations: {
      id: "id",
      ownerEmail: "owner_email",
      slug: "slug",
    },
  },
}));

vi.mock("../server/lib/email-automation.js", () => ({
  DEFAULT_AUTOMATION: {
    name: "Daily workspace digest",
    schedule: "Weekdays at 9:00 AM",
    recipient: "you@example.com",
    prompt: "Summarize workspace updates.",
  },
  DEFAULT_AUTOMATION_SLUG: "daily-digest",
  automationResponse: (automation: Record<string, unknown> | null) =>
    automation ? { ...automation, persisted: true } : { persisted: false },
  findAutomation: mocks.findAutomation,
  requireOwnerEmail: mocks.requireOwnerEmail,
}));

describe("update-email-automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerEmail.mockReturnValue("owner@example.com");
  });

  it("returns the winner when concurrent first saves hit the unique default", async () => {
    const concurrentWinner = {
      id: "winner",
      ownerEmail: "owner@example.com",
      slug: "daily-digest",
      name: "Daily workspace digest",
      schedule: "Weekdays at 9:00 AM",
      recipient: "owner@example.com",
      prompt: "Summarize updates",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    mocks.findAutomation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentWinner);
    const onConflictDoNothing = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    });
    mocks.db.mockReturnValue({
      insert: () => ({
        values: () => ({
          onConflictDoNothing,
        }),
      }),
    });

    const { default: action } = await import("./update-email-automation.js");
    const result = await action.run({
      name: "Updated digest",
      recipient: "owner@example.com",
      prompt: "Summarize updates",
    });

    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: ["owner_email", "slug"],
    });
    expect(result).toMatchObject({ id: "winner", persisted: true });
  });
});
