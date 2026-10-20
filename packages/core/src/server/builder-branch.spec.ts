import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveBuilderRequestAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: resolveBuilderRequestAuthorizationMock,
}));

vi.mock("./builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.example.test",
}));

import { ActionContractError } from "../action.js";
import {
  BuilderBranchError,
  getBuilderBranchStatus,
  sendBuilderBranchMessage,
  type BuilderBranchErrorCode,
} from "./builder-branch.js";
import { CredentialStoreUnavailableError } from "./credential-provider.js";

const OAUTH_TOKEN = "oauth-token-example-0001";
const LEGACY_KEY = "bpk-example-0002";
const BODY_SECRET = "private-body-detail-0003";

const oauthAuthorization = {
  token: OAUTH_TOKEN,
  authorization: `Bearer ${OAUTH_TOKEN}`,
  source: "oauth",
  oauthScope: "user",
};

const legacyAuthorization = {
  token: LEGACY_KEY,
  authorization: `Bearer ${LEGACY_KEY}`,
  source: "legacy",
  legacyPublicKey: "public-key-example",
  userId: "user-1",
};

const ref = { projectId: "project-1", branchName: "feature/ship-it" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonlResponse(chunks: unknown[], status = 200): Response {
  return new Response(chunks.map((c) => JSON.stringify(c) + "\n").join(""), {
    status,
    headers: { "Content-Type": "application/jsonl" },
  });
}

function streamResponse(parts: Array<Uint8Array | Error>): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[index++];
        if (part === undefined) controller.close();
        else if (part instanceof Error) controller.error(part);
        else controller.enqueue(part);
      },
    }),
    { status: 200 },
  );
}

const sendingChunks = [
  { type: "validating-branch", projectId: "project-1" },
  { type: "setting-up-container", projectId: "project-1" },
  { type: "sending-message", projectId: "project-1" },
];

const sentChunk = {
  type: "message-sent",
  message: "Message sent successfully!",
  url: "https://example.test/branch",
};

async function caught(promise: Promise<unknown>): Promise<BuilderBranchError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to reject");
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BuilderBranchError);
  return error as BuilderBranchError;
}

function expectFailure(
  error: BuilderBranchError,
  code: BuilderBranchErrorCode,
  retryable: boolean,
) {
  expect({ code: error.code, retryable: error.retryable }).toEqual({
    code,
    retryable,
  });
}

