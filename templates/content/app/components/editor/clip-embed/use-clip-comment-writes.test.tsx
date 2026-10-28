// @vitest-environment happy-dom

import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipCommentView, ClipThreadView } from "./clip-comments";
import {
  clipCommentListKey,
  useClipCommentWrites,
  type ClipCommentList,
} from "./use-clip-comment-writes";
import { useClipComments, type ClipCommentsState } from "./use-clip-playback";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const clips = vi.hoisted(() => ({
  byName: {} as Record<string, ReturnType<typeof vi.fn>>,
  options: {} as Record<string, unknown>,
  /** What Clips answers the next read of the comment list with. */
  read: (() => new Promise(() => {})) as () => Promise<unknown>,
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useActionMutation: (name: string, options?: unknown) => {
      clips.options[name] = options;
      return { mutateAsync: clips.byName[name] };
    },
    useActionQuery: (
      name: string,
      params: unknown,
      options?: { enabled?: boolean },
    ) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => clips.read(),
        enabled: options?.enabled,
      }),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function thread(
  id: string,
  videoTimestampMs: number,
  overrides?: Partial<ClipThreadView>,
): ClipThreadView {
  return {
    id,
    videoTimestampMs,
    content: `Comment ${id}`,
    authorEmail: "ada@example.test",
    authorName: "Ada Example",
    createdAt: "2026-10-23T12:00:00.000Z",
    replyCount: 0,
    replies: [],
    ...overrides,
  };
}

const theirReply: ClipCommentView = {
  id: "r9",
  content: "Me too",
  authorEmail: "cy@example.test",
  authorName: "Cy",
  createdAt: "2026-10-23T12:10:00.000Z",
};

// Query tells React of a read on a later timer, which `act` doesn't wait for.
notifyManager.setScheduler((callback) => callback());

const KEY = clipCommentListKey("doc_1", "rec_1");
let queryClient: QueryClient;
let root: Root | null = null;
let writes: ReturnType<typeof useClipCommentWrites> | null = null;
let shown: ClipCommentsState | null = null;

function Probe() {
  writes = useClipCommentWrites("doc_1", {
    email: "bo@example.test",
    name: "Bo",
  });
  shown = useClipComments("doc_1", "rec_1", true);
  return null;
}

/** Clips' list holds `threads` from now on. */
function onClips(...threads: ClipThreadView[]) {
  clips.read = () => Promise.resolve({ threads, truncated: false });
}

/** A read of the Clip's list that lands while a write waits. */
async function readLands(...threads: ClipThreadView[]) {
  onClips(...threads);
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: KEY, exact: true });
  });
}

const threadsShown = () => {
  const state = defined(shown);
  if (state.status !== "ready") throw new Error(`List is ${state.status}`);
  return state.threads;
};
const ids = () => threadsShown().map((entry) => entry.id);

