// @vitest-environment happy-dom

import { insertAgentComposerReference } from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/toolkit/composer";
import {
  AGENT_CHAT_INSERT_REFERENCE_EVENT,
  AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
  ComposerRuntimeAdaptersProvider,
  useComposerRuntimeAdapters,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer/runtime-adapters";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeferredBuilderConnectPopover } from "../../settings/deferred-builder-connect-popover.js";
import {
  CoreComposerRuntimeProvider,
  coreComposerAdapters,
} from "./runtime-adapters.js";

const formatters = { formatNumber: (value: number) => String(value) };
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => formatters,
  useT: () => translate,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CoreComposerRuntimeProvider", () => {
  it("keeps a blocked chat draft and links to Model settings after Send", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter basename="/reports" initialEntries={["/reports/home"]}>
          <ComposerRuntimeAdaptersProvider
            adapters={{
              translate,
              models: {
                ...coreComposerAdapters.models,
                BuilderSetupCard: () => null,
                useAgentEngineConfigured: () => ({
                  state: "missing",
                  missing: true,
                }),
                fetchAgentEngineConfiguredState: async () => "missing",
              },
            }}
          >
            <PromptComposer
              initialText="How did revenue trend by month?"
              onSubmit={onSubmit}
              requireAgentEngine
              showMissingApiKeySetup={false}
              showModelSelector={false}
              autoFocus={false}
              includeDefaultMentionSearch={false}
              includeDefaultSlashSkills={false}
              voiceEnabled={false}
            />
          </ComposerRuntimeAdaptersProvider>
        </MemoryRouter>,
      );
    });

    const send = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="send-button"]',
    );
    await vi.waitFor(() => expect(send?.disabled).toBe(false));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => send?.click());

    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent ?? "").toContain(
      "agentChat.setup.connectToChat",
    );
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe(
      "/reports/settings/model",
    );
    expect(container.querySelector(".ProseMirror")?.textContent).toBe(
      "How did revenue trend by month?",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("receives references sent by the core custom-event and postMessage helper", async () => {
    const customReferences: unknown[] = [];
    const messageReferences: unknown[] = [];
    const handleEvent = (event: Event) =>
      customReferences.push((event as CustomEvent).detail);
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE)
        messageReferences.push(event.data.data);
    };
    window.addEventListener(AGENT_CHAT_INSERT_REFERENCE_EVENT, handleEvent);
    window.addEventListener("message", handleMessage);
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation((data) => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    try {
      insertAgentComposerReference({
        label: "Reference",
        refType: "file",
        refId: "/reference.md",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(customReferences).toHaveLength(1);
      expect(postMessage).toHaveBeenCalledOnce();
      expect(messageReferences).toEqual(customReferences);
      expect(customReferences[0]).toMatchObject({
        label: "Reference",
        refType: "file",
        refId: "/reference.md",
      });
    } finally {
      postMessage.mockRestore();
      window.removeEventListener(
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        handleEvent,
      );
      window.removeEventListener("message", handleMessage);
    }
  });
  it("keeps the adapters identity across re-renders", () => {
    const seen: ComposerRuntimeAdapters[] = [];
    function Consumer({ tick }: { tick: number }) {
      seen.push(useComposerRuntimeAdapters());
      return <span>{tick}</span>;
    }
    const render = (tick: number) =>
      act(() => {
        root.render(
          <CoreComposerRuntimeProvider>
            <Consumer tick={tick} />
          </CoreComposerRuntimeProvider>,
        );
      });

    render(1);
    render(2);
    render(3);

    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it("routes composer Builder connects through the consent popover", () => {
    // Without it, the model picker and voice setup fall back to sign-in only.
    expect(coreComposerAdapters.builder?.BuilderConnectPopover).toBe(
      DeferredBuilderConnectPopover,
    );
  });

  it("offers composer credits only where commercial surfaces are shown", () => {
    expect(coreComposerAdapters.builder?.creditsOffered?.()).toBe(true);
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      billing: { commercialSurfaces: "hide" },
    });
    try {
      expect(coreComposerAdapters.builder?.creditsOffered?.()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
