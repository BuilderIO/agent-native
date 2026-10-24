// @vitest-environment happy-dom

import type { useSession } from "@agent-native/core/client/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionStatus = ReturnType<typeof useSession>["status"];

// The editor's three consent actions run for real behind a fetch-level fake
// server; only their storage, access, and database edges are stubbed. The
// grant itself is answered at the transport because it needs browser cookies.
const mocks = vi.hoisted(() => {
  const appState = new Map<string, Record<string, unknown>>();
  const tables = {
    designLocalhostConnections: {
      id: "c.id",
      ownerEmail: "c.ownerEmail",
      orgId: "c.orgId",
      rootPath: "c.rootPath",
      bridgeToken: "c.bridgeToken",
    },
    designLocalhostWriteGrants: {
      designId: "g.designId",
      connectionId: "g.connectionId",
      ownerEmail: "g.ownerEmail",
      orgId: "g.orgId",
      grantedUntil: "g.grantedUntil",
    },
  };
  return {
    appState,
    tables,
    sessionStatus: "authenticated" as SessionStatus,
    messages: {} as Record<string, unknown>,
    db: {
      select: () => {
        let table: unknown;
        const chain = {
          from: (from: unknown) => {
            table = from;
            return chain;
          },
          where: () => chain,
          limit: async () =>
            table === tables.designLocalhostConnections
              ? [{ rootPath: "/repo", bridgeToken: "fake-bridge-token" }]
              : [],
        };
        return chain;
      },
    },
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: async (sessionId: string, key: string) =>
    mocks.appState.get(`${sessionId}|${key}`) ?? null,
  appStatePut: async (
    sessionId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    mocks.appState.set(`${sessionId}|${key}`, value);
  },
  appStateCompareAndSet: async (
    sessionId: string,
    key: string,
    expected: unknown,
    next: Record<string, unknown> | null,
  ) => {
    const address = `${sessionId}|${key}`;
    if (
      JSON.stringify(mocks.appState.get(address) ?? null) !==
      JSON.stringify(expected)
    ) {
      return false;
    }
    if (next === null) mocks.appState.delete(address);
    else mocks.appState.set(address, next);
    return true;
  },
  readAppStateForCurrentTab: async () => null,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: async () => ({ role: "editor" }),
}));
vi.mock("../../../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.tables,
}));
vi.mock("../../../server/lib/localhost-connection.js", () => ({
  resolveLocalhostConnectionScope: async () => ({
    ownerEmail: "owner@example.test",
    orgId: null,
  }),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session:
      mocks.sessionStatus === "authenticated"
        ? { email: "editor@example.test" }
        : null,
    status: mocks.sessionStatus,
    isLoading: mocks.sessionStatus === "loading",
    error: null,
    retry: () => {},
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, string>) => {
    let value: unknown = mocks.messages;
    for (const part of key.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof value !== "string") return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => values?.[name] ?? "");
  },
}));

import { decodeContinuation } from "@agent-native/core/shared/sign-in-journey";

import {
  LocalhostWriteConsentSurface,
  useLocalhostWriteConsent,
  type LocalhostWriteConsentState,
} from "@/components/design/LocalhostWriteConsentDialog";
import { i18nCatalog } from "@/i18n";

import clearAction from "../../../actions/clear-localhost-write-consent-request";
import getAction from "../../../actions/get-localhost-write-consent-request";
import { localhostConsentRequestStateAddress } from "../../../actions/localhost-consent-request-state";
import requestAction from "../../../actions/request-localhost-write-consent";

const DESIGN_ID = "design-1";
const CONNECTION_ID = "connection-1";
const ACTIONS = "/_agent-native/actions/";
const GRANT = {
  grantId: "grant-1",
  rootPath: "/repo",
  grantedUntil: "2026-10-24T16:00:00.000Z",
};

type ServerRecord = {
  designId: string;
  connectionId: string;
  rootPath: string;
  files: string[];
  requestedAt: string;
  requestId?: string;
};

const runnable: Record<
  string,
  { run: (input: never) => Promise<unknown> } | undefined
> = {
  "get-localhost-write-consent-request": getAction as never,
  "clear-localhost-write-consent-request": clearAction as never,
  "request-localhost-write-consent": requestAction as never,
};

const { key: STATE_KEY, sessionId: STATE_SESSION } =
  localhostConsentRequestStateAddress(DESIGN_ID);

function serverRecord(): ServerRecord | null {
  return (mocks.appState.get(`${STATE_SESSION}|${STATE_KEY}`) ??
    null) as ServerRecord | null;
}

