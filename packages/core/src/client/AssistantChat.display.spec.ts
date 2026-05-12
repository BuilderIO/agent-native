// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { displayableUserMessageText } from "./AssistantChat.js";

describe("displayableUserMessageText", () => {
  it("treats context-only messages as empty for user bubble display", () => {
    expect(
      displayableUserMessageText(
        "\n\n<context>\nHidden attachment instructions\n</context>",
      ),
    ).toBe("");
  });
});
