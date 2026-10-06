import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => {
  let current: Record<string, unknown> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  const copy = (value: Record<string, unknown> | null) =>
    value === null ? null : structuredClone(value);
  const getUserSetting = vi.fn(async () => copy(current));
  const mutateUserSetting = vi.fn(
    async (
      _ownerEmail: string,
      _key: string,
      updater: (
        value: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => {
      const previous = mutationQueue;
      let release!: () => void;
      mutationQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        current = await updater(copy(current));
        return structuredClone(current);
      } finally {
        release();
      }
    },
  );

  return {
    getUserSetting,
    mutateUserSetting,
    read: () => copy(current),
    reset: () => {
      current = null;
      mutationQueue = Promise.resolve();
    },
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: settings.getUserSetting,
  mutateUserSetting: settings.mutateUserSetting,
}));

import type { AiFilterDecision } from "../../shared/ai-filter.js";
import {
  recordAiFilterFeedback,
  recordAiFilterDecisions,
  saveAiFilterState,
} from "./ai-filter.js";

describe("AI filter settings persistence", () => {
  beforeEach(() => {
    settings.reset();
    vi.clearAllMocks();
  });

  it("merges concurrent independent settings patches into the latest state", async () => {
    const ownerEmail = "owner@example.test";
    const decision: AiFilterDecision = {
      id: "decision-1",
      messageId: "message-1",
      sender: "updates@example.test",
      subject: "A new update",
      disposition: "filtered",
      source: "automatic",
      createdAt: 1,
    };

    await recordAiFilterDecisions(ownerEmail, [decision]);
    const [autoFilterUpdate, thresholdUpdate] = await Promise.all([
      saveAiFilterState(ownerEmail, { autoFilter: false }),
      saveAiFilterState(ownerEmail, { suggestionThreshold: 0.8 }),
    ]);

    expect(autoFilterUpdate.autoFilter).toBe(false);
    expect(thresholdUpdate.suggestionThreshold).toBe(0.8);
    expect(settings.read()).toMatchObject({
      autoFilter: false,
      suggestionThreshold: 0.8,
      decisions: [decision],
    });
    expect(settings.mutateUserSetting).toHaveBeenCalledTimes(3);
  });

  it("preserves feedback and decisions while updating requested settings", async () => {
    const ownerEmail = "owner@example.test";

    await recordAiFilterFeedback(ownerEmail, {
      targets: [
        {
          id: "message-2",
          sender: "person@example.test",
          subject: "Keep this",
        },
      ],
      disposition: "not_spam",
    });

    const updated = await saveAiFilterState(ownerEmail, {
      suggestionThreshold: 0.8,
    });

    expect(updated.suggestionThreshold).toBe(0.8);
    expect(updated.feedback).toHaveLength(1);
    expect(updated.feedback[0]).toMatchObject({
      disposition: "not_spam",
      sender: "person@example.test",
      subject: "Keep this",
    });
    expect(updated.decisions).toHaveLength(1);
    expect(updated.decisions[0]).toMatchObject({
      messageId: "message-2",
      disposition: "kept",
    });
  });

  it("rejects invalid setting patches without writing them", async () => {
    await expect(
      saveAiFilterState("owner@example.test", {
        suggestionThreshold: 1.2,
      }),
    ).rejects.toThrow("Invalid AI filter settings.");
    await expect(
      saveAiFilterState("owner@example.test", {
        labelName: "custom-label",
      } as never),
    ).rejects.toThrow("Invalid AI filter settings.");

    expect(settings.mutateUserSetting).not.toHaveBeenCalled();
  });
});
