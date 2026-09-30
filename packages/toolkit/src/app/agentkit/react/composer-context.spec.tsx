// @vitest-environment happy-dom

import {
  AgentKitClient,
  createAgentThreadState,
} from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PromptComposerProps,
  AgentChatContextItem,
  ComposerContextMenuItem,
} from "../../../agentkit.js";
import {
  AgentKitChat,
  AgentKitComposer,
  type AgentKitComposerSubmission,
} from "./components.js";
import { AgentKitProvider } from "./context.js";

const capture = vi.hoisted(() => ({
  props: undefined as PromptComposerProps | undefined,
}));
vi.mock("../../../agentkit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../agentkit.js")>();
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
  it.each([
    ["immediate", "capability"],
    ["queued", "capability"],
    ["edit", "capability"],
    ["immediate", "host"],
    ["queued", "host"],
    ["edit", "host"],
  ] as const)(
    "rejects retained files before %s submission after the %s upload gate closes",
    async (intent, gate) => {
      const runtime = {
        ...transport(),
        capabilities: {
          messageQueue: true,
          threadForking: true,
          uploads: true,
        },
        forkThread: vi.fn(async () => ({
          id: "thread-fork",
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        })),
        async getThreadSnapshot(threadId: string) {
          return {
            id: threadId,
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
            messages: [
              {
                id: "user-1",
                role: "user" as const,
                parts: [{ type: "text" as const, text: "Original" }],
              },
            ],
          };
        },
      } satisfies AgentTransport;
      client = new AgentKitClient({ transport: runtime });
      await client.loadThread("thread-1");
      let snapshot = client.getSnapshot();
      vi.spyOn(client, "getSnapshot").mockImplementation(() => snapshot);
      const upload = vi.spyOn(client, "uploadFiles").mockResolvedValue([
        {
          type: "file",
          name: "retained.pdf",
          mediaType: "application/pdf",
          url: "https://example.test/retained.pdf",
        },
      ]);
      const beforeSend = vi.fn();
      const onThreadForked = vi.fn();
      const render = (attachmentsEnabled = true) =>
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-1"
            onThreadForked={onThreadForked}
            labels={{ error: "Uploads unavailable" }}
          >
            <AgentKitChat
              composerProps={{
                beforeSend,
                autoFocus: false,
                attachmentsEnabled,
                initialText: "Draft with attachment",
              }}
            />
          </AgentKitProvider>,
        );
      await act(async () => render());
      if (intent === "edit") {
        const edit = container.querySelector<HTMLButtonElement>(
          'button[aria-label="Edit message"]',
        );
        expect(edit).not.toBeNull();
        await act(async () => edit!.click());
      }
      expect(capture.props!.attachmentsEnabled).toBe(true);
      const staleSubmit = capture.props!.onSubmit;
      if (gate === "capability")
        snapshot = {
          ...snapshot,
          capabilityDiscovery: undefined,
          capabilities: { ...snapshot.capabilities, uploads: false },
        };
      await act(async () => render(gate !== "host"));
      expect(capture.props!.attachmentsEnabled).toBe(false);
      const files = [
        new File(["retained"], "retained.pdf", { type: "application/pdf" }),
      ];
      for (const submit of [capture.props!.onSubmit, staleSubmit]) {
        await act(async () => {
          await expect(
            submit("Send with attachment", files, [], {
              intent: intent === "queued" ? "queued" : "immediate",
            }),
          ).rejects.toMatchObject({
            name: "AgentKitCapabilityError",
            capability: "uploads",
            code: "capability_unavailable",
          });
        });
      }
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Uploads unavailable",
      );
      expect(capture.props!.initialText).toBe(
        intent === "edit" ? "Original" : "Draft with attachment",
      );
      expect(files).toHaveLength(1);
      expect(upload).not.toHaveBeenCalled();
      expect(runtime.forkThread).not.toHaveBeenCalled();
      expect(onThreadForked).not.toHaveBeenCalled();
      expect(beforeSend).not.toHaveBeenCalled();
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(runtime.queueMessage).not.toHaveBeenCalled();
    },
  );

  it("passes a multiple dialog descriptor without requiring a single-item callback", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const onAttach = vi.fn().mockResolvedValue(false);
    const contextMenuItems: ComposerContextMenuItem[] = [
      {
        id: "frames",
        label: "Attach frames",
        picker: {
          presentation: { type: "dialog", mode: "multiple", onAttach },
          scopeKey: "account",
          refreshKey: 2,
          searchPlaceholder: "Search frames",
          link: {
            label: "Source URL",
            placeholder: "https://example.com",
            submitLabel: "Continue",
          },
          load: vi.fn().mockResolvedValue({ items: [] }),
        },
      },
    ];
    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer contextMenuItems={contextMenuItems} />
        </AgentKitProvider>,
      ),
    );
    expect(capture.props?.contextMenuItems).toBe(contextMenuItems);
    expect(
      capture.props?.contextMenuItems?.[0].picker?.onSelect,
    ).toBeUndefined();
    expect(runtime.startRun).not.toHaveBeenCalled();
    expect(runtime.queueMessage).not.toHaveBeenCalled();
  });
  it("forwards declarative picker and host attachment policy without starting a run", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const onSelect = vi.fn().mockResolvedValue(false);
    const load = vi.fn().mockResolvedValue({ items: [] });
    const contextMenuItems: ComposerContextMenuItem[] = [
      {
        id: "source",
        label: "Source",
        picker: {
          searchPlaceholder: "Search sources",
          scopeKey: "account",
          refreshKey: 3,
          load,
          onSelect,
          footerAction: { label: "Create source", onSelect: vi.fn() },
        },
      },
    ];
    const attachmentAdapter = {
      accept: ".tsx",
      add: vi.fn(),
      remove: vi.fn(),
      send: vi.fn(),
    };
    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer
            contextMenuItems={contextMenuItems}
            attachmentAdapter={attachmentAdapter}
            inlineTextAttachments={false}
          />
        </AgentKitProvider>,
      ),
    );
    expect(capture.props?.contextMenuItems).toBe(contextMenuItems);
    expect(capture.props?.attachmentAdapter).toBe(attachmentAdapter);
    expect(capture.props?.inlineTextAttachments).toBe(false);
    await onSelect(
      { id: "one", title: "One" },
      { page: 1, search: "", signal: new AbortController().signal },
    );
    expect(runtime.startRun).not.toHaveBeenCalled();
    expect(runtime.queueMessage).not.toHaveBeenCalled();
  });
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
        clearOnSubmitImmediately: true,
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
          composerModeContext: "Use scheduling tools for this request.",
          intent,
        });
      });
      expect(beforeSend).toHaveBeenCalledOnce();
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(runtime.queueMessage).not.toHaveBeenCalled();
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Thinking",
      );
      expect(Object.isFrozen(saved)).toBe(true);
      expect(Object.isFrozen(saved!.contextItems![0])).toBe(true);
      expect(Object.isFrozen(saved!.references[0].metadata)).toBe(true);
      source[0].context = "Changed after submission";
      references[0].metadata.revision = 2;
      await act(async () => {
        release();
        await pending;
      });
      expect(container.querySelector('[role="status"]')).toBeNull();
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
      expect(text).toBe(
        "Review\n\n<context>\nUse scheduling tools for this request.\n\nOriginal context\n</context>",
      );
      expect(saved!.text).toBe(text);
      expect(
        intent === "queued" ? runtime.startRun : runtime.queueMessage,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["immediate", "queued"] as const)(
    "includes mode instructions without context items in %s submissions",
    async (intent) => {
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
        await capture.props!.onSubmit("Create a skill: Review", [], [], {
          intent,
          composerModeContext: "Use skill tools for this request.",
        });
      });
      expect(beforeSend.mock.calls[0][0].text).toBe(
        "Create a skill: Review\n\n<context>\nUse skill tools for this request.\n</context>",
      );
      expect(beforeSend.mock.calls[0][0].contextItems).toBeUndefined();
      const input =
        intent === "queued"
          ? runtime.queueMessage.mock.calls[0][0]
          : runtime.startRun.mock.calls[0][0];
      const text =
        "text" in input
          ? input.text
          : input.messages.at(-1)!.parts.find((part) => part.type === "text")!
              .text;
      expect(text).toBe(beforeSend.mock.calls[0][0].text);
      expect(input.metadata).not.toHaveProperty("contextItems");
    },
  );

  it("forwards mode instructions unchanged to a host override", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer onSubmit={onSubmit} autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    const options = {
      composerModeContext: "Use automation tools for this request.",
    };
    await act(async () =>
      capture.props!.onSubmit("Create an automation: Review", [], [], options),
    );
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "Create an automation: Review",
      [],
      [],
      expect.objectContaining({
        ...options,
        onLocalSubmit: expect.any(Function),
      }),
    );
    expect(runtime.startRun).not.toHaveBeenCalled();
    expect(runtime.queueMessage).not.toHaveBeenCalled();
  });

  it("preserves mode instructions when resubmitting an edited message on a fork", async () => {
    const runtime = {
      ...transport(),
      capabilities: { messageQueue: true, threadForking: true },
      forkThread: vi.fn(async () => ({
        id: "thread-fork",
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      })),
      async getThreadSnapshot(threadId: string) {
        return {
          id: threadId,
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
          messages: [
            {
              id: "user-1",
              role: "user" as const,
              parts: [{ type: "text" as const, text: "Original" }],
            },
          ],
        };
      },
    } satisfies AgentTransport;
    client = new AgentKitClient({ transport: runtime });
    await client.loadThread("thread-1");
    const beforeSend = vi.fn();
    await act(async () =>
      root.render(
        <AgentKitProvider
          controller={client}
          threadId="thread-1"
          onThreadForked={vi.fn()}
        >
          <AgentKitChat composerProps={{ beforeSend, autoFocus: false }} />
        </AgentKitProvider>,
      ),
    );
    const edit = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit message"]',
    );
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    await act(async () =>
      capture.props!.onSubmit("Create a skill: Revised", [], [], {
        composerModeContext: "Use skill tools for this request.",
        contextItems: [
          { key: "brief", title: "Brief", context: "Source context" },
        ],
      }),
    );
    expect(runtime.forkThread).toHaveBeenCalledOnce();
    expect(runtime.startRun.mock.calls[0][0].threadId).toBe("thread-fork");
    const text = runtime.startRun.mock.calls[0][0].messages
      .at(-1)!
      .parts.find((part) => part.type === "text")!.text;
    expect(text).toBe(
      "Create a skill: Revised\n\n<context>\nUse skill tools for this request.\n\nSource context\n</context>",
    );
    expect(beforeSend.mock.calls[0][0].text).toBe(text);
  });

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
    vi.spyOn(client, "getThread").mockReturnValue(thread);
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
    expect(runtime.queueMessage.mock.calls[0][0].metadata).toEqual({
      mode: "act",
      requestMode: "act",
    });
    expect(runtime.queueMessage.mock.calls[0][0].metadata).not.toHaveProperty(
      "contextItems",
    );
    expect(runtime.queueMessage.mock.calls[0][0].metadata).not.toHaveProperty(
      "references",
    );
  });

  it("uses terminal run state when an old composer render submits", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const activeThread = {
      ...createAgentThreadState("thread-1"),
      activeRunIds: ["finished-run"],
    };
    const snapshot = {
      ...client.getSnapshot(),
      threads: { "thread-1": activeThread },
    };
    const completedThread = {
      ...createAgentThreadState("thread-1"),
      activeRunIds: ["finished-run"],
      runs: {
        "finished-run": {
          id: "finished-run",
          status: "completed" as const,
          lastSequence: 3,
        },
      },
    };
    vi.spyOn(client, "getSnapshot").mockReturnValue(snapshot);
    const currentThread = vi
      .spyOn(client, "getThread")
      .mockReturnValue(activeThread);

    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    const submitFromActiveRender = capture.props!.onSubmit;
    currentThread.mockReturnValue(completedThread);

    await act(async () => {
      await submitFromActiveRender("Send after completion", [], [], {});
    });

    expect(runtime.startRun).toHaveBeenCalledOnce();
    expect(runtime.queueMessage).not.toHaveBeenCalled();
  });

  it("sends directly after approval resolves from a stale awaiting run", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const awaitingApprovalThread = {
      ...createAgentThreadState("thread-1"),
      activeRunIds: ["approval-run"],
      runs: {
        "approval-run": {
          id: "approval-run",
          status: "awaiting_approval" as const,
          lastSequence: 2,
        },
      },
      events: [
        {
          id: "approval-requested",
          threadId: "thread-1",
          runId: "approval-run",
          sequence: 1,
          occurredAt: "2026-08-29T00:00:00.000Z",
          type: "approval.requested",
          request: { id: "approval", title: "Continue?" },
        } satisfies AgentEvent,
      ],
      approvalRunIds: { approval: "approval-run" },
    };
    const resolvedApprovalThread = {
      ...awaitingApprovalThread,
      approvalRunIds: {},
      events: [
        ...awaitingApprovalThread.events,
        {
          id: "approval-resolved",
          threadId: "thread-1",
          runId: "continuation-run",
          sequence: 1,
          occurredAt: "2026-08-29T00:00:01.000Z",
          type: "approval.resolved",
          approvalId: "approval",
          response: { decision: "approve" },
        } satisfies AgentEvent,
      ],
    };
    const snapshot = {
      ...client.getSnapshot(),
      threads: { "thread-1": awaitingApprovalThread },
    };
    vi.spyOn(client, "getSnapshot").mockReturnValue(snapshot);
    const currentThread = vi
      .spyOn(client, "getThread")
      .mockReturnValue(awaitingApprovalThread);

    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    const submitFromAwaitingApprovalRender = capture.props!.onSubmit;
    currentThread.mockReturnValue(resolvedApprovalThread);

    await act(async () => {
      await submitFromAwaitingApprovalRender("Send after approval", [], [], {});
    });

    expect(runtime.startRun).toHaveBeenCalledOnce();
    expect(runtime.queueMessage).not.toHaveBeenCalled();
  });

  it("queues while an approval is pending without its approval projection", async () => {
    const runtime = transport();
    client = new AgentKitClient({ transport: runtime });
    const pendingApprovalThread = {
      ...createAgentThreadState("thread-1"),
      activeRunIds: ["approval-run"],
      runs: {
        "approval-run": {
          id: "approval-run",
          status: "awaiting_approval" as const,
          lastSequence: 2,
        },
      },
      events: [
        {
          id: "approval-requested",
          threadId: "thread-1",
          runId: "approval-run",
          sequence: 1,
          occurredAt: "2026-08-29T00:00:00.000Z",
          type: "approval.requested",
          request: { id: "approval", title: "Continue?" },
        } satisfies AgentEvent,
      ],
      approvalRunIds: {},
    };
    const snapshot = {
      ...client.getSnapshot(),
      threads: { "thread-1": pendingApprovalThread },
    };
    vi.spyOn(client, "getSnapshot").mockReturnValue(snapshot);
    vi.spyOn(client, "getThread").mockReturnValue(pendingApprovalThread);

    await act(async () =>
      root.render(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitComposer autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    await act(async () => {
      await capture.props!.onSubmit("Next after approval", [], [], {});
    });

    expect(runtime.queueMessage.mock.calls[0][0]).toMatchObject({
      text: "Next after approval",
    });
    expect(runtime.startRun).not.toHaveBeenCalled();
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
          capture.props!.onSubmit("Review", [], [], {
            intent,
            composerModeContext: "Use scheduling tools for this request.",
          }),
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
