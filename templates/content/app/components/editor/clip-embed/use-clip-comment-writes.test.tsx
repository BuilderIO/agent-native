// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipThreadView } from "./clip-comments";
import {
  clipCommentListKey,
  useClipCommentWrites,
  type ClipCommentList,
} from "./use-clip-comment-writes";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const mutations = vi.hoisted(() => ({
  byName: {} as Record<string, ReturnType<typeof vi.fn>>,
  options: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string, options?: unknown) => {
    mutations.options[name] = options;
    return { mutateAsync: mutations.byName[name] };
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function thread(id: string, videoTimestampMs: number): ClipThreadView {
  return {
    id,
    videoTimestampMs,
    content: `Comment ${id}`,
    authorEmail: "ada@example.test",
    authorName: "Ada Example",
    createdAt: "2026-10-23T12:00:00.000Z",
    replyCount: 0,
    replies: [],
  };
}

const KEY = clipCommentListKey("doc_1", "rec_1");
let queryClient: QueryClient;
let root: Root | null = null;
let writes: ReturnType<typeof useClipCommentWrites> | null = null;

function Probe() {
  writes = useClipCommentWrites("doc_1", {
    email: "bo@example.test",
    name: "Bo",
  });
  return null;
}

const list = () => defined(queryClient.getQueryData<ClipCommentList>(KEY));
const ids = () => list().threads.map((entry) => entry.id);

beforeEach(() => {
  mutations.byName = {
    "add-clip-comment": vi.fn(),
    "resolve-clip-comment": vi.fn(),
  };
  queryClient = new QueryClient();
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
  queryClient.clear();
});

describe("useClipCommentWrites", () => {
  it("leaves the page's own comment lists alone", () => {
    expect(mutations.options["add-clip-comment"]).toEqual({
      skipActionQueryInvalidation: true,
    });
    expect(mutations.options["resolve-clip-comment"]).toEqual({
      skipActionQueryInvalidation: true,
    });
  });

  it("shows a new thread at its moment at once, then under Clips' id", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(mutations.byName["add-clip-comment"]).mockReturnValue(
      saved.promise,
    );
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
    expect(list().threads[1]).toMatchObject({
      authorEmail: "bo@example.test",
      authorName: "Bo",
      operationId: "op1",
    });
    expect(mutations.byName["add-clip-comment"]).toHaveBeenCalledWith({
      documentId: "doc_1",
      recordingId: "rec_1",
      content: "Here",
      videoTimestampMs: 5_000,
    });

    await act(async () => {
      saved.resolve({ id: "c3", threadId: "c3" });
      await posted;
    });
    expect(ids()).toEqual(["c1", "c3", "c2"]);
    expect(list().threads[1]?.operationId).toBeUndefined();
  });

  it("takes a new thread back when Clips refuses it, and says so", async () => {
    const saved = deferred<{ id: string; threadId: string }>();
    defined(mutations.byName["add-clip-comment"]).mockReturnValue(
      saved.promise,
    );
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
    defined(mutations.byName["add-clip-comment"]).mockReturnValue(
      saved.promise,
    );
    let posted!: Promise<unknown>;
    await act(async () => {
      posted = defined(writes).reply({
        recordingId: "rec_1",
        threadId: "c1",
        content: "Agreed",
        operationId: "op2",
      });
    });
    expect(list().threads[0]).toMatchObject({
      replyCount: 1,
      replies: [{ id: "optimistic-op2", content: "Agreed" }],
    });
    expect(mutations.byName["add-clip-comment"]).toHaveBeenCalledWith({
      documentId: "doc_1",
      recordingId: "rec_1",
      content: "Agreed",
      threadId: "c1",
    });

    await act(async () => {
      saved.reject(new Error("down"));
      await expect(posted).rejects.toThrow("down");
    });
    expect(list().threads[0]).toMatchObject({ replyCount: 0, replies: [] });
  });

  it("drops a resolved thread at once, and puts it back where it was on a refusal", async () => {
    const done = deferred<{ id: string; resolved: boolean }>();
    defined(mutations.byName["resolve-clip-comment"]).mockReturnValue(
      done.promise,
    );
    let resolving!: Promise<unknown>;
    await act(async () => {
      resolving = defined(writes).resolveThread({
        recordingId: "rec_1",
        threadId: "c1",
      });
    });
    expect(ids()).toEqual(["c2"]);
    expect(mutations.byName["resolve-clip-comment"]).toHaveBeenCalledWith({
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
    defined(mutations.byName["add-clip-comment"]).mockResolvedValue({
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
