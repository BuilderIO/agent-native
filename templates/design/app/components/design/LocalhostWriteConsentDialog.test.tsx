// @vitest-environment happy-dom

import type { useSession } from "@agent-native/core/client/hooks";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

type SessionStatus = ReturnType<typeof useSession>["status"];

const mocks = vi.hoisted(() => ({
  sessionStatus: "loading" as SessionStatus,
  messages: {} as Record<string, unknown>,
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
  useT: () => (key: string) => {
    let value: unknown = mocks.messages;
    for (const part of key.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));

import { i18nCatalog } from "@/i18n";

import {
  LocalhostWriteConsentDialog,
  type LocalhostWriteConsentPayload,
} from "./LocalhostWriteConsentDialog";

const GRANT_PATH = "/_agent-native/actions/grant-localhost-write-consent";
const GRANT = {
  grantId: "grant-1",
  rootPath: "/repo",
  grantedUntil: "2026-10-24T08:00:00.000Z",
};

describe("LocalhostWriteConsentDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let grantResponse: () => Response;
  let fetchMock: ReturnType<typeof vi.fn>;
  let payload: LocalhostWriteConsentPayload;
  let onOpenChange: Mock<(open: boolean) => void>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.messages = i18nCatalog.messages;
    mocks.sessionStatus = "loading";
    grantResponse = () => Response.json(GRANT);
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(GRANT_PATH)) return grantResponse();
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

  function render() {
    act(() =>
      root.render(
        <LocalhostWriteConsentDialog
          open
          onOpenChange={onOpenChange}
          designId="design-1"
          connectionId="connection-1"
          payload={payload}
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
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function signInLink() {
    return [...document.body.querySelectorAll("a")].find(
      (candidate) => candidate.textContent?.trim() === "Sign in",
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
    const [, init] = grantCalls()[0]!;
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
});
