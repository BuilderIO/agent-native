// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {} as Record<string, unknown>,
  sessionStatus: "unauthenticated" as "unauthenticated" | "loading",
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useLoaderData: () => mocks.loaderData,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session: null,
    isLoading: mocks.sessionStatus === "loading",
    status: mocks.sessionStatus,
    error: null,
    retry: () => {},
  }),
  useActionMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: vi.fn(),
}));

vi.mock("../../server/db", () => ({ getDb: vi.fn(), schema: {} }));

import ShareRoute from "./share.$shareId";

const SHARE_ID = "clip-1";

const trashedPublicClip = {
  id: SHARE_ID,
  title: "Retired demo",
  description: "",
  ownerInitial: "A",
  brandLogoUrl: null,
  thumbnailUrl: null,
  animatedThumbnailUrl: null,
  updatedAt: "2026-10-24T12:00:00.000Z",
  visibility: "public",
  status: "ready",
  hasPassword: false,
  archivedAt: null,
  trashedAt: "2026-10-24T12:00:00.000Z",
  isLoomEmbedBacked: false,
};

function loaderData(overrides: Record<string, unknown>) {
  return {
    recording: null,
    agentContextUrl: null,
    origin: "http://localhost:3000",
    shareUrl: null,
    ...overrides,
  };
}

describe("share page when the public recording read answers Not found", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.sessionStatus = "unauthenticated";
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  function render() {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/share/${SHARE_ID}`]}>
            <Routes>
              <Route path="/share/:shareId" element={<ShareRoute />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  function publicRecordingReads() {
    return fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/public-recording"),
    ).length;
  }

  function pageState() {
    return {
      heading: container.querySelector("h1")?.textContent ?? null,
      loadingPlaceholder: container.querySelector(".skeleton-shimmer") !== null,
      publicRecordingReads: publicRecordingReads(),
    };
  }

  async function settle(ms: number) {
    await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  it.each([
    ["a trashed clip", { recording: trashedPublicClip }],
    ["a missing clip", {}],
  ])("shows Clip unavailable at once for %s", async (_label, overrides) => {
    mocks.loaderData = loaderData(overrides);
    render();

    expect(pageState()).toMatchObject({
      heading: null,
      loadingPlaceholder: true,
    });

    await vi.waitFor(() => expect(publicRecordingReads()).toBe(1));
    await settle(400);

    expect(pageState()).toEqual({
      heading: "sharePage.clipUnavailable",
      loadingPlaceholder: false,
      publicRecordingReads: 1,
    });
  });

  it("keeps the request-access screen for a private clip", async () => {
    mocks.loaderData = loaderData({ accessDeniedStatus: 401 });
    render();

    await vi.waitFor(() => expect(publicRecordingReads()).toBe(1));
    await settle(400);

    expect(pageState()).toEqual({
      heading: "sharePage.privateClip",
      loadingPlaceholder: false,
      publicRecordingReads: 1,
    });
  });

  it("waits for the session before treating Not found as final", async () => {
    mocks.sessionStatus = "loading";
    mocks.loaderData = loaderData({ recording: trashedPublicClip });
    render();

    await vi.waitFor(() => expect(publicRecordingReads()).toBe(1));
    await settle(400);

    expect(pageState()).toMatchObject({
      heading: null,
      loadingPlaceholder: true,
    });
  });
});
