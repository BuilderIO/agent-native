// @vitest-environment happy-dom
//
// a person's FIRST question after a cold start
// could fail with "Could not verify saved AI connections. Try again shortly."
// because the readiness probe answered unavailable once and the client turned
// that into AgentChatAiSetupRequiredError("unavailable"). The probe is now
// retried a bounded number of times, inside the caller's deadline, before a
// transient failure can reach a person's message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({
  calls: 0,
  /** Answers per probe: "network" rejects, "unavailable" is a failed status, else a payload. */
  answers: [] as Array<"network" | "unavailable" | "configured" | "missing">,
}));

vi.mock("./client-status-requests.js", () => ({
  invalidateClientStatusRequest: vi.fn(),
  fetchAgentEngineStatus: vi.fn(async () => {
    const answer =
      status.answers[status.calls] ?? status.answers[status.answers.length - 1];
    status.calls += 1;
    if (answer === "network") throw new TypeError("fetch failed");
    if (answer === "unavailable") return { state: "unavailable" as const };
    return {
      state: "available" as const,
      stale: false,
      value: {
        engine: "builder",
        configured: true,
        chatEligible: answer === "configured",
      },
    };
  }),
}));

import {
  ensureAgentEngineReadiness,
  resetAgentEngineReadinessForTests,
} from "./agent-engine-readiness.js";

beforeEach(() => {
  status.calls = 0;
  status.answers = [];
  resetAgentEngineReadinessForTests();
});

afterEach(() => {
  resetAgentEngineReadinessForTests();
  vi.clearAllMocks();
});

describe("a cold start's first readiness probe", () => {
  it("recovers from one lost probe instead of failing the first question", async () => {
    status.answers = ["network", "configured"];

    await expect(
      ensureAgentEngineReadiness({ fresh: true, timeoutMs: 8_000 }),
    ).resolves.toBe("configured");
    expect(status.calls).toBe(2);
  });

  it("recovers from a failed status answer too", async () => {
    status.answers = ["unavailable", "configured"];

    await expect(
      ensureAgentEngineReadiness({ fresh: true, timeoutMs: 8_000 }),
    ).resolves.toBe("configured");
  });

  it("still answers unavailable when every bounded retry is lost", async () => {
    status.answers = ["network", "network", "network", "network", "network"];

    await expect(
      ensureAgentEngineReadiness({ fresh: true, timeoutMs: 8_000 }),
    ).resolves.toBe("unavailable");
    // one probe plus the two documented retries, never an unbounded loop
    expect(status.calls).toBe(3);
  });

  it("never retries a definitive answer", async () => {
    status.answers = ["missing"];

    await expect(
      ensureAgentEngineReadiness({ fresh: true, timeoutMs: 8_000 }),
    ).resolves.toBe("missing");
    expect(status.calls).toBe(1);
  });
});
