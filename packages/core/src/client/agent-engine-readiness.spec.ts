import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_CHAT_AI_SETUP_REQUIRED_CODE,
  AgentChatAiSetupRequiredError,
  resetAgentEngineReadinessForTests,
  requireAgentEngineConfiguredForDispatch,
} from "./agent-engine-readiness";

/**
 * The client gate that blocks a chat turn before any agent call.
 *
 * Reported: "the first question after a cold start can fail with 'Could not verify
 * saved AI connections. Try again shortly.'" — a message that reads like a credentials problem. The
 * mechanism is here, and it is a timeout: `waitForStatus` races the status request against a timer
 * and resolves `{state:"unavailable"}` when the timer wins, so a cold function whose
 * `/_agent-native/agent-engine/status` answer lands late is reported to the person as a connection
 * failure. These cases pin that behaviour deterministically (a small `timeoutMs`, a fetch that never
 * answers), and the last two prove the harness is not simply failing everything.
 *
 * They characterise what ships today. The fix changes the slow case into a distinguishable state
 * ("still connecting") — that test will need a new expectation next to these, not a rewrite of them.
 */
const status = (body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const neverAnswers = (() => new Promise(() => {})) as unknown as typeof fetch;
const throws = (async () => {
  throw new Error("cold start: the function did not answer");
}) as unknown as typeof fetch;

const gate = (fetchImpl: typeof fetch, timeoutMs = 20) =>
  requireAgentEngineConfiguredForDispatch({
    source: { fetch: fetchImpl },
    timeoutMs,
  });

beforeEach(() => resetAgentEngineReadinessForTests());

describe("the chat readiness gate", () => {
  it("reports an unverified connection when the status answer is slower than the budget", async () => {
    const failure = await gate(neverAnswers).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentChatAiSetupRequiredError);
    expect((failure as AgentChatAiSetupRequiredError).code).toBe(
      AGENT_CHAT_AI_SETUP_REQUIRED_CODE,
    );
    expect((failure as Error).message).toBe(
      "Could not verify saved AI connections. Try again shortly.",
    );
  });

  it("reports the same thing when the status request throws", async () => {
    const failure = await gate(throws).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentChatAiSetupRequiredError);
    expect((failure as AgentChatAiSetupRequiredError).state).toBe(
      "unavailable",
    );
  });

  it("reports the same thing when the status answers without a chat-eligible flag", async () => {
    const failure = await gate(status({ engine: "builder" })).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AgentChatAiSetupRequiredError);
    expect((failure as AgentChatAiSetupRequiredError).state).toBe(
      "unavailable",
    );
  });

  it("lets the turn through when the status says the engine can chat", async () => {
    await expect(
      gate(status({ engine: "builder", chatEligible: true })),
    ).resolves.toBeUndefined();
  });

  it("says setup is missing, not unavailable, when the status answers chat-eligible false", async () => {
    const failure = await gate(
      status({ engine: "builder", chatEligible: false }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentChatAiSetupRequiredError);
    expect((failure as AgentChatAiSetupRequiredError).state).toBe("missing");
    expect((failure as Error).message).toBe(
      "Use Builder.io or a provider API key before chatting.",
    );
  });
});