beforeEach(() => {
  clips.byName = {
    "add-clip-comment": vi.fn(),
    "resolve-clip-comment": vi.fn(),
  };
  onClips(thread("c1", 2_000), thread("c2", 9_000));
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData<ClipCommentList>(KEY, {
    threads: [thread("c1", 2_000), thread("c2", 9_000)],
    truncated: false,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    defined(root).render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  writes = null;
  shown = null;
  queryClient.clear();
});

describe("useClipCommentWrites", () => {
  it("leaves the page's own comment lists alone", () => {
    expect(clips.options["add-clip-comment"]).toEqual({
      skipActionQueryInvalidation: true,
    });
    expect(clips.options["resolve-clip-comment"]).toEqual({
      skipActionQueryInvalidation: true,
    });
  });

  it("shows a new thread at its moment at once, then under Clips' id", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(clips.byName["add-clip-comment"]).mockReturnValue(saved.promise);
    let posted!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).startThread({
        recordingId: "rec_1",
        content: "Here",
        videoTimestampMs: 5_000,
        operationId: "op1",
      });
    });
    expect(ids()).toEqual(["c1", "optimistic-op1", "c2"]);
    expect(threadsShown()[1]).toMatchObject({
      authorEmail: "bo@example.test",
      authorName: "Bo",
      operationId: "op1",
    });
    expect(clips.byName["add-clip-comment"]).toHaveBeenCalledWith({
      documentId: "doc_1",
      recordingId: "rec_1",
      content: "Here",
      videoTimestampMs: 5_000,
    });

    // The read after the write is still on its way.
    const reread = deferred<ClipCommentList>();
    clips.read = () => reread.promise;
    await act(async () => {
      saved.resolve({ id: "c3", threadId: "c3" });
      await posted;
    });
    expect(ids()).toEqual(["c1", "c3", "c2"]);
    expect(threadsShown()[1]?.operationId).toBeUndefined();

    await act(async () => {
      reread.resolve({
        threads: [
          thread("c1", 2_000),
          thread("c3", 5_000, { content: "Here" }),
          thread("c2", 9_000),
        ],
        truncated: false,
      });
      await reread.promise;
    });
    expect(ids()).toEqual(["c1", "c3", "c2"]);
  });

  it("takes a new thread back when Clips refuses it, and says so", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(clips.byName["add-clip-comment"]).mockReturnValue(saved.promise);
    let posted!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).startThread({
        recordingId: "rec_1",
        content: "Here",
        videoTimestampMs: 5_000,
        operationId: "op1",
      });
    });
    expect(ids()).toContain("optimistic-op1");

    const refused = Object.assign(new Error("off"), {
      errorCode: "clip_comments_disabled",
    });
    await act(async () => {
      saved.reject(refused);
      await expect(posted).rejects.toBe(refused);
    });
    expect(ids()).toEqual(["c1", "c2"]);
  });

  it("adds a reply to its thread at once, and takes it back on a refusal", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(clips.byName["add-clip-comment"]).mockReturnValue(saved.promise);
    let posted!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).reply({
        recordingId: "rec_1",
        threadId: "c1",
        content: "Agreed",
        operationId: "op2",
      });
    });
    expect(threadsShown()[0]).toMatchObject({
      replyCount: 1,
      replies: [{ id: "optimistic-op2", content: "Agreed" }],
    });
    expect(clips.byName["add-clip-comment"]).toHaveBeenCalledWith({
      documentId: "doc_1",
      recordingId: "rec_1",
      content: "Agreed",
      threadId: "c1",
    });

    await act(async () => {
      saved.reject(new Error("down"));
      await expect(posted).rejects.toThrow("down");
    });
    expect(threadsShown()[0]).toMatchObject({ replyCount: 0, replies: [] });
  });

  it("keeps a waiting reply through a read that lands first, and takes back only that reply", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(clips.byName["add-clip-comment"]).mockReturnValue(saved.promise);
    let posted!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).reply({
        recordingId: "rec_1",
        threadId: "c1",
        content: "Agreed",
        operationId: "op2",
      });
    });

    // Someone else's reply reaches Clips while ours waits.
    const answered = thread("c1", 2_000, {
      replyCount: 1,
      replies: [theirReply],
    });
    await readLands(answered, thread("c2", 9_000));
    expect(threadsShown()[0]).toMatchObject({
      replyCount: 2,
      replies: [{ id: "r9" }, { id: "optimistic-op2" }],
    });

    await act(async () => {
      saved.reject(new Error("down"));
      await expect(posted).rejects.toThrow("down");
    });
    expect(threadsShown()[0]).toMatchObject({
      replyCount: 1,
      replies: [{ id: "r9" }],
    });
  });

  it("keeps a waiting thread and resolve through a read that lands first", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(clips.byName["add-clip-comment"]).mockReturnValue(saved.promise);
    const done = deferred<{ id: string; resolved: boolean }>();
    defined(clips.byName["resolve-clip-comment"]).mockReturnValue(done.promise);
    let posted!: Promise<unknown>;
    let resolving!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).startThread({
        recordingId: "rec_1",
        content: "Here",
        videoTimestampMs: 5_000,
        operationId: "op1",
      });
      resolving = defined(writes).resolveThread({
        recordingId: "rec_1",
        threadId: "c2",
      });
    });
    expect(ids()).toEqual(["c1", "optimistic-op1"]);

    await readLands(thread("c1", 2_000), thread("c2", 9_000));
    expect(ids()).toEqual(["c1", "optimistic-op1"]);

    onClips(thread("c1", 2_000), thread("c3", 5_000, { content: "Here" }));
    await act(async () => {
      saved.resolve({ id: "c3", threadId: "c3" });
      done.resolve({ id: "c2", resolved: true });
      await Promise.all([posted, resolving]);
    });
    expect(ids()).toEqual(["c1", "c3"]);
  });

  it("drops a resolved thread at once, and puts it back where it was on a refusal", async () => {
    const done = deferred<{ id: string; resolved: boolean }>();
    defined(clips.byName["resolve-clip-comment"]).mockReturnValue(done.promise);
    let resolving!: Promise<unknown>;
    await act(async () => {
      resolving = defined(writes).resolveThread({
        recordingId: "rec_1",
        threadId: "c1",
      });
    });
    expect(ids()).toEqual(["c2"]);
    expect(clips.byName["resolve-clip-comment"]).toHaveBeenCalledWith({
      documentId: "doc_1",
      recordingId: "rec_1",
      threadId: "c1",
      resolved: true,
    });

    await act(async () => {
      done.reject(new Error("clip_forbidden"));
      await expect(resolving).rejects.toThrow("clip_forbidden");
    });
    expect(ids()).toEqual(["c1", "c2"]);
  });

  it("reads the Clip's list again after each write", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    defined(clips.byName["add-clip-comment"]).mockResolvedValue({
      id: "c3",
      threadId: "c3",
    });
    await act(async () => {
      await defined(writes).startThread({
        recordingId: "rec_1",
        content: "Here",
        videoTimestampMs: 5_000,
        operationId: "op1",
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY, exact: true });
  });
});
