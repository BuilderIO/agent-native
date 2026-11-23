import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import { describe, expect, it } from "vitest";

import { routeSkillRequestToWriteResource } from "./skill-request-message";

function sharedSkillRequest(scope: "personal" | "shared"): AgentChatMessage {
  return {
    message: "Create a skill: summarize weekly revenue",
    newTab: true,
    context: `The user wants to create an agent skill. Their description: "summarize weekly revenue"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description
2. **Determine the skill type** — Pattern, Workflow, or Generator
3. **Write the skill** as a ${scope} resource at path "skills/<name>/SKILL.md" using the \`resources\` tool with \`action: "write"\`

The skill file MUST have YAML frontmatter with name and description (under 40 words), then markdown.`,
  };
}

describe("routeSkillRequestToWriteResource", () => {
  it("replaces the shared page's resources-tool write instruction", () => {
    const routed = routeSkillRequestToWriteResource(
      sharedSkillRequest("personal"),
    );
    const context = String(routed.context);
    expect(context).toContain("`write-resource`");
    expect(context).not.toContain("`resources` tool");
    expect(context).not.toContain('action: "write"');
  });

  it("keeps the chosen scope, the skill path and the rest of the request", () => {
    const original = sharedSkillRequest("shared");
    const routed = routeSkillRequestToWriteResource(original);
    const context = String(routed.context);
    expect(context).toContain(
      'as a shared resource at path "skills/<name>/SKILL.md"',
    );
    expect(context).toContain("summarize weekly revenue");
    expect(context).toContain("YAML frontmatter");
    expect(routed.message).toBe(original.message);
    expect(routed.newTab).toBe(original.newTab);
  });

  it("limits the write to path, content and scope", () => {
    const context = String(
      routeSkillRequestToWriteResource(sharedSkillRequest("personal")).context,
    );
    expect(context).toMatch(/only `path`, `content` and `scope`/);
  });

  it("leaves a message without a context untouched", () => {
    const plain = { message: "hello" };
    expect(routeSkillRequestToWriteResource(plain)).toBe(plain);
  });

  it("leaves a context that does not mention the resources tool untouched", () => {
    const other = { message: "hi", context: "Use `write-resource` already." };
    expect(routeSkillRequestToWriteResource(other)).toBe(other);
  });
});
