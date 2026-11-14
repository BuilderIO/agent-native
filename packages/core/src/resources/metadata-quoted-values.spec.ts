import { describe, expect, it } from "vitest";

import {
  parseCustomAgentProfile,
  parseFrontmatter,
  serializeFrontmatter,
} from "./metadata.js";

describe("quoted resource metadata", () => {
  it("decodes escaped profile fields written as JSON strings", () => {
    const name = 'Eve\'s "Agent"';
    const description = "Two lines\nwith a backslash: \\";
    const content = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\nmodel: "inherit"\ntools: "inherit"\n---\nKeep these instructions.\n`;
    expect(parseCustomAgentProfile(content, "agents/example.md")).toMatchObject(
      {
        name,
        description,
        tools: "inherit",
        instructions: "Keep these instructions.",
      },
    );
  });

  it("round-trips the canonical writer's quoted colon and quote values", () => {
    const name = 'Reader: "daily"';
    const content = serializeFrontmatter([{ key: "name", value: name }]);
    expect(parseCustomAgentProfile(content, "agents/example.md")?.name).toBe(
      name,
    );
  });

  it("preserves literal legacy quotes and single-quoted scalars", () => {
    const parsed = parseFrontmatter(
      '---\nname: "a "literal" quote"\ndescription: \'read this\'\ntools: inherit\n---\n',
    );
    expect(parsed?.fields).toEqual([
      { key: "name", value: 'a "literal" quote' },
      { key: "description", value: "read this" },
      { key: "tools", value: "inherit" },
    ]);
  });
});
