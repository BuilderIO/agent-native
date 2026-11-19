import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, act, createRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { expect, it, vi } from "vitest";

import { useAgentKit } from "../agentkit/react/context.js";
import { trackManagedClientWork } from "../agentkit/react/managed-client-work.js";
import { AgentKitRoot } from "../agentkit/react/root.js";
import { AgentKitAssistantChat } from "./AgentKitAssistantChat.js";
import type { AssistantChatHandle } from "./chat/surface-types.js";

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => ({
    session: null,
    status: "unauthenticated",
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

it.each(["success", "failure", "timeout", "remount"] as const)(
  "settles an in-flight snapshot before disposing its chat transport on %s",
  async (outcome) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchMock = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const gate = Promise.withResolvers<void>();
    const received = vi.fn();
    const dispose = vi.fn();
    const otherDispose = vi.fn();
    const errorToast = vi.spyOn(toast, "error");
    const hostSave = vi.fn(
      async (_id: string, _snapshot: { threadData: string }) => true,
    );
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async assertAiSetupReady() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          messages: [
            {
              id: "user-1",
              role: "user",
              status: "complete",
              createdAt: "2026-01-01T00:00:00Z",
              parts: [{ type: "text", text: "Earlier message" }],
            },
          ],
        };
      },
      async persistThreadSnapshot(input, context) {
        received(input);
        await Promise.race([
          gate.promise,
          new Promise<never>((_, reject) =>
            context?.signal?.addEventListener(
              "abort",
              () => reject(context.signal?.reason),
              { once: true },
            ),
          ),
        ]);
        if (outcome === "failure") throw new Error("snapshot rejected");
      },
      dispose,
    };
    const host = document.createElement("div");
    const otherHost = document.createElement("div");
    document.body.append(host, otherHost);
    const root = createRoot(host);
    const otherRoot = createRoot(otherHost);
    const otherTransport: AgentTransport = {
      async startRun() {
        return { runId: "other-run" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      dispose: otherDispose,
    };
    let otherUnmounted = false;
    const ref = createRef<AssistantChatHandle>();
    const queryClient = new QueryClient();
    const createTransport = () => transport;
    const renderChat = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={queryClient}>
        <Activity mode={mode}>
          <AgentKitAssistantChat
            threadId="thread-1"
            isNewThread={false}
            ref={ref}
            createTransport={createTransport}
            onSaveThread={hostSave}
          />
        </Activity>
      </QueryClientProvider>
    );
    let unmounted = false;
    try {
      await act(async () =>
        otherRoot.render(
          <AgentKitRoot
            transport={otherTransport}
            clientOptions={{ transportOwnership: "owned" }}
            threadId="other-thread"
            load="manual"
          />,
        ),
      );
      await act(async () => root.render(renderChat("visible")));
      await vi.waitFor(() =>
        expect(host.textContent).toContain("Earlier message"),
      );
      if (outcome === "timeout") vi.useFakeTimers();
      await act(async () => {
        await ref.current?.sendMessage("New unsaved message");
      });
      if (outcome === "timeout") {
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(received).toHaveBeenCalledOnce();
      } else {
        await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
      }
      expect(JSON.stringify(received.mock.calls)).toContain(
        "New unsaved message",
      );
      if (outcome === "remount") {
        await act(async () => root.render(renderChat("hidden")));
        await act(async () => root.render(renderChat("visible")));
        expect(dispose).not.toHaveBeenCalled();
      }
      await act(async () => {
        root.unmount();
        unmounted = true;
        await Promise.resolve();
      });
      expect(dispose).not.toHaveBeenCalled();
      await act(async () => {
        otherRoot.unmount();
        otherUnmounted = true;
        await Promise.resolve();
      });
      if (outcome === "timeout") {
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        vi.useRealTimers();
      }
      await vi.waitFor(() => expect(otherDispose).toHaveBeenCalledOnce());
      if (outcome === "timeout") {
        await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
        expect(hostSave).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(errorToast).toHaveBeenCalled());
        return;
      }
      expect(dispose).not.toHaveBeenCalled();
      gate.resolve();
      if (outcome === "success") {
        await vi.waitFor(() => expect(hostSave).toHaveBeenCalledOnce());
        const saved = hostSave.mock.calls[0]?.[1];
        expect(saved).toBeDefined();
        const snapshot = JSON.parse(saved?.threadData ?? "null") as {
          agentKit: {
            messages: Array<{
              role: string;
              parts: Array<{ type: string; text?: string }>;
            }>;
          };
        };
        expect(
          snapshot.agentKit.messages.filter(
            (message) =>
              message.role === "user" &&
              message.parts.some(
                (part) =>
                  part.type === "text" && part.text === "New unsaved message",
              ),
          ),
        ).toHaveLength(1);
        expect(errorToast).not.toHaveBeenCalled();
      } else if (outcome === "failure") {
        await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
        expect(hostSave).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(errorToast).toHaveBeenCalled());
      }
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    } finally {
      vi.useRealTimers();
      gate.resolve();
      if (!unmounted) await act(async () => root.unmount());
      if (!otherUnmounted) await act(async () => otherRoot.unmount());
      host.remove();
      otherHost.remove();
      errorToast.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);

it("waits for work added after a managed client is remounted and disposes once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const dispose = vi.fn();
  const clientDispose = vi.spyOn(AgentKitClient.prototype, "dispose");
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    dispose,
  };
  let mounts = 0;
  function Work() {
    const { controller } = useAgentKit();
    useEffect(() => {
      mounts += 1;
      trackManagedClientWork(
        controller,
        mounts === 1 ? first.promise : second.promise,
      );
    }, [controller]);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let unmounted = false;
  const render = (mode: "visible" | "hidden") => (
    <Activity mode={mode}>
      <AgentKitRoot
        transport={transport}
        clientOptions={{ transportOwnership: "owned" }}
        threadId="thread-1"
        load="manual"
      >
        <Work />
      </AgentKitRoot>
    </Activity>
  );
  try {
    await act(async () => root.render(render("visible")));
    await act(async () => root.render(render("hidden")));
    await act(async () => root.render(render("visible")));
    expect(mounts).toBe(2);
    await act(async () => {
      root.unmount();
      unmounted = true;
    });
    first.resolve();
    await act(async () => {
      await first.promise;
    });
    expect(dispose).not.toHaveBeenCalled();
    second.resolve();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(clientDispose).toHaveBeenCalledOnce();
  } finally {
    first.resolve();
    second.resolve();
    if (!unmounted) await act(async () => root.unmount());
    host.remove();
    clientDispose.mockRestore();
    vi.unstubAllGlobals();
  }
});
