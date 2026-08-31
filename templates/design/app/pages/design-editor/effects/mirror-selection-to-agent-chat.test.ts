import { beforeEach, describe, expect, it, vi } from "vitest";

const setAgentChatContextItemMock = vi.hoisted(() => vi.fn());
const removeAgentChatContextItemMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/agent-chat", () => ({
  setAgentChatContextItem: setAgentChatContextItemMock,
  removeAgentChatContextItem: removeAgentChatContextItemMock,
}));

import type { ElementInfo } from "@/components/design/types";

import { runMirrorSelectionToAgentChat } from "./mirror-selection-to-agent-chat";

function makeRefs() {
  return {
    composerContextHasOurKeyRef: { current: true },
    mirroredExcerptRef: { current: null as string | null },
    mirroredSelectionIdRef: { current: null as string | null },
    sentSelectionIdRef: { current: null as string | null },
  };
}

const selectedElement: ElementInfo = {
  tagName: "div",
  classes: [],
  sourceId: "node-1",
  selector: "#node-1",
} as unknown as ElementInfo;

function baseArgs(refs: ReturnType<typeof makeRefs>, content: string) {
  return {
    activeFile: { id: "file-1", filename: "index.html" } as any,
    activeProjectionContent: content,
    composerContextHasOurKeyRef: refs.composerContextHasOurKeyRef,
    design: { title: "My design" } as any,
    id: "design-1",
    isSignedIn: true,
    mirroredExcerptRef: refs.mirroredExcerptRef,
    mirroredSelectionIdRef: refs.mirroredSelectionIdRef,
    selectedCodeLayerNode: {
      layerName: "Card",
      id: "layer-1",
      dataAttributes: {},
      selector: "#node-1",
      source: { start: 0, end: content.length },
    } as any,
    selectedElement,
    sentSelectionIdRef: refs.sentSelectionIdRef,
  };
}

describe("runMirrorSelectionToAgentChat", () => {
  beforeEach(() => {
    setAgentChatContextItemMock.mockClear();
    removeAgentChatContextItemMock.mockClear();
  });

  it("does not republish when the same unsent selection's markup is unchanged", () => {
    const refs = makeRefs();
    const html = '<div style="color:red">A</div>';

    runMirrorSelectionToAgentChat(baseArgs(refs, html));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);

    runMirrorSelectionToAgentChat(baseArgs(refs, html));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);
  });

  it("republishes fresh markup when the same still-unsent selection's markup changes", () => {
    const refs = makeRefs();
    const before = '<div style="color:red">A</div>';
    const after = '<div style="color:blue">A</div>';

    runMirrorSelectionToAgentChat(baseArgs(refs, before));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);
    expect(setAgentChatContextItemMock.mock.calls[0]![0].context).toContain(
      "color:red",
    );

    // The selection never changed and was never sent, but the node's own
    // markup was edited live (e.g. via the inspector) — the mirrored
    // "reference" context must pick up the new values instead of keeping
    // the stale ones from the first selection.
    runMirrorSelectionToAgentChat(baseArgs(refs, after));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(2);
    expect(setAgentChatContextItemMock.mock.calls[1]![0].context).toContain(
      "color:blue",
    );
  });

  it("does not resurrect a sent selection just because unrelated content changed", () => {
    const refs = makeRefs();
    const html = '<div style="color:red">A</div>';

    runMirrorSelectionToAgentChat(baseArgs(refs, html));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);

    // Simulate a send: the composer no longer carries our key.
    refs.composerContextHasOurKeyRef.current = false;
    runMirrorSelectionToAgentChat(baseArgs(refs, html));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);

    // An unrelated poll during the resulting agent run changes the document,
    // but must not resurrect the already-sent chip for the same selection.
    const polledHtml = '<div style="color:green">A</div>';
    runMirrorSelectionToAgentChat(baseArgs(refs, polledHtml));
    expect(setAgentChatContextItemMock).toHaveBeenCalledTimes(1);
  });
});
