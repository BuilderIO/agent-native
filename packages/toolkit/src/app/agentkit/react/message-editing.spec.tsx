// @vitest-environment happy-dom

import { AgentKitClient as AgentKitClientImplementation } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import type { AgentChatContextItem } from "@agent-native/core/client/agent-chat";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import type { TiptapComposerHandle } from "../../../composer/TiptapComposer.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

class AgentKitClient extends AgentKitClientImplementation {
  constructor(
    options: ConstructorParameters<typeof AgentKitClientImplementation>[0],
  ) {
    super({ ...options, aiSetupReadiness: "not-applicable" });
  }
}

async function renderEditableThread(
  hiddenContextItems: AgentChatContextItem[] = [],
) {
  const composerRef = createRef<TiptapComposerHandle>();
  const startRun = vi.fn(async () => ({ runId: "run-edit" }));
  const onThreadForked = vi.fn();
  const forkThread = vi.fn(async (input: { threadId: string }) => ({
    id: `${input.threadId}-fork`,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  }));
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
            parts: [{ type: "text", text: "First prompt" }],
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
          threadId="thread-edit"
          onThreadForked={onThreadForked}
        >
          <AgentKitChat
            composerProps={{
              autoFocus: false,
              modelStatusChecksEnabled: false,
              composerRef,
              hiddenContextItems,
            }}
          />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  const startEditing = async () => {
    await act(async () => {
      const edit = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Edit message"]',
      );
      if (!edit) throw new Error("Edit button is missing");
      edit.focus();
      edit.click();
      await Promise.resolve();
    });
  };
  const cleanup = async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await client.shutdown();
    container.remove();
    vi.unstubAllGlobals();
  };
  return {
    container,
    startEditing,
    cleanup,
    startRun,
    forkThread,
    composerRef,
    onThreadForked,
  };
}

