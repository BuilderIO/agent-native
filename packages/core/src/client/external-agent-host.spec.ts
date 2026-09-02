import { describe, expect, it } from "vitest";

import { detectExternalAgentHost } from "./external-agent-host.js";

describe("external agent host detection", () => {
  it("uses explicit host bridge signals instead of generic browser identity", () => {
    expect(
      detectExternalAgentHost({
        hostname: "app.example.com",
        openAiBridge: {},
      }),
    ).toEqual({ id: "chatgpt", label: "ChatGPT" });
    expect(
      detectExternalAgentHost({
        frameOrigin: "https://web-sandbox.oaiusercontent.com",
      }),
    ).toEqual({ id: "chatgpt", label: "ChatGPT" });
    expect(
      detectExternalAgentHost({
        hostname: "123.claudemcpcontent.com",
      }),
    ).toEqual({ id: "claude", label: "Claude" });
    expect(
      detectExternalAgentHost({
        hostInfo: { name: "Claude Code" },
      }),
    ).toEqual({ id: "claude", label: "Claude" });
    expect(
      detectExternalAgentHost({
        hostInfo: { name: "Codex" },
      }),
    ).toEqual({ id: "codex", label: "Codex" });
    expect(
      detectExternalAgentHost({ hostname: "localhost", referrer: null }),
    ).toBeNull();
  });
});