describe("Builder branch helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveBuilderRequestAuthorizationMock.mockResolvedValue(
      oauthAuthorization,
    );
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getBuilderBranchStatus", () => {
    it("reads the branch with the project read scope and OAuth bearer alone", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ branch: {} }));

      await getBuilderBranchStatus(ref);

      expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
        requiredScope: "builder:projects:read",
      });
      const [input, init] = vi.mocked(fetch).mock.calls[0]!;
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://api.example.test/projects/branches",
      );
      expect(url.searchParams.get("projectId")).toBe("project-1");
      expect(url.searchParams.has("apiKey")).toBe(false);
      expect(init).toMatchObject({
        method: "GET",
        headers: { Authorization: `Bearer ${OAUTH_TOKEN}` },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("sends the legacy public key as apiKey", async () => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue(
        legacyAuthorization,
      );
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ branch: {} }));

      await getBuilderBranchStatus(ref);

      const [input, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(new URL(String(input)).searchParams.get("apiKey")).toBe(
        "public-key-example",
      );
      expect(init).toMatchObject({
        headers: { Authorization: `Bearer ${LEGACY_KEY}` },
      });
    });

    it("encodes a branch name containing slashes and query characters", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ branch: {} }));
      const branchName = "feature/ship it#1&x=y";

      await getBuilderBranchStatus({ projectId: "project-1", branchName });

      const [input] = vi.mocked(fetch).mock.calls[0]!;
      const url = new URL(String(input));
      expect(url.searchParams.get("branchName")).toBe(branchName);
      expect(url.searchParams.getAll("x")).toEqual([]);
      expect(url.hash).toBe("");
      expect(String(input)).toContain(
        "branchName=feature%2Fship+it%231%26x%3Dy",
      );
    });

    it.each(["running", "waiting", "idle"] as const)(
      "maps agentState %s with its activity and pull request fields",
      async (agentState) => {
        vi.mocked(fetch).mockResolvedValue(
          jsonResponse({
            success: true,
            branch: {
              agentState,
              lastActivityAt: 1_760_000_000_000,
              state: "active",
              prStatus: "open",
              prUrl: "https://github.com/acme/app/pull/7",
            },
          }),
        );

        await expect(getBuilderBranchStatus(ref)).resolves.toStrictEqual({
          agentState,
          lastActivityAt: 1_760_000_000_000,
          state: "active",
          archived: false,
          prStatus: "open",
          prUrl: "https://github.com/acme/app/pull/7",
        });
      },
    );

    it("reports absent fields as null and drops fields the engine does not read", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({
          branch: {
            name: "feature/ship-it",
            screenshot: "https://example.test/shot.png",
            kubeHostname: "internal.example.test",
            metadata: { jiraIssueKey: "ENG-1" },
          },
        }),
      );

      await expect(getBuilderBranchStatus(ref)).resolves.toStrictEqual({
        agentState: null,
        lastActivityAt: null,
        state: "active",
        archived: false,
        prStatus: null,
        prUrl: null,
      });
    });

    it("reports an archived branch as archived, not as a failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ branch: { state: "archived", agentState: "idle" } }),
      );

      await expect(getBuilderBranchStatus(ref)).resolves.toMatchObject({
        state: "archived",
        archived: true,
        agentState: "idle",
      });
    });

    it("reads a legacy deleted flag only when state is absent", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ branch: { deleted: true } }))
        .mockResolvedValueOnce(
          jsonResponse({ branch: { state: "active", deleted: true } }),
        );

      await expect(getBuilderBranchStatus(ref)).resolves.toMatchObject({
        state: "deleted",
        archived: false,
      });
      await expect(getBuilderBranchStatus(ref)).resolves.toMatchObject({
        state: "active",
      });
    });

    it.each([404, 410])(
      "types a %s as a missing branch that is not retryable",
      async (status) => {
        vi.mocked(fetch).mockResolvedValue(
          jsonResponse({ message: BODY_SECRET }, status),
        );

        const error = await caught(getBuilderBranchStatus(ref));

        expectFailure(error, "branch_not_found", false);
        expect(error.status).toBe(status);
        expect(error.operation).toBe("status");
        expect(error.message).not.toContain(BODY_SECRET);
      },
    );

    it.each([
      [401, "unauthorized", false],
      [403, "forbidden", false],
      [429, "rate_limited", true],
      [500, "server_error", true],
      [502, "server_error", true],
      [503, "server_error", true],
      [408, "timeout", true],
      [400, "request_rejected", false],
      [422, "request_rejected", false],
    ] as const)(
      "types a %s response as %s (retryable: %s)",
      async (status, code, retryable) => {
        vi.mocked(fetch).mockResolvedValue(
          jsonResponse({ error: BODY_SECRET }, status),
        );

        const error = await caught(getBuilderBranchStatus(ref));

        expectFailure(error, code, retryable);
        expect(error.status).toBe(status);
        expect(error.message).not.toContain(BODY_SECRET);
      },
    );

    it("types a real request timeout as retryable", async () => {
      vi.mocked(fetch).mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      );

      const error = await caught(
        getBuilderBranchStatus({ ...ref, timeoutMs: 5 }),
      );

      expectFailure(error, "timeout", true);
      expect(error.status).toBeNull();
    });

    it("types a network failure as retryable", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

      expectFailure(
        await caught(getBuilderBranchStatus(ref)),
        "network_error",
        true,
      );
    });

    it.each([
      [
        "a non-JSON body",
        () => new Response("<html>" + BODY_SECRET + "</html>"),
      ],
      ["a JSON array", () => jsonResponse([])],
      ["a body without a branch", () => jsonResponse({ success: true })],
      ["a non-object branch", () => jsonResponse({ branch: "main" })],
      [
        "an unknown agentState",
        () => jsonResponse({ branch: { agentState: "errored" } }),
      ],
      [
        "an unknown prStatus",
        () => jsonResponse({ branch: { prStatus: "stale" } }),
      ],
      ["an unknown state", () => jsonResponse({ branch: { state: "hidden" } })],
      [
        "a non-numeric lastActivityAt",
        () => jsonResponse({ branch: { lastActivityAt: "yesterday" } }),
      ],
    ])("types %s as an unreadable response", async (_label, respond) => {
      vi.mocked(fetch).mockResolvedValue(respond());

      const error = await caught(getBuilderBranchStatus(ref));

      expectFailure(error, "invalid_response", false);
      expect(error.message).not.toContain(BODY_SECRET);
      expect(error.cause).toBeUndefined();
    });

    it.each([
      ["projectId", { ...ref, projectId: "  " }],
      ["branchName", { ...ref, branchName: "" }],
    ])(
      "requires a %s and never reaches Builder without one",
      async (_name, args) => {
        const error = await caught(getBuilderBranchStatus(args));

        expectFailure(error, "invalid_request", false);
        expect(resolveBuilderRequestAuthorizationMock).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  });

  describe("sendBuilderBranchMessage", () => {
    it("posts a queued fire-and-forget message with the project write scope", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonlResponse([...sendingChunks, sentChunk]),
      );

      await expect(
        sendBuilderBranchMessage({ ...ref, message: "Please add tests" }),
      ).resolves.toStrictEqual({ accepted: true });

      expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
        requiredScope: "builder:projects:write",
      });
      const [input, init] = vi.mocked(fetch).mock.calls[0]!;
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://api.example.test/projects/branch/message",
      );
      expect(url.search).toBe("");
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          Authorization: `Bearer ${OAUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
      expect(JSON.parse(String(init?.body))).toStrictEqual({
        projectId: "project-1",
        branchName: "feature/ship-it",
        fireAndForget: true,
        userMessage: { userPrompt: "Please add tests", queue: true },
      });
    });

    it("sends the legacy public key and user id as query parameters", async () => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue(
        legacyAuthorization,
      );
      vi.mocked(fetch).mockResolvedValue(jsonlResponse([sentChunk]));

      await sendBuilderBranchMessage({ ...ref, message: "hello" });

      const [input] = vi.mocked(fetch).mock.calls[0]!;
      const url = new URL(String(input));
      expect(url.searchParams.get("apiKey")).toBe("public-key-example");
      expect(url.searchParams.get("userId")).toBe("user-1");
    });

    it("keeps a slashed branch name verbatim in the JSON body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonlResponse([sentChunk]));

      await sendBuilderBranchMessage({
        projectId: "project-1",
        branchName: "feature/a/b c",
        message: "hello",
      });

      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(JSON.parse(String(init?.body)).branchName).toBe("feature/a/b c");
    });

    it("reads an outcome chunk split across stream reads", async () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ type: "sending-message", note: "café" }) +
          "\n" +
          JSON.stringify(sentChunk) +
          "\n",
      );
      const parts = [
        bytes.slice(0, 40),
        bytes.slice(40, 45),
        bytes.slice(45, 100),
        bytes.slice(100),
      ];
      vi.mocked(fetch).mockResolvedValue(streamResponse(parts));

      await expect(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      ).resolves.toStrictEqual({ accepted: true });
    });

    it("accepts an outcome chunk that has no trailing newline", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(sentChunk), { status: 200 }),
      );

      await expect(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      ).resolves.toStrictEqual({ accepted: true });
    });

    it("stops at the first outcome chunk", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(sentChunk) + "\nnot json\n", {
          status: 200,
        }),
      );

      await expect(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      ).resolves.toStrictEqual({ accepted: true });
    });

    it("types a validation error chunk as a non-retryable rejection without echoing it", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonlResponse([
          sendingChunks[0],
          {
            type: "error",
            message: "Message sending failed during validation",
            error: `Branch "feature/ship-it" is archived ${BODY_SECRET}`,
          },
        ]),
      );

      const error = await caught(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      );

      expectFailure(error, "message_rejected", false);
      expect(error.operation).toBe("message");
      expect(error.message).not.toContain(BODY_SECRET);
    });

    it("types an unrecognized error chunk as a non-retryable rejection", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonlResponse([{ type: "error", message: BODY_SECRET }]),
      );

      const error = await caught(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      );

      expectFailure(error, "message_rejected", false);
      expect(error.message).not.toContain(BODY_SECRET);
    });

    it("types a container setup failure as retryable", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonlResponse([
          sendingChunks[1],
          {
            type: "error",
            message: "Container setup failed",
            error: `Failed to set up container: ${BODY_SECRET}`,
          },
        ]),
      );

      const error = await caught(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      );

      expectFailure(error, "container_unavailable", true);
      expect(error.message).not.toContain(BODY_SECRET);
    });

    it("does not call a stream without an outcome a success", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonlResponse(sendingChunks));

      expectFailure(
        await caught(sendBuilderBranchMessage({ ...ref, message: "hello" })),
        "incomplete_response",
        true,
      );
    });

    it("does not call an empty 200 a success", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 200 }));

      expectFailure(
        await caught(sendBuilderBranchMessage({ ...ref, message: "hello" })),
        "incomplete_response",
        true,
      );
    });

    it("types a malformed stream line as an unreadable response", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(`{"type":"sending-message"}\n<html>${BODY_SECRET}\n`, {
          status: 200,
        }),
      );

      const error = await caught(
        sendBuilderBranchMessage({ ...ref, message: "hello" }),
      );

      expectFailure(error, "invalid_response", false);
      expect(error.message).not.toContain(BODY_SECRET);
      expect(error.cause).toBeUndefined();
    });

    it("types a stream that breaks mid-read as a retryable network failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        streamResponse([
          new TextEncoder().encode(JSON.stringify(sendingChunks[0]) + "\n"),
          new TypeError("terminated"),
        ]),
      );

      expectFailure(
        await caught(sendBuilderBranchMessage({ ...ref, message: "hello" })),
        "network_error",
        true,
      );
    });

    it("types a request timeout as retryable", async () => {
      vi.mocked(fetch).mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      );

      expectFailure(
        await caught(
          sendBuilderBranchMessage({ ...ref, message: "hello", timeoutMs: 5 }),
        ),
        "timeout",
        true,
      );
    });

    it.each([
      [401, "unauthorized", false],
      [403, "forbidden", false],
      [404, "request_rejected", false],
      [400, "request_rejected", false],
      [429, "rate_limited", true],
      [500, "server_error", true],
      [503, "server_error", true],
    ] as const)(
      "types a %s response as %s (retryable: %s)",
      async (status, code, retryable) => {
        vi.mocked(fetch).mockResolvedValue(
          jsonResponse({ error: BODY_SECRET }, status),
        );

        const error = await caught(
          sendBuilderBranchMessage({ ...ref, message: "hello" }),
        );

        expectFailure(error, code, retryable);
        expect(error.status).toBe(status);
        expect(error.message).not.toContain(BODY_SECRET);
      },
    );

    it.each([
      ["projectId", { ...ref, projectId: "", message: "hello" }],
      ["branchName", { ...ref, branchName: " ", message: "hello" }],
      ["message", { ...ref, message: "   " }],
    ])(
      "requires a %s and never reaches Builder without one",
      async (_name, args) => {
        const error = await caught(sendBuilderBranchMessage(args));

        expectFailure(error, "invalid_request", false);
        expect(resolveBuilderRequestAuthorizationMock).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  });

  describe.each([
    ["getBuilderBranchStatus", () => getBuilderBranchStatus(ref)],
    [
      "sendBuilderBranchMessage",
      () => sendBuilderBranchMessage({ ...ref, message: "hello" }),
    ],
  ])("%s authorization", (_name, call) => {
    it("reports a missing connection and never calls Builder", async () => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue(null);

      expectFailure(await caught(call()), "not_connected", false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports a connection that needs re-authorizing", async () => {
      const cause = new ActionContractError("scope missing", {
        errorCode: "builder_oauth_reauthorization_required",
        statusCode: 400,
      });
      resolveBuilderRequestAuthorizationMock.mockRejectedValue(cause);

      const error = await caught(call());

      expectFailure(error, "not_connected", false);
      expect(error.cause).toBe(cause);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports legacy credentials without a public key", async () => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue({
        token: LEGACY_KEY,
        authorization: `Bearer ${LEGACY_KEY}`,
        source: "legacy",
      });

      expectFailure(await caught(call()), "not_connected", false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("keeps an unreadable credential store distinct from a missing connection", async () => {
      resolveBuilderRequestAuthorizationMock.mockRejectedValue(
        new CredentialStoreUnavailableError(),
      );

      expectFailure(await caught(call()), "credentials_unavailable", true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("does not retype an unexpected resolver failure", async () => {
      const bug = new RangeError("resolver bug");
      resolveBuilderRequestAuthorizationMock.mockRejectedValue(bug);

      await expect(call()).rejects.toBe(bug);
    });

    it("never puts a credential in a thrown error", async () => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue(
        legacyAuthorization,
      );
      vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
      const failures = [await caught(call())];

      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: LEGACY_KEY }, 401),
      );
      failures.push(await caught(call()));

      for (const error of failures) {
        const rendered = [
          error.message,
          String(error),
          JSON.stringify(error),
          error.stack,
        ].join("\n");
        expect(rendered).not.toContain(LEGACY_KEY);
        expect(rendered).not.toContain(OAUTH_TOKEN);
      }
    });
  });
});
