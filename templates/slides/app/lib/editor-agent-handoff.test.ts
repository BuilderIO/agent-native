// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDrawingHandoffPrompt,
  buildSelectionHandoffPrompt,
  sendEditorPromptToAgent,
} from "./editor-agent-handoff";

interface Handoff {
  events: string[];
  posts: Array<Record<string, unknown>>;
  eventsBeforeFirstPost: string[];
}

function captureHandoff(run: () => void): Handoff {
  const events: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  let eventsBeforeFirstPost: string[] | null = null;
  const realDispatch = window.dispatchEvent.bind(window);

  vi.spyOn(window, "dispatchEvent").mockImplementation((event: Event) => {
    events.push(event.type);
    return realDispatch(event);
  });
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    const envelope = message as {
      type?: string;
      data?: Record<string, unknown>;
    };
    if (envelope?.type !== "agentNative.submitChat" || !envelope.data) return;
    if (eventsBeforeFirstPost === null) eventsBeforeFirstPost = [...events];
    posts.push(envelope.data);
  });

  vi.useFakeTimers();
  try {
    run();
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }

  return { events, posts, eventsBeforeFirstPost: eventsBeforeFirstPost ?? [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("multi-select send to agent", () => {
  it("opens the agent panel and sends the selection when the panel is closed", () => {
    const prompt = buildSelectionHandoffPrompt({
      slideNumber: 3,
      slideId: "slide-abc",
      selectors: [".title", ".body", ".chart", ".caption"],
    });
    expect(prompt).not.toBeNull();

    const handoff = captureHandoff(() => sendEditorPromptToAgent(prompt!));

    expect(handoff.eventsBeforeFirstPost).toContain("agent-panel:open");
    expect(handoff.posts).toHaveLength(1);
    expect(handoff.posts[0].message).toBe(
      "[Current selection on slide 3 (slide-abc): .title, .body, .chart, .caption]\n",
    );
    expect(handoff.posts[0].submit).toBe(false);
    expect(handoff.posts[0].submitMessageId).toEqual(expect.any(String));
  });

  it("still opens the panel and sends when the panel is already open", () => {
    let panelOpen = false;
    window.addEventListener("agent-panel:open", () => {
      panelOpen = true;
    });
    const prompt = buildSelectionHandoffPrompt({
      slideNumber: 1,
      slideId: "slide-1",
      selectors: [".a"],
    });

    const first = captureHandoff(() => sendEditorPromptToAgent(prompt!));
    expect(panelOpen).toBe(true);
    vi.restoreAllMocks();

    const second = captureHandoff(() => sendEditorPromptToAgent(prompt!));

    expect(second.events).toContain("agent-panel:open");
    expect(second.posts).toHaveLength(1);
    expect(second.posts[0].message).toBe(first.posts[0].message);
    expect(second.posts[0].submit).toBe(false);
  });

  it("sends nothing when no elements are selected", () => {
    expect(
      buildSelectionHandoffPrompt({
        slideNumber: 1,
        slideId: "slide-1",
        selectors: [],
      }),
    ).toBeNull();
  });
});

describe("other editor entry points that hand content to the agent", () => {
  it("opens the agent panel when sending a drawing", () => {
    const handoff = captureHandoff(() =>
      sendEditorPromptToAgent(
        buildDrawingHandoffPrompt({
          slideId: "slide-9",
          annotations: [
            {
              id: "a1",
              type: "path",
              pathData: "M0 0 L10 10",
              color: "#ff0000",
              lineWidth: 3,
              position: { x: 0, y: 0 },
            },
            {
              id: "a2",
              type: "text",
              text: "tighten",
              color: "#00ff00",
              lineWidth: 2,
              position: { x: 12.6, y: 40.2 },
            },
          ],
          instruction: "Move this box left",
          canvasSize: { width: 1280.4, height: 720.6 },
        }),
      ),
    );

    expect(handoff.eventsBeforeFirstPost).toContain("agent-panel:open");
    expect(handoff.posts[0].submit).toBe(true);
    expect(handoff.posts[0].message).toContain("[Drawing on slide slide-9]");
    expect(handoff.posts[0].message).toContain("Canvas size: 1280x721");
    expect(handoff.posts[0].message).toContain(
      "[stroke #ff0000 w=3] M0 0 L10 10",
    );
    expect(handoff.posts[0].message).toContain('[label "tighten" at 13,40]');
    expect(handoff.posts[0].message).toContain("Move this box left");
  });

  it("falls back to a default instruction when the drawing has no prompt", () => {
    expect(
      buildDrawingHandoffPrompt({
        slideId: "slide-9",
        annotations: [],
        instruction: "",
        canvasSize: { width: 100, height: 100 },
      }).message,
    ).toContain("Apply these annotations to the slide.");
  });

  it("opens the agent panel when applying pending visual updates", () => {
    const handoff = captureHandoff(() =>
      sendEditorPromptToAgent({
        message: "Apply the pending visual updates",
        submit: true,
      }),
    );

    expect(handoff.eventsBeforeFirstPost).toContain("agent-panel:open");
    expect(handoff.posts[0].message).toBe("Apply the pending visual updates");
  });
});
