// @vitest-environment happy-dom

import { AgentKitClient as AgentKitClientImplementation } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

class AgentKitClient extends AgentKitClientImplementation {
  constructor(
    options: ConstructorParameters<typeof AgentKitClientImplementation>[0],
  ) {
    super({ ...options, aiSetupReadiness: "not-applicable" });
  }
}

async function renderEditableThread() {
  const transport: AgentTransport = {
    capabilities: { threadForking: true },
    async forkThread(input) {
      return {
        id: `${input.threadId}-fork`,
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
      };
    },
    async startRun() {
      return { runId: "run-edit" };
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
          onThreadForked={vi.fn()}
        >
          <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  const startEditing = async () => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit message"]')
        ?.click();
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
  return { container, startEditing, cleanup };
}

describe("AgentKit message editing", () => {
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
      expect(editor?.textContent).toBe("Original prompt");

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
        "Original prompt",
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
