import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAvailableClis } from "./available-clis.js";
import {
  BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE,
  startBuilderAgentsRun,
} from "./builder-agents-run.js";
import {
  listChatCheckpoints,
  restoreChatCheckpoint,
} from "./chat-checkpoints.js";
import { FrameworkRouteError } from "./framework-route-request.js";

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function failure(
  promise: Promise<unknown>,
): Promise<FrameworkRouteError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FrameworkRouteError);
  return error as FrameworkRouteError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAvailableClis", () => {
  it("returns an empty list only when the server answers with one", async () => {
    const fetchMock = respond([]);
    await expect(fetchAvailableClis()).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/_agent-native/available-clis",
    );
  });

  it("returns validated CLI rows", async () => {
    respond([{ command: "claude", label: "Claude Code", available: true }]);
    await expect(fetchAvailableClis()).resolves.toEqual([
      { command: "claude", label: "Claude Code", available: true },
    ]);
  });

  it("throws typed failures instead of an empty list", async () => {
    respond({ error: "nope" }, 500);
    const http = await failure(fetchAvailableClis());
    expect(http).toMatchObject({ kind: "http", status: 500 });
    expect(http.serverMessage).toBe("nope");

    respond({ clis: [] });
    expect(await failure(fetchAvailableClis())).toMatchObject({
      kind: "malformed",
      status: 200,
    });

    respond([{ command: "claude" }]);
    expect((await failure(fetchAvailableClis())).kind).toBe("malformed");

    respond("<html>");
    expect((await failure(fetchAvailableClis())).kind).toBe("malformed");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await failure(fetchAvailableClis())).toMatchObject({
      kind: "network",
      status: null,
    });
  });

  it("rethrows aborts unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abort;
      }),
    );
    await expect(fetchAvailableClis()).rejects.toBe(abort);
  });
});

describe("listChatCheckpoints", () => {
  const row = {
    id: "cp-1",
    threadId: "thread 1",
    runId: "run-1",
    commitSha: "abc123",
    message: "checkpoint",
    createdAt: "1760000000000",
  };

  it("reads rows from the chat API and normalizes BIGINT timestamps", async () => {
    const fetchMock = respond([row, { ...row, id: "cp-2", runId: null }]);
    const rows = await listChatCheckpoints({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread 1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/_agent-native/agent-chat/checkpoints?threadId=thread%201",
    );
    expect(rows.map((item) => [item.runId, item.createdAt])).toEqual([
      ["run-1", 1760000000000],
      [null, 1760000000000],
    ]);
  });

  it("keeps a refused or malformed list distinct from no checkpoints", async () => {
    respond({ error: "Checkpoints only available on localhost" }, 403);
    expect(
      await failure(listChatCheckpoints({ threadId: "thread-1" })),
    ).toMatchObject({
      kind: "http",
      status: 403,
      serverMessage: "Checkpoints only available on localhost",
    });

    respond([{ ...row, commitSha: 42 }]);
    expect(
      (await failure(listChatCheckpoints({ threadId: "thread-1" }))).kind,
    ).toBe("malformed");
  });
});

describe("restoreChatCheckpoint", () => {
  it("posts the run id and resolves on a confirmed restore", async () => {
    const fetchMock = respond({ success: true, commitSha: "abc123" });
    await expect(
      restoreChatCheckpoint({ apiUrl: "/api/chat", runId: "run-1" }),
    ).resolves.toEqual({ commitSha: "abc123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/chat/checkpoints/restore");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ runId: "run-1" });
  });

  it("carries the server's reason, and rejects an unconfirmed 2xx", async () => {
    respond({ error: "No checkpoint was saved for this turn." }, 404);
    expect(
      await failure(restoreChatCheckpoint({ runId: "run-1" })),
    ).toMatchObject({
      kind: "http",
      status: 404,
      serverMessage: "No checkpoint was saved for this turn.",
    });

    respond({ ok: true });
    expect(
      (await failure(restoreChatCheckpoint({ checkpointId: "cp-1" }))).kind,
    ).toBe("malformed");
  });
});

describe("startBuilderAgentsRun", () => {
  it("returns the branch url Builder answered with", async () => {
    const fetchMock = respond({ url: "https://builder.example/branch" });
    const receipt = await startBuilderAgentsRun({ userMessage: "Add a page" });
    expect(receipt.url).toBe("https://builder.example/branch");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/_agent-native/builder/agents-run");
    expect(JSON.parse(String(init.body))).toEqual({
      userMessage: "Add a page",
    });
  });

  it("reports a missing url as null, not as a failure", async () => {
    respond({ branchName: "feature" });
    await expect(
      startBuilderAgentsRun({ userMessage: "Add a page" }),
    ).resolves.toMatchObject({ url: null, body: { branchName: "feature" } });
  });

  it("surfaces the not-connected error code", async () => {
    respond(
      {
        errorCode: BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE,
        error: "Builder Cloud Agents are not connected.",
      },
      400,
    );
    expect(
      await failure(startBuilderAgentsRun({ userMessage: "Add a page" })),
    ).toMatchObject({
      kind: "http",
      status: 400,
      errorCode: BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE,
    });
  });
});
