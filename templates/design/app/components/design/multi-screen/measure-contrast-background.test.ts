// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestTextBackground } from "./measure-contrast-background";

afterEach(() => {
  vi.useRealTimers();
});

const layers = [
  {
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    opacity: "1",
    mixBlendMode: "normal",
  },
  {
    backgroundColor: "rgb(17, 24, 39)",
    backgroundImage: "none",
    opacity: "1",
    mixBlendMode: "normal",
  },
];

function fakeFrame() {
  const frame = { postMessage: vi.fn() };
  return {
    window: frame as unknown as Window,
    sent: () => frame.postMessage.mock.calls[0]![0] as Record<string, unknown>,
  };
}

function reply(source: Window, data: Record<string, unknown>): void {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

describe("requestTextBackground", () => {
  it("is unavailable at once when there is no canvas iframe to ask", async () => {
    await expect(
      requestTextBackground({
        screenId: "s1",
        selector: "#t",
        targetWindows: () => [],
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "no-screen" });
  });

  it("asks each canvas iframe for the paint behind the selector", async () => {
    const frame = fakeFrame();
    const pending = requestTextBackground({
      screenId: "s1",
      selector: "#t",
      targetWindows: () => [frame.window],
    });
    expect(frame.sent()).toMatchObject({
      type: "agent-native:measure-contrast-background",
      screenId: "s1",
      selector: "#t",
    });
    reply(frame.window, {
      type: "agent-native:contrast-background-measured",
      correlationId: frame.sent().correlationId,
      screenId: "s1",
      payload: layers,
    });
    await expect(pending).resolves.toEqual({
      kind: "ready",
      color: { r: 17, g: 24, b: 39 },
    });
  });

  it("is unavailable, not a guess, when no iframe answers in time", async () => {
    vi.useFakeTimers();
    const frame = fakeFrame();
    const pending = requestTextBackground({
      screenId: "s1",
      selector: "#t",
      targetWindows: () => [frame.window],
      timeoutMs: 400,
    });
    await vi.advanceTimersByTimeAsync(401);
    await expect(pending).resolves.toEqual({
      kind: "unavailable",
      reason: "no-screen",
    });
  });

  it("ignores answers from other windows, requests and screens", async () => {
    vi.useFakeTimers();
    const frame = fakeFrame();
    const stranger = fakeFrame();
    const pending = requestTextBackground({
      screenId: "s1",
      selector: "#t",
      targetWindows: () => [frame.window],
      timeoutMs: 100,
    });
    const correlationId = frame.sent().correlationId;
    const answer = {
      type: "agent-native:contrast-background-measured",
      correlationId,
      screenId: "s1",
      payload: layers,
    };
    reply(stranger.window, answer);
    reply(frame.window, { ...answer, correlationId: "someone-else" });
    reply(frame.window, { ...answer, screenId: "s2" });
    reply(frame.window, { ...answer, type: "agent-native:other" });
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toEqual({
      kind: "unavailable",
      reason: "no-screen",
    });
  });

  it("is unavailable when the answer is not a list of layers", async () => {
    const frame = fakeFrame();
    const pending = requestTextBackground({
      screenId: "s1",
      selector: "#t",
      targetWindows: () => [frame.window],
    });
    reply(frame.window, {
      type: "agent-native:contrast-background-measured",
      correlationId: frame.sent().correlationId,
      screenId: "s1",
      payload: null,
    });
    await expect(pending).resolves.toEqual({
      kind: "unavailable",
      reason: "bad-reply",
    });
  });

  it("stops listening once it has an answer", async () => {
    const frame = fakeFrame();
    const remove = vi.spyOn(window, "removeEventListener");
    const pending = requestTextBackground({
      screenId: "s1",
      selector: "#t",
      targetWindows: () => [frame.window],
    });
    reply(frame.window, {
      type: "agent-native:contrast-background-measured",
      correlationId: frame.sent().correlationId,
      screenId: "s1",
      payload: layers,
    });
    await pending;
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    remove.mockRestore();
  });
});
