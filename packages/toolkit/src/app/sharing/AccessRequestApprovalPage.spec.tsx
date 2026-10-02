// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { AccessRequestApprovalPage } from "./AccessRequestApprovalPage.js";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  queryParams: [] as unknown[],
  approve: vi.fn(),
  decline: vi.fn(),
  refetch: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: (_name: string, params: unknown) => {
    mocks.queryParams.push(params);
    return { refetch: mocks.refetch, ...mocks.query };
  },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "approve-resource-access-request"
        ? mocks.approve
        : mocks.decline,
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "owner@example.test" } }),
  signOut: mocks.signOut,
}));
vi.mock("@agent-native/core/client/sign-in-return", () => ({
  buildSignInReturnHref: () => "/_agent-native/sign-in",
}));

const catalog = createToolkitI18nCatalog({ messages: {} });

const pendingReview = {
  id: "req-1",
  generation: 2,
  state: "pending",
  requester: { email: "requester@example.test", name: "Pat Example" },
  note: "Need this for the launch review.",
  requestedAt: "2026-10-01T10:00:00.000Z",
  decidedAt: null,
  grantedRole: null,
  resource: {
    type: "document",
    id: "doc-1",
    label: "Document",
    title: "Launch plan",
    path: "/page/doc-1",
  },
};

function actionError(status: number, fields: Record<string, unknown> = {}) {
  return Object.assign(new Error("Action failed"), { status, ...fields });
}

describe("AccessRequestApprovalPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.query = {};
    mocks.queryParams = [];
    mocks.approve.mockReset().mockResolvedValue(undefined);
    mocks.decline.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function render() {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={catalog}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <MemoryRouter initialEntries={["/access-requests/req-1"]}>
            <Routes>
              <Route
                path="/access-requests/:requestId"
                element={<AccessRequestApprovalPage />}
              />
            </Routes>
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
  }

  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
  }

  it("reads the request from the route without deciding anything", () => {
    mocks.query = { isLoading: true };
    render();

    expect(mocks.queryParams.at(-1)).toEqual({ requestId: "req-1" });
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.decline).not.toHaveBeenCalled();
  });

  it("shows who is asking, for which page, and starts the role at Viewer", () => {
    mocks.query = { data: pendingReview };
    render();

    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("Pat Example is asking for access");
    expect(document.activeElement).toBe(heading);
    expect(container.textContent).toContain("requester@example.test");
    expect(container.textContent).toContain("Need this for the launch review.");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/page/doc-1");
    expect(link?.textContent).toBe("Launch plan");
    expect(container.textContent).toContain("Viewer");

    act(() => button("Allow")?.click());
    expect(mocks.approve).toHaveBeenCalledWith({
      requestId: "req-1",
      generation: 2,
      role: "viewer",
    });
  });

  it("declines with the request's generation", () => {
    mocks.query = { data: pendingReview };
    render();

    act(() => button("Decline")?.click());
    expect(mocks.decline).toHaveBeenCalledWith({
      requestId: "req-1",
      generation: 2,
    });
  });

  it("explains a sharing rule that refused and keeps the request open", async () => {
    mocks.query = { data: pendingReview };
    mocks.approve.mockRejectedValue(
      actionError(403, {
        actionMessage: "This workspace doesn't allow sharing outside it.",
      }),
    );
    render();

    await act(async () => button("Allow")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This workspace doesn't allow sharing outside it.",
    );
    expect(button("Allow")).toBeDefined();
  });

  it("reloads a request someone else already handled", async () => {
    mocks.query = { data: pendingReview };
    mocks.approve.mockRejectedValue(
      actionError(409, {
        errorCode: "access_request_stale",
        actionMessage: "Someone already handled this request.",
      }),
    );
    render();

    await act(async () => button("Allow")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Someone already handled this request, or it changed.",
    );
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("doesn't show an unexpected server message", async () => {
    mocks.query = { data: pendingReview };
    mocks.approve.mockRejectedValue(
      actionError(500, { actionMessage: "Internal stack detail" }),
    );
    render();

    await act(async () => button("Allow")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save your decision. Try again.",
    );
  });

  it("shows the outcome once the request is decided", () => {
    mocks.query = {
      data: {
        ...pendingReview,
        state: "approved",
        grantedRole: "editor",
        decidedAt: "2026-10-01T11:00:00.000Z",
      },
    };
    render();

    expect(container.querySelector("h1")?.textContent).toBe("Access allowed");
    expect(container.textContent).toContain("Editor");
    expect(button("Allow")).toBeUndefined();
    expect(button("Decline")).toBeUndefined();
  });

  it("shows nothing about the request to someone who can't review it", () => {
    mocks.query = { isError: true, error: actionError(404) };
    render();

    expect(container.querySelector("h1")?.textContent).toBe(
      "You can't review this request",
    );
    expect(container.textContent).toContain(
      "You're signed in as owner@example.test",
    );
    expect(container.textContent).not.toContain("Launch plan");
    expect(button("Allow")).toBeUndefined();

    act(() => button("Switch account")?.click());
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("asks a signed-out visitor to sign in", () => {
    mocks.query = { isError: true, error: actionError(401) };
    render();

    expect(container.querySelector("h1")?.textContent).toBe(
      "Sign in to continue",
    );
    expect(button("Sign in")).toBeDefined();
  });

  it("offers Retry when the request couldn't be read", () => {
    mocks.query = { isError: true, error: actionError(500) };
    render();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't load this request.",
    );
    act(() => button("Retry")?.click());
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
