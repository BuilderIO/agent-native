// @vitest-environment happy-dom

import type {
  PromptComposerProps,
  AgentChatContextItem,
} from "@agent-native/toolkit/agentkit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitClient, createAgentThreadState } from "../client/index.js";
import type { AgentTransport } from "../protocol/index.js";
import {
  AgentKitComposer,
  type AgentKitComposerSubmission,
} from "./components.js";
import { AgentKitProvider } from "./context.js";

const capture = vi.hoisted(() => ({
  props: undefined as PromptComposerProps | undefined,
}));
vi.mock("@agent-native/toolkit/agentkit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/toolkit/agentkit")>();
  return {
    ...actual,
    PromptComposer: (props: PromptComposerProps) => {
      capture.props = props;
      return null;
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let client: AgentKitClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  capture.props = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  client?.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function transport() {
  return {
    capabilities: { messageQueue: true },
    startRun: vi
      .fn<AgentTransport["startRun"]>()
      .mockResolvedValue({ runId: "run-1" }),
    async *subscribeToRun() {},
    async cancelRun() {},
    queueMessage: vi
      .fn<NonNullable<AgentTransport["queueMessage"]>>()
      .mockImplementation(async (input) => ({
        message: { id: "queued-1", ...input },
      })),
  } satisfies AgentTransport;
}

describe("AgentKit composer context submission", () => {
  it.each(["immediate", "queued"] as const)(
    "awaits persistence and sends the immutable context to the %s runtime path",
    async (intent) => {
      const runtime = transport();
      client = new AgentKitClient({ transport: runtime });
      const source: AgentChatContextItem[] = [
        { key: "brief", title: "Brief", context: "Original context" },
      ];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let saved: AgentKitComposerSubmission | undefined;
      const beforeSend = vi.fn(
        async (submission: AgentKitComposerSubmission) => {
          saved = submission;
          await gate;
        },
      );
      const onRemoveContextItem = vi.fn();
      const onInspectContextItem = vi.fn();
      const onRetryContextItem = vi.fn();
      const contextMenuItems = [{ id: "brief", label: "Brief", onSelect() {} }];
      await act(async () =>
        root.render(
          <AgentKitProvider controller={client} threadId="thread-1">
            <AgentKitComposer
              contextItems={source}
              contextMenuItems={contextMenuItems}
              onRemoveContextItem={onRemoveContextItem}
              onInspectContextItem={onInspectContextItem}
              onRetryContextItem={onRetryContextItem}
              beforeSend={beforeSend}
              autoFocus={false}
            />
          </AgentKitProvider>,
        ),
      );
      expect(capture.props).toMatchObject({
        contextItems: source,
        contextMenuItems,
        onRemoveContextItem,
        onInspectContextItem,
        onRetryContextItem,
      });
      const references = [
        {
          type: "file" as const,
          path: "brief.md",
          name: "Brief",
          source: "codebase",
          metadata: { revision: 1 },
        },
      ];
      let pending: void | Promise<void>;
      await act(async () => {
        pending = capture.props!.onSubmit("Review", [], references, {
          contextItems: source,
          intent,
        });
      });
      expect(beforeSend).toHaveBeenCalledOnce();
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(runtime.queueMessage).not.toHaveBeenCalled();
      expect(Object.isFrozen(saved)).toBe(true);
      expect(Object.isFrozen(saved!.contextItems![0])).toBe(true);
      expect(Object.isFrozen(saved!.references[0].metadata)).toBe(true);
      source[0].context = "Changed after submission";
      references[0].metadata.revision = 2;
      await act(async () => {
        release();
        await pending;
      });
      const input =
        intent === "queued"
          ? runtime.queueMessage.mock.calls[0][0]
          : runtime.startRun.mock.calls[0][0];
      expect(input.metadata?.contextItems).toEqual([
        { key: "brief", title: "Brief", context: "Original context" },
      ]);
      expect(input.metadata?.references).toEqual([
        { ...references[0], metadata: { revision: 1 } },
      ]);
      const text =
        "text" in input
          ? input.text
          : input.messages.at(-1)!.parts.find((part) => part.type === "text")!
              .text;
      expect(text).toBe("Review\n\n<context>\nOriginal context\n</context>");
      expect(saved!.text).toBe(text);
      expect(
        intent === "queued" ? runtime.startRun : runtime.queueMessage,
      ).not.toHaveBeenCalled();
    },
  );

  it("queues while running with the same hook and keeps legacy submissions context-free", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const thread = {
      ...createAgentThreadState("thread-1"),
      activeRunIds: ["active-run"],
    };
    const snapshot = {
      ...client.getSnapshot(),
      threads: { "thread-1": thread },
    };
    vi.spyOn(client, "getSnapshot").mockReturnValue(snapshot);
    const beforeSend = vi.fn();
    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer beforeSend={beforeSend} autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    await act(async () => {
      await capture.props!.onSubmit("Legacy", [], [], {});
    });
    expect(beforeSend.mock.calls[0][0].intent).toBe("queued");
    expect(runtime.queueMessage.mock.calls[0][0].text).toBe("Legacy");
    expect(runtime.queueMessage.mock.calls[0][0].metadata).toBeUndefined();
  });

  it.each(["pending", "error"] as const)(
    "rejects %s context before persistence or runtime calls",
    async (status) => {
      const runtime = transport();
      client = new AgentKitClient({ transport: runtime });
      const beforeSend = vi.fn();
      await act(async () =>
        root.render(
          <AgentKitProvider controller={client} threadId="thread-1">
            <AgentKitComposer beforeSend={beforeSend} autoFocus={false} />
          </AgentKitProvider>,
        ),
      );
      await act(async () => {
        await expect(
          capture.props!.onSubmit("Review", [], [], {
            contextItems: [{ key: "bad", title: "Bad", context: "", status }],
          }),
        ).rejects.toThrow("not ready");
      });
      expect(beforeSend).not.toHaveBeenCalled();
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(runtime.queueMessage).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "not ready",
      );
    },
  );

  it.each(["immediate", "queued"] as const)(
    "propagates a persistence rejection so the %s composer keeps its draft",
    async (intent) => {
      const runtime = transport();
      client = new AgentKitClient({ transport: runtime });
      const beforeSend = vi
        .fn()
        .mockRejectedValue(new Error("Snapshot could not be saved"));
      await act(async () =>
        root.render(
          <AgentKitProvider controller={client} threadId="thread-1">
            <AgentKitComposer beforeSend={beforeSend} autoFocus={false} />
          </AgentKitProvider>,
        ),
      );
      await act(async () => {
        await expect(
          capture.props!.onSubmit("Review", [], [], { intent }),
        ).rejects.toThrow("Snapshot could not be saved");
      });
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(runtime.queueMessage).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Snapshot could not be saved",
      );
    },
  );
});
