import { describe, expect, it } from "vitest";

import { createDesktopLocalAgentRuntime } from "./desktop-local-agent-runtime.js";

describe("desktop local agent runtime", () => {
  it("does not retain a disposed session", async () => {
    const runtime = createDesktopLocalAgentRuntime("codex");
    const firstSession = await runtime.createSession({
      id: "session-1",
      threadId: "thread-a",
    });

    await firstSession.dispose?.();

    const secondSession = await runtime.createSession({
      id: "session-1",
      threadId: "thread-b",
    });
    expect(secondSession.threadId).toBe("thread-b");
  });
});