function setServerRecord(record: ServerRecord) {
  mocks.appState.set(`${STATE_SESSION}|${STATE_KEY}`, record);
}

describe("localhost write consent across sign-in", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let latest: LocalhostWriteConsentState | null;
  let routerLocation: { pathname: string; search: string } | null;
  let grantStatus: 200 | 401 | 500;
  let grantHold: Promise<void> | null;
  let requestHold: Promise<void> | null;
  let calls: Array<{ name: string; body: Record<string, unknown> }>;
  let chatMessages: Array<Record<string, unknown>>;

  const onChatMessage = (event: MessageEvent) => {
    if (event.data?.type === "agentNative.submitChat") {
      chatMessages.push(event.data.data);
    }
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.messages = i18nCatalog.messages;
    mocks.sessionStatus = "authenticated";
    mocks.appState.clear();
    grantStatus = 200;
    grantHold = null;
    requestHold = null;
    calls = [];
    chatMessages = [];
    latest = null;
    routerLocation = null;
    window.addEventListener("message", onChatMessage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          String(input instanceof Request ? input.url : input),
          window.location.origin,
        );
        const name = url.pathname.slice(
          url.pathname.indexOf(ACTIONS) + ACTIONS.length,
        );
        const body =
          init?.method === "GET" || !init?.body
            ? Object.fromEntries(url.searchParams)
            : (JSON.parse(String(init.body)) as Record<string, unknown>);
        calls.push({ name, body });
        if (name === "grant-localhost-write-consent") {
          if (grantHold) await grantHold;
          if (grantStatus === 500) {
            return Response.json(
              { error: "Bridge unavailable" },
              { status: 500 },
            );
          }
          return grantStatus === 200
            ? Response.json(GRANT)
            : Response.json(
                {
                  error: "Sign in to allow file writes.",
                  errorCode: "browser_session_required",
                },
                { status: 401 },
              );
        }
        const action = runnable[name];
        if (!action) {
          throw new Error(`Unexpected action request: ${url.pathname}`);
        }
        try {
          const result = await action.run(body as never);
          if (requestHold && name === "request-localhost-write-consent") {
            await requestHold;
          }
          return Response.json(result);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(() => {
    unmount();
    container.remove();
    window.removeEventListener("message", onChatMessage);
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  function Harness({ canEditDesign }: { canEditDesign: boolean }) {
    const consent = useLocalhostWriteConsent({
      designId: DESIGN_ID,
      canEditDesign,
    });
    const location = useLocation();
    latest = consent;
    routerLocation = location;
    return (
      <LocalhostWriteConsentSurface designId={DESIGN_ID} consent={consent} />
    );
  }

  // Each mount is a page load: its own query cache and URL.
  async function mountAt(path: string, canEditDesign = true) {
    window.history.replaceState(null, "", path);
    root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    act(() =>
      root!.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <Harness canEditDesign={canEditDesign} />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await settle();
  }

  function unmount() {
    if (!root) return;
    act(() => root!.unmount());
    root = null;
  }

  async function settle() {
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function dialogTitled(title: string) {
    return [...document.body.querySelectorAll('[role="dialog"]')].find(
      (dialog) => dialog.textContent?.includes(title),
    );
  }

  function button(label: string) {
    return [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  async function click(label: string) {
    const target = button(label);
    if (!target) throw new Error(`${label} was not rendered`);
    await act(async () => target.click());
    await settle();
  }

  function openLocalRequest(files: string[]) {
    const events: string[] = [];
    act(() =>
      latest!.openLocalConsent({
        connectionId: CONNECTION_ID,
        rootPath: "/repo",
        files,
        onGranted: () => events.push("granted"),
        onCancel: () => events.push("cancelled"),
        onError: () => events.push("error"),
      }),
    );
    return events;
  }

  function holdGrant(): () => Promise<void> {
    let release!: () => void;
    grantHold = new Promise((resolve) => {
      release = resolve;
    });
    return async () => {
      grantHold = null;
      release();
      await settle();
    };
  }

  // Every way a person can dismiss the dialog.
  const dismissals: Array<[string, () => Promise<void>]> = [
    ["Cancel", () => click("Cancel")],
    [
      "Escape",
      async () => {
        await act(async () => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
        await settle();
      },
    ],
    [
      "a press outside the dialog",
      async () => {
        await act(async () => {
          for (const type of [
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click",
          ]) {
            document.body.dispatchEvent(
              new MouseEvent(type, { bubbles: true, button: 0 }),
            );
          }
        });
        await settle();
      },
    ],
  ];

  // Sign-in is a full-page navigation: capture it, then end this mount the way
  // a page unload would, without closing the dialog.
  async function signInAndLeave(): Promise<string> {
    const assigned: string[] = [];
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation((url: string | URL) => {
        assigned.push(String(url));
      });
    try {
      const link = [...document.body.querySelectorAll("a")].find(
        (candidate) => candidate.textContent?.trim() === "Sign in",
      );
      if (!link) throw new Error("Sign in was not rendered");
      await act(async () => link.click());
      await settle();
    } finally {
      assign.mockRestore();
    }
    expect(assigned).toHaveLength(1);
    unmount();
    const target = new URL(assigned[0]!, window.location.origin);
    expect(target.pathname).toBe("/sign-in");
    const returnTo = decodeContinuation(target.searchParams.get("c"));
    if (!returnTo) throw new Error("Sign-in link has no return path");
    return returnTo;
  }

  function callsTo(name: string) {
    return calls.filter((call) => call.name === name);
  }

  function lastBodyTo(name: string) {
    const matching = callsTo(name);
    return matching[matching.length - 1]?.body;
  }

  const copy = () =>
    (i18nCatalog.messages as any).designEditor.localhostConsent as Record<
      string,
      string
    >;

  it("reopens an agent's request after sign-in and offers an explicit retry", async () => {
    await requestAction.run({
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      files: ["src/App.tsx"],
    });
    const agentRequest = serverRecord()!;
    expect(agentRequest.requestId).toEqual(expect.any(String));

    // A Visual Edit link session reads as signed in on the client; only the
    // grant learns the browser has no sign-in of its own.
    grantStatus = 401;
    await mountAt(`/visual-edit/${DESIGN_ID}?screen=s1`);
    expect(dialogTitled("Allow file writes")?.textContent).toContain(
      "src/App.tsx",
    );
    expect(serverRecord()).toEqual(agentRequest);

    await click("Allow writes");
    expect(callsTo("grant-localhost-write-consent")).toHaveLength(1);
    const returnTo = await signInAndLeave();

    const resumable = serverRecord()!;
    expect(resumable.requestId).not.toBe(agentRequest.requestId);
    expect(returnTo).toBe(
      `/visual-edit/${DESIGN_ID}?localhostConsent=${resumable.requestId}`,
    );
    expect(callsTo("clear-localhost-write-consent-request")).toHaveLength(0);

    grantStatus = 200;
    await mountAt(returnTo);
    expect(dialogTitled("Allow file writes")?.textContent).toContain(
      "src/App.tsx",
    );
    expect(routerLocation?.search).toBe("");

    await click("Allow writes");
    expect(lastBodyTo("grant-localhost-write-consent")).toEqual({
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
    });
    expect(lastBodyTo("clear-localhost-write-consent-request")).toEqual({
      designId: DESIGN_ID,
      requestedAt: resumable.requestedAt,
      requestId: resumable.requestId,
    });
    expect(serverRecord()).toBeNull();
    expect(dialogTitled("Allow file writes")).toBeUndefined();
    expect(dialogTitled(copy().approvedTitle)).toBeDefined();
    expect(chatMessages).toHaveLength(0);

    await click(copy().retryInChat);
    expect(chatMessages).toEqual([
      expect.objectContaining({
        message:
          "File writes are approved for /repo. Run the edit that needed them again.",
        submit: false,
        openSidebar: true,
      }),
    ]);
    expect(dialogTitled(copy().approvedTitle)).toBeUndefined();
  });

  it("never replays a local edit's callback after sign-in", async () => {
    mocks.sessionStatus = "unauthenticated";
    await mountAt(`/design/${DESIGN_ID}`);
    const onGranted = vi.fn();
    const onCancel = vi.fn();
    act(() =>
      latest!.openLocalConsent({
        connectionId: CONNECTION_ID,
        rootPath: "/repo",
        files: ["src/Card.tsx"],
        onGranted,
        onCancel,
      }),
    );
    await settle();
    expect(serverRecord()).toBeNull();

    const returnTo = await signInAndLeave();
    expect(lastBodyTo("request-localhost-write-consent")).toEqual({
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      files: ["src/Card.tsx"],
      resumeAfterSignIn: true,
    });
    expect(serverRecord()).toMatchObject({ files: ["src/Card.tsx"] });

    mocks.sessionStatus = "authenticated";
    await mountAt(returnTo);
    await click("Allow writes");

    expect(dialogTitled(copy().approvedTitle)).toBeDefined();
    expect(serverRecord()).toBeNull();
    expect(onGranted).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it("runs a local edit's callback after its own grant on the same page and never cancels it", async () => {
    await mountAt(`/design/${DESIGN_ID}`);
    const onGranted = vi.fn();
    const onCancel = vi.fn();
    act(() =>
      latest!.openLocalConsent({
        connectionId: CONNECTION_ID,
        rootPath: "/repo",
        files: ["src/Card.tsx"],
        onGranted,
        onCancel,
      }),
    );
    await settle();
    await click("Allow writes");

    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(onGranted).toHaveBeenCalledWith(GRANT);
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialogTitled("Allow file writes")).toBeUndefined();
    expect(dialogTitled(copy().approvedTitle)).toBeUndefined();
    expect(callsTo("request-localhost-write-consent")).toHaveLength(0);
  });

  it.each(dismissals)(
    "cancels a local edit exactly once when %s dismisses it",
    async (_dismissal, dismiss) => {
      await mountAt(`/design/${DESIGN_ID}`);
      const events = openLocalRequest(["src/Card.tsx"]);
      await settle();
      expect(dialogTitled("Allow file writes")).toBeDefined();

      await dismiss();
      expect(events).toEqual(["cancelled"]);
      expect(dialogTitled("Allow file writes")).toBeUndefined();
      expect(callsTo("grant-localhost-write-consent")).toHaveLength(0);
    },
  );

  it.each(dismissals)(
    "keeps a granting dialog open through %s until its grant answers",
    async (_dismissal, dismiss) => {
      await mountAt(`/design/${DESIGN_ID}`);
      const events = openLocalRequest(["src/Card.tsx"]);
      await settle();
      const release = holdGrant();
      await click("Allow writes");
      expect(button("Cancel")?.disabled).toBe(true);

      await dismiss();
      expect(events).toEqual([]);
      expect(dialogTitled("Allow file writes")?.textContent).toContain(
        "Granting…",
      );

      await release();
      expect(events).toEqual(["granted"]);
      expect(dialogTitled("Allow file writes")).toBeUndefined();
      expect(callsTo("grant-localhost-write-consent")).toHaveLength(1);
    },
  );

  const endings: Array<[string, () => void]> = [
    ["the editor unmounts", () => unmount()],
    [
      "the editor closes the request",
      () => act(() => latest!.onOpenChange(false)),
    ],
  ];

  it.each(
    endings.flatMap(([ending, end]) =>
      ([200, 500] as const).map((status) => [status, ending, end] as const),
    ),
  )("drops a grant answering %i after %s", async (status, _ending, end) => {
    await mountAt(`/design/${DESIGN_ID}`);
    const events = openLocalRequest(["src/Card.tsx"]);
    await settle();
    const release = holdGrant();
    await click("Allow writes");

    end();
    grantStatus = status;
    await release();
    expect(events).toEqual([]);
    expect(dialogTitled("Allow file writes")).toBeUndefined();
  });

  it.each([200, 500] as const)(
    "drops an older grant answering %i after a newer request for the same connection replaced it",
    async (status) => {
      await mountAt(`/design/${DESIGN_ID}`);
      const older = openLocalRequest(["src/Card.tsx"]);
      await settle();
      const release = holdGrant();
      await click("Allow writes");

      const newer = openLocalRequest(["src/Next.tsx"]);
      await settle();
      expect(button("Allow writes")?.disabled).toBe(false);
      grantStatus = status;
      await release();
      expect(older).toEqual([]);
      expect(newer).toEqual([]);
      expect(dialogTitled("Allow file writes")?.textContent).toContain(
        "src/Next.tsx",
      );

      grantStatus = 200;
      await click("Allow writes");
      expect(newer).toEqual(["granted"]);
      expect(older).toEqual([]);
      expect(dialogTitled("Allow file writes")).toBeUndefined();
    },
  );

  it("says a returned request is no longer pending when it was cleared, expired, or replaced", async () => {
    // Edit access gates the handoff, not a browser sign-in.
    mocks.sessionStatus = "unauthenticated";
    const now = Date.now();
    const base = {
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      rootPath: "/repo",
      files: ["src/App.tsx"],
    };

    await mountAt(`/design/${DESIGN_ID}?localhostConsent=cleared-request`);
    expect(dialogTitled(copy().unavailableTitle)).toBeDefined();
    expect(dialogTitled("Allow file writes")).toBeUndefined();
    expect(routerLocation?.search).toBe("");
    unmount();

    setServerRecord({
      ...base,
      requestedAt: new Date(now - 31 * 60 * 1000).toISOString(),
      requestId: "expired-request",
    });
    await mountAt(`/design/${DESIGN_ID}?localhostConsent=expired-request`);
    expect(dialogTitled(copy().unavailableTitle)).toBeDefined();
    expect(dialogTitled("Allow file writes")).toBeUndefined();
    unmount();

    setServerRecord({
      ...base,
      requestedAt: new Date(now).toISOString(),
      requestId: "newer-request",
    });
    await mountAt(`/design/${DESIGN_ID}?localhostConsent=returned-request`);
    expect(dialogTitled(copy().unavailableTitle)).toBeDefined();
    expect(dialogTitled("Allow file writes")).toBeUndefined();

    await click(copy().close);
    expect(dialogTitled(copy().unavailableTitle)).toBeUndefined();
    expect(dialogTitled("Allow file writes")).toBeDefined();

    expect(callsTo("grant-localhost-write-consent")).toHaveLength(0);
    expect(callsTo("clear-localhost-write-consent-request")).toHaveLength(0);
    expect(serverRecord()?.requestId).toBe("newer-request");
  });

  it("cancels only the request it showed, never a newer one", async () => {
    const requestedAt = new Date().toISOString();
    const shown = {
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      rootPath: "/repo",
      files: ["src/App.tsx"],
      requestedAt,
      requestId: "shown-request",
    };
    setServerRecord(shown);
    await mountAt(`/design/${DESIGN_ID}`);
    expect(dialogTitled("Allow file writes")).toBeDefined();

    const newer = { ...shown, files: ["src/Next.tsx"], requestId: "newer" };
    setServerRecord(newer);
    await click("Cancel");

    expect(callsTo("clear-localhost-write-consent-request")).toEqual([
      {
        name: "clear-localhost-write-consent-request",
        body: { designId: DESIGN_ID, requestedAt, requestId: "shown-request" },
      },
    ]);
    expect(serverRecord()).toEqual(newer);
    expect(dialogTitled("Allow file writes")?.textContent).toContain(
      "src/Next.tsx",
    );
  });

  it("keeps a request pending through a failed grant and approves it on retry", async () => {
    await requestAction.run({
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      files: ["src/App.tsx"],
    });
    const pending = serverRecord()!;

    grantStatus = 500;
    await mountAt(`/design/${DESIGN_ID}`);
    await click("Allow writes");
    expect(dialogTitled("Allow file writes")).toBeDefined();
    expect(serverRecord()).toEqual(pending);
    expect(callsTo("clear-localhost-write-consent-request")).toHaveLength(0);

    grantStatus = 200;
    await click("Allow writes");
    expect(callsTo("grant-localhost-write-consent")).toHaveLength(2);
    expect(callsTo("clear-localhost-write-consent-request")).toEqual([
      {
        name: "clear-localhost-write-consent-request",
        body: {
          designId: DESIGN_ID,
          requestedAt: pending.requestedAt,
          requestId: pending.requestId,
        },
      },
    ]);
    expect(serverRecord()).toBeNull();
    expect(dialogTitled(copy().approvedTitle)).toBeDefined();
  });

  it("drops a sign-in save that finishes after the editor has gone", async () => {
    await requestAction.run({
      designId: DESIGN_ID,
      connectionId: CONNECTION_ID,
      files: ["src/App.tsx"],
    });
    grantStatus = 401;
    await mountAt(`/visual-edit/${DESIGN_ID}`);
    await click("Allow writes");

    let release!: () => void;
    requestHold = new Promise((resolve) => {
      release = resolve;
    });
    const assigned: string[] = [];
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation((url: string | URL) => {
        assigned.push(String(url));
      });
    try {
      const link = [...document.body.querySelectorAll("a")].find(
        (candidate) => candidate.textContent?.trim() === "Sign in",
      );
      if (!link) throw new Error("Sign in was not rendered");
      await act(async () => link.click());
      await settle();
      const saved = serverRecord()!;

      unmount();
      requestHold = null;
      release();
      await settle();

      expect(assigned).toEqual([]);
      expect(callsTo("clear-localhost-write-consent-request")).toHaveLength(0);
      expect(serverRecord()).toEqual(saved);
    } finally {
      assign.mockRestore();
    }
  });
});
