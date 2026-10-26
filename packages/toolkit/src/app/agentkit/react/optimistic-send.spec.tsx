// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport, FilePart } from "@agent-native/agentkit/protocol";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getComposerDraftKey } from "../../../composer/draft-key.js";
import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import type { TiptapComposerHandle } from "../../../composer/TiptapComposer.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider, useAgentKitControl } from "./context.js";

const THREAD_ID = "thread-optimistic";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  localStorage.removeItem(getComposerDraftKey(`agentkit:${THREAD_ID}`));
  vi.unstubAllGlobals();
});

async function renderChat(
  options: {
    history?: { id: string; text: string }[];
    readiness?: () => Promise<void>;
    startRun?: AgentTransport["startRun"];
    uploaded?: FilePart[];
    /** Renders a host composer that sends through the control, as desktop does. */
    hostComposer?: boolean;
  } = {},
) {
  const transport: AgentTransport = {
    capabilities: { uploads: true },
    assertAiSetupReady: options.readiness
      ? () => options.readiness!()
      : async () => undefined,
    startRun: options.startRun ?? (async () => ({ runId: "run-sent" })),
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot(threadId) {
      return {
        id: threadId,
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:00.000Z",
        messages: (options.history ?? []).map((message) => ({
          id: message.id,
          role: "user" as const,
          parts: [{ type: "text" as const, text: message.text }],
        })),
      };
    },
  };
  const client = new AgentKitClient({ transport });
  // The control binds uploadFiles when it mounts, so stub it before render.
  if (options.uploaded) {
    vi.spyOn(client, "uploadFiles").mockResolvedValue(options.uploaded);
  }
  await client.loadThread(THREAD_ID);
  await client.getCapabilities();
  const composerRef = createRef<TiptapComposerHandle>();
  const hostSend: {
    current?: ReturnType<typeof useAgentKitControl>["sendMessage"];
  } = {};
  function HostComposer() {
    hostSend.current = useAgentKitControl(THREAD_ID).sendMessage;
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider
        adapters={{
          models: {
            useAgentEngineConfigured: () => ({
              missing: false,
              state: "configured",
            }),
            fetchAgentEngineConfiguredState: async () => "configured",
          },
        }}
      >
        <AgentKitProvider
          controller={client}
          threadId={THREAD_ID}
          slots={options.hostComposer ? { composer: HostComposer } : undefined}
        >
          <AgentKitChat
            composerProps={{
              composerRef,
              autoFocus: false,
              modelStatusChecksEnabled: false,
              voiceEnabled: false,
            }}
          />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    await client.shutdown();
    container.remove();
  });
  const send = async () => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-agent-composer-slot="send-button"]',
        )!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const settle = async () => {
    await act(async () => {
      for (let tick = 0; tick < 3; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  };
  const userMessages = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>(
        'article.agentkit-message[data-role="user"]',
      ),
    );
  const editorText = () =>
    container.querySelector('[contenteditable="true"]')?.textContent ?? "";
  const notices = () =>
    Array.from(
      container.querySelectorAll(
        '[data-agent-composer-slot="notices"] [data-agent-composer-notice]',
      ),
      (notice) => notice.textContent ?? "",
    );
  return {
    client,
    composerRef,
    hostSend,
    container,
    send,
    settle,
    userMessages,
    editorText,
    notices,
  };
}

describe("AgentKit optimistic send", () => {
  it("shows the sent message at once, before readiness resolves", async () => {
    const readiness = Promise.withResolvers<void>();
    const chat = await renderChat({ readiness: () => readiness.promise });
    expect(
      chat.container
        .querySelector(".agentkit-chat")
        ?.getAttribute("data-empty"),
    ).toBe("true");
    await act(async () => chat.composerRef.current!.setText("Plan the launch"));

    await chat.send();

    const [pending] = chat.userMessages();
    expect(pending?.textContent).toContain("Plan the launch");
    expect(pending?.dataset.pending).toBe("true");
    expect(chat.editorText()).toBe("");
    expect(
      chat.container
        .querySelector(".agentkit-chat")
        ?.getAttribute("data-empty"),
    ).toBe("false");

    readiness.resolve();
    await chat.settle();

    const messages = chat.userMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.dataset.pending).toBeUndefined();
    expect(messages[0]?.textContent).toContain("Plan the launch");
  });

  it("puts the draft back and shows the error when readiness fails", async () => {
    const readiness = Promise.withResolvers<void>();
    const chat = await renderChat({ readiness: () => readiness.promise });
    await act(async () => chat.composerRef.current!.setText("Plan the launch"));
    await chat.send();
    expect(chat.userMessages()).toHaveLength(1);

    readiness.reject(new Error("Connect an AI provider to send."));
    await chat.settle();

    expect(chat.userMessages()).toHaveLength(0);
    expect(chat.editorText()).toBe("Plan the launch");
    expect(chat.notices()).toEqual([
      expect.stringContaining("Connect an AI provider to send."),
    ]);
  });

  it("puts the draft back and shows the error when the send fails", async () => {
    const chat = await renderChat({
      startRun: async () => {
        throw new Error("The agent could not start.");
      },
    });
    await act(async () => chat.composerRef.current!.setText("Plan the launch"));
    await chat.send();
    await chat.settle();

    // The client keeps its own failed copy; the optimistic one must not join it.
    const messages = chat.userMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.dataset.pending).toBeUndefined();
    expect(chat.editorText()).toBe("Plan the launch");
    expect(chat.notices()).toEqual([
      expect.stringContaining("The agent could not start."),
    ]);
  });

  it("swaps the copy for the sent message by request id, not by text", async () => {
    const started = Promise.withResolvers<{ runId: string }>();
    const startRun = vi.fn<AgentTransport["startRun"]>(() => started.promise);
    const readiness = Promise.withResolvers<void>();
    const chat = await renderChat({
      history: [{ id: "earlier", text: "Plan the launch" }],
      readiness: () => readiness.promise,
      startRun,
    });
    await act(async () => chat.composerRef.current!.setText("Plan the launch"));
    await chat.send();

    // Same text as the earlier message, and still shown as its own message.
    expect(
      chat.userMessages().map((message) => message.dataset.pending),
    ).toEqual([undefined, "true"]);

    readiness.resolve();
    await chat.settle();

    expect(startRun).toHaveBeenCalledOnce();
    const sent = startRun.mock.calls[0]![0].messages.at(-1);
    const requestId = sent?.metadata?.clientRequestId;
    expect(typeof requestId).toBe("string");
    expect(
      chat.client
        .getThread(THREAD_ID)
        .messages.filter(
          (message) => message.metadata?.clientRequestId === requestId,
        ),
    ).toHaveLength(1);
    const messages = chat.userMessages();
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => !message.dataset.pending)).toBe(true);

    started.resolve({ runId: "run-sent" });
    await chat.settle();
    expect(chat.userMessages()).toHaveLength(2);
  });

  it("shows a files-only send and returns its file to the draft on failure", async () => {
    const readiness = Promise.withResolvers<void>();
    const chat = await renderChat({
      readiness: () => readiness.promise,
      uploaded: [
        {
          type: "file",
          name: "shot.png",
          mediaType: "image/png",
          url: "https://files.example.test/shot.png",
        },
      ],
    });
    await act(async () => {
      await chat.composerRef.current!.addAttachment(
        new File(["png"], "shot.png", { type: "image/png" }),
      );
    });
    const strip = () =>
      chat.container.querySelector(".agent-composer-attachment-strip");
    expect(strip()?.innerHTML).toContain("shot.png");

    await chat.send();

    const [pending] = chat.userMessages();
    expect(pending?.dataset.pending).toBe("true");
    expect(pending?.innerHTML).toContain("shot.png");
    expect(strip()).toBeNull();

    readiness.reject(new Error("Connect an AI provider to send."));
    await chat.settle();

    expect(chat.userMessages()).toHaveLength(0);
    expect(strip()?.innerHTML).toContain("shot.png");
    expect(chat.notices()).toEqual([
      expect.stringContaining("Connect an AI provider to send."),
    ]);
  });

  it("shows a host composer's send through the control without a duplicate", async () => {
    const readiness = Promise.withResolvers<void>();
    const chat = await renderChat({
      readiness: () => readiness.promise,
      hostComposer: true,
    });
    let sent: Promise<unknown> | undefined;
    await act(async () => {
      sent = chat.hostSend.current!({ text: "Run the tests" });
      await Promise.resolve();
    });

    expect(
      chat.userMessages().map((message) => message.dataset.pending),
    ).toEqual(["true"]);

    readiness.resolve();
    await act(async () => {
      await sent;
    });
    await chat.settle();

    const messages = chat.userMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.dataset.pending).toBeUndefined();
    expect(messages[0]?.textContent).toContain("Run the tests");
  });
});
