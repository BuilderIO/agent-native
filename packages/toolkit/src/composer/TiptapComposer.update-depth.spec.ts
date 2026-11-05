// @vitest-environment happy-dom

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { TiptapComposer, type TiptapComposerHandle } from "./TiptapComposer.js";

const emptyChatModelAdapter: ChatModelAdapter = {
  async *run() {},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TiptapComposer editor updates", () => {
  it("settles plain text updates and reports inline reference changes", async () => {
    const onTextChange = vi.fn();
    const onReferencesChange = vi.fn();
    let handle: TiptapComposerHandle | null = null;
    let handleUpdates = 0;
    const focusRef = (next: TiptapComposerHandle | null) => {
      handle = next;
      if (next) handleUpdates += 1;
    };

    function Harness() {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return React.createElement(
        AssistantRuntimeProvider,
        { runtime },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TiptapComposer, {
            focusRef,
            onTextChange,
            onReferencesChange,
            includeDefaultSlashSkills: false,
            plusMenuMode: "hidden",
            voiceEnabled: false,
          }),
        ),
      );
    }

    await act(async () => {
      root.render(React.createElement(Harness));
    });
    await act(async () => handle?.insertTextAtCursor?.("Hello"));
    await act(async () => handle?.insertTextAtCursor?.(" world"));
    handleUpdates = 0;
    await act(async () => handle?.insertTextAtCursor?.("!"));

    expect(
      container.querySelector(".agent-composer-prosemirror")?.textContent,
    ).toBe("Hello world!");
    expect(onTextChange).toHaveBeenLastCalledWith("Hello world!");
    expect(handleUpdates).toBe(0);

    await act(async () =>
      handle?.insertReference({
        label: "Document",
        refType: "file",
        refId: "one",
      }),
    );
    expect(onReferencesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "Document", refId: "one" }),
    ]);
    await act(async () =>
      handle?.replaceReference("file", {
        label: "Updated",
        refType: "file",
        refId: "two",
      }),
    );
    expect(onReferencesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "Updated", refId: "two" }),
    ]);
    await act(async () => handle?.replaceReference("file", null));
    expect(onReferencesChange).toHaveBeenLastCalledWith([]);
  });
});
