// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const OWNER = "owner@example.test";

const mocks = vi.hoisted(() => ({
  playerData: null as Record<string, unknown> | null,
  queries: new Map<string, Record<string, unknown>>(),
  mutations: new Map<string, Record<string, unknown>>(),
  mutationCalls: [] as { name: string; args: unknown }[],
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  const session = {
    session: { email: "owner@example.test", name: "Owner" },
    isLoading: false,
    status: "authenticated",
    error: null,
    retry: () => {},
  };
  return {
    ...actual,
    useSession: () => session,
    useActionQuery: (name: string) => {
      let query = mocks.queries.get(name);
      if (!query) {
        query = {
          data:
            name === "get-recording-player-data" ? mocks.playerData : undefined,
          error: null,
          isError: false,
          isFetching: false,
          isLoading: false,
          isPending: false,
          isSuccess: true,
          status: "success",
          refetch: async () => ({}),
        };
        mocks.queries.set(name, query);
      }
      return query;
    },
    useActionMutation: (name: string) => {
      let mutation = mocks.mutations.get(name);
      if (!mutation) {
        const run = async (args: unknown) => {
          mocks.mutationCalls.push({ name, args });
          return { id: `${name}-result` };
        };
        mutation = {
          isPending: false,
          mutate: (args: unknown) => void run(args),
          mutateAsync: run,
          reset: () => {},
        };
        mocks.mutations.set(name, mutation);
      }
      return mutation;
    },
  };
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const { default: messages } = await import("@/i18n/en-US");
  const t = (key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        messages,
      );
    return typeof value === "string" ? value : key;
  };
  return {
    ...(await importOriginal<
      typeof import("@agent-native/core/client/i18n")
    >()),
    useT: () => t,
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";

import RecordingPage from "./_app.r.$recordingId";

function playerData(
  recordingId: string,
  settings: { enableComments: boolean; enableReactions: boolean },
) {
  return {
    role: "owner",
    canComment: true,
    viewCount: 0,
    agentViewCount: 0,
    recording: {
      id: recordingId,
      organizationId: "org-1",
      title: "Product walkthrough",
      description: null,
      kind: "video",
      imageUrl: null,
      baseImageUrl: null,
      annotations: [],
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
      filmstripUrl: null,
      filmstripFrameCount: 0,
      durationMs: 6_000,
      editsJson: "{}",
      videoUrl: "/clip.webm",
      videoFormat: "webm",
      videoSizeBytes: 1_000,
      mediaUpdatedAt: null,
      width: 640,
      height: 360,
      hasAudio: false,
      hasCamera: false,
      status: "ready",
      verificationPending: false,
      seekableRepairPending: false,
      uploadProgress: 100,
      failureReason: null,
      failureCode: null,
      hasPassword: false,
      expiresAt: null,
      enableDownloads: true,
      defaultSpeed: "1",
      animatedThumbnailEnabled: false,
      visibility: "private",
      ownerEmail: OWNER,
      folderId: null,
      spaceIds: [],
      createdAt: "2026-10-25T12:00:00.000Z",
      updatedAt: "2026-10-25T12:00:00.000Z",
      trashedAt: null,
      ...settings,
    },
    transcript: null,
    comments: [],
    reactions: [],
    chapters: [],
    tags: [],
    ctas: [],
  };
}

describe("recording page reactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    mocks.queries.clear();
    mocks.mutations.clear();
    mocks.mutationCalls.length = 0;
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

  async function renderRecording(
    recordingId: string,
    settings: { enableComments: boolean; enableReactions: boolean },
  ) {
    mocks.playerData = playerData(recordingId, settings);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[`/r/${recordingId}`]}>
              <Routes>
                <Route path="/r/:recordingId" element={<RecordingPage />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  function headerReactButton() {
    return Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "React",
    );
  }

  it("lets the owner react when comments are off and reactions are on", async () => {
    await renderRecording("rec-comments-off", {
      enableComments: false,
      enableReactions: true,
    });

    const react = headerReactButton();
    assert.isDefined(react);
    expect(react.disabled).toBe(false);
    expect(
      document.querySelector('[placeholder="Leave a comment..."]'),
    ).toBeNull();

    await act(async () => {
      react.click();
    });
    const fire = document.querySelector<HTMLButtonElement>(
      'button[aria-label="React fire"]',
    );
    assert.isNotNull(fire);
    await act(async () => {
      fire.click();
    });

    expect(mocks.mutationCalls).toEqual([
      {
        name: "react-to-recording",
        args: {
          recordingId: "rec-comments-off",
          emoji: "🔥",
          videoTimestampMs: 0,
        },
      },
    ]);
  });

  it("hides the reaction button when reactions are off", async () => {
    await renderRecording("rec-reactions-off", {
      enableComments: false,
      enableReactions: false,
    });

    expect(headerReactButton()).toBeUndefined();
  });

  it("keeps reactions disabled on the viewer redesign preview", async () => {
    await renderRecording("viewer-redesign-preview", {
      enableComments: false,
      enableReactions: true,
    });

    expect(headerReactButton()?.disabled).toBe(true);
  });
});
