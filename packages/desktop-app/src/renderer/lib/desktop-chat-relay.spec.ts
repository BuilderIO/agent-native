// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopChatRelayUnavailableError,
  installDesktopChatFetchRelay,
  resolveDesktopChatRelayBase,
  setDesktopChatRelayActive,
  setDesktopChatRelayBase,
} from "./desktop-chat-relay.js";

const requested: string[] = [];
const underlyingFetch = vi.fn(async (input: RequestInfo | URL) => {
  requested.push(input instanceof Request ? input.url : String(input));
  return new Response("{}", { status: 200 });
});

window.fetch = underlyingFetch as unknown as typeof window.fetch;
installDesktopChatFetchRelay();

describe("desktop chat relay URL", () => {
  it("derives a framework request base from the app chat endpoint", () => {
    expect(
      resolveDesktopChatRelayBase(
        "http://127.0.0.1:43123/desktop-chat/secret/mail/_agent-native/agent-chat",
      ),
    ).toBe("http://127.0.0.1:43123/desktop-chat/secret/mail");
  });

  it("fails closed for non-relay URLs", () => {
    expect(resolveDesktopChatRelayBase(null)).toBeNull();
    expect(resolveDesktopChatRelayBase("/_agent-native/agent-chat")).toBeNull();
  });

  afterEach(() => {
    requested.length = 0;
    setDesktopChatRelayBase("mail", null);
    setDesktopChatRelayBase("calendar", null);
    setDesktopChatRelayActive("mail", false);
    setDesktopChatRelayActive("calendar", false);
    underlyingFetch.mockClear();
  });

  it("routes unattributed framework fetches through the active shell", async () => {
    setDesktopChatRelayBase(
      "mail",
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase(
      "calendar",
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/agent-chat",
    );
    setDesktopChatRelayActive("calendar", true);

    await window.fetch("/_agent-native/poll");

    expect(requested).toEqual([
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/poll",
    ]);
  });

  it("keeps throwing when mounted shells do not name one active owner", () => {
    setDesktopChatRelayBase(
      "mail",
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase(
      "calendar",
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/agent-chat",
    );

    expect(() => window.fetch("/_agent-native/poll")).toThrow(
      /Unattributed .*mail, calendar/,
    );
  });
});

describe("desktop chat relay with no app mounted", () => {
  afterEach(async () => {
    // Resolving a base resets the backoff for the next test, same as a real
    // app mount would.
    setDesktopChatRelayBase(
      "reset",
      "http://127.0.0.1:1/desktop-chat/s/reset/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase("reset", null);
    underlyingFetch.mockClear();
    vi.useRealTimers();
  });

  it("rejects with a typed error instead of the doomed file:// fetch", async () => {
    vi.useFakeTimers();
    const rejection = expect(
      window.fetch("/_agent-native/application-state/foo"),
    ).rejects.toBeInstanceOf(DesktopChatRelayUnavailableError);
    await vi.runAllTimersAsync();
    await rejection;
    expect(underlyingFetch).not.toHaveBeenCalled();
  });

  it("backs off instead of hot-looping at ~350 req/s", async () => {
    vi.useFakeTimers();
    // A caller retrying immediately on every rejection — the worst case
    // that produced the measured storm — issues these back to back with no
    // awaited delay of its own.
    const rejections: unknown[] = [];
    const settle = (n: number) =>
      Array.from({ length: n }, () =>
        window.fetch("/_agent-native/application-state/foo").catch((e) => {
          rejections.push(e);
        }),
      );

    const promises = [...settle(4)];
    await Promise.resolve();
    expect(rejections).toHaveLength(0); // not synchronous

    await vi.advanceTimersByTimeAsync(250);
    expect(rejections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(rejections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rejections).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rejections).toHaveLength(4);

    expect(
      rejections.every((e) => e instanceof DesktopChatRelayUnavailableError),
    ).toBe(true);
    expect(underlyingFetch).not.toHaveBeenCalled();
    await Promise.all(promises);
  });

  it("resets the backoff once an app resolves a relay base", async () => {
    vi.useFakeTimers();
    const first = window
      .fetch("/_agent-native/application-state/foo")
      .catch(() => {});
    await vi.advanceTimersByTimeAsync(250); // first attempt clears at 250ms
    await first;

    setDesktopChatRelayBase(
      "mail",
      "http://127.0.0.1:1/desktop-chat/s/mail/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase("mail", null);

    const rejections: unknown[] = [];
    void window
      .fetch("/_agent-native/application-state/foo")
      .catch((e) => rejections.push(e));

    // Backoff restarted at the base delay, not the grown 500ms it would be
    // without the reset.
    await vi.advanceTimersByTimeAsync(249);
    expect(rejections).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(rejections).toHaveLength(1);
  });
});
