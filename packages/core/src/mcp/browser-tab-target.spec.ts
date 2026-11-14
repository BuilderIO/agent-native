import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserTabTarget } from "../server/request-context.js";
import {
  browserTabTargetNote,
  createBrowserTabTargetSlot,
  withBrowserTabTargetNote,
} from "./browser-tab-target.js";

const findLastUsedBrowserTab = vi.fn<() => Promise<BrowserTabTarget>>();
let userEmail: string | undefined;

vi.mock("../application-state/last-used-tab.js", () => ({
  LAST_USED_BROWSER_TAB_MAX_AGE_MS: 12 * 60 * 60 * 1000,
  findLastUsedBrowserTab: (...args: unknown[]) =>
    findLastUsedBrowserTab(...(args as [])),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => userEmail,
}));

const NOW = 1_800_000_000_000;
const LAST_USED: BrowserTabTarget = {
  kind: "last-used",
  tabId: "tab-b",
  usedAt: NOW - 5 * 60_000,
};

beforeEach(() => {
  userEmail = "alice@example.com";
  findLastUsedBrowserTab.mockReset();
  findLastUsedBrowserTab.mockResolvedValue(LAST_USED);
});

describe("a call's browser tab target", () => {
  it("looks up the user's last-used tab once, however often the call asks", async () => {
    const slot = createBrowserTabTargetSlot();
    expect(slot.resolved).toBeUndefined();

    const [first, second] = await Promise.all([slot.resolve(), slot.resolve()]);
    await slot.resolve();

    expect(first).toEqual(LAST_USED);
    expect(second).toBe(first);
    expect(slot.resolved).toBe(first);
    expect(findLastUsedBrowserTab).toHaveBeenCalledTimes(1);
    expect(findLastUsedBrowserTab).toHaveBeenCalledWith("alice@example.com");
  });

  it("finds no tab for a call with no signed-in user, without looking", async () => {
    userEmail = undefined;
    const slot = createBrowserTabTargetSlot();

    await expect(slot.resolve()).resolves.toEqual({ kind: "unavailable" });
    expect(slot.resolved).toEqual({ kind: "unavailable" });
    expect(findLastUsedBrowserTab).not.toHaveBeenCalled();
  });
});

describe("the note a call's result gets", () => {
  const usedAgo = (ms: number) =>
    browserTabTargetNote(
      { kind: "last-used", tabId: "tab-b", usedAt: NOW - ms },
      NOW,
    );

  it("says the call used the most recently used tab, and when it was used", () => {
    expect(usedAgo(5 * 60_000)).toBe(
      "Browser tab: this call used the user's most recently used tab of this app (last used 5 min ago). A navigate command reaches that tab only while it stays open, and this result doesn't confirm that it moved.",
    );
    expect(usedAgo(59_999)).toContain("(last used less than a minute ago)");
    expect(usedAgo(-60_000)).toContain("(last used less than a minute ago)");
    expect(usedAgo(60_000)).toContain("(last used 1 min ago)");
    expect(usedAgo(60 * 60_000 - 1)).toContain("(last used 59 min ago)");
    expect(usedAgo(60 * 60_000)).toContain("(last used 1 h ago)");
    expect(usedAgo(3 * 60 * 60_000 + 59 * 60_000)).toContain(
      "(last used 3 h ago)",
    );
  });

  it("says when no tab was used recently, and what the agent should ask", () => {
    expect(browserTabTargetNote({ kind: "unavailable" }, NOW)).toBe(
      "Browser tab: no tab of this app was used in the last 12 hours, so there was no on-screen state to read and a navigate command won't move any tab. Ask the user to open the app in a browser tab, then retry.",
    );
  });

  it("is added to a successful result once the call has touched tab state", async () => {
    const slot = createBrowserTabTargetSlot();
    const result = {
      content: [{ type: "text", text: "screen" }],
      structuredContent: { ok: true },
    };
    expect(withBrowserTabTargetNote(result, slot)).toBe(result);

    await slot.resolve();
    const noted = withBrowserTabTargetNote(result, slot);

    expect(noted).toEqual({
      content: [
        { type: "text", text: "screen" },
        { type: "text", text: browserTabTargetNote(LAST_USED) },
      ],
      structuredContent: { ok: true },
    });
    expect(result.content).toHaveLength(1);
  });

  it("leaves errors, results without content, and calls with no target alone", async () => {
    const slot = createBrowserTabTargetSlot();
    await slot.resolve();
    const error = { content: [{ type: "text", text: "nope" }], isError: true };
    const noContent = { structuredContent: {} };
    const notArray = { content: "screen" };
    const ok = { content: [] };

    expect(withBrowserTabTargetNote(error, slot)).toBe(error);
    expect(withBrowserTabTargetNote(noContent, slot)).toBe(noContent);
    expect(withBrowserTabTargetNote(notArray, slot)).toBe(notArray);
    expect(withBrowserTabTargetNote(ok, undefined)).toBe(ok);
    expect(withBrowserTabTargetNote(null, slot)).toBeNull();
    expect(withBrowserTabTargetNote("text", slot)).toBe("text");
    expect(
      withBrowserTabTargetNote({ content: [], isError: false }, slot),
    ).toMatchObject({ content: [{ type: "text" }] });
  });
});
