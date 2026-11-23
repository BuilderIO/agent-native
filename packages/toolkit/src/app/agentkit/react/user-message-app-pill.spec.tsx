// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

async function renderWithUserMessage(text: string) {
  const transport: AgentTransport = {
    assertAiSetupReady: async () => undefined,
    async startRun() {
      return { runId: "run-user-pill" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot() {
      return {
        id: "thread-user-pill",
        createdAt: "2026-11-20T00:00:00.000Z",
        updatedAt: "2026-11-20T00:00:00.000Z",
        messages: [
          {
            id: "user-1",
            role: "user" as const,
            parts: [{ type: "text" as const, text }],
          },
        ],
      };
    },
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread("thread-user-pill");
  const html = renderToStaticMarkup(
    <AgentKitProvider controller={client} threadId="thread-user-pill">
      <AgentKitChat composer={false} />
    </AgentKitProvider>,
  );
  await client.shutdown();
  return html;
}

describe("User message app-routing pill", () => {
  it("drops a trailing `@[Name|icon]` chip the host auto-attached to the user's message", async () => {
    const html = await renderWithUserMessage(
      "whats on my todo list\n@[Tasks|folder]",
    );
    expect(html).toContain("whats on my todo list");
    expect(html).not.toContain('data-mention-label="Tasks"');
    expect(html).not.toContain("agentkit-mention-label");
  });

  it("keeps an inline mention chip that sits between the sender's own text", async () => {
    const html = await renderWithUserMessage(
      "Review @[latest run|folder] please.",
    );
    expect(html).toContain('data-mention-label="latest run"');
    expect(html).toContain("latest run");
    expect(html).toContain("Review ");
    expect(html).toContain(" please.");
  });

  it("drops a chip that is the whole message", async () => {
    const html = await renderWithUserMessage("@[Calendar|folder]");
    expect(html).not.toContain('data-mention-label="Calendar"');
    expect(html).not.toContain("agentkit-mention-label");
  });
});
