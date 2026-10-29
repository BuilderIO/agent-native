import { describe, expect, expectTypeOf, it } from "vitest";

import { jobBelongsToApp } from "../../jobs/frontmatter.js";
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

const picksUp = (
  options: AgentChatPluginOptions,
  job: { appId: string },
): boolean => jobBelongsToApp(job, options.appId, options.additionalJobAppIds);

describe("AgentChatPluginOptions.additionalJobAppIds", () => {
  const options = {
    appId: "factory",
    additionalJobAppIds: ["factory-workflows"],
  } satisfies AgentChatPluginOptions;

  it("widens the job files the app picks up to the listed app ids, beside its own", () => {
    expect(picksUp(options, { appId: "factory-workflows" })).toBe(true);
    expect(picksUp(options, { appId: "factory" })).toBe(true);
  });

  it("leaves a job under any other app id to the build that lists it", () => {
    expect(picksUp(options, { appId: "other-app" })).toBe(false);
  });

  it("changes nothing when it is not set", () => {
    expect(picksUp({ appId: "factory" }, { appId: "factory-workflows" })).toBe(
      false,
    );
  });
});
