import type { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
}));

import {
  appendBuilderConnectStateCookie,
  createBuilderConnectState,
  resolveBuilderConnectCallbackState,
} from "./builder-browser.js";
import {
  resolveBuilderOrgMutation,
  selectLiveBuilderConnectStates,
} from "./core-routes-plugin.js";

function createMockEvent(): H3Event {
  return {
    req: {
      method: "POST",
      url: "https://example.com/_agent-native/builder/connect",
      headers: new Headers({ host: "example.com" }),
    },
    url: new URL("https://example.com/_agent-native/builder/connect"),
    node: {
      req: {
        headers: { host: "example.com" },
        method: "POST",
        socket: { remoteAddress: "203.0.113.10" },
        url: "/_agent-native/builder/connect",
      },
    },
    headers: new Headers({ host: "example.com" }),
    context: {},
    path: "/_agent-native/builder/connect",
  } as unknown as H3Event;
}

beforeEach(() => {
  getOrgContextMock.mockReset();
});

describe("resolveBuilderOrgMutation", () => {
  it("allows any authenticated org member to start Builder connect", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(
      resolveBuilderOrgMutation(createMockEvent(), {
        allowMemberInitiation: true,
      }),
    ).resolves.toEqual({
      orgId: "org-123",
      role: "member",
      deny: null,
    });
  });

  it("keeps shared Builder revocation owner/admin protected", async () => {
    getOrgContextMock.mockResolvedValue({
      orgId: "org-123",
      role: "member",
    });

    await expect(resolveBuilderOrgMutation(createMockEvent())).resolves.toEqual(
      {
        orgId: "org-123",
        role: "member",
        deny: "Only an organization owner or admin can change the shared Builder connection.",
      },
    );
  });
});

describe("selectLiveBuilderConnectStates", () => {
  const now = 1_000_000;
  const live = { expiresAt: now + 60_000 };

  it("drops consumed, expired, and missing flows", async () => {
    const rows: Record<string, Record<string, unknown> | null> = {
      "builder-connect-pending:live": live,
      "builder-connect-pending:consumed": { ...live, consumed: true },
      "builder-connect-pending:expired": { expiresAt: now - 1 },
      "builder-connect-pending:gone": null,
    };

    await expect(
      selectLiveBuilderConnectStates(
        ["live", "consumed", "expired", "gone"],
        now,
        (async (key: string) => rows[key] ?? null) as never,
      ),
    ).resolves.toEqual(["live"]);
  });

  it("reports an unreadable pending store instead of calling every flow dead", async () => {
    await expect(
      selectLiveBuilderConnectStates(["live"], now, (async () => {
        throw new Error("settings unavailable");
      }) as never),
    ).resolves.toBeNull();
  });

  it("recovers the one live flow when the cookie also holds a finished one", async () => {
    const finished = createBuilderConnectState();
    const pending = createBuilderConnectState();
    const cookie = appendBuilderConnectStateCookie(
      appendBuilderConnectStateCookie(null, finished),
      pending,
    );
    const rows: Record<string, Record<string, unknown> | null> = {
      [`builder-connect-pending:${pending}`]: live,
      [`builder-connect-pending:${finished}`]: { ...live, consumed: true },
    };

    const states = await selectLiveBuilderConnectStates(
      cookie.split(","),
      now,
      (async (key: string) => rows[key] ?? null) as never,
    );

    // Builder dropped the query state: the finished flow must not make this
    // callback look ambiguous.
    expect(
      resolveBuilderConnectCallbackState(null, (states ?? []).join(",")),
    ).toEqual({ state: pending, resetStateCookie: false });
  });

  it("still fails closed when two flows are genuinely live", async () => {
    const first = createBuilderConnectState();
    const second = createBuilderConnectState();
    const states = await selectLiveBuilderConnectStates(
      [first, second],
      now,
      (async () => live) as never,
    );

    expect(
      resolveBuilderConnectCallbackState(null, (states ?? []).join(",")),
    ).toEqual({ state: null, resetStateCookie: true });
  });
});
