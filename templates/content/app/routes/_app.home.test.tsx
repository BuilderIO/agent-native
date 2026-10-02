// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveLanding,
  searchParams,
  startPageOpenDocumentReads,
  useLastLocationTitleHint,
  locationState,
} = vi.hoisted(() => ({
  startPageOpenDocumentReads: vi.fn(),
  locationState: { current: null as unknown },
  resolveLanding: {
    mutateAsync: vi.fn(),
    isError: false,
    isPending: false,
    reset: vi.fn(),
  },
  searchParams: new URLSearchParams(),
  useLastLocationTitleHint: vi.fn(
    () => null as null | undefined | { documentId: string; title: string },
  ),
}));
const landingOptions = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | {
        skipActionQueryInvalidation?: boolean;
        onSuccess?: (result: {
          resolution: string;
          welcomeCreated?: true;
        }) => void;
      },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (
    _name: string,
    options: typeof landingOptions.current,
  ) => {
    landingOptions.current = options;
    return resolveLanding;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-optimistic-document-title", () => ({
  useLastLocationTitleHint,
}));

vi.mock("@/hooks/use-documents", () => ({
  LIST_DOCUMENTS_QUERY_KEY: ["action", "list-documents", undefined],
  startPageOpenDocumentReads,
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <header data-testid="app-header" />,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

const navigate = vi.fn();

vi.mock("react-router", () => ({
  PrefetchPageLinks: () => null,
  useLocation: () => ({
    pathname: "/home",
    search: "",
    hash: "",
    state: locationState.current,
  }),
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams],
}));

import {
  peekLandingTitleHint,
  stashLandingTitleHint,
} from "@/lib/document-title-hint";
import { rememberPageIconRow } from "@/lib/page-startup-hints";

import HomeRoute from "./_app.home";

const queryClient = new QueryClient();

function renderHome(root: Root) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <HomeRoute />
      </QueryClientProvider>,
    );
  });
}

