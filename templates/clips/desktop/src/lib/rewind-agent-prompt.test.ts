import { describe, expect, it } from "vitest";

import { REWIND_AGENT_PROMPT } from "./rewind-agent-prompt";

describe("REWIND_AGENT_PROMPT", () => {
  it("bootstraps a reusable Rewind skill and local MCP connection", () => {
    expect(REWIND_AGENT_PROMPT).toContain("skills add rewind");
    expect(REWIND_AGENT_PROMPT).toContain("--scope user --yes");
    expect(REWIND_AGENT_PROMPT).toContain("screen_memory_status");
    expect(REWIND_AGENT_PROMPT).toContain("Look at Rewind");
    expect(REWIND_AGENT_PROMPT).toContain("search chapters before raw context");
    expect(REWIND_AGENT_PROMPT).toContain("never crawl Clips' archive paths");
    expect(REWIND_AGENT_PROMPT).not.toContain("inspect the newest finalized");
    expect(REWIND_AGENT_PROMPT).toContain("bounded private Clip");
    expect(REWIND_AGENT_PROMPT).toContain("cannot install skills");
  });
});
