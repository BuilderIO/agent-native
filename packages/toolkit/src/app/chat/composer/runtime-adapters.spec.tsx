// @vitest-environment happy-dom

import { insertAgentComposerReference } from "@agent-native/core/client/agent-chat";
import {
  AGENT_CHAT_INSERT_REFERENCE_EVENT,
  AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
  useComposerRuntimeAdapters,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer/runtime-adapters";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
});