describe("home landing route optimistic title", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resolveLanding.mutateAsync.mockReset();
    resolveLanding.isError = false;
    searchParams.delete("spaceId");
    useLastLocationTitleHint.mockReturnValue(null);
    startPageOpenDocumentReads.mockReset();
    locationState.current = null;
    navigate.mockReset();
    stashLandingTitleHint(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resolveLanding.reset.mockClear();
  });

  it("refreshes the Files root and recents only when the landing created Welcome", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "doc-1",
      resolution: "restored",
    });
    renderHome(root);

    expect(landingOptions.current?.skipActionQueryInvalidation).toBe(true);
    landingOptions.current?.onSuccess?.({ resolution: "restored" });
    landingOptions.current?.onSuccess?.({ resolution: "welcome-reused" });
    expect(invalidate).not.toHaveBeenCalled();

    landingOptions.current?.onSuccess?.({
      resolution: "fallback",
      welcomeCreated: true,
    });
    const refreshed = invalidate.mock.calls.map(([filters]) => filters);
    expect(refreshed.map((filters) => filters?.queryKey)).toEqual([
      ["action", "query-content-database-items"],
      ["action", "get-content-recent"],
      ["action", "list-documents", undefined],
    ]);
    expect(refreshed).not.toContainEqual({ queryKey: ["action"] });
    const [navigation] = refreshed;
    const predicate = navigation?.predicate as (query: {
      queryKey: readonly unknown[];
    }) => boolean;
    expect(
      predicate({
        queryKey: [
          "action",
          "query-content-database-items",
          { databaseId: "files", navigation: { parentId: null } },
        ],
      }),
    ).toBe(true);
    expect(
      predicate({
        queryKey: [
          "action",
          "query-content-database-items",
          { databaseId: "files", navigation: { parentId: "page" } },
        ],
      }),
    ).toBe(false);
    invalidate.mockRestore();
  });

  it("keeps the plain skeleton when nothing knows the title", async () => {
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "doc-1",
      resolution: "restored",
    });
    renderHome(root);
    expect(container.textContent).not.toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/doc-1", search: "", hash: "" },
      { replace: true },
    );
  });

  it("holds the body placeholder until a saved title names the page", () => {
    resolveLanding.mutateAsync.mockReturnValue(new Promise(() => {}));
    useLastLocationTitleHint.mockReturnValue(undefined);
    renderHome(root);
    expect(
      container.querySelector('[data-startup-anchor="title"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-startup-anchor="body"]')).toBeNull();

    useLastLocationTitleHint.mockReturnValue(null);
    renderHome(root);
    expect(container.querySelector('[data-startup-anchor="body"]')).toBeNull();

    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    renderHome(root);
    expect(
      container.querySelector('[data-startup-anchor="body"]'),
    ).not.toBeNull();
  });

  it("holds the remembered icon row of the page it expects to open", () => {
    resolveLanding.mutateAsync.mockReturnValue(new Promise(() => {}));
    rememberPageIconRow("doc-1", "icon");
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    renderHome(root);
    expect(
      container.querySelector('[data-startup-anchor="title"]')
        ?.previousElementSibling?.firstElementChild?.className,
    ).toContain("size-14");
    rememberPageIconRow("doc-1", "add");
  });

  it("draws the page placeholder without the app header, which messages get back", () => {
    resolveLanding.mutateAsync.mockReturnValue(new Promise(() => {}));
    renderHome(root);
    expect(container.querySelector('[data-testid="app-header"]')).toBeNull();

    resolveLanding.isError = true;
    renderHome(root);
    expect(
      container.querySelector('[data-testid="app-header"]'),
    ).not.toBeNull();
  });

  it("paints the persisted title immediately and hands it to the editor", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "doc-1",
      resolution: "restored",
    });
    renderHome(root);
    expect(container.textContent).toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/doc-1", search: "", hash: "" },
      { replace: true },
    );
    expect(peekLandingTitleHint("doc-1")).toEqual({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    expect(peekLandingTitleHint("doc-2")).toBeNull();
  });

  it("never hands a title forward when the resolver restores another page", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "welcome-1",
      resolution: "fallback",
      fallbackReason: "saved-document-unavailable",
    });
    renderHome(root);
    expect(container.textContent).toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/welcome-1", search: "", hash: "" },
      { replace: true },
    );
    expect(peekLandingTitleHint("welcome-1")).toBeNull();
    expect(peekLandingTitleHint("doc-1")).toBeNull();
  });

  it("resolves an explicit workspace and opens its exact saved target", async () => {
    searchParams.set("spaceId", "space-2");
    resolveLanding.mutateAsync.mockResolvedValue({
      target: {
        documentId: "doc-2",
        databaseId: "database-2",
        viewId: "board",
      },
      resolution: "restored",
    });

    renderHome(root);
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveLanding.mutateAsync).toHaveBeenCalledWith({
      spaceId: "space-2",
    });
    expect(navigate).toHaveBeenCalledWith(
      "/page/doc-2?databaseId=database-2&viewId=board",
      { replace: true },
    );
  });

  it("ignores a stale landing resolution after switching workspaces", async () => {
    const pending = new Map<
      string,
      (value: {
        target: { documentId: string; databaseId: string; viewId: string };
        resolution: "restored";
      }) => void
    >();
    resolveLanding.mutateAsync.mockImplementation(
      ({ spaceId }: { spaceId: string }) =>
        new Promise((resolve) => pending.set(spaceId, resolve)),
    );

    searchParams.set("spaceId", "space-a");
    renderHome(root);
    await act(async () => Promise.resolve());
    searchParams.set("spaceId", "space-b");
    renderHome(root);
    await act(async () => Promise.resolve());

    await act(async () => {
      pending.get("space-b")?.({
        target: {
          documentId: "doc-b",
          databaseId: "database-b",
          viewId: "board",
        },
        resolution: "restored",
      });
      await Promise.resolve();
    });
    await act(async () => {
      pending.get("space-a")?.({
        target: {
          documentId: "doc-a",
          databaseId: "database-a",
          viewId: "table",
        },
        resolution: "restored",
      });
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      "/page/doc-b?databaseId=database-b&viewId=board",
      { replace: true },
    );
  });

  it("starts the remembered page's reads while the landing validates it", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockReturnValue(new Promise(() => {}));

    renderHome(root);
    await act(async () => Promise.resolve());

    expect(startPageOpenDocumentReads).toHaveBeenCalledTimes(1);
    expect(startPageOpenDocumentReads).toHaveBeenCalledWith(
      queryClient,
      "doc-1",
      { databaseId: null, databaseDocumentId: null },
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not guess a page for a workspace landing or an unavailable-page recovery", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockReturnValue(new Promise(() => {}));
    searchParams.set("spaceId", "space-2");
    renderHome(root);
    await act(async () => Promise.resolve());
    expect(startPageOpenDocumentReads).not.toHaveBeenCalled();

    searchParams.delete("spaceId");
    locationState.current = { unavailableDocumentId: "doc-1" };
    renderHome(root);
    await act(async () => Promise.resolve());
    expect(startPageOpenDocumentReads).not.toHaveBeenCalled();
  });
});
