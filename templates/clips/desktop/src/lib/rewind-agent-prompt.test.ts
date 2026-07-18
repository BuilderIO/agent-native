import { describe, expect, it } from "vitest";

import { REWIND_AGENT_PROMPT } from "./rewind-agent-prompt";

describe("REWIND_AGENT_PROMPT", () => {
  it("guides a local agent through the broker without archive bypass", () => {
    expect(REWIND_AGENT_PROMPT).toContain("screen_memory_status");
    expect(REWIND_AGENT_PROMPT).toContain("install-screen-memory");
    expect(REWIND_AGENT_PROMPT).toContain("screen_memory_search_chapters");
    expect(REWIND_AGENT_PROMPT).toContain("screen_memory_frame_at");
    expect(REWIND_AGENT_PROMPT).toContain("screen_memory_contact_sheet");
    expect(REWIND_AGENT_PROMPT).toContain("Do not bypass Clips");
    expect(REWIND_AGENT_PROMPT).not.toContain("inspect the newest finalized");
    expect(REWIND_AGENT_PROMPT).toContain("bounded private Clip handoff");
    expect(REWIND_AGENT_PROMPT).toContain("do not upload the returned frames");
    expect(REWIND_AGENT_PROMPT).toContain("ask which one I mean");
  });
});
