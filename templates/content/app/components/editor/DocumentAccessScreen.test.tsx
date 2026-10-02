// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data?: unknown; isPending: boolean; isError: boolean };

const mocks = vi.hoisted(() => ({
  session: { current: null as { email: string } | null },
  signOut: vi.fn(),
  restore: vi.fn(),
  queries: {} as Record<string, QueryResult>,
  useActionQuery: vi.fn(),
  gate: {
    status: undefined as { state: string; role?: string } | undefined,
    isError: false,
    refetch: vi.fn(),
    onAccessGranted: undefined as (() => void) | undefined,
    options: undefined as unknown,
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  signOut: mocks.signOut,
  useActionQuery: mocks.useActionQuery,
  useSession: () => ({ session: mocks.session.current }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, params?: { email?: string }) =>
    params?.email ? `${key} ${params.email}` : key,
}));
vi.mock("@agent-native/core/client/sharing", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/sharing")
  >()),
  useResourceAccessGate: (options: { onAccessGranted?: () => void }) => {
    mocks.gate.options = options;
    mocks.gate.onAccessGranted = options.onAccessGranted;
    return {
      status: mocks.gate.status,
      isLoading: !mocks.gate.status && !mocks.gate.isError,
      isError: mocks.gate.isError,
      refetch: mocks.gate.refetch,
    };
  },
}));
vi.mock("@/hooks/use-documents", () => ({
  useRestoreDocument: () => ({ mutateAsync: mocks.restore, isPending: false }),
}));
vi.mock("@/components/layout/sidebar-trigger", () => ({
  useSidebarTrigger: () => null,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { DocumentAccessScreen } from "./DocumentAccessScreen";

describe("DocumentAccessScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onReload = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.session.current = { email: "outsider@example.test" };
    mocks.gate.status = undefined;
    mocks.gate.isError = false;
    mocks.queries = {};
    mocks.useActionQuery.mockReset();
    mocks.useActionQuery.mockImplementation(
      (
        name: string,
        params: { id?: string; resourceId?: string },
        options: { enabled?: boolean },
      ) =>
        (options.enabled &&
          mocks.queries[`${name}:${params.id ?? params.resourceId}`]) || {
          data: undefined,
          isPending: true,
          isError: false,
        },
    );
    for (const fn of [
      mocks.signOut,
      mocks.restore,
      mocks.gate.refetch,
      mocks.toast.success,
      mocks.toast.error,
      onReload,
    ]) {
      fn.mockReset();
    }
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
    status: { state: string; role?: string } | undefined,
    reloading = false,
  ) {
    mocks.gate.status = status;
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/page/private-doc"]}>
          <Routes>
            <Route
              path="/page/:id"
              element={
                <DocumentAccessScreen
                  documentId="private-doc"
                  loading={<p>loading</p>}
                  reloading={reloading}
                  onReload={onReload}
                />
              }
            />
            <Route path="/home" element={<p>landing</p>} />
            <Route path="/trash" element={<p>trash</p>} />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
  }

  it("asks about this page and shows the editor's loading state meanwhile", () => {
    render(undefined);

    expect(mocks.gate.options).toMatchObject({
      resourceType: "document",
      resourceId: "private-doc",
    });
    expect(container.textContent).toBe("loading");
  });

  it("tells an outsider the page exists but isn't theirs to open", () => {
    render({ state: "denied" });

    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.pageNoAccess",
    );
    expect(container.textContent).toContain(
      "agentChat.accessGate.signedInAs outsider@example.test",
    );
    const home = container.querySelector("a");
    expect(home?.getAttribute("href")).toBe("/home");
    expect(home?.textContent).toBe("empty.goToMyPages");

    act(() => button("agentChat.accessGate.switchAccount")?.click());
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith();
  });

  it("goes to the person's own landing only when they ask", () => {
    render({ state: "denied" });

    act(() => container.querySelector("a")?.click());

    expect(container.textContent).toBe("landing");
  });

  it("says a missing page doesn't exist, without the account or Switch account", () => {
    render({ state: "missing" });

    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.pageMissing",
    );
    expect(container.textContent).not.toContain("signedInAs");
    expect(button("agentChat.accessGate.switchAccount")).toBeUndefined();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/home");
  });

  it("reads the page again when it can be opened, then says missing if that fails", () => {
    render({ state: "allowed", role: "owner" });
    expect(container.textContent).toBe("loading");

    act(() => mocks.gate.onAccessGranted?.());
    render({ state: "allowed", role: "owner" }, true);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("loading");

    render({ state: "allowed", role: "owner" }, false);
    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.pageMissing",
    );
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("reads the page again when access arrives while the screen is open", () => {
    render({ state: "denied" });

    mocks.gate.onAccessGranted?.();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  function trashedPage(trashRootId: string | null) {
    mocks.queries["get-trashed-document:private-doc"] = {
      data: { trashRootId },
      isPending: false,
      isError: false,
    };
  }

  it("offers the owner Restore and Open Trash for a trashed page", async () => {
    trashedPage(null);
    mocks.restore.mockResolvedValue({ success: true });
    render({ state: "trashed", role: "owner" });

    expect(container.querySelector("h1")?.textContent).toBe(
      "empty.pageInTrash",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/trash");

    await act(async () => {
      button("trash.restore")?.click();
    });

    expect(mocks.restore).toHaveBeenCalledWith({ id: "private-doc" });
    expect(mocks.toast.success).toHaveBeenCalledWith("trash.restored");
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("restores from the page that was deleted when the viewer manages it", async () => {
    trashedPage("parent-doc");
    mocks.queries["get-resource-access-status:parent-doc"] = {
      data: { state: "trashed", role: "admin" },
      isPending: false,
      isError: false,
    };
    mocks.restore.mockResolvedValue({ success: true });
    render({ state: "trashed", role: "owner" });

    await act(async () => {
      button("trash.restore")?.click();
    });

    expect(mocks.restore).toHaveBeenCalledWith({ id: "parent-doc" });
  });

  it("doesn't offer Restore when the page was deleted with a parent the viewer can't manage", () => {
    trashedPage("parent-doc");
    mocks.queries["get-resource-access-status:parent-doc"] = {
      data: { state: "trashed", role: "viewer" },
      isPending: false,
      isError: false,
    };
    render({ state: "trashed", role: "owner" });

    expect(container.textContent).toContain("empty.pageInTrashAskOwner");
    expect(button("trash.restore")).toBeUndefined();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/home");
  });

  it("shows the loading state while it checks who can restore", () => {
    render({ state: "trashed", role: "owner" });

    expect(container.textContent).toBe("loading");
  });

  it("says so when Restore fails and stays on the screen", async () => {
    trashedPage(null);
    mocks.restore.mockRejectedValue(new Error("nope"));
    render({ state: "trashed", role: "admin" });

    await act(async () => {
      button("trash.restore")?.click();
    });

    expect(mocks.restore).toHaveBeenCalledWith({ id: "private-doc" });
    expect(mocks.toast.error).toHaveBeenCalledWith("trash.restoreFailed");
    expect(onReload).not.toHaveBeenCalled();
  });

  it("asks a viewer of a trashed page to have the owner restore it", () => {
    render({ state: "trashed", role: "viewer" });

    expect(container.textContent).toContain("empty.pageInTrashAskOwner");
    expect(button("trash.restore")).toBeUndefined();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/home");
  });

  it("offers a retry when the status can't be loaded", () => {
    mocks.gate.isError = true;
    render(undefined);

    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
  });
});
