// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { focusAgentChat } from "./agent-sidebar-events";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function addComposer(state = "open", tag = "textarea") {
  const panel = document.createElement("section");
  panel.className = "agent-sidebar-panel";
  panel.dataset.agentSidebarState = state;
  const composer = document.createElement(tag);
  if (tag === "div") {
    composer.className = "ProseMirror";
    composer.setAttribute("contenteditable", "true");
    composer.tabIndex = 0;
  }
  panel.append(composer);
  document.body.append(panel);
  return composer;
}

it("requests chat mode and opening with focus, then focuses the visible composer", () => {
  const events: unknown[] = [];
  const mode = (event: Event) =>
    events.push([event.type, (event as CustomEvent).detail]);
  window.addEventListener("agent-panel:set-mode", mode, { once: true });
  window.addEventListener("agent-panel:open", mode, { once: true });
  const composer = addComposer();
  focusAgentChat();
  expect(events).toEqual([
    ["agent-panel:set-mode", { mode: "chat" }],
    ["agent-panel:open", { focus: true }],
  ]);
  vi.advanceTimersByTime(0);
  expect(document.activeElement).toBe(composer);
});

it("retries focus when the chat body loads after the opening event", () => {
  focusAgentChat();
  vi.advanceTimersByTime(1750);
  const composer = addComposer("open", "div");
  vi.advanceTimersByTime(50);
  expect(document.activeElement).toBe(composer);
});

it("does not focus a closed panel or a disabled composer", () => {
  const closed = addComposer("closed");
  const disabled = addComposer();
  disabled.setAttribute("disabled", "");
  focusAgentChat();
  vi.runAllTimers();
  expect(document.activeElement).not.toBe(closed);
  expect(document.activeElement).not.toBe(disabled);
});

it("stops retrying after two seconds", () => {
  focusAgentChat();
  vi.advanceTimersByTime(2100);
  const composer = addComposer();
  vi.runAllTimers();
  expect(document.activeElement).not.toBe(composer);
  expect(vi.getTimerCount()).toBe(0);
});
