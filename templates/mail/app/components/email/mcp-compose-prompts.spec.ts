import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeEditorMarkdownIntoDraftBody } from "./compose-draft-context";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Mail MCP compose prompts", () => {
  it("uses the manage-draft action contract for popout and inline generate prompts", () => {
    const popout = source("./ComposeModal.tsx");
    const inline = source("./InlineReplyComposer.tsx");

    for (const file of [popout, inline]) {
      expect(file).toContain('calling manage-draft with action "update"');
      expect(file).toContain("getCurrentDraftBodyFromEditor");
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
    expect(toolbar).toContain("Current Markdown draft body:");
    expect(toolbar).toContain("Selected Markdown slice to edit:");
    expect(toolbar).toContain("Selection range in the editor document:");
    expect(toolbar).toContain("getCurrentDraftBody(editor)");
    expect(toolbar).not.toContain("application-state/compose.json");
    expect(toolbar).not.toContain("isMcpChatBridgeActive");
  });

  it("reconstructs the current full body from live editor Markdown", () => {
    expect(
      mergeEditorMarkdownIntoDraftBody({
        draft: {
          id: "draft-1",
          mode: "reply",
          to: "friend@example.com",
          cc: "",
          bcc: "",
          subject: "Re: hi",
          body: "Old body\n\nBest,\nSteve\n— On Tue wrote:\nQuoted",
          attachments: [],
        },
        editorMarkdown: "Fresh body",
        signature: "Best,\nSteve",
      }),
    ).toBe("Fresh body\n\nBest,\nSteve\n\n— On Tue wrote:\nQuoted");
  });
});
