import { describe, expect, it } from "vitest";

import { buildAgentShareDeepLink } from "./agent-share";

describe("agent share deep links", () => {
  const prompt =
    "Review this clip: https://clips.example/api/recordings/abc/agent-context?token=a&b=2";

  it.each([
    ["claude", "claude://claude.ai/new"],
    ["claude-code", "claude://code/new"],
    ["codex", "codex://threads/new"],
  ] as const)("prefills the %s composer", (destination, expectedBaseUrl) => {
    const deepLink = new URL(buildAgentShareDeepLink(destination, prompt));

    expect(`${deepLink.protocol}//${deepLink.host}${deepLink.pathname}`).toBe(
      expectedBaseUrl,
    );
    expect(deepLink.searchParams.get("q")).toBe(prompt);
  });
});
