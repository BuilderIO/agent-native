// @vitest-environment happy-dom
//
// `agentNative.chatRunning` is a window-wide event, so a design editor sees
// runs that belong to other designs. Regression cover for a brand-new design
// adopting the previously created design's run: that run's completion then
// cleared the new design's queued prompt before it was ever submitted, leaving
// a blank canvas while the other design kept being edited.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(() => "chat-new-tab"),
}));

import {
  clearPendingGeneration,
  hasFreshPendingGeneration,
  patchPendingGeneration,
  readPendingGeneration,
  writePendingGeneration,
} from "@/lib/pending-generation";

import { useAgentGenerating } from "./use-agent-generating";

const DESIGN = "design-b";
const OWN_RUN_TAB = "chat-design-b-run";
const FOREIGN_RUN_TAB = "chat-design-a-run";

/**
 * Mirrors how DesignEditor wires the hook: adoption is limited to the run this
 * design recorded, and completion clears this design's pending generation
 * (DesignEditor.tsx `shouldAdoptRunningTab` / `handleGenerationComplete`).
 */
function Probe(props: {
  designId: string;
  onAdopt: (tabId: string) => void;
  onComplete: (tabId: string | null) => void;
}) {
  useAgentGenerating({
    shouldAdoptRunningTab: (tabId) =>
      Boolean(props.designId) &&
      hasFreshPendingGeneration(props.designId) &&
      readPendingGeneration(props.designId)?.runTabId === tabId,
    onAdoptRunningTab: props.onAdopt,
    onComplete: (tabId) => {
      window.setTimeout(() => {
        props.onComplete(tabId);
        clearPendingGeneration(props.designId);
      }, 4000);
    },
  });
  return null;
}

describe("design generation run ownership", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const adopted: string[] = [];
  const completed: (string | null)[] = [];

  async function renderProbe() {
    await act(async () => {
      root.render(
        <Probe
          designId={DESIGN}
          onAdopt={(tabId) => adopted.push(tabId)}
          onComplete={(tabId) => completed.push(tabId)}
        />,
      );
    });
  }

  async function chatRunning(isRunning: boolean, tabId: string) {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning, tabId },
        }),
      );
    });
    await act(async () => {
      // 4s stop debounce in the hook + 4s completion timer in DesignEditor.
      vi.advanceTimersByTime(8000);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    window.sessionStorage.clear();
    adopted.length = 0;
    completed.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("ignores a run belonging to another design and keeps this design's queued prompt", async () => {
    writePendingGeneration(DESIGN, { prompt: "Create a pricing page" });
    await renderProbe();

    // The previously created design's thread reconnects to its live run and
    // broadcasts, then that run stops.
    await chatRunning(true, FOREIGN_RUN_TAB);
    expect(adopted).toEqual([]);

    await chatRunning(false, FOREIGN_RUN_TAB);
    expect(completed).toEqual([]);
    expect(readPendingGeneration(DESIGN)?.prompt).toBe("Create a pricing page");
    expect(hasFreshPendingGeneration(DESIGN)).toBe(true);
  });

  it("re-adopts the run this design queued, and completes on its stop", async () => {
    writePendingGeneration(DESIGN, { prompt: "Create a pricing page" });
    patchPendingGeneration(DESIGN, { runTabId: OWN_RUN_TAB });
    await renderProbe();

    await chatRunning(true, OWN_RUN_TAB);
    expect(adopted).toEqual([OWN_RUN_TAB]);

    await chatRunning(false, OWN_RUN_TAB);
    expect(completed).toEqual([OWN_RUN_TAB]);
    expect(readPendingGeneration(DESIGN)).toBeNull();
  });
});
