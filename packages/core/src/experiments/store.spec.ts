import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setUserLabStates: vi.fn() }));

vi.mock("../labs/registry.js", () => ({
  getLabDefinition: (key: string) =>
    key === "clips.editor" ? { key } : undefined,
}));
vi.mock("../labs/store.js", () => ({
  getUserLabs: vi.fn(),
  normalizeLabValues: vi.fn(),
  setUserLabStates: mocks.setUserLabStates,
}));

import { setUserExperiment } from "./store.js";

beforeEach(() => {
  mocks.setUserLabStates.mockReset();
});

describe("setUserExperiment compatibility adapter", () => {
  it("returns successful booleans when another Lab has a corrupt choice", async () => {
    mocks.setUserLabStates.mockResolvedValue({
      "clips.editor": { enabled: true, source: "choice", mixed: false },
      "clips.meetings": { error: "invalid-choice" },
    });

    await expect(
      setUserExperiment("alice@example.com", "clips.editor", true),
    ).resolves.toEqual({ "clips.editor": true });
  });

  it("rejects when the requested Lab itself is unreadable", async () => {
    mocks.setUserLabStates.mockResolvedValue({
      "clips.editor": { error: "legacy-unavailable" },
      "clips.meetings": { enabled: false, source: "default", mixed: false },
    });

    await expect(
      setUserExperiment("alice@example.com", "clips.editor", true),
    ).rejects.toThrow("Could not resolve saved lab state: clips.editor");
  });
});
