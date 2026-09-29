import { describe, expect, it } from "vitest";

import {
  groupRecentPrompts,
  type RecentPromptEntry,
} from "./recent-prompt-groups.js";

const entry = (
  overrides: Partial<RecentPromptEntry> = {},
): RecentPromptEntry => ({
  id: 1,
  ownerEmail: "a@example.com",
  app: "analytics",
  label: "chat",
  model: "model-a",
  prompt: "Summarize usage",
  ...overrides,
});

describe("groupRecentPrompts", () => {
  it("keeps the newest matching prompt and counts its occurrences", () => {
    const newest = entry({ id: 2 });
    const older = entry({ id: 1, ownerEmail: "A@Example.com" });

    expect(groupRecentPrompts([newest, older])).toEqual([
      { entry: newest, count: 2 },
    ]);
  });

  it("keeps different owners, models, and uncaptured rows separate", () => {
    const entries = [
      entry(),
      entry({ id: 2, ownerEmail: "b@example.com" }),
      entry({ id: 3, model: "model-b" }),
      entry({ id: 4, prompt: null }),
      entry({ id: 5, prompt: null }),
    ];

    expect(groupRecentPrompts(entries)).toHaveLength(5);
  });
});
