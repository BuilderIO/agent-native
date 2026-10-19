import type { CollabUser } from "@agent-native/core/client/collab";
import { describe, expect, it } from "vitest";

import { getPassiveSlidePresenceUsers } from "./slide-presence";

const agent: CollabUser = {
  name: "AI Assistant",
  email: " AGENT@SYSTEM ",
  color: "#00B5FF",
};
const human: CollabUser = {
  name: "Ada",
  email: "ada@example.com",
  color: "#6366F1",
};

describe("getPassiveSlidePresenceUsers", () => {
  it("hides duplicate agent presence while the agent is editing", () => {
    expect(getPassiveSlidePresenceUsers([agent], true)).toEqual([]);
  });

  it("preserves human collaborators while the agent is editing", () => {
    expect(getPassiveSlidePresenceUsers([agent, human], true)).toEqual([human]);
  });

  it("keeps passive agent presence after editing ends", () => {
    expect(getPassiveSlidePresenceUsers([agent], false)).toEqual([agent]);
  });
});
