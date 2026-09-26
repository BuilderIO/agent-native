import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => {
  let current: Record<string, unknown> | null = null;
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
      current = await updater(copy(current));
      return structuredClone(current);
    },
  );

  return {
    getUserSetting,
    mutateUserSetting,
    read: () => copy(current),
    reset: () => {
      current = null;
    },
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: settings.getUserSetting,
  mutateUserSetting: settings.mutateUserSetting,
}));

import {
  getAiFilterState,
  recordAiFilterFeedback,
  recordAiFilterDecisions,
  saveAiFilterState,
} from "./ai-filter.js";
import type { AiFilterDecision } from "../../shared/ai-filter.js";

describe("AI filter settings persistence", () => {
  beforeEach(() => {
    settings.reset();
    vi.clearAllMocks();
  });

  it("applies a settings change without dropping decisions added after its read", async () => {
    const ownerEmail = "owner@example.test";
    const settingsSnapshot = await getAiFilterState(ownerEmail);
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

    const updated = await saveAiFilterState(ownerEmail, {
      ...settingsSnapshot,
      autoFilter: false,
    });

    expect(updated.autoFilter).toBe(false);
    expect(updated.decisions).toEqual([decision]);
    expect(settings.read()).toMatchObject({
      autoFilter: false,
      decisions: [decision],
    });
    expect(settings.mutateUserSetting).toHaveBeenCalledTimes(2);
  });

  it("preserves feedback recorded after the settings snapshot", async () => {
    const ownerEmail = "owner@example.test";
    const snapshot = await getAiFilterState(ownerEmail);

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
      ...snapshot,
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
});
