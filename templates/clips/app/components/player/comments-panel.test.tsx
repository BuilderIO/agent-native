// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  useCommentAccessRefresh,
  useCommentAccessToken,
} from "../../hooks/use-comment-access-refresh";
import {
  collectCommentSubtreeIds,
  type Comment,
  CommentsPanel,
  relativeTime,
} from "./comments-panel";
import { TimestampedCommentBar } from "./timestamped-comment-button";

type MockedMutationOptions = {
  headers?: Record<string, string> | (() => Record<string, string> | undefined);
  onMutate?: (vars: Record<string, unknown>) => unknown;
};

const actionMocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  otherMutation: vi.fn(),
  mutationOptions: new Map<string, any>(),
  requests: vi.fn(),
  realMutations: false,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    cn: (...classes: Array<string | false | null | undefined>) =>
      classes.filter(Boolean).join(" "),
    useActionMutation: (name: string, options?: MockedMutationOptions) => {
      if (actionMocks.realMutations)
        return actual.useActionMutation(name, options);
      actionMocks.mutationOptions.set(name, options);
      return {
        mutate: (vars: Record<string, unknown>) => {
          const headers =
            typeof options?.headers === "function"
              ? options.headers()
              : options?.headers;
          actionMocks.requests(name, vars, headers);
          void options?.onMutate?.(vars);
          return (
            name === "add-comment"
              ? actionMocks.addComment
              : name === "update-comment"
                ? actionMocks.updateComment
                : name === "delete-comment"
                  ? actionMocks.deleteComment
                  : actionMocks.otherMutation
          )(vars);
        },
      };
    },
    useAvatarUrl: () => null,
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatRelativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => {
      if (options?.numeric === "auto" && value === 0) return "now";
      const amount = Math.abs(value);
      return `${amount} ${unit}${amount === 1 ? "" : "s"} ${value < 0 ? "ago" : "from now"}`;
    },
  }),
}));

vi.mock("../../hooks/use-mention-members", () => ({
  useMentionMembers: () => ({
    data: [{ email: "member@example.com", name: "Member" }],
  }),
}));

const rootComment: Comment = {
  id: "comment-1",
  threadId: "thread-1",
  parentId: null,
  authorEmail: "author@example.com",
  authorName: "Author",
  content:
    "Please take a look at https://example.com/docs?item=1 and www.example.org/help.",
  videoTimestampMs: 12_000,
  emojiReactionsJson: "{}",
  resolved: false,
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
};

let notifyResize: (() => void) | undefined;

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this as unknown as ResizeObserver);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: value }),
  );
}

async function mentionMember(composer: HTMLTextAreaElement, text: string) {
  const value = `${text} @`;
  act(() => {
    setTextareaValue(composer, value);
    composer.setSelectionRange(value.length, value.length);
    composer.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, key: "@" }),
    );
  });
  await act(async () => {
    document.body
      .querySelector<HTMLButtonElement>('button[role="option"]')
      ?.click();
    await Promise.resolve();
  });
  expect(composer.value).toBe(`${text} @Member `);
}

describe("comment timestamps", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const formatRelativeTime = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
  ) => {
    const amount = Math.abs(value);
    return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
  };

  it.each([
    [45 * 60 * 1000, "45 minutes ago"],
    [18 * 60 * 60 * 1000, "18 hours ago"],
    [3 * 24 * 60 * 60 * 1000, "3 days ago"],
    [2 * 30 * 24 * 60 * 60 * 1000, "2 months ago"],
    [365 * 24 * 60 * 60 * 1000, "1 year ago"],
  ])(
    "uses full relative units for an elapsed timestamp",
    (elapsed, expected) => {
      const createdAt = new Date(now - elapsed).toISOString();
      expect(relativeTime(createdAt, formatRelativeTime, now)).toBe(expected);
    },
  );

  it("uses a localized near-now value for a just-created comment", () => {
    const formatter = vi.fn(
      (
        _value: number,
        _unit: Intl.RelativeTimeFormatUnit,
        options?: Intl.RelativeTimeFormatOptions,
      ) => (options?.numeric === "auto" ? "now" : "unexpected"),
    );
    expect(
      relativeTime(new Date(now - 30_000).toISOString(), formatter, now),
    ).toBe("now");
    expect(formatter).toHaveBeenCalledWith(0, "second", { numeric: "auto" });
  });

  it("does not round into the next unit before its boundary", () => {
    expect(
      relativeTime(
        new Date(now - 59.9 * 60_000).toISOString(),
        formatRelativeTime,
        now,
      ),
    ).toBe("59 minutes ago");
    expect(
      relativeTime(
        new Date(now - 23.9 * 3_600_000).toISOString(),
        formatRelativeTime,
        now,
      ),
    ).toBe("23 hours ago");
  });

  it("returns an empty value for an invalid timestamp", () => {
    expect(relativeTime("not-a-date", formatRelativeTime, now)).toBe("");
  });
});

async function openMenu(trigger: HTMLButtonElement | null) {
  expect(trigger).not.toBeNull();
  trigger?.focus();
  await act(async () => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

const fakeShareKey = ["public-recording", "fake-share"];

function fakeShare(commentAccessToken: string, comments: Comment[]) {
  return {
    ok: true,
    status: 200,
    data: { recording: { commentAccessToken }, comments },
  };
}

function ProofShare({
  shareFetch,
  getCurrentMs,
}: {
  shareFetch: (context: {
    signal: AbortSignal;
  }) => Promise<ReturnType<typeof fakeShare>>;
  getCurrentMs?: (() => number) | undefined;
}) {
  const shareQ = useQuery({ queryKey: fakeShareKey, queryFn: shareFetch });
  const getCommentAccessToken = useCommentAccessToken(shareQ, fakeShareKey);
  const share = shareQ.data?.data;
  if (!share) return null;
  return (
    <CommentsPanel
      recordingId="recording-1"
      comments={share.comments}
      currentMs={34_000}
      getCurrentMs={getCurrentMs}
      currentUserEmail="viewer@example.com"
      enableComments
      canComment
      onSeek={vi.fn()}
      queryKey={fakeShareKey}
      selectComments={(data) =>
        (data as ReturnType<typeof fakeShare> | undefined)?.data.comments
      }
      applyComments={(data, next) => {
        const current = data as ReturnType<typeof fakeShare> | undefined;
        return current
          ? { ...current, data: { ...current.data, comments: next } }
          : current;
      }}
      commentAccessToken={share.recording.commentAccessToken}
      getCommentAccessToken={getCommentAccessToken}
      presentation="share"
    />
  );
}

// Like the share and recording routes: the page owns the draft, whether the
// bar is open, and the time it comments at, taken from the playhead when it
// opens; the bar paints inside the player only while the player is fullscreen.
function FullscreenCommentPage({
  fullscreen,
  player,
  initialDraft = "",
  getPlayheadMs,
  onClose,
  ...bar
}: Omit<
  React.ComponentProps<typeof TimestampedCommentBar>,
  "draft" | "onDraftChange" | "portalContainer"
> & {
  fullscreen: boolean;
  player: HTMLElement;
  initialDraft?: string;
  getPlayheadMs?: () => number;
}) {
  const [draft, setDraft] = React.useState(initialDraft);
  const [open, setOpen] = React.useState(true);
  const [atMs, setAtMs] = React.useState(bar.atMs);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAtMs(getPlayheadMs?.() ?? atMs);
          setOpen(true);
        }}
      >
        commentsPanel.commentButton
      </button>
      <TimestampedCommentBar
        {...bar}
        atMs={atMs}
        open={open}
        draft={draft}
        onDraftChange={setDraft}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        portalContainer={fullscreen ? player : undefined}
      />
    </>
  );
}

