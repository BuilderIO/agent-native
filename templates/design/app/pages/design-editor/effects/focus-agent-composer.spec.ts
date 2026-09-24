// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusAgentComposer } from "./focus-agent-composer";

function mountPanel(kind: "prosemirror" | "textarea") {
  const panel = document.createElement("div");
  panel.setAttribute("data-design-agent-panel", "");
  const composer =
    kind === "textarea"
      ? document.createElement("textarea")
      : Object.assign(document.createElement("div"), {
          className: "ProseMirror",
        });
  if (kind === "prosemirror") composer.setAttribute("contenteditable", "true");
  panel.append(composer);
  document.body.append(panel);
  return composer as HTMLElement;
}

/** Drain the queued rAF callbacks the retry loop schedules. */
async function frames(count: number) {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(16);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("focusAgentComposer", () => {
  it("lands the caret in a composer that is already mounted", async () => {
    const composer = mountPanel("prosemirror");
    focusAgentComposer();
    await frames(2);
    expect(document.activeElement).toBe(composer);
  });

  it("waits for a panel that mounts its editor a few frames late", async () => {
    focusAgentComposer();
    await frames(5);
    expect(document.activeElement).not.toBe(null);
    const composer = mountPanel("prosemirror");
    await frames(3);
    expect(document.activeElement).toBe(composer);
  });

  it("falls back to a plain textarea composer", async () => {
    const composer = mountPanel("textarea");
    focusAgentComposer();
    await frames(2);
    expect(document.activeElement).toBe(composer);
  });

  it("gives up rather than retrying forever when no panel appears", async () => {
    focusAgentComposer();
    await frames(80);
    const composer = mountPanel("prosemirror");
    await frames(5);
    expect(document.activeElement).not.toBe(composer);
  });

  it("keeps trying when focus() does not move the caret", async () => {
    // A composer rendered before its provider connects is disabled: present in
    // the panel but not focusable, so focus() silently no-ops. happy-dom will
    // focus anything, so the no-op is stubbed rather than reproduced.
    const composer = mountPanel("prosemirror");
    const realFocus = composer.focus.bind(composer);
    let focusable = false;
    composer.focus = () => {
      if (focusable) realFocus();
    };

    focusAgentComposer();
    await frames(4);
    expect(document.activeElement).not.toBe(composer);

    focusable = true;
    await frames(4);
    expect(document.activeElement).toBe(composer);
  });

  it("does not steal focus from a field the user started typing in", async () => {
    focusAgentComposer();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    mountPanel("prosemirror");
    await frames(5);
    expect(document.activeElement).toBe(input);
  });
});
