// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  agentPanelShortcutSelectionText,
  isAgentPanelChatShortcut,
  isAgentSidebarToggleShortcut,
  type AgentPanelChatShortcutEvent,
} from "./agent-sidebar-events";

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("deferred assistant shortcuts", () => {
  it("keeps the existing modifier behavior for chat and sidebar shortcuts", () => {
    expect(
      isAgentPanelChatShortcut(
        new KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true }),
      ),
    ).toBe(true);
    expect(
      isAgentPanelChatShortcut(
        new KeyboardEvent("keydown", {
          key: "i",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
    expect(
      isAgentSidebarToggleShortcut(
        new KeyboardEvent("keydown", { code: "Backslash", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      isAgentSidebarToggleShortcut(
        new KeyboardEvent("keydown", {
          code: "Backslash",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
    expect(
      isAgentSidebarToggleShortcut(
        new KeyboardEvent("keydown", {
          code: "Backslash",
          ctrlKey: true,
          altKey: true,
        }),
      ),
    ).toBe(false);
  });

  it("leaves chat shortcuts in editable controls alone", () => {
    const input = document.createElement("input");
    const event = new KeyboardEvent("keydown", { key: "i", ctrlKey: true });
    input.dispatchEvent(event);
    expect(isAgentPanelChatShortcut(event)).toBe(false);
  });

  it("preserves the first selection while the assistant loads", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "original context";
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    const event: AgentPanelChatShortcutEvent = new KeyboardEvent("keydown", {
      key: "i",
      ctrlKey: true,
    });
    event.agentNativeSelectionText = agentPanelShortcutSelectionText(event);
    window.getSelection()?.removeAllRanges();
    paragraph.remove();
    expect(agentPanelShortcutSelectionText(event)).toBe("original context");
  });

  it("preserves an empty selection rather than attaching a later one", () => {
    const event: AgentPanelChatShortcutEvent = new KeyboardEvent("keydown");
    event.agentNativeSelectionText = "";
    expect(agentPanelShortcutSelectionText(event)).toBe("");
  });
});
