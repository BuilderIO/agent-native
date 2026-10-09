// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  requireAgentEngine: undefined as boolean | undefined,
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@agent-native/toolkit/app/chat/composer", async () => {
  const { createElement } = await import("react");
  return {
    isLocalRuntimeEngine: (engine?: string) =>
      ["codex-cli", "claude-cli", "pi-cli", "opencode-cli"].includes(
        engine ?? "",
      ),
    PromptComposer: (props: {
      requireAgentEngine?: boolean;
      onBeforeSubmit?: () => boolean | Promise<boolean>;
      onSubmit: (
        text: string,
        files: File[],
        references: unknown[],
        options: { intent: "immediate" },
      ) => void | Promise<void>;
    }) => {
      mocks.requireAgentEngine = props.requireAgentEngine;
      return createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void (async () => {
              if ((await props.onBeforeSubmit?.()) === false) return;
              await props.onSubmit("Follow up", [], [], {
                intent: "immediate",
              });
            })();
          },
        },
        "Send follow-up",
      );
    },
  };
});

import type { CodeAgentsHost } from "./CodeAgentsApp.js";
import { SessionWatchPanel } from "./SessionWatchPanel.js";
import type { CodeAgentRun } from "./types.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.toast.mockReset();
  mocks.requireAgentEngine = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function createHost(configured: boolean | undefined) {
  const appendFollowUp = vi.fn(async () => ({ ok: true, message: "sent" }));
  const getHostMetadata = vi.fn(async () =>
    configured === undefined
      ? { status: "unavailable" as const }
      : { status: "ok" as const, llmProvider: { configured } },
  );
  const host = {
    appendFollowUp,
    getHostMetadata,
    readTranscript: vi.fn(async () => ({
      status: "ok" as const,
      runId: "run-1",
      events: [],
    })),
  } as unknown as CodeAgentsHost;
  return { host, appendFollowUp, getHostMetadata };
}

async function submitFollowUp() {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Send follow-up",
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render(host: CodeAgentsHost, engine?: string) {
  act(() => {
    root.render(
      React.createElement(SessionWatchPanel, {
        host,
        run: {
          id: "run-1",
          goalId: "goal-1",
          ...(engine ? { metadata: { engine } } : {}),
        } as CodeAgentRun,
        onClose: vi.fn(),
      }),
    );
  });
}

describe("SessionWatchPanel AI readiness", () => {
  it.each([
    ["missing provider", false],
    ["unavailable host status", undefined],
  ])(
    "blocks follow-up dispatch when readiness is %s",
    async (_label, configured) => {
      const { host, appendFollowUp, getHostMetadata } = createHost(configured);
      render(host);

      await submitFollowUp();

      expect(mocks.requireAgentEngine).toBeUndefined();
      expect(getHostMetadata).toHaveBeenCalledOnce();
      expect(appendFollowUp).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledOnce();
    },
  );

  it("uses host readiness and reaches IPC when a provider is configured", async () => {
    const { host, appendFollowUp, getHostMetadata } = createHost(true);
    render(host);

    await submitFollowUp();

    expect(mocks.requireAgentEngine).toBeUndefined();
    expect(getHostMetadata).toHaveBeenCalledOnce();
    expect(appendFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Follow up", runId: "run-1" }),
    );
    expect(mocks.toast).toHaveBeenCalledWith("Message sent to session", {
      duration: 1600,
    });
  });

  it("keeps the local-runtime exemption and leaves final admission to IPC", async () => {
    const { host, appendFollowUp, getHostMetadata } = createHost(undefined);
    render(host, "codex-cli");

    await submitFollowUp();

    expect(getHostMetadata).not.toHaveBeenCalled();
    expect(appendFollowUp).toHaveBeenCalledOnce();
  });
});
