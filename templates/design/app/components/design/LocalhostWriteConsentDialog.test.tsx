// @vitest-environment happy-dom

import type { useSession } from "@agent-native/core/client/hooks";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  assert,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}

type SessionStatus = ReturnType<typeof useSession>["status"];

const mocks = vi.hoisted(() => ({
  sessionStatus: "loading" as SessionStatus,
  messages: {} as Record<string, unknown>,
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

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
  useT: () => (key: string) => {
    let value: unknown = mocks.messages;
    for (const part of key.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));

import { decodeContinuation } from "@agent-native/core/shared/sign-in-journey";

import { i18nCatalog } from "@/i18n";

import {
  LocalhostWriteConsentDialog,
  type LocalhostWriteConsentPayload,
} from "./LocalhostWriteConsentDialog";

const GRANT_PATH = "/_agent-native/actions/grant-localhost-write-consent";
const REQUEST_PATH = "/_agent-native/actions/request-localhost-write-consent";
const GRANT = {
  grantId: "grant-1",
  rootPath: "/repo",
  grantedUntil: "2026-10-24T08:00:00.000Z",
};

describe("LocalhostWriteConsentDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let grantResponse: () => Response;
  let requestResponse: () => Response;
  let requestBodies: unknown[];
  let requestHold: Promise<void> | null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let payload: LocalhostWriteConsentPayload;
  let onOpenChange: Mock<(open: boolean) => void>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.messages = i18nCatalog.messages;
    mocks.sessionStatus = "loading";
    grantResponse = () => Response.json(GRANT);
    requestResponse = () =>
      Response.json({
        designId: "design-1",
        connectionId: "connection-1",
        requestId: "request-2",
        requestedAt: "2026-10-24T08:00:00.000Z",
        surfaced: true,
      });
    requestBodies = [];
    requestHold = null;
    mocks.toastError.mockReset();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(GRANT_PATH)) return grantResponse();
      if (url.includes(REQUEST_PATH)) {
        requestBodies.push(JSON.parse(String(init?.body)));
        if (requestHold) await requestHold;
        return requestResponse();
      }
      return Response.json({ error: "Not authenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);
    payload = {
      rootPath: "/repo",
      files: ["src/App.tsx"],
      onGranted: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    };
    onOpenChange = vi.fn<(open: boolean) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(
    props: { designId?: string; payload?: LocalhostWriteConsentPayload } = {},
  ) {
    act(() =>
      root.render(
        <LocalhostWriteConsentDialog
          open
          onOpenChange={onOpenChange}
          designId={props.designId ?? "design-1"}
          connectionId="connection-1"
          payload={props.payload ?? payload}
        />,
      ),
    );
  }

  function grantCalls() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(GRANT_PATH),
    );
  }

  function button(label: string) {
    return [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent.trim() === label,
    );
  }

  function signInLink() {
    return [...document.body.querySelectorAll("a")].find(
      (candidate) => candidate.textContent.trim() === "Sign in",
    );
  }

  async function settle() {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function allowWrites() {
    const allow = button("Allow writes");
    if (!allow) throw new Error("Allow writes was not rendered");
    await act(async () => allow.click());
    await settle();
  }

  it("asks a signed-out visitor to sign in and sends no grant", async () => {
    mocks.sessionStatus = "unauthenticated";
    render();
    await settle();

    expect(signInLink()?.getAttribute("href")).toContain("/sign-in");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign in with an account that has access.",
    );
    expect(button("Allow writes")).toBeUndefined();
    expect(grantCalls()).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(payload.onCancel).not.toHaveBeenCalled();
  });

  it("holds the grant while the session is loading", async () => {
    render();
    const allow = button("Allow writes");
    expect(allow?.disabled).toBe(true);

    await act(async () => allow?.click());
    await settle();
    expect(grantCalls()).toHaveLength(0);
  });

  it("grants once the visitor's session resolves signed in", async () => {
    mocks.sessionStatus = "unauthenticated";
    render();
    expect(signInLink()).toBeDefined();

    mocks.sessionStatus = "authenticated";
    render();
    expect(signInLink()).toBeUndefined();
    await allowWrites();

    expect(grantCalls()).toHaveLength(1);
    const [, init] = required(grantCalls()[0]);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      designId: "design-1",
      connectionId: "connection-1",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(payload.onGranted).toHaveBeenCalledWith(GRANT);
    expect(payload.onError).not.toHaveBeenCalled();
    expect(payload.onCancel).not.toHaveBeenCalled();
  });

  it("switches to sign-in when the server refuses a session without browser sign-in", async () => {
    // A Visual Edit embed credential can read as a session client-side; only
    // the server knows the browser cookie is missing.
    mocks.sessionStatus = "authenticated";
    grantResponse = () =>
      Response.json(
        {
          error: "Sign in to allow file writes.",
          errorCode: "browser_session_required",
        },
        { status: 401 },
      );
    render();
    await allowWrites();

    expect(grantCalls()).toHaveLength(1);
    expect(signInLink()).toBeDefined();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign in with an account that has access.",
    );
    expect(button("Allow writes")).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(payload.onError).not.toHaveBeenCalled();
    expect(payload.onCancel).not.toHaveBeenCalled();

    await settle();
    expect(grantCalls()).toHaveLength(1);
  });

  it("shows a signed-in account's access refusal without asking it to sign in", async () => {
    mocks.sessionStatus = "authenticated";
    grantResponse = () =>
      Response.json({ error: "Forbidden" }, { status: 403 });
    render();
    await allowWrites();

    expect(grantCalls()).toHaveLength(1);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "You don't have access",
    );
    expect(signInLink()).toBeUndefined();
    expect(button("Allow writes")).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(payload.onError).not.toHaveBeenCalled();

    const cancel = button("Cancel");
    await act(async () => cancel?.click());
    expect(payload.onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(grantCalls()).toHaveLength(1);
  });

  async function clickSignIn(): Promise<string[]> {
    const assigned: string[] = [];
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation((url: string | URL) => {
        assigned.push(String(url));
      });
    try {
      const link = signInLink();
      if (!link) throw new Error("Sign in was not rendered");
      await act(async () => link.click());
      await settle();
    } finally {
      assign.mockRestore();
    }
    return assigned;
  }

  it("saves the request before sign-in and returns with only its ID", async () => {
    mocks.sessionStatus = "unauthenticated";
    window.history.replaceState(
      null,
      "",
      "/visual-edit/design-1?screen=s1&embed=fake-link-token#layer",
    );
    try {
      render();
      const assigned = await clickSignIn();

      expect(requestBodies).toEqual([
        {
          designId: "design-1",
          connectionId: "connection-1",
          files: ["src/App.tsx"],
          resumeAfterSignIn: true,
        },
      ]);
      expect(assigned).toHaveLength(1);
      const target = new URL(required(assigned[0]), window.location.origin);
      expect(target.pathname).toBe("/sign-in");
      expect(decodeContinuation(target.searchParams.get("c"))).toBe(
        "/visual-edit/design-1?localhostConsent=request-2",
      );
      expect(grantCalls()).toHaveLength(0);
      expect(payload.onGranted).not.toHaveBeenCalled();
      expect(payload.onCancel).not.toHaveBeenCalled();
      expect(payload.onError).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("stays put when the request cannot be saved for sign-in", async () => {
    mocks.sessionStatus = "unauthenticated";
    render();

    requestResponse = () =>
      Response.json({ error: "Connection is not ready" }, { status: 500 });
    expect(await clickSignIn()).toEqual([]);

    requestResponse = () =>
      Response.json({ designId: "design-1", alreadyGranted: true });
    expect(await clickSignIn()).toEqual([]);

    requestResponse = () => Response.json(null);
    expect(await clickSignIn()).toEqual([]);
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "Couldn't save this request before sign-in. Try again.",
    );

    expect(requestBodies).toHaveLength(3);
    expect(signInLink()).toBeDefined();
    expect(grantCalls()).toHaveLength(0);
    expect(payload.onGranted).not.toHaveBeenCalled();
    expect(payload.onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("keeps a failed grant open so it can be tried again", async () => {
    mocks.sessionStatus = "authenticated";
    grantResponse = () =>
      Response.json({ error: "Bridge unavailable" }, { status: 500 });
    render();
    await allowWrites();

    expect(payload.onError).toHaveBeenCalledTimes(1);
    expect(payload.onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(button("Allow writes")?.disabled).toBe(false);

    grantResponse = () => Response.json(GRANT);
    await allowWrites();
    expect(grantCalls()).toHaveLength(2);
    expect(payload.onGranted).toHaveBeenCalledWith(GRANT);
    expect(payload.onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports a failed grant when the caller has no error handler", async () => {
    mocks.sessionStatus = "authenticated";
    grantResponse = () =>
      Response.json({ error: "Bridge unavailable" }, { status: 500 });
    const { onError: _onError, ...withoutHandler } = payload;
    render({ payload: withoutHandler });
    await allowWrites();

    expect(mocks.toastError).toHaveBeenCalledWith("Bridge unavailable");
    expect(payload.onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(button("Allow writes")).toBeDefined();
  });

  function holdRequests(): () => Promise<void> {
    let release!: () => void;
    requestHold = new Promise((resolve) => {
      release = resolve;
    });
    return async () => {
      requestHold = null;
      release();
      await settle();
    };
  }

  function watchAssign() {
    const assigned: string[] = [];
    const spy = vi
      .spyOn(window.location, "assign")
      .mockImplementation((url: string | URL) => {
        assigned.push(String(url));
      });
    return { assigned, restore: () => spy.mockRestore() };
  }

  async function startSignIn() {
    const link = signInLink();
    if (!link) throw new Error("Sign in was not rendered");
    await act(async () => link.click());
    await settle();
    expect(requestBodies).toHaveLength(1);
  }

  it("ignores a sign-in save that finishes after its request is gone", async () => {
    mocks.sessionStatus = "unauthenticated";
    const assign = watchAssign();
    try {
      const endings: Array<() => void> = [
        () => render({ designId: "design-2" }),
        () => render({ payload: { ...payload, files: ["src/Other.tsx"] } }),
        () => act(() => root.unmount()),
      ];
      for (const end of endings) {
        act(() => root.unmount());
        root = createRoot(container);
        requestBodies = [];
        render();
        const release = holdRequests();
        await startSignIn();
        end();
        await release();
      }
      expect(assign.assigned).toEqual([]);
      expect(payload.onCancel).not.toHaveBeenCalled();
      expect(payload.onGranted).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
    } finally {
      assign.restore();
    }
  });

  it("keeps the dialog and its starting page while the sign-in save is in flight", async () => {
    mocks.sessionStatus = "unauthenticated";
    window.history.replaceState(null, "", "/visual-edit/design-1?screen=s1");
    const assign = watchAssign();
    try {
      render();
      const release = holdRequests();
      await startSignIn();

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(payload.onCancel).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

      window.history.replaceState(null, "", "/somewhere-else");
      await release();
      expect(assign.assigned).toHaveLength(1);
      const target = new URL(
        required(assign.assigned[0]),
        window.location.origin,
      );
      expect(decodeContinuation(target.searchParams.get("c"))).toBe(
        "/visual-edit/design-1?localhostConsent=request-2",
      );
    } finally {
      assign.restore();
      window.history.replaceState(null, "", "/");
    }
  });
});
