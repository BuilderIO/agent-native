import { describe, expect, it, vi } from "vitest";

import { DOCS_AGENT_SYSTEM_PROMPT } from "./agent-chat";

// Codegen output that only exists after a dev/build run, so a clean checkout
// cannot resolve it. Every other app's plugin spec stubs it the same way.
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

describe("Docs agent system prompt", () => {
  it("keeps response language tied to the user's message, not the browser or page locale", () => {
    expect(DOCS_AGENT_SYSTEM_PROMPT).toContain(
      "Reply in the language of the user's latest message.",
    );
    expect(DOCS_AGENT_SYSTEM_PROMPT).toContain(
      "The browser locale, docs URL locale, UI language, and language of retrieved documentation are context only",
    );
    expect(DOCS_AGENT_SYSTEM_PROMPT).toContain(
      "answer an English question in English even when the browser or page is set to Portuguese",
    );
  });
});
