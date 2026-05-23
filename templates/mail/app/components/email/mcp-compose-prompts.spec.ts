import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Mail MCP compose prompts", () => {
  it("uses the manage-draft action contract for popout and inline generate prompts", () => {
    const popout = source("./ComposeModal.tsx");
    const inline = source("./InlineReplyComposer.tsx");

    for (const file of [popout, inline]) {
      expect(file).toContain('calling manage-draft with action "update"');
      expect(file).not.toContain("application-state/compose-");
      expect(file).not.toContain("Read it first, then write back");
      expect(file).not.toContain("isMcpChatBridgeActive");
    }
  });

  it("updates the active draft for selected-text AI edits instead of asking for text-only replies", () => {
    const toolbar = source("./ComposeBubbleToolbar.tsx");

    expect(toolbar).toContain('id "${draftId}"');
    expect(toolbar).toContain(
      "body set to the full revised Markdown draft body",
    );
    expect(toolbar).toContain("Current draft body:");
    expect(toolbar).not.toContain("replacement text only");
    expect(toolbar).not.toContain("application-state/compose.json");
    expect(toolbar).not.toContain("isMcpChatBridgeActive");
  });
});
