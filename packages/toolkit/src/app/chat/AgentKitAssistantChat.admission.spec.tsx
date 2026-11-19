// @vitest-environment happy-dom

import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { AgentKitAssistantChat } from "./AgentKitAssistantChat.js";
import type { AssistantChatHandle } from "./chat/surface-types.js";

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => ({
    session: { email: "test@example.test" },
    status: "authenticated",
    isLoading: false,
  }),
}));

it("keeps the draft and app setup notice visible without admitting a turn when AI is missing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<AssistantChatHandle>();
  const admitComposerMessage = vi.fn();
  const startRun = vi.fn();
  const transport: AgentTransport = {
    startRun,
    async *subscribeToRun() {},
    async cancelRun() {},
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        String(url).includes("/agent-engine/status")
          ? { configured: false, chatEligible: false }
          : {},
      ),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentKitAssistantChat
              threadId="unsent"
              isNewThread
              showModelSelector={false}
              ref={ref}
              createTransport={() => transport}
              admitComposerMessage={admitComposerMessage}
              composerProviderSetupSlot={
                <p role="status">Connect an AI provider to continue.</p>
              }
            />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Connect an AI provider to continue."),
    );
    await act(async () => ref.current?.prefillMessage("Keep this question"));
    const editor = () =>
      host.querySelector('[data-agent-composer-slot="editor"] .ProseMirror');
    await vi.waitFor(() =>
      expect(editor()?.textContent).toBe("Keep this question"),
    );
    const send = host.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="send-button"]',
    );
    if (!send) throw new Error("The shared Send button did not render");
    await act(async () => send.click());
    expect(editor()?.textContent).toBe("Keep this question");
    expect(host.textContent).toContain("Connect an AI provider to continue.");
    expect(admitComposerMessage).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
