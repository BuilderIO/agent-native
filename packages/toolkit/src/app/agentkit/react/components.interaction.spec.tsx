// @vitest-environment happy-dom

import { act, createElement, createRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { TiptapComposerHandle } from "../../../composer/TiptapComposer.js";

vi.mock("../../../design-system/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../design-system/index.js")>();
  return {
    ...actual,
    Popover: ({
      trigger,
      children,
      open,
      onOpenChange,
      className,
    }: {
      trigger: ReactNode;
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      className?: string;
    }) =>
      createElement(
        "div",
        { className, onClick: () => onOpenChange?.(!open) },
        trigger,
        open ? children : null,
      ),
  };
});

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";

import { getComposerDraftKey } from "../../../composer/draft-key.js";
import { AgentKitChat, AgentMessageActions } from "./components.js";
import { AgentKitProvider } from "./context.js";

describe("AgentKitChat interactions", () => {
  it.each(["default", "compact"] as const)(
    "clears the %s composer before startRun resolves and preserves the next draft",
    async (layoutVariant) => {
      const started = Promise.withResolvers<{ runId: string }>();
      const startRun = vi.fn(() => started.promise);
      const client = new AgentKitClient({
        transport: {
          startRun,
          async *subscribeToRun() {},
          async cancelRun() {},
        },
      });
      const composerRef = createRef<TiptapComposerHandle>();
      const container = document.createElement("div");
      container.style.width = layoutVariant === "compact" ? "320px" : "960px";
      document.body.appendChild(container);
      const root = createRoot(container);
      const actEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      };
      const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

      try {
        await act(async () => {
          root.render(
            <AgentKitProvider controller={client} threadId="thread-latency">
              <AgentKitChat
                composerProps={{
                  composerRef,
                  layoutVariant,
                  autoFocus: false,
                  showModelSelector: false,
                  modelStatusChecksEnabled: false,
                  voiceEnabled: false,
                  includeDefaultSlashSkills: false,
                }}
              />
            </AgentKitProvider>,
          );
        });
        const editor = container.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        )!;
        expect(editor).not.toBeNull();
        await act(async () => composerRef.current!.setText("First prompt"));
        const send = container.querySelector<HTMLButtonElement>(
          '[data-agent-composer-slot="send-button"]',
        )!;
        expect(send.disabled).toBe(false);
        await act(async () => {
          send.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(startRun).toHaveBeenCalledOnce();
        expect(
          container.querySelector('.agentkit-message[data-role="user"]')
            ?.textContent,
        ).toContain("First prompt");
        expect(client.getThread("thread-latency").activeRunIds).toEqual([]);
        expect(editor.textContent).toBe("");

        await act(async () => composerRef.current!.setText("Next draft"));
        await act(async () => started.resolve({ runId: "run-latency" }));

        expect(editor.textContent).toBe("Next draft");
        expect(startRun).toHaveBeenCalledOnce();
        expect(client.getThread("thread-latency").messages).toHaveLength(1);
      } finally {
        await act(async () => {
          started.resolve({ runId: "run-latency" });
        });
        await act(async () => root.unmount());
        await client.shutdown();
        container.remove();
        if (previousActEnvironment === undefined) {
          delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
        } else {
          actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
        }
      }
    },
  );

  it("offers fork from the message actions menu", async () => {
    const forkThread = vi.fn(async (input) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }));
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      forkThread,
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-actions",
              role: "user",
              status: "complete",
              parts: [{ type: "text", text: "Make a change." }],
            },
            {
              id: "assistant-actions",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", text: "Done." }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-actions");
    const onThreadForked = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-actions"
            onThreadForked={onThreadForked}
          >
            <AgentKitChat composer={false} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Message actions"]',
          )
          ?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerType: "mouse",
            }),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const forkItem = Array.from(
        document.body.querySelectorAll<HTMLElement>(
          '.agentkit-message-menu [role="menuitem"]',
        ),
      ).find((item) => item.textContent?.trim().startsWith("Fork"));
      expect(forkItem).toBeDefined();
      await act(async () => {
        forkItem?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(forkThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thread-actions" }),
        expect.anything(),
      );
      expect(onThreadForked).toHaveBeenCalledWith(
        expect.objectContaining({ id: "thread-actions-fork" }),
      );
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("edits a user message on a fork and resubmits it", async () => {
    const forkThread = vi.fn(async (input) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }));
    const startRun = vi.fn(
      async (
        _input: Parameters<NonNullable<AgentTransport["startRun"]>>[0],
      ) => ({ runId: "run-edit" }),
    );
    const onThreadForked = vi.fn();
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      forkThread,
      startRun,
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-edit",
              role: "user",
              parts: [{ type: "text", text: "Original prompt" }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-edit");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-edit"
            onThreadForked={onThreadForked}
          >
            <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const editButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Edit message"]',
      );
      expect(editButton).not.toBeNull();
      await act(async () => {
        editButton?.click();
        await Promise.resolve();
      });
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe("Original prompt");

      const sendButton = container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="send-button"]',
      );
      expect(sendButton).not.toBeNull();
      expect(sendButton?.disabled).toBe(false);
      await act(async () => {
        sendButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(forkThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-edit",
          fromMessageId: undefined,
        }),
        expect.anything(),
      );
      expect(onThreadForked).toHaveBeenCalledWith(
        expect.objectContaining({ id: "thread-edit-fork" }),
      );
      expect(startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-edit-fork",
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              parts: expect.arrayContaining([
                expect.objectContaining({ text: "Original prompt" }),
              ]),
            }),
          ]),
        }),
        expect.anything(),
      );
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("restores a failed edit in the forked thread draft", async () => {
    const forkThread = vi.fn(async (input) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }));
    const startRun = vi.fn(async () => {
      throw new Error("Network unavailable");
    });
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      forkThread,
      startRun,
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-edit-failed",
              role: "user",
              parts: [{ type: "text", text: "Original prompt" }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-edit-failed");
    const onThreadForked = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const forkDraftKey = getComposerDraftKey(
      "agentkit:thread-edit-failed-fork",
    );
    localStorage.removeItem(forkDraftKey);

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-edit-failed"
            onThreadForked={onThreadForked}
          >
            <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Edit message"]')
          ?.click();
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-agent-composer-slot="send-button"]',
          )
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(onThreadForked).toHaveBeenCalledWith(
        expect.objectContaining({ id: "thread-edit-failed-fork" }),
      );
      expect(localStorage.getItem(forkDraftKey)).toContain("Original prompt");

      await client.loadThread("thread-edit-failed-fork");
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-edit-failed-fork"
          >
            <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
          </AgentKitProvider>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe("Original prompt");
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      localStorage.removeItem(forkDraftKey);
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("regenerates the last assistant response from its user turn", async () => {
    const forkThread = vi.fn(async (input) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }));
    const startRun = vi.fn(
      async (
        _input: Parameters<NonNullable<AgentTransport["startRun"]>>[0],
      ) => ({ runId: "run-regenerate" }),
    );
    const onThreadForked = vi.fn();
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      forkThread,
      startRun,
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-regenerate",
              role: "user",
              parts: [{ type: "text", text: "Try this again" }],
            },
            {
              id: "assistant-regenerate",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", text: "First answer" }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-regenerate");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-regenerate"
            onThreadForked={onThreadForked}
          >
            <AgentKitChat />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const regenerateButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Regenerate response"]',
      );
      expect(regenerateButton).not.toBeNull();
      await act(async () => {
        regenerateButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(forkThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-regenerate",
          fromMessageId: undefined,
        }),
        expect.anything(),
      );
      expect(onThreadForked).toHaveBeenCalledWith(
        expect.objectContaining({ id: "thread-regenerate-fork" }),
      );
      expect(startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-regenerate-fork",
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              parts: expect.arrayContaining([
                expect.objectContaining({ text: "Try this again" }),
              ]),
            }),
          ]),
        }),
        expect.anything(),
      );
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("renders the default plus control and routes chat-wide file drops to the composer", async () => {
    const transport: AgentTransport = {
      capabilities: { uploads: true },
      async startRun() {
        return { runId: "run-drop" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-image",
              role: "user",
              parts: [
                { type: "text", text: "Review this image." },
                {
                  type: "file",
                  name: "review.png",
                  mediaType: "image/png",
                  url: "https://example.test/review.png",
                },
              ],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-drop");
    const onAttachmentError = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-drop">
            <AgentKitChat composerProps={{ onAttachmentError }} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const plusButton = container.querySelector<HTMLButtonElement>(
        'button[data-agent-composer-slot="plus-button"]',
      );
      expect(plusButton).not.toBeNull();
      expect(plusButton?.getAttribute("aria-haspopup")).toBe("menu");

      const previewButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Preview review.png"]',
      );
      expect(previewButton).not.toBeNull();
      await act(async () => {
        previewButton?.click();
        await Promise.resolve();
      });
      expect(
        document.body
          .querySelector<HTMLImageElement>(".agentkit-image-preview img")
          ?.getAttribute("src"),
      ).toBe("https://example.test/review.png");
      const closePreview = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.includes("Close preview"));
      expect(closePreview).not.toBeNull();
      await act(async () => {
        closePreview?.click();
        await Promise.resolve();
      });

      const chat = container.querySelector<HTMLElement>(".agentkit-chat");
      expect(chat).not.toBeNull();
      const file = new File(["attached"], "drop.txt", { type: "text/plain" });
      const dataTransfer = {
        types: ["Files"],
        files: [file],
        dropEffect: "none",
      };
      const dragEnter = new Event("dragenter", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(dragEnter, "dataTransfer", {
        value: dataTransfer,
      });
      await act(async () => {
        chat?.dispatchEvent(dragEnter);
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Drop files to attach");

      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      await act(async () => {
        chat?.dispatchEvent(drop);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).not.toContain("Drop files to attach");
      expect(container.textContent).toContain("drop.txt");

      const oversizedFile = new Proxy(
        new File(["small body"], "too-large.txt", { type: "text/plain" }),
        {
          get(target, property) {
            if (property === "size") return 3 * 1024 * 1024 + 1;
            return Reflect.get(target, property, target);
          },
        },
      );
      const rejectedDrop = new Event("drop", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(rejectedDrop, "dataTransfer", {
        value: {
          types: ["Files"],
          files: [oversizedFile],
          dropEffect: "none",
        },
      });
      await act(async () => {
        chat?.dispatchEvent(rejectedDrop);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(onAttachmentError).toHaveBeenCalledWith(
        expect.stringContaining("too-large.txt"),
      );
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("disables transcript file drops when the host disables uploads", async () => {
    const transport: AgentTransport = {
      capabilities: { uploads: true },
      async startRun() {
        return { runId: "run-storage-disabled" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-storage-disabled");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const attachedFiles = vi.fn();
    window.addEventListener("agentkit:attach-files", attachedFiles);

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-storage-disabled"
          >
            <AgentKitChat composerProps={{ attachmentsEnabled: false }} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const chat = container.querySelector<HTMLElement>(".agentkit-chat");
      expect(chat).not.toBeNull();
      const dataTransfer = {
        types: ["Files"],
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
        dropEffect: "none",
      };
      const dragEnter = new Event("dragenter", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(dragEnter, "dataTransfer", { value: dataTransfer });
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });

      await act(async () => {
        chat?.dispatchEvent(dragEnter);
        chat?.dispatchEvent(drop);
        await Promise.resolve();
      });

      expect(dragEnter.defaultPrevented).toBe(false);
      expect(drop.defaultPrevented).toBe(false);
      expect(attachedFiles).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("Drop files to attach");
    } finally {
      window.removeEventListener("agentkit:attach-files", attachedFiles);
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("submits feedback reasons with message trace, rich copy, and branch controls", async () => {
    const userMessage = {
      id: "user-feedback",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Question" }],
    };
    const assistantMessage = {
      id: "assistant-feedback",
      role: "assistant" as const,
      status: "complete" as const,
      createdAt: "2026-09-26T00:00:00.000Z",
      parts: [{ type: "text" as const, text: "Useful answer" }],
    };
    const submitFeedback = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { feedback: true },
      submitFeedback,
      async startRun() {
        return { runId: "run-feedback" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [userMessage, assistantMessage],
          events: [
            {
              id: "event-feedback",
              threadId,
              runId: "run-feedback",
              sequence: 1,
              occurredAt: "2026-09-26T00:00:00.000Z",
              type: "message.completed",
              message: assistantMessage,
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-feedback");
    const onCopyMessage = vi.fn(async () => true);
    const onPrevious = vi.fn(async () => undefined);
    const onNext = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-feedback"
            labels={{ formatTimestamp: () => "localized time" }}
            onCopyMessage={onCopyMessage}
            branchNavigation={{
              index: 2,
              count: 3,
              onPrevious,
              onNext,
            }}
          >
            <AgentKitChat composer={false} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-message-id="assistant-feedback"] button[aria-label="Copy message"]',
          )
          ?.click();
        await Promise.resolve();
      });
      expect(onCopyMessage).toHaveBeenCalledWith({
        message: assistantMessage,
        text: "Useful answer",
      });
      expect(container.querySelector("time")?.textContent).toBe(
        "localized time",
      );

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Not helpful"]')
          ?.click();
        await Promise.resolve();
      });
      const textarea = document.body.querySelector<HTMLTextAreaElement>(
        ".agentkit-feedback-popover textarea",
      );
      expect(textarea).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "The answer missed the key detail.");
        textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        const submit = Array.from(
          document.body.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) => button.textContent?.includes("Submit feedback"));
        submit?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(submitFeedback).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          threadId: "thread-feedback",
          messageId: "assistant-feedback",
          value: "negative",
          runId: "run-feedback",
          messageSeq: 1,
        }),
        expect.anything(),
      );
      expect(submitFeedback).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          threadId: "thread-feedback",
          messageId: "assistant-feedback",
          value: "negative",
          runId: "run-feedback",
          messageSeq: 1,
          reason: "The answer missed the key detail.",
        }),
        expect.anything(),
      );

      expect(container.textContent).toContain("2/3");
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Previous branch"]',
          )
          ?.click();
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Next branch"]')
          ?.click();
        await Promise.resolve();
      });
      expect(onPrevious).toHaveBeenCalledOnce();
      expect(onNext).toHaveBeenCalledOnce();
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("falls back to plain-text clipboard copy when the host declines handling", async () => {
    const message = {
      id: "assistant-copy-fallback",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Plain text answer" }],
    };
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-copy-fallback" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [message],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-copy-fallback");
    const onCopyMessage = vi.fn(async () => false);
    const writeText = vi.fn(async () => undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-copy-fallback"
            onCopyMessage={onCopyMessage}
          >
            <AgentMessageActions
              threadId="thread-copy-fallback"
              value={message}
            />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')
          ?.click();
        await Promise.resolve();
      });

      expect(onCopyMessage).toHaveBeenCalledWith({
        message,
        text: "Plain text answer",
      });
      expect(writeText).toHaveBeenCalledWith("Plain text answer");
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("keeps queue steering available during a run and moves queued items durably", async () => {
    const queuedMessages = [
      {
        id: "queued-first",
        threadId: "thread-queue",
        text: "First",
        createdAt: "2026-09-26T00:00:00.000Z",
      },
      {
        id: "queued-second",
        threadId: "thread-queue",
        text: "Second",
        createdAt: "2026-09-26T00:00:01.000Z",
        attachments: [
          {
            type: "file" as const,
            name: "diagram.png",
            mediaType: "image/png",
            url: "https://example.test/diagram.png",
          },
        ],
      },
    ];
    const moveQueuedMessageToTop = vi.fn(async () => undefined);
    const steerQueuedMessage = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      moveQueuedMessageToTop,
      steerQueuedMessage,
      async startRun() {
        return { runId: "run-queue" };
      },
      async *subscribeToRun({ signal }) {
        if (!signal) return;
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [],
          activeRunIds: ["run-active"],
          runs: [
            {
              id: "run-active",
              threadId,
              status: "running" as const,
              lastSequence: 0,
            },
          ],
          queuedMessages,
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-queue");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-queue">
            <AgentKitChat />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      expect(
        container
          .querySelector<HTMLImageElement>(
            'section[data-agent-message-queue="true"] img',
          )
          ?.getAttribute("src"),
      ).toBe("https://example.test/diagram.png");
      const steerButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          'section[data-agent-message-queue="true"] button',
        ),
      ).find((button) => button.textContent?.trim() === "Steer");
      expect(steerButton?.disabled).toBe(false);

      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-queue">
            <AgentKitChat composerProps={{ submissionDisabled: true }} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const blockedSteerButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          'section[data-agent-message-queue="true"] button',
        ),
      ).find((button) => button.textContent?.trim() === "Steer");
      expect(blockedSteerButton).toBeUndefined();
      expect(
        container.querySelector<HTMLButtonElement>(
          'section[data-agent-message-queue="true"] button[aria-label="Remove queued message"]',
        )?.disabled,
      ).toBe(false);

      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-queue">
            <AgentKitChat />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });

      const moreActions = container.querySelectorAll<HTMLButtonElement>(
        'section[data-agent-message-queue="true"] button[aria-label="More actions"]',
      );
      await act(async () => {
        moreActions[1]?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
      await act(async () => {
        const moveToTop =
          document.body.querySelector<HTMLElement>('[role="menuitem"]');
        expect(moveToTop?.textContent).toContain("Move to top");
        moveToTop?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(moveQueuedMessageToTop).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-queue",
          messageId: "queued-second",
        }),
        expect.anything(),
      );
      expect(
        client.getThread("thread-queue").queuedMessages.map(({ id }) => id),
      ).toEqual(["queued-second", "queued-first"]);

      await act(async () => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>(
            'section[data-agent-message-queue="true"] button',
          ),
        )
          .find((button) => button.textContent?.trim() === "Steer")
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(steerQueuedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-queue",
          messageId: "queued-second",
        }),
        expect.anything(),
      );
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("returns a detached transcript to bottom and restores automatic follow", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-scroll" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "assistant-scroll",
              role: "assistant",
              parts: [{ type: "text", text: "A long conversation." }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-scroll");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let scrollHeight = 400;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-scroll">
            <AgentKitChat composer={false} />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      const transcript = container.querySelector<HTMLElement>(
        ".agentkit-transcript",
      );
      expect(transcript).not.toBeNull();
      Object.defineProperty(transcript, "clientHeight", {
        configurable: true,
        value: 100,
      });
      Object.defineProperty(transcript, "scrollHeight", {
        configurable: true,
        get: () => scrollHeight,
      });
      transcript!.scrollTop = 0;
      await act(async () => {
        transcript?.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const returnButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Scroll to bottom"]',
      );
      expect(returnButton).not.toBeNull();
      await act(async () => {
        returnButton?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(transcript?.scrollTop).toBe(300);
      expect(
        container.querySelector('button[aria-label="Scroll to bottom"]'),
      ).toBeNull();

      scrollHeight = 500;
      await act(async () => {
        await client.sendMessage({ threadId: "thread-scroll", text: "Next" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(transcript?.scrollTop).toBe(400);
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("forwards plan-mode disabling and its explanation to the composer", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-plan" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider controller={client} threadId="thread-plan">
            <AgentKitChat
              composerProps={{
                autoFocus: false,
                planModeDisabled: true,
                planModeDisabledReason: "Plan mode requires Desktop.",
              }}
            />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });
      await act(async () => {
        const modeButton = container.querySelector<HTMLButtonElement>(
          'button[data-agent-composer-slot="mode-button"]',
        );
        expect(modeButton).not.toBeNull();
        modeButton!.click();
        await Promise.resolve();
        expect(modeButton!.getAttribute("aria-expanded")).toBe("true");
      });
      await vi.waitFor(() => {
        const planOption = Array.from(
          document.body.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) =>
          button.textContent?.includes("Plan mode requires Desktop."),
        );
        expect(planOption?.disabled).toBe(true);
        expect(planOption?.getAttribute("title")).toBe(
          "Plan mode requires Desktop.",
        );
      });
      expect(
        container
          .querySelector<HTMLButtonElement>(
            'button[data-agent-composer-slot="mode-button"]',
          )
          ?.getAttribute("aria-label"),
      ).toBe("Act mode");
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });
});
