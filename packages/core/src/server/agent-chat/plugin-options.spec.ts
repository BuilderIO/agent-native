import { describe, expect, expectTypeOf, it } from "vitest";

import type { RealtimeVoiceIntelligence } from "../realtime-voice.js";
import {
  resolveA2AAgentDelegationEnabled,
  type AgentChatPluginOptions,
} from "./plugin-options.js";

describe("AgentChatPluginOptions", () => {
  it("takes an app's realtime voice guidance, preloaded tools, and default intelligence", () => {
    expectTypeOf<
      NonNullable<AgentChatPluginOptions["realtimeVoice"]>
    >().toEqualTypeOf<{
      instructions?: string;
      priorityToolNames?: readonly string[];
      defaultIntelligence?: RealtimeVoiceIntelligence;
    }>();
  });
});

describe("resolveA2AAgentDelegationEnabled", () => {
  it("delegates to A2A agents unless an app turns it off", () => {
    expect(resolveA2AAgentDelegationEnabled()).toBe(true);
    expect(resolveA2AAgentDelegationEnabled({})).toBe(true);
    expect(resolveA2AAgentDelegationEnabled({ a2aAgentDelegation: true })).toBe(
      true,
    );
    expect(
      resolveA2AAgentDelegationEnabled({ a2aAgentDelegation: false }),
    ).toBe(false);
  });
});
