import { expect, it } from "vitest";

import { AGENT_INTERNAL_CONTINUE_PROMPT } from "../continuation-prompt.js";
import { windowToText } from "./message-text.js";

it("omits private content and same-turn derivations while retaining later ordinary turns", () => {
  const text = windowToText([
    { role: "user", content: [{ type: "text", text: "first request" }] },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "x",
          name: "read",
          input: { body: "secret" },
          omitFromPersistedHistory: true,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "x",
          toolName: "read",
          toolInput: "{}",
          content: "secret",
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
    },
    { role: "assistant", content: [{ type: "text", text: "derived secret" }] },
    { role: "user", content: [{ type: "text", text: "next request" }] },
    { role: "assistant", content: [{ type: "text", text: "ordinary answer" }] },
  ]);
  expect(text).not.toContain("secret");
  expect(text).toContain("first request");
  expect(text).toContain("next request");
  expect(text).toContain("ordinary answer");
});
