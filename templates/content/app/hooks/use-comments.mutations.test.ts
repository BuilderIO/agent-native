import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useActionQuery = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient,
}));

import {
  type Comment,
  useCreateComment,
  useEditComment,
  useComments,
  useResolveComment,
} from "./use-comments";

const key = ["action", "list-comments", { documentId: "doc-1" }] as const;

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "root-1",
    document_id: "doc-1",
    thread_id: "root-1",
    parent_id: null,
    content: "Original",
    quoted_text: "Quote",
    anchor_prefix: null,
    anchor_suffix: null,
    anchor_start_offset: 3,
    mentions: [],
    author_email: "alice@example.com",
    author_name: "Alice",
    resolved: 0,
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
    notion_comment_id: null,
    ...overrides,
  };
}

function queryClient(initial = [comment()]) {
  let data: { comments: Comment[] } = { comments: initial };
  const client = {
    cancelQueries: vi.fn(async () => undefined),
    getQueryData: vi.fn(() => data),
    setQueryData: vi.fn(
      (
        _queryKey: unknown,
        update: (current: { comments: Comment[] }) => { comments: Comment[] },
      ) => {
        data = update(data);
        return data;
      },
    ),
    invalidateQueries: vi.fn(async () => undefined),
    refetchQueries: vi.fn(async () => undefined),
    read: () => data,
    replace: (comments: Comment[]) => {
      data = { comments };
    },
  };
  return client;
}

function selectedComments(client: ReturnType<typeof queryClient>): Comment[] {
  const commentsQuery = useComments("doc-1") as any;
  return commentsQuery
    .select(client.read())
    .flatMap((thread: { comments: Comment[] }) => thread.comments);
}

beforeEach(() => {
  vi.clearAllMocks();
  useActionMutation.mockImplementation((_name, options) => options);
  useActionQuery.mockImplementation((_name, _variables, options) => options);
});