describe("CommentsPanel reply composer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function renderPanel(
    currentUserEmail = "viewer@example.com",
    comments: Comment[] = [rootComment],
    presentation: "default" | "share" | "inline" = "share",
    enableComments = true,
    canDeleteOwnComments?: boolean,
    commentAccessToken?: string,
  ) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            commentAccessToken={commentAccessToken}
            recordingId="recording-1"
            comments={comments}
            currentMs={34_000}
            currentUserEmail={currentUserEmail}
            enableComments={enableComments}
            canComment={enableComments}
            canDeleteOwnComments={canDeleteOwnComments}
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation={presentation}
          />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderPanel();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    notifyResize = undefined;
    actionMocks.mutationOptions.clear();
    vi.clearAllMocks();
  });

  async function renderProofShare(
    shareFetch: Parameters<typeof ProofShare>[0]["shareFetch"],
    getCurrentMs?: () => number,
  ) {
    act(() => root.render(null));
    actionMocks.realMutations = true;
    onTestFinished(() => {
      actionMocks.realMutations = false;
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProofShare shareFetch={shareFetch} getCurrentMs={getCurrentMs} />
        </QueryClientProvider>,
      );
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  function renderFullscreenCommentPage(
    props: Omit<
      React.ComponentProps<typeof FullscreenCommentPage>,
      "fullscreen" | "player"
    >,
  ) {
    act(() => root.render(null));
    actionMocks.realMutations = true;
    const player = document.createElement("div");
    document.body.appendChild(player);
    onTestFinished(() => {
      actionMocks.realMutations = false;
      player.remove();
    });
    const setFullscreen = (fullscreen: boolean) =>
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <FullscreenCommentPage
              {...props}
              fullscreen={fullscreen}
              player={player}
            />
          </QueryClientProvider>,
        ),
      );
    setFullscreen(true);
    const bar = () => {
      const composer = document.body.querySelector("textarea");
      const send =
        document.body.querySelector<HTMLButtonElement>("button[aria-label]");
      if (!composer || !send) throw new Error("Expected the comment bar");
      return {
        composer,
        send,
        alert: document.body.querySelector('[role="alert"]'),
      };
    };
    const isOpen = () => document.body.querySelector("textarea") !== null;
    const close = (how: "Cancel" | "Escape") =>
      act(() => {
        if (how === "Escape") {
          bar().composer.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        Array.from(document.body.querySelectorAll("button"))
          .find((button) => button.textContent === "common.cancel")
          ?.click();
      });
    const reopen = () =>
      act(() => {
        Array.from(document.body.querySelectorAll("button"))
          .find(
            (button) => button.textContent === "commentsPanel.commentButton",
          )
          ?.click();
      });
    return { player, setFullscreen, bar, isOpen, close, reopen };
  }

  // The page's proof renewal and the add-comment POST, each held until the
  // test settles it, so a fullscreen send can fail after newer typing.
  function deferredCommentTransport() {
    const renewals: Array<(proof: string | Error) => void> = [];
    const getCommentAccessToken = vi.fn(
      (_refusedToken?: string | null) =>
        new Promise<string>((resolve, reject) => {
          renewals.push((proof) =>
            proof instanceof Error ? reject(proof) : resolve(proof),
          );
        }),
    );
    const responses: Array<(status: number) => void> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          responses.push((status) =>
            resolve(
              new Response(
                JSON.stringify(
                  status === 200
                    ? { id: "comment-sent" }
                    : { error: "Forbidden" },
                ),
                { status, headers: { "Content-Type": "application/json" } },
              ),
            ),
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const settle = <T,>(queue: Array<(value: T) => void>, value: T) =>
      act(async () => {
        const next = queue.shift();
        assert.isDefined(next, "Expected a held renewal or request");
        next(value);
        // React Query publishes the settled state to render a tick later.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    return {
      getCommentAccessToken,
      fetch,
      renew: (proof: string | Error) => settle(renewals, proof),
      respond: (status: number) => settle(responses, status),
      sent: (call: number) => {
        const init = fetch.mock.calls[call]?.[1];
        return {
          token: new Headers(init?.headers).get("x-clips-comment-token"),
          body: JSON.parse(String(init?.body)),
        };
      },
    };
  }

  const pageAlerts = () => document.body.querySelectorAll('[role="alert"]');
  const failedBarComment = (content: string) =>
    Array.from(document.body.querySelectorAll("li")).find((row) =>
      row.textContent.includes(content),
    );
  const failedBarCommentButton = (content: string, label: string) =>
    Array.from(
      failedBarComment(content)?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === label);
  const expectFailedBarComment = (content: string, clock: string) => {
    const row = failedBarComment(content);
    assert.isDefined(row, `Expected "${content}" kept as a failed comment`);
    expect(row.textContent).toContain(clock);
    expect(row.querySelector('[role="alert"]')?.textContent).toBe(
      "notificationsRoute.sendFailed",
    );
  };

  const commentCard = (content: string) =>
    Array.from(container.querySelectorAll("li"))
      .map((item) => item.firstElementChild)
      .find((card) => card?.textContent.includes(content));

  const pressCommentButton = async (content: string, label: string) => {
    await act(async () => {
      Array.from(commentCard(content)?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent.trim() === label)
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("supplies current password proof to every comment mutation after rotation", () => {
    for (const token of ["fake-first-grant", "fake-rotated-grant", undefined]) {
      renderPanel(
        "viewer@example.com",
        [rootComment],
        "share",
        true,
        undefined,
        token,
      );
      for (const name of [
        "add-comment",
        "react-to-comment",
        "delete-comment",
        "update-comment",
      ]) {
        const options = actionMocks.mutationOptions.get(name);
        const headers =
          typeof options?.headers === "function"
            ? options.headers()
            : options?.headers;
        expect(headers?.["x-clips-comment-token"]).toBe(token);
      }
    }
  });

  it("refreshes proof before a fullscreen comment sends", async () => {
    act(() => root.render(null));
    actionMocks.realMutations = true;
    onTestFinished(() => {
      actionMocks.realMutations = false;
    });
    let completeRenewal!: (token: string) => void;
    const renewal = new Promise<string>((resolve) => {
      completeRenewal = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ id: "comment-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <TimestampedCommentBar
            recordingId="recording-1"
            atMs={12000}
            draft="Fake fullscreen comment"
            onClose={vi.fn()}
            commentAccessToken="fake-expired-proof"
            getCommentAccessToken={() => renewal}
          />
        </QueryClientProvider>,
      ),
    );
    const send =
      container.querySelector<HTMLButtonElement>("button[aria-label]");
    expect(send).not.toBeNull();
    await act(async () => {
      send?.click();
    });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      completeRenewal("fake-fresh-proof");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    assert.isDefined(init);
    expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
      "fake-fresh-proof",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      recordingId: "recording-1",
      content: "Fake fullscreen comment",
      videoTimestampMs: 12000,
    });
  });

  it("waits for pending password renewal before cancelling queries or sending a mutation", async () => {
    act(() => root.render(null));
    actionMocks.realMutations = true;
    onTestFinished(() => {
      actionMocks.realMutations = false;
    });
    let completeRenewal!: (value: { token: string }) => void;
    const deferred = new Promise<{ token: string }>((resolve) => {
      completeRenewal = resolve;
    });
    const cancel = vi.spyOn(queryClient, "cancelQueries");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ id: "comment-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const renew = () =>
      queryClient
        .fetchQuery({
          queryKey: ["recording", "recording-1"],
          queryFn: () => deferred,
        })
        .catch(() => null);
    function PendingShare() {
      useCommentAccessRefresh("fake-expired-proof", renew);
      return (
        <CommentsPanel
          recordingId="recording-1"
          comments={[
            {
              ...rootComment,
              emojiReactionsJson: JSON.stringify({
                "👍": ["other@example.com"],
              }),
            },
          ]}
          currentMs={0}
          currentUserEmail="viewer@example.com"
          enableComments
          canComment
          onSeek={vi.fn()}
          queryKey={["recording", "recording-1"]}
          commentAccessToken="fake-expired-proof"
          getCommentAccessToken={async () => (await renew())?.token}
        />
      );
    }
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <PendingShare />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    const reaction = container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    expect(reaction).not.toBeNull();
    await act(async () => {
      reaction?.click();
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      completeRenewal({ token: "fake-fresh-proof" });
    });
    expect(cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    assert.isDefined(init);
    expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
      "fake-fresh-proof",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      commentId: "comment-1",
      emoji: "👍",
    });
  });

  it.each(["renewed", "rejected"] as const)(
    "shows a comment at once while stale proof renews, then sends only %s proof",
    async (outcome) => {
      act(() => root.render(null));
      actionMocks.realMutations = true;
      onTestFinished(() => {
        actionMocks.realMutations = false;
      });
      const shareKey = ["public-recording", "fake-share"];
      let settleRenewal!: () => void;
      const shareFetches = [
        async () => ({ token: "fake-stale-proof", comments: [rootComment] }),
        () =>
          new Promise<{ token: string; comments: Comment[] }>(
            (resolve, reject) => {
              settleRenewal = () =>
                outcome === "renewed"
                  ? resolve({
                      token: "fake-renewed-proof",
                      comments: [rootComment],
                    })
                  : reject(new Error("fake renewal failure"));
            },
          ),
      ];
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({ id: "comment-2", threadId: "comment-2" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      vi.stubGlobal("fetch", fetch);
      function StaleShare() {
        const shareQ = useQuery({
          queryKey: shareKey,
          queryFn: () => {
            const nextFetch = shareFetches.shift();
            assert.isDefined(nextFetch);
            return nextFetch();
          },
        });
        if (!shareQ.data) return null;
        return (
          <CommentsPanel
            recordingId="recording-1"
            comments={shareQ.data.comments}
            currentMs={0}
            currentUserEmail="viewer@example.com"
            enableComments
            canComment
            onSeek={vi.fn()}
            queryKey={shareKey}
            selectComments={(data) =>
              (data as { comments?: Comment[] } | undefined)?.comments
            }
            applyComments={(data, next) =>
              data ? { ...(data as object), comments: next } : data
            }
            commentAccessToken={shareQ.data.token}
            getCommentAccessToken={async () => {
              const result = await shareQ.refetch({ cancelRefetch: false });
              if (result.error) throw result.error;
              return result.data?.token;
            }}
            presentation="share"
          />
        );
      }
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <StaleShare />
          </QueryClientProvider>,
        );
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const composer = container.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="commentsPanel.leaveComment"]',
      );
      assert.isNotNull(composer);
      act(() => setTextareaValue(composer, "Fake stale-proof comment"));
      await act(async () => {
        composer.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "Enter",
          }),
        );
      });
      const feed = () =>
        Array.from(container.querySelectorAll("li"))
          .map((item) => item.textContent)
          .join(" ");
      expect(feed()).toContain("Fake stale-proof comment");
      expect(fetch).not.toHaveBeenCalled();

      await act(async () => {
        settleRenewal();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      if (outcome === "rejected") {
        expect(feed()).not.toContain("Fake stale-proof comment");
        expect(fetch).not.toHaveBeenCalled();
        return;
      }
      expect(feed()).toContain("Fake stale-proof comment");
      expect(fetch).toHaveBeenCalledTimes(1);
      const init = fetch.mock.calls[0]?.[1];
      assert.isDefined(init);
      expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
        "fake-renewed-proof",
      );
    },
  );

  it("sends every comment write on a fresh grant at once and renews only after a refusal", async () => {
    const ownComment: Comment = {
      ...rootComment,
      authorEmail: "viewer@example.com",
      emojiReactionsJson: JSON.stringify({ "👍": ["other@example.com"] }),
    };
    const shareFetch = vi.fn(async () =>
      fakeShare(`fake-proof-${shareFetch.mock.calls.length}`, [ownComment]),
    );
    const responses: Array<(response: Response) => void> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise((resolve) => responses.push(resolve)),
    );
    vi.stubGlobal("fetch", fetch);
    const flush = () =>
      act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await renderProofShare(shareFetch);
    const feed = () =>
      Array.from(container.querySelectorAll("li"))
        .map((item) => item.textContent)
        .join(" ");
    const sent = (index: number) => {
      const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
      return {
        token: new Headers(init?.headers).get("x-clips-comment-token"),
        body: JSON.parse(String(init?.body)),
      };
    };
    const composer = () =>
      container.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="commentsPanel.leaveComment"]',
      );
    const submitComment = async (content: string) => {
      const field = composer();
      assert.isNotNull(field);
      act(() => setTextareaValue(field, content));
      await act(async () => {
        composer()?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "Enter",
          }),
        );
      });
    };
    const chooseMenuItem = async (label: string) => {
      await openMenu(
        container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]'),
      );
      const item = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((candidate) => candidate.textContent.trim() === label);
      expect(item).toBeDefined();
      await act(async () => {
        item?.click();
        await Promise.resolve();
      });
    };

    await submitComment("Fake fresh-proof comment");
    expect(feed()).toContain("Fake fresh-proof comment");
    expect(sent(0)).toMatchObject({
      token: "fake-proof-1",
      body: { content: "Fake fresh-proof comment" },
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("button[aria-pressed]")
        ?.click();
    });
    expect(feed()).toContain("👍 2");
    expect(sent(1)).toMatchObject({
      token: "fake-proof-1",
      body: { commentId: "comment-1", emoji: "👍" },
    });

    await chooseMenuItem("commentsPanel.editComment");
    const editField = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="commentsPanel.editComment"]',
    );
    assert.isNotNull(editField);
    act(() => setTextareaValue(editField, "Fake fresh-proof edit"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "common.save")
        ?.click();
    });
    expect(feed()).toContain("Fake fresh-proof edit");
    expect(sent(2)).toMatchObject({
      token: "fake-proof-1",
      body: { id: "comment-1", content: "Fake fresh-proof edit" },
    });

    await chooseMenuItem("commentsPanel.delete");
    expect(feed()).not.toContain("Fake fresh-proof edit");
    expect(sent(3)).toMatchObject({
      token: "fake-proof-1",
      body: { id: "comment-1" },
    });
    expect(shareFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      const respondForbidden = responses[0];
      assert.isDefined(respondForbidden);
      respondForbidden(
        new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await submitComment("Fake retried comment");
    await flush();
    expect(shareFetch).toHaveBeenCalledTimes(2);
    expect(sent(4)).toMatchObject({
      token: "fake-proof-2",
      body: { content: "Fake retried comment" },
    });
  });

  it("joins a proof renewal already in flight instead of cancelling it", async () => {
    let finishRenewal!: () => void;
    let renewalAborted = false;
    const shareFetch = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      const proof = `fake-proof-${shareFetch.mock.calls.length}`;
      if (proof !== "fake-proof-1") {
        signal.addEventListener("abort", () => {
          renewalAborted = true;
        });
        await new Promise<void>((resolve) => {
          finishRenewal = resolve;
        });
      }
      return fakeShare(proof, [rootComment]);
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ id: "comment-2", threadId: "comment-2" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await renderProofShare(shareFetch);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(shareFetch).toHaveBeenCalledTimes(2);

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    assert.isNotNull(composer);
    act(() => setTextareaValue(composer, "Fake comment during renewal"));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="commentsPanel.commentButton"]',
        )
        ?.click();
    });
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      finishRenewal();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renewalAborted).toBe(false);
    expect(shareFetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    assert.isDefined(init);
    expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
      "fake-proof-2",
    );
  });

  it.each(["comment", "reply"] as const)(
    "returns a failed %s to its composer with feedback when stale proof cannot renew",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      onTestFinished(() => {
        vi.useRealTimers();
      });
      let playheadMs = 34_000;
      let settleRenewal!: (renewed: boolean) => void;
      const shareFetch = vi.fn(async () => {
        const proof = `fake-proof-${shareFetch.mock.calls.length}`;
        if (proof !== "fake-proof-1") {
          await new Promise<void>((resolve, reject) => {
            settleRenewal = (renewed) =>
              renewed ? resolve() : reject(new Error("fake renewal failure"));
          });
        }
        return fakeShare(proof, [rootComment]);
      });
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({ id: "comment-2", threadId: "thread-1" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      vi.stubGlobal("fetch", fetch);
      await renderProofShare(shareFetch, () => playheadMs);
      if (kind === "reply") {
        await act(async () => {
          Array.from(container.querySelectorAll("button"))
            .find(
              (button) => button.textContent.trim() === "commentsPanel.reply",
            )
            ?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      const label =
        kind === "reply"
          ? "commentsPanel.writeReply"
          : "commentsPanel.leaveComment";
      const composer = () =>
        container.querySelector<HTMLTextAreaElement>(
          `textarea[placeholder="${label}"]`,
        );
      const send = async () => {
        await act(async () => {
          container
            .querySelector<HTMLButtonElement>(
              `button[aria-label="${
                kind === "reply"
                  ? "commentsPanel.writeReply"
                  : "commentsPanel.commentButton"
              }"]`,
            )
            ?.click();
        });
      };
      const field = composer();
      assert.isNotNull(field);
      await mentionMember(field, "Hi");
      playheadMs = 50_000;
      vi.setSystemTime(Date.now() + 300_000);

      await send();
      expect(container.querySelectorAll("li")).toHaveLength(2);
      expect(composer()?.value ?? "").toBe("");
      expect(shareFetch).toHaveBeenCalledTimes(2);
      await act(async () => {
        settleRenewal(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelectorAll("li")).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(composer()?.value).toBe("Hi @Member ");
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "notificationsRoute.sendFailed",
      );

      await send();
      await act(async () => {
        settleRenewal(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      const init = fetch.mock.calls[0]?.[1];
      assert.isDefined(init);
      expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
        "fake-proof-3",
      );
      expect(JSON.parse(String(init.body))).toMatchObject({
        content: "Hi @Member",
        mentions: [{ email: "member@example.com", name: "Member" }],
        ...(kind === "reply"
          ? {
              videoTimestampMs: 12_000,
              threadId: "thread-1",
              parentId: "comment-1",
            }
          : { videoTimestampMs: 34_000 }),
      });
    },
  );

  it("keeps newer typing when a send fails behind it, and keeps the failed comment in the feed to retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let playheadMs = 34_000;
    const renewals: Array<(renewed: boolean) => void> = [];
    const shareFetch = vi.fn(async () => {
      const proof = `fake-proof-${shareFetch.mock.calls.length}`;
      if (proof !== "fake-proof-1") {
        await new Promise<void>((resolve, reject) => {
          renewals.push((renewed) =>
            renewed ? resolve() : reject(new Error("fake renewal failure")),
          );
        });
      }
      return fakeShare(proof, [rootComment]);
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (): Promise<Response> => {
        const id = `comment-sent-${fetch.mock.calls.length}`;
        return new Response(JSON.stringify({ id, threadId: id }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetch);
    await renderProofShare(shareFetch, () => playheadMs);
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    assert.isNotNull(composer);
    const send = () =>
      act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="commentsPanel.commentButton"]',
          )
          ?.click();
      });
    const settleRenewal = (renewed: boolean) =>
      act(async () => {
        renewals.shift()?.(renewed);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    const sent = (index: number) => {
      const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
      return {
        token: new Headers(init?.headers).get("x-clips-comment-token"),
        body: JSON.parse(String(init?.body)),
      };
    };
    const alerts = () => container.querySelectorAll('[role="alert"]');

    await mentionMember(composer, "Hi");
    playheadMs = 50_000;
    vi.setSystemTime(Date.now() + 300_000);
    await send();
    expect(commentCard("Hi @Member")).toBeDefined();
    act(() => setTextareaValue(composer, "Fake newer draft"));
    await settleRenewal(false);

    expect(fetch).not.toHaveBeenCalled();
    expect(composer.value).toBe("Fake newer draft");
    expect(alerts()).toHaveLength(1);
    expect(
      commentCard("Hi @Member")?.querySelector('[role="alert"]')?.textContent,
    ).toBe("notificationsRoute.sendFailed");

    await send();
    await settleRenewal(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({
      token: "fake-proof-3",
      body: { content: "Fake newer draft", videoTimestampMs: 50_000 },
    });
    expect(commentCard("Fake newer draft")).toBeDefined();
    expect(alerts()).toHaveLength(1);
    expect(
      commentCard("Hi @Member")?.querySelector('[role="alert"]'),
    ).not.toBeNull();

    await pressCommentButton("Hi @Member", "libraryGrid.retry");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(shareFetch).toHaveBeenCalledTimes(3);
    expect(sent(1)).toMatchObject({
      token: "fake-proof-3",
      body: {
        content: "Hi @Member",
        mentions: [{ email: "member@example.com", name: "Member" }],
        videoTimestampMs: 34_000,
      },
    });
    expect(sent(1).body).not.toHaveProperty("parentId");
    expect(alerts()).toHaveLength(0);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(commentCard("Fake newer draft")).toBeDefined();
    expect(composer.value).toBe("");
  });

  it.each([
    {
      newer: "typed",
      draft: "Fake newest draft",
      failed: ["Fake first comment", "Fake second comment"],
    },
    {
      newer: "nothing",
      draft: "Fake first comment",
      failed: ["Fake second comment"],
    },
  ])(
    "keeps every comment that fails together without replacing an earlier one ($newer)",
    async ({ newer, draft, failed }) => {
      const shareFetch = vi.fn(async () =>
        fakeShare(`fake-proof-${shareFetch.mock.calls.length}`, [rootComment]),
      );
      const responses: Array<(response: Response) => void> = [];
      const fetch = vi.fn<typeof globalThis.fetch>(
        () => new Promise((resolve) => responses.push(resolve)),
      );
      vi.stubGlobal("fetch", fetch);
      await renderProofShare(shareFetch);
      const composer = container.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="commentsPanel.leaveComment"]',
      );
      assert.isNotNull(composer);
      const submit = async (content: string) => {
        act(() => setTextareaValue(composer, content));
        await act(async () => {
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="commentsPanel.commentButton"]',
            )
            ?.click();
        });
      };
      const respond = (status: number) =>
        act(async () => {
          for (const resolve of responses.splice(0)) {
            resolve(
              new Response(
                JSON.stringify(
                  status === 200
                    ? { id: "comment-sent", threadId: "comment-sent" }
                    : { error: "Forbidden" },
                ),
                { status, headers: { "Content-Type": "application/json" } },
              ),
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      const failedComments = () =>
        ["Fake first comment", "Fake second comment"].filter((content) =>
          commentCard(content)?.querySelector('[role="alert"]'),
        );

      await submit("Fake first comment");
      await submit("Fake second comment");
      if (newer === "typed") {
        act(() => setTextareaValue(composer, "Fake newest draft"));
      }
      expect(fetch).toHaveBeenCalledTimes(2);
      await respond(403);

      expect(composer.value).toBe(draft);
      expect(failedComments()).toEqual(failed);
      expect(container.querySelectorAll("li")).toHaveLength(1 + failed.length);

      await pressCommentButton("Fake second comment", "libraryGrid.retry");
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(shareFetch).toHaveBeenCalledTimes(2);
      const init = fetch.mock.calls[2]?.[1];
      assert.isDefined(init);
      expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
        "fake-proof-2",
      );
      expect(JSON.parse(String(init.body))).toMatchObject({
        content: "Fake second comment",
      });
      expect(failedComments()).toEqual(failed.slice(0, -1));
      expect(container.querySelectorAll("li")).toHaveLength(1 + failed.length);

      await respond(200);
      expect(failedComments()).toEqual(failed.slice(0, -1));
      expect(commentCard("Fake second comment")).toBeDefined();
      if (newer === "typed") {
        await pressCommentButton("Fake first comment", "commentsPanel.delete");
        expect(commentCard("Fake first comment")).toBeUndefined();
      }
      expect(composer.value).toBe(draft);
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    { otherReply: "kept open", restored: false },
    { otherReply: "cancelled", restored: true },
  ])(
    "restores a failed reply only while no other comment's reply composer is open, and otherwise keeps it in the feed to retry ($otherReply)",
    async ({ otherReply, restored }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const otherComment: Comment = {
        ...rootComment,
        id: "comment-2",
        threadId: "thread-2",
        content: "Fake second thread",
        videoTimestampMs: 20_000,
      };
      const renewals: Array<(renewed: boolean) => void> = [];
      const shareFetch = vi.fn(async () => {
        const proof = `fake-proof-${shareFetch.mock.calls.length}`;
        if (proof !== "fake-proof-1") {
          await new Promise<void>((resolve, reject) => {
            renewals.push((renewed) =>
              renewed ? resolve() : reject(new Error("fake renewal failure")),
            );
          });
        }
        return fakeShare(proof, [rootComment, otherComment]);
      });
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({ id: "comment-sent", threadId: "thread-1" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      vi.stubGlobal("fetch", fetch);
      await renderProofShare(shareFetch);
      const openReply = (content: string) =>
        pressCommentButton(content, "commentsPanel.reply");
      const settleRenewal = (renewed: boolean) =>
        act(async () => {
          renewals.shift()?.(renewed);
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      const replyComposer = () =>
        container.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="commentsPanel.writeReply"]',
        );
      const replyingTo = () =>
        replyComposer()?.closest("li")?.firstElementChild?.textContent;
      const alerts = () => container.querySelectorAll('[role="alert"]');

      await openReply("Please take a look");
      const failedReply = replyComposer();
      assert.isNotNull(failedReply);
      await mentionMember(failedReply, "Fake failed reply");
      vi.setSystemTime(Date.now() + 300_000);
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="commentsPanel.writeReply"]',
          )
          ?.click();
      });
      expect(container.textContent).toContain("Fake failed reply");
      expect(replyComposer()).toBeNull();

      await openReply("Fake second thread");
      expect(replyingTo()).toContain("Fake second thread");
      if (otherReply === "cancelled") {
        act(() => {
          replyComposer()?.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
          );
        });
        expect(replyComposer()).toBeNull();
      }
      await settleRenewal(false);

      expect(fetch).not.toHaveBeenCalled();
      expect(replyingTo()).toContain(
        restored ? "Please take a look" : "Fake second thread",
      );
      expect(replyComposer()?.value).toBe(
        restored ? "Fake failed reply @Member " : "",
      );
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0]?.textContent).toBe("notificationsRoute.sendFailed");
      expect(Boolean(commentCard("Fake failed reply"))).toBe(!restored);
      if (restored) return;

      const newerReply = replyComposer();
      assert.isNotNull(newerReply);
      act(() => setTextareaValue(newerReply, "Fake newer reply"));
      expect(
        commentCard("Fake failed reply")?.querySelector('[role="alert"]'),
      ).not.toBeNull();
      expect(
        commentCard("Fake failed reply")?.closest("ul")?.closest("li")
          ?.firstElementChild?.textContent,
      ).toContain("Please take a look");
      await pressCommentButton("Fake failed reply", "libraryGrid.retry");
      await settleRenewal(true);

      expect(fetch).toHaveBeenCalledTimes(1);
      const init = fetch.mock.calls[0]?.[1];
      assert.isDefined(init);
      expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
        "fake-proof-3",
      );
      expect(JSON.parse(String(init.body))).toMatchObject({
        content: "Fake failed reply @Member",
        mentions: [{ email: "member@example.com", name: "Member" }],
        videoTimestampMs: 12_000,
        threadId: "thread-1",
        parentId: "comment-1",
      });
      expect(alerts()).toHaveLength(0);
      expect(commentCard("Fake failed reply")).toBeDefined();
      expect(replyingTo()).toContain("Fake second thread");
      expect(replyComposer()?.value).toBe("Fake newer reply");
    },
  );

  it("keeps a fullscreen draft with feedback when proof cannot renew, then sends it on retry after leaving fullscreen and reopening", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ id: "comment-2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const getCommentAccessToken = vi
      .fn<(refusedToken?: string | null) => Promise<string>>()
      .mockRejectedValueOnce(new Error("fake password changed"))
      .mockResolvedValueOnce("fake-renewed-proof");
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { player, setFullscreen, bar, isOpen, close, reopen } =
      renderFullscreenCommentPage({
        recordingId: "recording-1",
        atMs: 12000,
        initialDraft: "Fake fullscreen comment",
        onAdded,
        onClose,
        commentAccessToken: "fake-stale-proof",
        getCommentAccessToken,
      });
    expect(player.contains(bar().composer)).toBe(true);
    await act(async () => {
      bar().send.click();
    });
    setFullscreen(false);
    expect(player.contains(bar().composer)).toBe(false);
    expect(bar().alert?.textContent).toBe("notificationsRoute.sendFailed");
    expect(fetch).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(bar().composer.value).toBe("Fake fullscreen comment");
    expect(bar().send.disabled).toBe(false);
    close("Escape");
    expect(isOpen()).toBe(false);
    reopen();
    expect(bar().alert?.textContent).toBe("notificationsRoute.sendFailed");
    expect(bar().composer.value).toBe("Fake fullscreen comment");
    expect(bar().send.disabled).toBe(false);

    await act(async () => {
      bar().send.click();
    });
    expect(getCommentAccessToken).toHaveBeenLastCalledWith("fake-stale-proof");
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    assert.isDefined(init);
    expect(new Headers(init.headers).get("x-clips-comment-token")).toBe(
      "fake-renewed-proof",
    );
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
    reopen();
    expect(bar().alert).toBeNull();
    expect(bar().composer.value).toBe("");
  });

  it("sends a fullscreen comment once however often send repeats, the composer closes and reopens, or the player leaves fullscreen before it settles", async () => {
    let completeRenewal!: (token: string) => void;
    const renewal = new Promise<string>((resolve) => {
      completeRenewal = resolve;
    });
    const getCommentAccessToken = vi.fn(() => renewal);
    let completeRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await request;
      return new Response(JSON.stringify({ id: "comment-2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const onAdded = vi.fn();
    const { player, setFullscreen, bar, isOpen, close, reopen } =
      renderFullscreenCommentPage({
        recordingId: "recording-1",
        atMs: 12000,
        onAdded,
        onClose: vi.fn(),
        commentAccessToken: "fake-expired-proof",
        getCommentAccessToken,
      });
    const pressSend = (modifier: "ctrlKey" | "metaKey") =>
      bar().composer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    act(() => setTextareaValue(bar().composer, "Fake fullscreen comment"));

    // Same tick, before React Query publishes the pending state.
    await act(async () => {
      pressSend("ctrlKey");
      bar().send.click();
      pressSend("metaKey");
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(bar().send.disabled).toBe(true);
    await act(async () => {
      pressSend("ctrlKey");
    });
    const resend = async () => {
      expect(bar().composer.value).toBe("Fake fullscreen comment");
      expect(bar().send.disabled).toBe(true);
      await act(async () => {
        pressSend("ctrlKey");
        bar().send.click();
        pressSend("metaKey");
      });
    };
    for (const fullscreen of [false, true]) {
      setFullscreen(fullscreen);
      expect(player.contains(bar().composer)).toBe(fullscreen);
      await resend();
    }
    for (const how of ["Cancel", "Escape"] as const) {
      close(how);
      expect(isOpen()).toBe(false);
      reopen();
      await resend();
    }
    expect(getCommentAccessToken).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      completeRenewal("fake-fresh-proof");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    setFullscreen(false);
    await resend();
    close("Escape");
    reopen();
    await resend();
    expect(isOpen()).toBe(true);

    await act(async () => {
      completeRequest();
    });
    expect(getCommentAccessToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get(
        "x-clips-comment-token",
      ),
    ).toBe("fake-fresh-proof");
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
    reopen();
    expect(bar().composer.value).toBe("");
    expect(bar().alert).toBeNull();

    act(() => setTextareaValue(bar().composer, "Fake follow-up comment"));
    await act(async () => {
      pressSend("ctrlKey");
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      recordingId: "recording-1",
      content: "Fake follow-up comment",
      videoTimestampMs: 12000,
    });
    expect(onAdded).toHaveBeenCalledTimes(2);
  });

  it.each(["Cancel", "Escape"] as const)(
    "finishes a comment closed with %s while it sends, and reopens without the posted draft",
    async (how) => {
      let completeRenewal!: (token: string) => void;
      const renewal = new Promise<string>((resolve) => {
        completeRenewal = resolve;
      });
      let completeRequest!: () => void;
      const request = new Promise<void>((resolve) => {
        completeRequest = resolve;
      });
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        await request;
        return new Response(JSON.stringify({ id: "comment-2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetch);
      const onAdded = vi.fn();
      const { bar, isOpen, close, reopen } = renderFullscreenCommentPage({
        recordingId: "recording-1",
        atMs: 12000,
        initialDraft: "Fake fullscreen comment",
        onAdded,
        onClose: vi.fn(),
        commentAccessToken: "fake-expired-proof",
        getCommentAccessToken: () => renewal,
      });
      await act(async () => {
        bar().send.click();
      });
      close(how);
      await act(async () => {
        completeRenewal("fake-fresh-proof");
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => {
        completeRequest();
      });
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(isOpen()).toBe(false);

      reopen();
      expect(bar().composer.value).toBe("");
      expect(bar().alert).toBeNull();
      await act(async () => {
        bar().send.click();
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["stays open", "Cancel", "Escape", "leaves fullscreen"] as const)(
    "keeps text typed while a fullscreen comment sends unsent after it posts, then sends it next (%s)",
    async (meanwhile) => {
      let completeRenewal!: (token: string) => void;
      const renewal = new Promise<string>((resolve) => {
        completeRenewal = resolve;
      });
      const getCommentAccessToken = vi.fn(() => renewal);
      let completeRequest!: () => void;
      const request = new Promise<void>((resolve) => {
        completeRequest = resolve;
      });
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        await request;
        return new Response(JSON.stringify({ id: "comment-2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetch);
      const onAdded = vi.fn();
      const { player, setFullscreen, bar, isOpen, close, reopen } =
        renderFullscreenCommentPage({
          recordingId: "recording-1",
          atMs: 12000,
          initialDraft: "Fake first comment",
          onAdded,
          onClose: vi.fn(),
          commentAccessToken: "fake-expired-proof",
          getCommentAccessToken,
        });
      const sentContent = (call: number) =>
        JSON.parse(String(fetch.mock.calls[call]?.[1]?.body)).content;
      await act(async () => {
        bar().send.click();
      });
      act(() => setTextareaValue(bar().composer, "Fake follow-up comment"));
      if (meanwhile === "leaves fullscreen") {
        setFullscreen(false);
        expect(player.contains(bar().composer)).toBe(false);
      } else if (meanwhile !== "stays open") {
        close(meanwhile);
        expect(isOpen()).toBe(false);
      }

      await act(async () => {
        completeRenewal("fake-fresh-proof");
      });
      await act(async () => {
        completeRequest();
      });
      // React Query publishes the settled state to render a tick later.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sentContent(0)).toBe("Fake first comment");
      expect(onAdded).toHaveBeenCalledTimes(1);
      if (meanwhile === "Cancel" || meanwhile === "Escape") {
        expect(isOpen()).toBe(false);
        reopen();
      }
      expect(isOpen()).toBe(true);
      expect(bar().composer.value).toBe("Fake follow-up comment");
      expect(bar().alert).toBeNull();
      expect(bar().send.disabled).toBe(false);

      await act(async () => {
        bar().send.click();
      });
      expect(getCommentAccessToken).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sentContent(1)).toBe("Fake follow-up comment");
      expect(onAdded).toHaveBeenCalledTimes(2);
      expect(isOpen()).toBe(false);
      reopen();
      expect(bar().composer.value).toBe("");
    },
  );

  it.each(["renewal", "request"] as const)(
    "keeps a fullscreen comment that fails behind newer typing beside it, to retry at its own time without touching the newer draft, through fullscreen changes and closing (%s fails)",
    async (failing) => {
      const transport = deferredCommentTransport();
      let playheadMs = 12_000;
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { player, setFullscreen, bar, isOpen, close, reopen } =
        renderFullscreenCommentPage({
          recordingId: "recording-1",
          atMs: playheadMs,
          getPlayheadMs: () => playheadMs,
          initialDraft: "Fake first comment",
          onAdded,
          onClose,
          commentAccessToken: "fake-stale-proof",
          getCommentAccessToken: transport.getCommentAccessToken,
        });
      await act(async () => {
        bar().send.click();
      });
      act(() => setTextareaValue(bar().composer, "Fake newer draft"));
      if (failing === "renewal") {
        await transport.renew(new Error("fake password changed"));
      } else {
        await transport.renew("fake-fresh-proof");
        expect(transport.fetch).toHaveBeenCalledTimes(1);
        await transport.respond(403);
      }
      const posts = failing === "renewal" ? 0 : 1;
      const expectBoth = (fullscreen: boolean) => {
        expect(player.contains(bar().composer)).toBe(fullscreen);
        expect(bar().composer.value).toBe("Fake newer draft");
        expect(bar().send.disabled).toBe(false);
        expectFailedBarComment("Fake first comment", "0:12");
        expect(pageAlerts()).toHaveLength(1);
      };

      expectBoth(true);
      expect(transport.fetch).toHaveBeenCalledTimes(posts);
      expect(onAdded).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      setFullscreen(false);
      expectBoth(false);
      close("Cancel");
      expect(isOpen()).toBe(false);
      playheadMs = 50_000;
      reopen();
      expect(bar().send.getAttribute("aria-label")).toBe(
        "commentsPanel.commentAt 0:50",
      );
      expectBoth(false);
      setFullscreen(true);
      close("Escape");
      expect(isOpen()).toBe(false);
      reopen();
      expectBoth(true);

      // Same tick, before React Query publishes the pending state.
      await act(async () => {
        failedBarCommentButton(
          "Fake first comment",
          "libraryGrid.retry",
        )?.click();
        bar().send.click();
        failedBarCommentButton(
          "Fake first comment",
          "libraryGrid.retry",
        )?.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(transport.getCommentAccessToken).toHaveBeenCalledTimes(2);
      expect(transport.getCommentAccessToken).toHaveBeenLastCalledWith(
        failing === "renewal" ? "fake-stale-proof" : "fake-fresh-proof",
      );
      expect(bar().send.disabled).toBe(true);
      expect(pageAlerts()).toHaveLength(0);
      await transport.renew("fake-retry-proof");
      expect(transport.fetch).toHaveBeenCalledTimes(posts + 1);
      expect(transport.sent(posts)).toEqual({
        token: "fake-retry-proof",
        body: {
          recordingId: "recording-1",
          content: "Fake first comment",
          videoTimestampMs: 12_000,
        },
      });
      await transport.respond(200);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(isOpen()).toBe(true);
      expect(bar().composer.value).toBe("Fake newer draft");
      expect(failedBarComment("Fake first comment")).toBeUndefined();
      expect(pageAlerts()).toHaveLength(0);

      await act(async () => {
        bar().send.click();
      });
      await transport.renew("fake-next-proof");
      expect(transport.sent(posts + 1)).toEqual({
        token: "fake-next-proof",
        body: {
          recordingId: "recording-1",
          content: "Fake newer draft",
          videoTimestampMs: 50_000,
        },
      });
      await transport.respond(200);
      expect(onAdded).toHaveBeenCalledTimes(2);
      expect(isOpen()).toBe(false);
      reopen();
      expect(bar().composer.value).toBe("");
    },
  );

  it.each([
    { composer: "unchanged", draft: "Fake first comment", row: false },
    { composer: "cleared", draft: "", row: true },
  ])(
    "shows a fullscreen comment that fails in one place, the composer while it still holds the text and otherwise a row to retry ($composer)",
    async ({ draft, row }) => {
      const transport = deferredCommentTransport();
      const { bar } = renderFullscreenCommentPage({
        recordingId: "recording-1",
        atMs: 12_000,
        initialDraft: "Fake first comment",
        onClose: vi.fn(),
        commentAccessToken: "fake-stale-proof",
        getCommentAccessToken: transport.getCommentAccessToken,
      });
      await act(async () => {
        bar().send.click();
      });
      act(() => setTextareaValue(bar().composer, draft));
      await transport.renew(new Error("fake password changed"));

      expect(bar().composer.value).toBe(draft);
      expect(pageAlerts()).toHaveLength(1);
      expect(Boolean(failedBarComment("Fake first comment"))).toBe(row);
      expect(
        Boolean(
          failedBarCommentButton("Fake first comment", "libraryGrid.retry"),
        ),
      ).toBe(row);
      if (row) expectFailedBarComment("Fake first comment", "0:12");
    },
  );

  it("keeps fullscreen comments that fail behind newer typing apart, lists one that fails again once, and deletes one without a request", async () => {
    const transport = deferredCommentTransport();
    let playheadMs = 12_000;
    const onAdded = vi.fn();
    const { bar, close, reopen } = renderFullscreenCommentPage({
      recordingId: "recording-1",
      atMs: playheadMs,
      getPlayheadMs: () => playheadMs,
      initialDraft: "Fake first comment",
      onAdded,
      onClose: vi.fn(),
      commentAccessToken: "fake-stale-proof",
      getCommentAccessToken: transport.getCommentAccessToken,
    });
    const sendThenType = async (newer: string) => {
      await act(async () => {
        bar().send.click();
      });
      act(() => setTextareaValue(bar().composer, newer));
    };
    const rows = () => document.body.querySelectorAll("li");

    await sendThenType("Fake second comment");
    await transport.renew(new Error("fake password changed"));
    close("Escape");
    playheadMs = 20_000;
    reopen();
    await sendThenType("Fake third draft");
    await transport.renew("fake-fresh-proof");
    await transport.respond(403);

    expect(bar().composer.value).toBe("Fake third draft");
    expect(rows()).toHaveLength(2);
    expectFailedBarComment("Fake first comment", "0:12");
    expectFailedBarComment("Fake second comment", "0:20");
    expect(pageAlerts()).toHaveLength(2);

    await act(async () => {
      failedBarCommentButton(
        "Fake first comment",
        "libraryGrid.retry",
      )?.click();
    });
    await transport.renew(new Error("fake password changed again"));
    expect(bar().composer.value).toBe("Fake third draft");
    expect(rows()).toHaveLength(2);
    expectFailedBarComment("Fake first comment", "0:12");
    expectFailedBarComment("Fake second comment", "0:20");

    await act(async () => {
      failedBarCommentButton(
        "Fake first comment",
        "commentsPanel.delete",
      )?.click();
    });
    expect(failedBarComment("Fake first comment")).toBeUndefined();
    expect(rows()).toHaveLength(1);
    expect(transport.getCommentAccessToken).toHaveBeenCalledTimes(3);
    expect(transport.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      failedBarCommentButton(
        "Fake second comment",
        "libraryGrid.retry",
      )?.click();
    });
    await transport.renew("fake-retry-proof");
    expect(transport.sent(1)).toEqual({
      token: "fake-retry-proof",
      body: {
        recordingId: "recording-1",
        content: "Fake second comment",
        videoTimestampMs: 20_000,
      },
    });
    await transport.respond(200);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(0);
    expect(pageAlerts()).toHaveLength(0);
    expect(bar().composer.value).toBe("Fake third draft");
  });

  it.each(["active", "resumed"])(
    "renews expired proof before a %s viewer submits",
    async (mode) => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const refresh = vi.fn();
      function UnlockedShare() {
        const [token, setToken] = React.useState("fake-initial-proof");
        const renew = React.useCallback(async () => {
          refresh();
          setToken(`fake-renewed-proof-${refresh.mock.calls.length}`);
        }, []);
        useCommentAccessRefresh(token, renew);
        return (
          <CommentsPanel
            recordingId="recording-1"
            comments={[
              {
                ...rootComment,
                emojiReactionsJson: JSON.stringify({
                  "👍": ["other@example.com"],
                }),
              },
            ]}
            currentMs={0}
            currentUserEmail="viewer@example.com"
            enableComments
            canComment
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            commentAccessToken={token}
          />
        );
      }
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <UnlockedShare />
          </QueryClientProvider>,
        ),
      );
      if (mode === "active") {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(660_000);
        });
      } else {
        vi.setSystemTime(Date.now() + 660_000);
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
      }
      expect(refresh).toHaveBeenCalledTimes(mode === "active" ? 2 : 1);
      const reaction = container.querySelector<HTMLButtonElement>(
        "button[aria-pressed]",
      );
      expect(reaction).not.toBeNull();
      act(() => reaction?.click());
      expect(actionMocks.requests).toHaveBeenLastCalledWith(
        "react-to-comment",
        { commentId: "comment-1", emoji: "👍" },
        {
          "x-clips-comment-token": `fake-renewed-proof-${mode === "active" ? 2 : 1}`,
        },
      );
    },
  );

  it("renders comment URLs as safe external links without including punctuation", () => {
    const absoluteUrl = container.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/docs?item=1"]',
    );
    const wwwUrl = container.querySelector<HTMLAnchorElement>(
      'a[href="https://www.example.org/help"]',
    );

    expect(absoluteUrl?.textContent).toBe("https://example.com/docs?item=1");
    expect(absoluteUrl?.target).toBe("_blank");
    expect(absoluteUrl?.rel).toBe("noopener noreferrer");
    expect(wwwUrl?.textContent).toBe("www.example.org/help");
    expect(container.textContent).toContain("www.example.org/help.");
  });

  it("keeps reactions on one compact action row as secondary buttons", () => {
    renderPanel("viewer@example.com", [
      {
        ...rootComment,
        emojiReactionsJson: JSON.stringify({
          "👍": ["viewer@example.com"],
          "💡": ["other@example.com"],
        }),
      },
    ]);

    const actionRow = container.querySelector<HTMLElement>(
      "[data-comment-actions]",
    );
    const reactionButtons = actionRow?.querySelectorAll<HTMLButtonElement>(
      'button[aria-pressed="true"], button[aria-pressed="false"]',
    );

    expect(actionRow?.className).toContain("flex-nowrap");
    expect(reactionButtons).toHaveLength(2);
    expect(reactionButtons?.[0].className).toContain("bg-secondary");
    expect(reactionButtons?.[0].className).toContain("h-7");
    expect(reactionButtons?.[1].className).toContain("bg-secondary");
    act(() => reactionButtons?.[0].click());
    expect(actionMocks.otherMutation).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "👍",
    });
  });

  it("gives comment actions shadcn hover feedback", () => {
    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );
    const reactionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.react"]',
    );

    expect(replyButton?.className).toContain("hover:bg-accent");
    expect(replyButton?.className).toContain("hover:text-accent-foreground");
    expect(reactionButton?.className).toContain("hover:bg-accent");
    expect(reactionButton?.className).toContain("hover:text-accent-foreground");

    renderPanel("author@example.com");
    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[data-comment-actions] [aria-haspopup="menu"]',
    );
    expect(menuTrigger?.className).toContain("hover:bg-accent");
    expect(menuTrigger?.className).toContain("hover:text-accent-foreground");
  });

  it("treats legacy resolved comments like regular comments", () => {
    renderPanel("viewer@example.com", [{ ...rootComment, resolved: true }]);

    expect(container.textContent).not.toContain("commentsPanel.resolved");
    expect(container.querySelector(".opacity-60")).toBeNull();
    expect(container.querySelector("[data-comment-actions]")).not.toBeNull();
  });

  it("keeps the compact comment composer inside a quiet filled surface", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );

    expect(composer?.className).toContain("px-0 py-1");
    const composerShell = composer?.closest(".rounded-xl");
    expect(composerShell?.className).toContain("bg-muted/60");
    expect(composerShell?.querySelectorAll("button")).toHaveLength(1);
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.react"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.reply"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector(
        'button[aria-label="commentsPanel.commentButton"]',
      ),
    ).not.toBeNull();
  });

  it("docks the inline composer below the feed with a compact arrow action", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    const composerShell = composer?.closest(".rounded-xl");
    const comment = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent?.includes("Please take a look"),
    );

    expect(composerShell).not.toBeNull();
    expect(composerShell?.className).toContain("rounded-xl");
    expect(composerShell?.className).toContain(
      "border-[hsl(var(--comment-input-border))]",
    );
    expect(composerShell?.className).toContain(
      "shadow-[var(--comment-input-shadow)]",
    );
    expect(composerShell?.querySelectorAll("button")).toHaveLength(1);
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.react"]'),
    ).toBeNull();
    expect(
      composerShell?.querySelector('button[aria-label="commentsPanel.reply"]'),
    ).toBeNull();
    expect(composerShell?.parentElement?.className).toContain(
      "comment-widget-shadow",
    );
    expect(composerShell?.className).toContain("focus-within:border-ring");
    expect(composer?.className).toContain("min-h-[54px]");
    expect(composer?.className).toContain("max-h-[40vh]");
    const composerDock = composerShell?.closest(".shrink-0");
    expect(composerDock?.className).toContain("relative");
    expect(composerDock?.className).toContain("z-10");
    expect(composerDock?.className).toContain("bg-transparent");
    expect(composerDock?.className).toContain("-mt-16");
    expect(composerDock?.className).toContain("pt-16");
    expect(composerDock?.className).toContain("pointer-events-none");
    const fade = composerDock?.querySelector('[aria-hidden="true"]');
    expect(fade?.className).toContain("absolute");
    expect(fade?.className).toContain("top-0");
    expect(fade?.className).toContain("z-0");
    expect(fade?.className).toContain("bg-gradient-to-b");
    expect(fade?.className).toContain("lg:to-background");
    expect(composerDock?.lastElementChild?.className).toContain(
      "pointer-events-auto",
    );
    expect(composerDock?.lastElementChild?.className).toContain(
      "relative z-10",
    );
    expect(composerDock?.lastElementChild?.className).toContain(
      "bg-background",
    );
    expect(composerDock?.className).not.toContain("border-t");
    const submit = container.querySelector<HTMLButtonElement>(
      "button[data-comment-submit]",
    );
    expect(submit?.className).toContain("size-[22px]");
    expect(submit?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
    expect(submit?.disabled).toBe(true);
    expect(comment).toBeDefined();
    expect(
      (comment as Node).compareDocumentPosition(composer!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A new comment");
    });

    expect(submit?.disabled).toBe(false);
    expect(container.querySelector("kbd")).toBeNull();
  });

  it("keeps inline comments scrollable with the composer available, at every width", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");

    const panel = container.firstElementChild as HTMLElement | null;
    const listRegion = container.querySelector("ul")?.parentElement;
    const commentList = container.querySelector("ul");

    expect(panel?.className).toContain("h-full");
    expect(panel?.className).not.toMatch(/\blg:h-full\b/);
    expect(listRegion?.className).toContain("overflow-y-auto");
    expect(listRegion?.className).not.toMatch(/\blg:overflow-y-auto\b/);
    expect(listRegion?.className).toContain("overscroll-contain");
    expect(listRegion?.className).not.toMatch(/\blg:overscroll-contain\b/);
    expect(commentList?.className).toContain("pb-16");
    expect(
      Array.from(commentList?.querySelectorAll(":scope > li") ?? []).every(
        (item) => !item.className.includes("min-h-[140px]"),
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("[data-comment-actions]")).length,
    ).toBeGreaterThan(0);
  });

  it("scrolls the default (sidebar) preset at every width too", () => {
    renderPanel("viewer@example.com", [rootComment], "default");

    const listRegion = container.querySelector("ul")?.parentElement;

    expect(listRegion?.className).toContain("overflow-y-auto");
    expect(listRegion?.className).not.toMatch(/\blg:overflow-y-auto\b/);
  });

  it("shows a clear sign-in action for a signed-out viewer", () => {
    const onUnauthenticated = vi.fn();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={34_000}
            enableComments
            canComment={false}
            onSeek={vi.fn()}
            onUnauthenticated={onUnauthenticated}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const signInButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("commentsPanel.signInToComment"),
    );

    expect(signInButton).toBeDefined();
    expect(signInButton?.className).toContain("justify-start");
    expect(signInButton?.querySelector("span.rounded-xl")).toBeNull();
    expect(signInButton?.querySelector("svg")).toBeNull();
    expect(
      container.querySelector(
        'textarea[placeholder="commentsPanel.leaveComment"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("commentsPanel.beFirst");
    act(() => signInButton?.click());
    expect(onUnauthenticated).toHaveBeenCalledWith("comment");
  });

  it("keeps reply and reaction affordances visible before the account gate", () => {
    const onUnauthenticated = vi.fn();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={34_000}
            enableComments
            canComment={false}
            onSeek={vi.fn()}
            onUnauthenticated={onUnauthenticated}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const reply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("commentsPanel.reply"),
    );
    const react = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.react"]',
    );

    expect(reply).toBeDefined();
    expect(react).toBeDefined();
    act(() => reply?.click());
    expect(onUnauthenticated).toHaveBeenCalledWith("comment");
  });

  it("grows comment composers to 40vh and scrolls only past that limit", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const maxHeight = Math.round(window.innerHeight * 0.4);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: maxHeight + 64,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A comment long enough to wrap");
    });

    expect(composer?.style.height).toBe(`${maxHeight}px`);
    expect(composer?.style.overflowY).toBe("auto");

    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: 72,
    });
    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "Short comment");
    });

    expect(composer?.style.height).toBe("72px");
    expect(composer?.style.overflowY).toBe("hidden");
  });

  it("recalculates the comment textarea cap after a viewport resize", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const heightDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    const originalHeight = window.innerHeight;

    try {
      Object.defineProperty(composer, "scrollHeight", {
        configurable: true,
        value: Math.round(originalHeight * 0.4) + 64,
      });
      act(() => {
        if (composer) setTextareaValue(composer, "A long comment");
      });
      expect(composer?.style.height).toBe(
        `${Math.round(originalHeight * 0.4)}px`,
      );

      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 400,
      });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(composer?.style.height).toBe("160px");
      expect(composer?.style.overflowY).toBe("auto");
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(window, "innerHeight", heightDescriptor);
      } else {
        Reflect.deleteProperty(window, "innerHeight");
      }
    }
  });

  it("regrows comment textareas when their width changes wrapping", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const naturalHeight = Math.floor(window.innerHeight * 0.2);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: naturalHeight,
    });

    act(() => notifyResize?.());

    expect(composer?.style.height).toBe(`${naturalHeight}px`);
    expect(composer?.style.overflowY).toBe("hidden");
  });

  it("lets the comment feed widget expand with its composer", () => {
    renderPanel("viewer@example.com", [rootComment], "inline");
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();
    const naturalHeight = Math.floor(window.innerHeight * 0.2);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: naturalHeight,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "A longer comment in the feed");
    });

    expect(composer?.style.height).toBe(`${naturalHeight}px`);
    expect(composer?.closest(".comment-widget-shadow")?.className).toContain(
      "min-h-[96px]",
    );
    expect(
      composer?.closest(".comment-widget-shadow")?.className.split(" "),
    ).not.toContain("h-[96px]");
  });

  it("renders inline Markdown while flattening headings", () => {
    renderPanel("viewer@example.com", [
      {
        ...rootComment,
        content: "# Not a heading\n\n**Bold**, *italic* and `inline code`.",
      },
    ]);

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("inline code");
    expect(container.textContent).toContain("Not a heading");
  });

  it("applies Markdown formatting shortcuts to selected text", () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "format this");
      composer.setSelectionRange(0, 11);
      composer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "b",
          metaKey: true,
        }),
      );
    });

    expect(composer?.value).toBe("**format this**");
  });

  it("opens and focuses a reply field inline without replacing the new-comment draft", async () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Keep this draft");
    });

    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );
    expect(replyButton).toBeDefined();

    await act(async () => {
      replyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const inlineReply = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    expect(inlineReply).not.toBeNull();
    expect(document.activeElement).toBe(inlineReply);
    expect(newComment?.value).toBe("Keep this draft");
    const inlineReplyShell = inlineReply?.parentElement?.parentElement;
    expect(inlineReplyShell?.className).toContain("rounded-[16px]");
    expect(inlineReplyShell?.className).toContain("border-transparent");
    expect(inlineReplyShell?.className).toContain("focus-within:border-ring");
    expect(inlineReplyShell?.className).not.toContain("focus-within:ring-ring");
    expect(inlineReplyShell?.className).toContain("p-[3px]");
    expect(inlineReply?.className).toContain("min-h-6");
    const inlineReplySubmit = inlineReplyShell?.querySelector("button");
    expect(inlineReplySubmit?.className).toContain("size-[22px]");
    expect(
      inlineReply!.compareDocumentPosition(newComment as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(inlineReply?.closest(".border-s")).toBeNull();
  });

  it("inserts organization member mentions from autocomplete", async () => {
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(composer).not.toBeNull();

    act(() => {
      if (!composer) return;
      setTextareaValue(composer, "Hi @");
      composer.setSelectionRange(4, 4);
      composer.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: "@" }),
      );
    });

    const option = document.body.querySelector<HTMLButtonElement>(
      'button[role="option"]',
    );
    expect(option?.textContent).toContain("Member");

    await act(async () => {
      option?.click();
      await Promise.resolve();
    });

    expect(composer?.value).toBe("Hi @Member ");
    act(() =>
      composer?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="commentsPanel.commentButton"]',
        )
        ?.click(),
    );

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Hi @Member",
      videoTimestampMs: 34_000,
      mentions: [{ email: "member@example.com", name: "Member" }],
    });
  });

  it("submits the inline reply to the selected thread", async () => {
    const replyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "commentsPanel.reply",
    );

    await act(async () => {
      replyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const inlineReply = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    act(() => {
      if (!inlineReply) return;
      setTextareaValue(inlineReply, "Inline response");
    });

    const sendReply = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.writeReply"]',
    );
    expect(sendReply?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
    await act(async () => {
      sendReply?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Inline response",
      videoTimestampMs: 12_000,
      threadId: "thread-1",
      parentId: "comment-1",
    });
    expect(container.textContent).toContain("Inline response");
  });

  it("nests replies two levels deep and caps further reply affordances", async () => {
    const firstReply: Comment = {
      ...rootComment,
      id: "comment-1-reply-1",
      parentId: rootComment.id,
      authorName: "First Reply",
      content: "A first-level reply.",
      createdAt: "2026-07-10T12:01:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
    };
    const secondReply: Comment = {
      ...rootComment,
      id: "comment-1-reply-2",
      parentId: firstReply.id,
      authorName: "Second Reply",
      content: "A second-level reply.",
      createdAt: "2026-07-10T12:02:00.000Z",
      updatedAt: "2026-07-10T12:02:00.000Z",
    };
    renderPanel(
      "viewer@example.com",
      [rootComment, firstReply, secondReply],
      "share",
    );

    const rootList = container.querySelector("ul");
    const rootItem = rootList?.querySelector(":scope > li");
    const firstLevelList = rootItem?.querySelector(":scope > ul");
    const firstReplyItem = firstLevelList?.querySelector(":scope > li");
    const secondLevelList = firstReplyItem?.querySelector(":scope > ul");
    const secondReplyItem = secondLevelList?.querySelector(":scope > li");

    expect(firstReplyItem?.textContent).toContain("A first-level reply.");
    expect(secondReplyItem?.textContent).toContain("A second-level reply.");
    expect(secondReplyItem?.parentElement).toBe(secondLevelList);

    const replyButtons = Array.from(
      container.querySelectorAll("[data-comment-actions] button"),
    ).filter((button) => button.textContent?.trim() === "commentsPanel.reply");
    expect(replyButtons).toHaveLength(2);

    const firstReplyButton = Array.from(
      firstReplyItem?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.trim() === "commentsPanel.reply");
    await act(async () => {
      firstReplyButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nestedComposer = firstReplyItem?.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.writeReply"]',
    );
    expect(nestedComposer).not.toBeNull();
    act(() => {
      if (!nestedComposer) return;
      setTextareaValue(nestedComposer, "A nested response.");
    });
    act(() =>
      firstReplyItem
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="commentsPanel.writeReply"]',
        )
        ?.click(),
    );

    expect(actionMocks.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "A nested response.",
        threadId: rootComment.threadId,
        parentId: firstReply.id,
      }),
    );
    expect(
      Array.from(secondReplyItem?.querySelectorAll("button") ?? []).some(
        (button) => button.textContent?.trim() === "commentsPanel.reply",
      ),
    ).toBe(false);
  });

  it("collects every nested reply for optimistic deletion", () => {
    const firstReply = {
      ...rootComment,
      id: "reply-1",
      parentId: rootComment.id,
    };
    const secondReply = {
      ...rootComment,
      id: "reply-2",
      parentId: firstReply.id,
    };

    expect(
      collectCommentSubtreeIds(
        [rootComment, firstReply, secondReply],
        rootComment.id,
      ),
    ).toEqual(new Set([rootComment.id, firstReply.id, secondReply.id]));
  });

  it("rolls back one failed reaction without discarding another optimistic reaction", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "💡",
    });

    await act(async () => {
      options.onError?.(
        new Error("reaction failed"),
        {
          commentId: rootComment.id,
          emoji: "👍",
        },
        first,
      );
      await Promise.resolve();
    });

    const commentText = container.textContent ?? "";
    expect(commentText).toContain("💡 1");
    expect(commentText).not.toContain("👍 1");
    expect(second).toMatchObject({ type: "reaction", emoji: "💡" });
  });

  it("keeps same-emoji toggles ordered when both requests fail", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });

    await act(async () => {
      options.onError?.(
        new Error("first reaction failed"),
        { commentId: rootComment.id, emoji: "👍" },
        first,
      );
      options.onError?.(
        new Error("second reaction failed"),
        { commentId: rootComment.id, emoji: "👍" },
        second,
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("👍 1");
  });

  it("ignores an older reaction response after a newer toggle", async () => {
    renderPanel("viewer@example.com");
    const options = actionMocks.mutationOptions.get("react-to-comment");
    expect(options).toBeDefined();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const first = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });
    const second = await options.onMutate({
      commentId: rootComment.id,
      emoji: "👍",
    });

    await act(async () => {
      options.onSuccess?.(
        { reactions: {} },
        { commentId: rootComment.id, emoji: "👍" },
        second,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("👍 1");
    expect(invalidateQueries).not.toHaveBeenCalled();

    await act(async () => {
      options.onSuccess?.(
        { reactions: { "👍": ["viewer@example.com"] } },
        { commentId: rootComment.id, emoji: "👍" },
        first,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("👍 1");
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["recording", "recording-1"],
    });
  });

  it("restores the confirmed edit when every overlapping edit fails", async () => {
    renderPanel("author@example.com");
    const options = actionMocks.mutationOptions.get("update-comment");
    expect(options).toBeDefined();

    const first = await options.onMutate({
      id: rootComment.id,
      content: "Rejected edit A",
    });
    const second = await options.onMutate({
      id: rootComment.id,
      content: "Rejected edit B",
    });

    await act(async () => {
      options.onError?.(
        new Error("first edit failed"),
        { id: rootComment.id, content: "Rejected edit A" },
        first,
      );
      options.onError?.(
        new Error("second edit failed"),
        { id: rootComment.id, content: "Rejected edit B" },
        second,
      );
      await Promise.resolve();
    });

    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "common.cancel")
        ?.click();
    });

    expect(container.textContent).toContain(rootComment.content);
    expect(container.textContent).not.toContain("Rejected edit A");
    expect(container.textContent).not.toContain("Rejected edit B");
  });

  it("only offers comment editing to the comment author", () => {
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();

    renderPanel("AUTHOR@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    expect(menuTrigger).not.toBeNull();
    expect(menuTrigger?.className).toContain("opacity-0");
    expect(menuTrigger?.className).toContain("group-hover/comment:opacity-100");
    expect(menuTrigger?.className).toContain(
      "group-focus-within/comment:opacity-100",
    );
  });

  it("prefills and saves an author's comment inline", async () => {
    const setSelectionRange = vi.spyOn(
      HTMLTextAreaElement.prototype,
      "setSelectionRange",
    );
    onTestFinished(() => setSelectionRange.mockRestore());
    renderPanel("author@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    await openMenu(menuTrigger);

    const editItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "commentsPanel.editComment");
    expect(editItem).toBeDefined();

    await act(async () => {
      editItem?.click();
      await Promise.resolve();
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="commentsPanel.editComment"]',
    );
    expect(editor?.value).toBe(rootComment.content);
    // The closing menu hands focus back to its button a tick later; Edit
    // swaps that button out, so focus stays in the edit box.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(editor);
    // happy-dom moves the caret to the end whenever the value is set, so check
    // the call a browser needs.
    expect(setSelectionRange).toHaveBeenCalledWith(
      rootComment.content.length,
      rootComment.content.length,
    );

    act(() => {
      if (!editor) return;
      setTextareaValue(editor, "Updated comment");
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    );
    act(() => save?.click());

    expect(actionMocks.updateComment).toHaveBeenCalledWith({
      id: "comment-1",
      content: "Updated comment",
    });
  });

  it("cancels comment editing without saving", async () => {
    renderPanel("author@example.com");

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    );
    await openMenu(menuTrigger);
    const editItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "commentsPanel.editComment");
    await act(async () => {
      editItem?.click();
      await Promise.resolve();
    });

    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.cancel",
    );
    act(() => cancel?.click());

    expect(
      container.querySelector(
        'textarea[aria-label="commentsPanel.editComment"]',
      ),
    ).toBeNull();
    expect(actionMocks.updateComment).not.toHaveBeenCalled();
  });

  it("submits a new comment for a signed-in viewer", () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Viewer note");
    });

    act(() => {
      newComment?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "Enter",
        }),
      );
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Viewer note",
      videoTimestampMs: 34_000,
    });
  });

  it("captures the player's live timestamp when the rendered time is stale", () => {
    const getCurrentMs = vi.fn(() => 72_000);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[rootComment]}
            currentMs={0}
            getCurrentMs={getCurrentMs}
            currentUserEmail="viewer@example.com"
            enableComments
            canComment
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation="inline"
          />
        </QueryClientProvider>,
      );
    });

    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Live timestamp note");
      newComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(getCurrentMs).toHaveBeenCalledTimes(1);
    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Live timestamp note",
      videoTimestampMs: 72_000,
    });
  });

  it("submits a new comment with Enter while keeping Shift+Enter for newlines", () => {
    const newComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(newComment).not.toBeNull();

    act(() => {
      if (!newComment) return;
      setTextareaValue(newComment, "Viewer note");
      newComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    expect(actionMocks.addComment).toHaveBeenCalledWith({
      recordingId: "recording-1",
      content: "Viewer note",
      videoTimestampMs: 34_000,
    });

    actionMocks.addComment.mockClear();
    renderPanel();
    const multilineComment = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.leaveComment"]',
    );
    expect(multilineComment).not.toBeNull();

    act(() => {
      if (!multilineComment) return;
      setTextareaValue(multilineComment, "Viewer note");
      multilineComment.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });

    expect(actionMocks.addComment).not.toHaveBeenCalled();
  });

  it("grows the timestamped composer to 40vh with a compact send action", () => {
    act(() => {
      root.render(
        <TimestampedCommentBar
          recordingId="recording-1"
          atMs={34_000}
          onClose={vi.fn()}
        />,
      );
    });

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="commentsPanel.composerPlaceholder"]',
    );
    const send = container.querySelector<HTMLButtonElement>(
      'button[aria-label="commentsPanel.commentAt 0:34"]',
    );
    const maxHeight = Math.round(window.innerHeight * 0.4);
    Object.defineProperty(composer, "scrollHeight", {
      configurable: true,
      value: maxHeight + 64,
    });

    act(() => {
      if (!composer) return;
      setTextareaValue(
        composer,
        "A timestamped comment that spans several lines",
      );
    });

    expect(composer?.getAttribute("rows")).toBe("1");
    expect(composer?.className).toContain("max-h-[40vh]");
    expect(composer?.style.height).toBe(`${maxHeight}px`);
    expect(composer?.style.overflowY).toBe("auto");
    expect(composer?.closest(".max-w-lg")).not.toBeNull();
    expect(send?.className).toContain("size-7");
    expect(send?.querySelector(".tabler-icon-arrow-up")).not.toBeNull();
  });

  it("renders a shadcn empty state with an icon when there are no comments", () => {
    renderPanel("viewer@example.com", [], "share");

    const empty = container.querySelector("[data-slot=empty]");
    const icon = container.querySelector("[data-slot=empty-icon]");
    const svg = icon ? icon.querySelector("svg") : null;

    expect(empty).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("commentsPanel.beFirst");
  });

  it.each(["reply", "edit"])(
    "closes an open %s composer when comments are disabled",
    async (operation) => {
      renderPanel("author@example.com");
      if (operation === "reply") {
        const reply = Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === "commentsPanel.reply",
        );
        assert.isDefined(reply);
        act(() => reply.click());
      } else {
        await openMenu(
          container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]'),
        );
        const edit = Array.from(
          document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ).find(
          (item) => item.textContent.trim() === "commentsPanel.editComment",
        );
        assert.isDefined(edit);
        await act(async () => {
          edit.click();
          await Promise.resolve();
        });
      }
      expect(container.querySelector("textarea")).not.toBeNull();
      renderPanel("author@example.com", [rootComment], "share", false);
      expect(container.querySelector("textarea")).toBeNull();
      expect(container.textContent).toContain(
        rootComment.content.split(" https:")[0],
      );
    },
  );

  it("shows saved owner comments read-only when comments are disabled", () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[{ ...rootComment, content: "Fake saved comment" }]}
            currentMs={34_000}
            currentUserEmail="owner@example.com"
            enableComments={false}
            canComment={false}
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
          />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toContain("Fake saved comment");
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.textContent).not.toContain("commentsPanel.reply");
  });

  it.each([
    {
      viewer: "the author with comments on",
      email: "author@example.com",
      enableComments: true,
      canDeleteOwnComments: undefined,
      items: ["commentsPanel.editComment", "commentsPanel.delete"],
    },
    {
      viewer: "the author reviewing history with comments off",
      email: "author@example.com",
      enableComments: false,
      canDeleteOwnComments: true,
      items: ["commentsPanel.delete"],
    },
    {
      viewer: "the recording owner on another author's history",
      email: "owner@example.com",
      enableComments: false,
      canDeleteOwnComments: true,
      items: null,
    },
    {
      viewer: "the author when the caller grants no deletion",
      email: "author@example.com",
      enableComments: false,
      canDeleteOwnComments: undefined,
      items: null,
    },
  ])(
    "gives $viewer only the comment menu actions they may take",
    async ({ email, enableComments, canDeleteOwnComments, items }) => {
      renderPanel(
        email,
        [rootComment],
        "inline",
        enableComments,
        canDeleteOwnComments,
      );
      const menuTrigger = container.querySelector<HTMLButtonElement>(
        '[aria-haspopup="menu"]',
      );
      if (items === null) {
        expect(menuTrigger).toBeNull();
        return;
      }
      await openMenu(menuTrigger);
      expect(
        Array.from(
          document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
          (item) => item.textContent.trim(),
        ),
      ).toEqual(items);
    },
  );

  it("lets the author delete saved history while comments are off", async () => {
    renderPanel(
      "author@example.com",
      [
        {
          ...rootComment,
          emojiReactionsJson: JSON.stringify({ "👍": ["member@example.com"] }),
        },
      ],
      "inline",
      false,
      true,
    );
    const buttons = () =>
      Array.from(container.querySelectorAll("button"), (button) =>
        (button.getAttribute("aria-label") ?? button.textContent).trim(),
      );
    expect(buttons()).not.toContain("commentsPanel.reply");
    expect(buttons()).not.toContain("commentsPanel.react");
    expect(buttons()).not.toContain("👍 1");
    expect(container.textContent).toContain("👍 1");
    expect(container.textContent).not.toContain("commentsPanel.resolve");
    expect(container.querySelector("textarea")).toBeNull();

    await openMenu(
      container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]'),
    );
    const deleteItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent.trim() === "commentsPanel.delete");
    assert.isDefined(deleteItem);
    await act(async () => {
      deleteItem.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actionMocks.deleteComment).toHaveBeenCalledWith({
      id: rootComment.id,
    });
    expect(container.textContent).not.toContain("Please take a look");
  });

  it("renders the shared empty state icon when comments are disabled", () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommentsPanel
            recordingId="recording-1"
            comments={[]}
            currentMs={34_000}
            currentUserEmail="viewer@example.com"
            enableComments={false}
            canComment={false}
            onSeek={vi.fn()}
            queryKey={["recording", "recording-1"]}
            presentation="share"
          />
        </QueryClientProvider>,
      );
    });

    const empty = container.querySelector("[data-slot=empty]");
    const icon = container.querySelector("[data-slot=empty-icon]");
    const svg = icon ? icon.querySelector("svg") : null;

    expect(empty).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("commentsPanel.disabled");
  });
});