describe("AgentKit message editing", () => {
  it("opens the edited first prompt's fork after the new run is registered", async () => {
    const {
      container,
      startEditing,
      cleanup,
      startRun,
      forkThread,
      composerRef,
      onThreadForked,
    } = await renderEditableThread();
    let resolveRun = (_receipt: { runId: string }): void => {};
    startRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );
    try {
      await startEditing();
      await act(async () => composerRef.current!.setText("Edited request"));
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-agent-composer-slot="send-button"]',
          )!
          .click();
      });
      await vi.waitFor(() => expect(startRun).toHaveBeenCalledOnce());
      expect(forkThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-edit",
          beforeMessageId: "user-edit",
          forkPurpose: "edit",
          fromMessageId: undefined,
        }),
        expect.anything(),
      );
      expect(startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-edit-fork",
          messages: [
            expect.objectContaining({
              role: "user",
              parts: [{ type: "text", text: "Edited request" }],
            }),
          ],
        }),
        expect.anything(),
      );
      expect(onThreadForked).not.toHaveBeenCalled();
      await act(async () => resolveRun({ runId: "run-edit" }));
      expect(onThreadForked).toHaveBeenCalledWith(
        expect.objectContaining({ id: "thread-edit-fork" }),
      );
    } finally {
      await cleanup();
    }
  });

  it("keeps hidden context items on an edited message", async () => {
    const { container, startEditing, cleanup, startRun, composerRef } =
      await renderEditableThread([
        {
          key: "agent-current-resource-context",
          title: "Document",
          context: "Resource context: document:doc-1",
        },
      ]);
    try {
      await startEditing();
      await act(async () => composerRef.current?.setText("Edited request"));
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-agent-composer-slot="send-button"]',
          )
          ?.click();
      });
      await vi.waitFor(() => expect(startRun).toHaveBeenCalledOnce());
      expect(JSON.stringify(startRun.mock.calls[0])).toContain(
        "Resource context: document:doc-1",
      );
    } finally {
      await cleanup();
    }
  });

  it("focuses the editor when Edit is selected in a chat without autofocus", async () => {
    const { container, startEditing, cleanup } = await renderEditableThread();
    try {
      await startEditing();
      const editor = container.querySelector('[contenteditable="true"]');
      expect(editor?.textContent).toBe("First prompt");
      await vi.waitFor(() => expect(document.activeElement).toBe(editor));
    } finally {
      await cleanup();
    }
  });

  it("labels the edit above the editor and marks the source message", async () => {
    const { container, startEditing, cleanup } = await renderEditableThread();
    try {
      expect(
        container.querySelector('[data-agent-composer-slot="header-row"]'),
      ).toBeNull();
      expect(
        container
          .querySelector('[data-message-id="user-edit"]')
          ?.hasAttribute("data-editing"),
      ).toBe(false);

      await startEditing();

      const headerRow = container.querySelector<HTMLElement>(
        '[data-agent-composer-slot="header-row"]',
      );
      const editorWrap = container.querySelector(
        '[data-agent-composer-slot="editor-wrap"]',
      );
      expect(headerRow).not.toBeNull();
      expect(
        headerRow!.compareDocumentPosition(editorWrap!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const row = headerRow!.querySelector<HTMLElement>(
        '[data-agentkit-editing-row="true"]',
      );
      expect(row?.getAttribute("role")).toBe("group");
      const labelId = row?.getAttribute("aria-labelledby");
      expect(labelId && document.getElementById(labelId)?.textContent).toBe(
        "Editing message",
      );
      const cancel = Array.from(row!.querySelectorAll("button")).find(
        (button) => button.textContent === "Cancel",
      );
      expect(cancel?.className).toContain("h-6");
      expect(
        container
          .querySelector('[data-message-id="user-edit"]')
          ?.getAttribute("data-editing"),
      ).toBe("true");
      expect(
        container
          .querySelector('[data-agent-composer-slot="toolbar"]')
          ?.querySelector('button[aria-label="Cancel"]'),
      ).toBeNull();

      await act(async () => {
        cancel?.click();
        await Promise.resolve();
      });
      expect(
        container.querySelector('[data-agentkit-editing-row="true"]'),
      ).toBeNull();
      expect(
        container
          .querySelector('[data-message-id="user-edit"]')
          ?.hasAttribute("data-editing"),
      ).toBe(false);
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe("");
    } finally {
      await cleanup();
    }
  });

  it("cancels editing on Escape in the editor", async () => {
    const { container, startEditing, cleanup } = await renderEditableThread();
    try {
      await startEditing();
      const editor = container.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      expect(editor?.textContent).toBe("First prompt");

      await act(async () => {
        editor?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await Promise.resolve();
      });

      expect(
        container.querySelector('[data-agentkit-editing-row="true"]'),
      ).toBeNull();
      expect(
        container
          .querySelector('[data-message-id="user-edit"]')
          ?.hasAttribute("data-editing"),
      ).toBe(false);
    } finally {
      await cleanup();
    }
  });
  it("recalls the last sent message with ArrowUp in an empty composer", async () => {
    const { container, cleanup } = await renderEditableThread();
    try {
      const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
      const event = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        editor.dispatchEvent(event);
        await Promise.resolve();
      });

      expect(event.defaultPrevented).toBe(true);
      expect(
        container
          .querySelector('[data-message-id="user-edit"]')
          ?.hasAttribute("data-editing"),
      ).toBe(true);
      expect(container.querySelector(".ProseMirror")?.textContent).toBe(
        "First prompt",
      );
    } finally {
      await cleanup();
    }
  });

  it("reads as a reply once the thread has messages", async () => {
    const { container, cleanup } = await renderEditableThread();
    try {
      expect(
        container
          .querySelector(".ProseMirror p[data-placeholder]")
          ?.getAttribute("data-placeholder"),
      ).toBe("Reply…");
    } finally {
      await cleanup();
    }
  });
});