describe("optimistic comment mutations", () => {
  it("forces selection to rerun when settlement writes structurally equal authoritative data", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const authoritative = { comments: [comment()] };
    let operationActive = true;
    const observer = new QueryObserver(client, {
      queryKey: key,
      enabled: false,
      structuralSharing: false,
      select: (data: typeof authoritative) => ({
        comments: data.comments.map((entry) =>
          operationActive
            ? {
                ...entry,
                mutation: {
                  operationId: "settling-operation",
                  kind: "create" as const,
                  status: "error" as const,
                  ambiguous: true,
                },
              }
            : entry,
        ),
      }),
    });
    let selected = observer.getCurrentResult().data;
    const unsubscribe = observer.subscribe((result) => {
      selected = result.data;
    });

    client.setQueryData(key, authoritative);
    expect(selected?.comments[0].mutation).toMatchObject({
      operationId: "settling-operation",
    });

    operationActive = false;
    client.setQueryData(key, (current: typeof authoritative | undefined) => ({
      ...(current ?? authoritative),
      comments: (current ?? authoritative).comments.filter(
        ({ id }) => id !== "already-absent-temporary-id",
      ),
    }));
    expect(selected?.comments[0].mutation).toBeUndefined();

    unsubscribe();
    client.clear();
  });

  it("disables structural sharing for the comments observer", () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);

    const commentsQuery = useComments("doc-1") as any;

    expect(commentsQuery.structuralSharing).toBe(false);
  });

  it("creates in the raw response envelope with local authorship, then reconciles the returned IDs", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({ email: "jane.doe@example.com" }) as any;
    const variables = {
      documentId: "doc-1",
      content: "A new thought",
      mentions: JSON.stringify([{ email: "sam@example.com", name: "Sam" }]),
    };

    const context = await mutation.onMutate(variables);
    const optimistic = client.read().comments[1];

    expect(optimistic).toMatchObject({
      content: "A new thought",
      author_email: "jane.doe@example.com",
      author_name: "Jane Doe",
      mentions: [{ email: "sam@example.com", name: "Sam" }],
      mutation: { kind: "create", status: "pending" },
    });
    expect(variables).not.toHaveProperty("authorEmail");
    expect(variables).not.toHaveProperty("authorName");

    mutation.onSuccess(
      { id: "server-comment", threadId: "server-comment" },
      variables,
      context,
    );

    expect(client.read().comments[1]).toMatchObject({
      id: "server-comment",
      thread_id: "server-comment",
    });
    expect(client.read().comments[1].mutation).toBeUndefined();
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: key,
      exact: true,
      refetchType: "active",
    });
  });

  it("does not duplicate a create when an external refetch sees the returned row first", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({
      email: "alice@example.com",
      name: "Alice",
    }) as any;
    const variables = { documentId: "doc-1", content: "Already visible" };
    const context = await mutation.onMutate(variables);

    client.replace([
      comment(),
      comment({
        id: "server-comment",
        thread_id: "server-comment",
        content: "Already visible",
      }),
    ]);
    mutation.onSuccess(
      { id: "server-comment", threadId: "server-comment" },
      variables,
      context,
    );

    expect(
      client.read().comments.filter(({ id }) => id === "server-comment"),
    ).toHaveLength(1);
    expect(
      client.read().comments.some(({ id }) => id === context.temporaryId),
    ).toBe(false);
  });

  it("reapplies a pending create over an external authoritative refetch", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({
      email: "alice@example.com",
      name: "Alice",
    }) as any;
    const context = await mutation.onMutate({
      documentId: "doc-1",
      content: "Still sending",
    });

    client.replace([comment()]);
    const commentsQuery = useComments("doc-1") as any;
    const threads = commentsQuery.select(client.read());

    expect(
      threads
        .flatMap((thread: any) => thread.comments)
        .find(({ id }: Comment) => id === context.temporaryId),
    ).toMatchObject({
      content: "Still sending",
      mutation: { status: "pending", kind: "create" },
    });
  });

  it("shows one pending row when an authoritative refetch arrives before create success", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({
      email: "alice@example.com",
      name: "Alice",
    }) as any;
    const variables = {
      documentId: "doc-1",
      content: "Persisted while response is delayed",
      quotedText: "Quote",
      anchorStartOffset: 3,
    };
    const context = await mutation.onMutate(variables);
    const persisted = comment({
      id: "persisted-pending",
      thread_id: "persisted-pending",
      content: variables.content,
    });

    client.replace([comment(), persisted]);
    const pendingVisible = selectedComments(client).filter(
      ({ content }) => content === variables.content,
    );
    expect(pendingVisible).toHaveLength(1);
    expect(pendingVisible[0]).toMatchObject({
      id: persisted.id,
      mutation: {
        operationId: context.operationId,
        status: "pending",
        kind: "create",
      },
    });

    mutation.onSuccess(
      { id: persisted.id, threadId: persisted.thread_id },
      variables,
      context,
    );
    const settledVisible = selectedComments(client).filter(
      ({ content }) => content === variables.content,
    );
    expect(settledVisible).toHaveLength(1);
    expect(settledVisible[0]).toMatchObject({ id: persisted.id });
    expect(settledVisible[0].mutation).toBeUndefined();
  });

  it("removes a definitely rejected create but retains an ambiguous create until reconciliation", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({
      email: "alice@example.com",
      name: "Alice",
    }) as any;
    const variables = { documentId: "doc-1", content: "Potential duplicate" };

    const rejectedContext = await mutation.onMutate(variables);
    const rejected = Object.assign(new Error("Forbidden"), { status: 403 });
    mutation.onError(rejected, variables, rejectedContext);
    expect(client.read().comments).toHaveLength(1);

    const ambiguousContext = await mutation.onMutate(variables);
    const timeout = Object.assign(new Error("Timed out"), { timedOut: true });
    mutation.onError(timeout, variables, ambiguousContext);
    expect(client.read().comments[1].mutation).toMatchObject({
      operationId: ambiguousContext.operationId,
      status: "error",
      ambiguous: true,
    });

    client.refetchQueries.mockImplementationOnce(async () => {
      client.replace([comment()]);
    });
    await expect(
      mutation.reconcileAmbiguous("doc-1", ambiguousContext.operationId),
    ).resolves.toBe("unresolved");
    expect(client.read().comments[1].mutation).toMatchObject({
      operationId: ambiguousContext.operationId,
      ambiguous: true,
    });
  });

  it("shows one guarded row when an ambiguous create appears in an authoritative refetch", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useCreateComment({
      email: "alice@example.com",
      name: "Alice",
    }) as any;
    const variables = {
      documentId: "doc-1",
      content: "Persisted despite lost response",
      quotedText: "Quote",
      anchorStartOffset: 3,
    };
    const context = await mutation.onMutate(variables);
    const timeout = Object.assign(new Error("Response lost"), {
      timedOut: true,
    });
    mutation.onError(timeout, variables, context);

    const persisted = comment({
      id: "persisted-comment",
      thread_id: "persisted-comment",
      content: variables.content,
    });
    client.replace([comment(), persisted]);

    const visible = selectedComments(client).filter(
      ({ content }) => content === variables.content,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: "persisted-comment",
      mutation: {
        operationId: context.operationId,
        status: "error",
        ambiguous: true,
      },
    });

    client.refetchQueries.mockImplementationOnce(async () => {
      client.replace([comment(), persisted]);
    });
    await expect(
      mutation.reconcileAmbiguous("doc-1", context.operationId),
    ).resolves.toBe("confirmed");
    const reconciled = selectedComments(client).filter(
      ({ id }) => id === persisted.id,
    );
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].mutation).toBeUndefined();
  });

  it("rolls back only the edit operation that still owns the row", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useEditComment() as any;
    const variables = {
      id: "root-1",
      documentId: "doc-1",
      content: "First edit",
    };
    const context = await mutation.onMutate(variables);

    client.replace([
      comment({
        content: "Newer edit",
        mutation: {
          operationId: "newer-operation",
          kind: "edit",
          status: "pending",
        },
      }),
    ]);
    mutation.onError(new Error("First failed"), variables, context);

    expect(client.read().comments[0]).toMatchObject({
      content: "Newer edit",
      mutation: { operationId: "newer-operation", status: "pending" },
    });
  });

  it("keeps a successful edit visible when a refetch replaced its optimistic row", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useEditComment() as any;
    const variables = {
      id: "root-1",
      documentId: "doc-1",
      content: "Saved edit",
    };
    const context = await mutation.onMutate(variables);

    client.replace([comment({ content: "Original from early refetch" })]);
    mutation.onSuccess({ ok: true }, variables, context);

    expect(client.read().comments[0]).toMatchObject({
      content: "Saved edit",
    });
    expect(client.read().comments[0].mutation).toBeUndefined();
  });

  it("lets a later edit retire an earlier failure and ignores the retired late success", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useEditComment() as any;
    const editA = {
      id: "root-1",
      documentId: "doc-1",
      content: "Edit A",
    };
    const editB = { ...editA, content: "Edit B" };
    const contextA = await mutation.onMutate(editA);
    const contextB = await mutation.onMutate(editB);

    mutation.onError(new Error("A rejected"), editA, contextA);
    mutation.onSuccess({ ok: true }, editB, contextB);

    expect(selectedComments(client)[0]).toMatchObject({
      content: "Edit B",
    });
    expect(selectedComments(client)[0].mutation).toBeUndefined();

    mutation.onSuccess({ ok: true }, editA, contextA);
    expect(selectedComments(client)[0]).toMatchObject({
      content: "Edit B",
    });
    expect(selectedComments(client)[0].mutation).toBeUndefined();
  });

  it("preserves mentions when an edit omits metadata and clears them explicitly", async () => {
    const original = comment({
      mentions: [{ email: "sam@example.com", name: "Sam" }],
    });
    const client = queryClient([original]);
    useQueryClient.mockReturnValue(client);
    const mutation = useEditComment() as any;

    await mutation.onMutate({
      id: "root-1",
      documentId: "doc-1",
      content: "Text only",
    });
    expect(client.read().comments[0].mentions).toEqual(original.mentions);

    await mutation.onMutate({
      id: "root-1",
      documentId: "doc-1",
      content: "No mentions",
      mentions: "[]",
    });
    expect(client.read().comments[0].mentions).toEqual([]);
  });

  it("optimistically resolves only the selected thread and restores it on failure", async () => {
    const reply = comment({
      id: "reply-1",
      parent_id: "root-1",
      content: "Reply",
    });
    const sibling = comment({
      id: "root-2",
      thread_id: "root-2",
      content: "Sibling",
    });
    const client = queryClient([comment(), reply, sibling]);
    useQueryClient.mockReturnValue(client);
    const mutation = useResolveComment() as any;
    const variables = {
      id: "root-1",
      documentId: "doc-1",
      resolved: true,
    };

    const context = await mutation.onMutate(variables);
    expect(client.read().comments.map(({ resolved }) => resolved)).toEqual([
      1, 1, 0,
    ]);

    mutation.onError(new Error("No access"), variables, context);
    expect(client.read().comments.map(({ resolved }) => resolved)).toEqual([
      0, 0, 0,
    ]);
    expect(client.read().comments[0].mutation).toMatchObject({
      kind: "resolve",
      status: "error",
    });
  });

  it("lets a later resolve state retire an earlier resolve failure", async () => {
    const client = queryClient();
    useQueryClient.mockReturnValue(client);
    const mutation = useResolveComment() as any;
    const resolveA = {
      id: "root-1",
      documentId: "doc-1",
      resolved: true,
    };
    const resolveB = { ...resolveA, resolved: false };
    const contextA = await mutation.onMutate(resolveA);
    const contextB = await mutation.onMutate(resolveB);

    mutation.onError(new Error("A rejected"), resolveA, contextA);
    mutation.onSuccess({ ok: true, resolved: false }, resolveB, contextB);

    expect(selectedComments(client)[0]).toMatchObject({ resolved: 0 });
    expect(selectedComments(client)[0].mutation).toBeUndefined();
  });
});
