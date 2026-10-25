// @vitest-environment happy-dom
// oracle-change(templates/clips/app/lib/missing-share-retry.test.ts): The share page no longer polls the share API after a missing-record 404; these rendering tests of the unavailable state replace the deleted polling-helper tests.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {} as Record<string, unknown>,
  sessionStatus: "unauthenticated" as "unauthenticated" | "loading",
  recordingRows: [] as Record<string, unknown>[],
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

vi.mock("../../server/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.recordingRows),
        }),
      }),
    }),
  }),
  schema: { recordings: {}, organizationSettings: {} },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => null,
  signScopedAgentAccessToken: () => "access-request-token",
  verifyScopedAgentAccessToken: () => ({ ok: false }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: () => Promise.resolve(null),
}));

import ShareRoute, { loader, meta } from "./share.$shareId";

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

describe("share page server data for a clip in Trash", () => {
  function recordingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SHARE_ID,
      title: "Quarterly roadmap",
      description: "Pricing changes for Q4",
      thumbnailUrl: "https://media.example.test/clip-1/thumb.jpg",
      animatedThumbnailUrl: null,
      updatedAt: "2026-10-24T12:00:00.000Z",
      sharePasswordVersion: null,
      visibility: "public",
      status: "ready",
      ownerEmail: "owner@example.test",
      organizationId: null,
      password: null,
      expiresAt: null,
      archivedAt: null,
      trashedAt: null,
      sourceAppName: null,
      videoUrl: "https://media.example.test/clip-1/video.mp4",
      ...overrides,
    };
  }

  async function loadShare(row?: Record<string, unknown>) {
    mocks.recordingRows = row ? [row] : [];
    const pageData = await loader({
      params: { shareId: SHARE_ID },
      url: new URL(`https://clips.example.test/share/${SHARE_ID}`),
    } as unknown as Parameters<typeof loader>[0]);
    const tags = meta({ loaderData: pageData } as unknown as Parameters<
      typeof meta
    >[0]);
    return { pageData, tags };
  }

  it.each(["public", "private"])(
    "serves a trashed %s clip the same page data and meta tags as a missing one",
    async (visibility) => {
      const missing = await loadShare();
      const trashed = await loadShare(
        recordingRow({ visibility, trashedAt: "2026-10-24T12:00:00.000Z" }),
      );

      expect(trashed).toEqual(missing);
    },
  );

  it("keeps the title and image of a public clip that is not in Trash", async () => {
    const { pageData, tags } = await loadShare(recordingRow());

    expect(pageData).toMatchObject({
      recording: { title: "Quarterly roadmap" },
    });
    expect(tags).toContainEqual({
      property: "og:title",
      content: "Quarterly roadmap · Clips",
    });
    expect(tags).toContainEqual(
      expect.objectContaining({ property: "og:image" }),
    );
  });

  it("keeps the request-access page data for a private clip", async () => {
    const { pageData } = await loadShare(
      recordingRow({ visibility: "private" }),
    );

    expect(pageData).toMatchObject({
      data: { recording: null, accessDeniedStatus: 401 },
      init: { status: 401 },
    });
  });
});
