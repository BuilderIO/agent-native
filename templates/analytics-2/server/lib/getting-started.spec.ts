import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listThreads: vi.fn(),
  registered: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/server", () => ({
  listThreads: state.listThreads,
}));
vi.mock("@agent-native/core/onboarding", () => ({
  registerOnboardingStep: (step: Record<string, unknown>) =>
    state.registered.push(step),
}));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../model/database.js", () => ({
  ensureAnalyticsDatabase: vi.fn(),
}));
vi.mock("../model/data-connections.js", () => ({
  listDataConnections: async () => [{ id: "builtin-sample-data" }],
}));

import {
  GETTING_STARTED_CHECKLIST,
  hasAskedQuestion,
  hasOwnConnection,
  registerGettingStartedSteps,
} from "./getting-started";

describe("Home getting-started checklist", () => {
  it("registers three steps on the getting-started checklist", () => {
    registerGettingStartedSteps();
    expect(state.registered.map((step) => step.id)).toEqual([
      "connect-data",
      "ask-question",
      "create-project",
    ]);
    expect(
      state.registered.every(
        (step) => step.checklist === GETTING_STARTED_CHECKLIST,
      ),
    ).toBe(true);
  });

  it("does not count the built-in sample as the member's own connection", async () => {
    await expect(
      hasOwnConnection({ sessionId: "s", userEmail: "a@x.test", orgId: "o" }),
    ).resolves.toBe(false);
  });

  it("completes the ask step from a thread in this workspace scope", async () => {
    state.listThreads.mockResolvedValue([{ id: "t1" }]);
    await expect(
      hasAskedQuestion({ sessionId: "s", userEmail: "a@x.test", orgId: "o" }),
    ).resolves.toBe(true);
    expect(state.listThreads).toHaveBeenCalledWith(
      "a@x.test",
      expect.objectContaining({ orgId: "o", sourceAppId: "analytics-2" }),
    );
    await expect(hasAskedQuestion({ sessionId: "s" })).resolves.toBe(false);
  });
});
