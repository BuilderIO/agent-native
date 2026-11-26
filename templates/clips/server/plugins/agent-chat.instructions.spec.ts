import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentChatSource = readFileSync(
  new URL("./agent-chat.ts", import.meta.url),
  "utf8",
);
const agentsGuideSource = readFileSync(
  new URL("../../AGENTS.md", import.meta.url),
  "utf8",
);

describe("Clips transcript agent guidance", () => {
  it("continues bounded transcripts through every returned offset", () => {
    expect(agentChatSource).toContain(
      "transcriptOffset set to each nextFullTextOffset until that value is null",
    );
    expect(agentChatSource).toContain("interpret the chunks together");
  });
});

describe("Clips library search navigation guidance", () => {
  it("steers find and filter requests to navigate with view=library and search", () => {
    expect(agentChatSource).toContain("<clips-library-search>");
    expect(agentChatSource).toContain('view="library" and search=');
    expect(agentChatSource).toContain(
      "even if matching recordings already appear",
    );
    expect(agentChatSource).toContain(
      'do not jump straight into a single recording player (view="recording")',
    );
  });

  it("advertises filtered library search paths in MCP instructions", () => {
    expect(agentChatSource).toContain("open_app");
    expect(agentChatSource).toContain("/library?q=");
  });

  it("documents library search navigation in AGENTS.md", () => {
    expect(agentsGuideSource).toContain('view: "library"');
    expect(agentsGuideSource).toContain("?q=");
  });
});
