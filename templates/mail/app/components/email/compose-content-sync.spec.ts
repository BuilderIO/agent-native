import { describe, expect, it } from "vitest";

import {
  shouldApplyComposeContent,
  COMPOSE_TYPING_GRACE_MS,
} from "./compose-draft-context";

const NOW = 1_000_000;

describe("shouldApplyComposeContent", () => {
  it("does not re-apply content the editor already shows", () => {
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "Hello",
        nextContent: "Hello",
        editorFocused: true,
        lastTypedAt: NOW,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("applies an external (agent) edit when the editor is blurred", () => {
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "Old body",
        nextContent: "Agent-rewritten body",
        editorFocused: false,
        lastTypedAt: NOW - 10_000,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("applies an external edit while focused but idle (not actively typing)", () => {
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "Old body",
        nextContent: "Agent-rewritten body",
        editorFocused: true,
        lastTypedAt: NOW - (COMPOSE_TYPING_GRACE_MS + 1),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("defers an external edit while the user is actively typing", () => {
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "User is typing thi",
        nextContent: "Agent-rewritten body",
        editorFocused: true,
        lastTypedAt: NOW - 100,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("applies once the typing grace window elapses (boundary)", () => {
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "Old body",
        nextContent: "New body",
        editorFocused: true,
        lastTypedAt: NOW - COMPOSE_TYPING_GRACE_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("ignores recent typing when the editor is not focused", () => {
    // A blurred editor can't be "typing right now" even if lastTypedAt is recent
    expect(
      shouldApplyComposeContent({
        currentMarkdown: "Old body",
        nextContent: "New body",
        editorFocused: false,
        lastTypedAt: NOW - 50,
        now: NOW,
      }),
    ).toBe(true);
  });
});
