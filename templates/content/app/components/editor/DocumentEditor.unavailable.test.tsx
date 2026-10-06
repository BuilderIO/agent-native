// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session, signOut } = vi.hoisted(() => ({
  session: { current: null as { email: string } | null },
  signOut: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  signOut,
  useSession: () => ({ session: session.current }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));
vi.mock("@/components/layout/sidebar-trigger", () => ({
  useSidebarTrigger: () => null,
}));

import { DocumentUnavailable } from "./DocumentEditor";

describe("DocumentUnavailable", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    session.current = { email: "outsider@example.test" };
    signOut.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(host: "page" | "preview") {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/page/private-doc"]}>
          <Routes>
            <Route
              path="/page/:id"
              element={<DocumentUnavailable host={host} />}
            />
            <Route path="/home" element={<p>landing</p>} />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it("keeps a page link on its URL and says which account can't open it", () => {
    render("page");

    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.documentUnavailable",
    );
    expect(container.textContent).toContain(
      'empty.signedInAs {"email":"outsider@example.test"}',
    );
    expect(container.textContent).not.toContain("landing");
    const home = container.querySelector("a");
    expect(home?.getAttribute("href")).toBe("/home");
    expect(home?.textContent).toBe("empty.goToMyPages");
  });

  it("goes to the person's own landing only when they ask", () => {
    render("page");

    act(() => {
      container.querySelector("a")?.click();
    });

    expect(container.textContent).toBe("landing");
  });

  it("switches account through sign-out, which returns to this link", () => {
    render("page");
    const switchAccount = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "empty.switchAccount",
    );

    act(() => switchAccount?.click());

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
  });

  it("leaves out the account and actions inside an embedded preview", () => {
    render("preview");

    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.documentUnavailable",
    );
    expect(container.textContent).not.toContain("empty.signedInAs");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
