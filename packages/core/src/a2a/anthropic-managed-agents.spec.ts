import { createServer, type IncomingMessage, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import {
  ANTHROPIC_MANAGED_AGENTS_BETA_HEADER,
  ANTHROPIC_MANAGED_AGENTS_METADATA_KEY,
  createAnthropicManagedAgentsHandler,
  type AnthropicManagedAgentRuntimeEvent,
} from "./anthropic-managed-agents.js";
import { RemoteAgentCredentialRejectedError } from "./remote-agent-auth.js";
import type { A2AHandlerResult } from "./types.js";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendSse(
  response: import("node:http").ServerResponse,
  events: unknown[],
) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  for (const event of events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

function context() {
  return {
    taskId: "task_fixture",
    contextId: "context_fixture",
    writeArtifact: (name: string) => name,
  };
}

describe("Anthropic Managed Agents A2A handler", () => {
  let server: Server;
  let origin = "";
  let mode:
    | "complete"
    | "approval"
    | "terminated"
    | "race"
    | "connect-timeout"
    | "credential-rejected" = "complete";
  let streamConnected = false;
  const previousA2ASecret = process.env.A2A_SECRET;
  const requests: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown> | null;
  }> = [];

  beforeAll(async () => {
    process.env.A2A_SECRET = "anthropic-managed-fixture-secret";
    server = createServer(async (request, response) => {
      const bodyText = request.method === "POST" ? await readBody(request) : "";
      const body = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : null;
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "/",
        headers: request.headers,
        body,
      });

      if (request.url === "/v1/sessions" && request.method === "POST") {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: "ses_fixture" }));
        return;
      }
      if (
        request.url === "/v1/sessions/ses_fixture/events" &&
        request.method === "POST"
      ) {
        if (mode === "race") {
          if (!streamConnected) {
            response.writeHead(409).end("stream was not connected");
            return;
          }
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ data: [] }));
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: [] }));
        return;
      }
      if (
        request.url === "/v1/sessions/ses_fixture/events/stream" &&
        request.method === "GET"
      ) {
        if (mode === "connect-timeout") return;
        if (mode === "credential-rejected") {
          response.writeHead(401).end("invalid credential");
          return;
        }
        if (mode === "race") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          streamConnected = true;
          sendSse(response, [
            {
              type: "agent.message",
              id: "sevt_message",
              content: [{ type: "text", text: "managed answer" }],
            },
            {
              type: "session.status_idle",
              id: "sevt_idle",
              stop_reason: { type: "end_turn" },
            },
          ]);
          return;
        }
        sendSse(
          response,
          mode === "approval"
            ? [
                {
                  type: "agent.tool_use",
                  id: "sevt_tool",
                  name: "bash",
                  input: { command: "ls" },
                  evaluated_permission: "ask",
                },
                {
                  type: "session.status_idle",
                  id: "sevt_idle",
                  stop_reason: {
                    type: "requires_action",
                    event_ids: ["sevt_tool"],
                  },
                },
              ]
            : mode === "terminated"
              ? [
                  {
                    type: "agent.message",
                    id: "sevt_message",
                    content: [{ type: "text", text: "partial answer" }],
                  },
                  {
                    type: "session.status_terminated",
                    id: "sevt_terminated",
                    reason: "sandbox crashed",
                  },
                ]
              : [
                  {
                    type: "agent.message",
                    id: "sevt_message",
                    content: [{ type: "text", text: "managed answer" }],
                  },
                  {
                    type: "session.status_idle",
                    id: "sevt_idle",
                    stop_reason: { type: "end_turn" },
                  },
                ],
        );
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("fixture did not bind");
        }
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
    else process.env.A2A_SECRET = previousA2ASecret;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  beforeEach(() => {
    mode = "complete";
    streamConnected = false;
    requests.length = 0;
  });

  function makeHandler(
    events: AnthropicManagedAgentRuntimeEvent[],
    options: {
      requestTimeoutMs?: number;
      streamConnectTimeoutMs?: number;
    } = {},
  ) {
    return createAnthropicManagedAgentsHandler({
      agentId: "agt_fixture",
      environmentId: "env_fixture",
      credentialRef: "ANTHROPIC_API_KEY",
      apiBaseUrl: origin,
      fetch: globalThis.fetch,
      resolveApiKey: async (credentialRef) => {
        expect(credentialRef).toBe("ANTHROPIC_API_KEY");
        return "fixture-key";
      },
      onRuntimeEvent: (event) => events.push(event),
      requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
      ...(options.streamConnectTimeoutMs === undefined
        ? {}
        : { streamConnectTimeoutMs: options.streamConnectTimeoutMs }),
    });
  }

  function withCaller<T>(
    fn: () => Promise<T>,
    email = "alice@example.test",
    orgId = "org_fixture",
  ) {
    return runWithRequestContext({ userEmail: email, orgId }, fn);
  }

  it("creates a session, sends a text event, and maps the streamed reply", async () => {
    const runtimeEvents: AnthropicManagedAgentRuntimeEvent[] = [];
    const handler = makeHandler(runtimeEvents);
    const result = await handler(
      {
        role: "user",
        parts: [{ type: "text", text: "Summarize the repository." }],
      },
      context(),
    );

    expect(result).toMatchObject({
      message: {
        role: "agent",
        parts: [{ type: "text", text: "managed answer" }],
      },
    });
    expect(runtimeEvents).toEqual([]);
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /v1/sessions",
      "GET /v1/sessions/ses_fixture/events/stream",
      "POST /v1/sessions/ses_fixture/events",
    ]);
    expect(requests[0]?.body).toEqual({
      agent: "agt_fixture",
      environment_id: "env_fixture",
    });
    expect(requests[2]?.body).toEqual({
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: "Summarize the repository." }],
        },
      ],
    });
    for (const request of requests) {
      expect(request.headers["anthropic-beta"]).toBe(
        ANTHROPIC_MANAGED_AGENTS_BETA_HEADER,
      );
      expect(request.headers["x-api-key"]).toBe("fixture-key");
    }
  });

  it("maps a blocking tool confirmation to input-required and a runtime approval event", async () => {
    mode = "approval";
    const runtimeEvents: AnthropicManagedAgentRuntimeEvent[] = [];
    const handler = makeHandler(runtimeEvents);
    const result = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the working tree." }],
        },
        context(),
      ),
    );

    expect(result).toMatchObject({
      taskState: "input-required",
      message: {
        metadata: {
          agentNativeTaskState: "input-required",
          [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
            continuationToken: expect.any(String),
            pendingToolUseIds: ["sevt_tool"],
          },
        },
      },
    });
    expect(runtimeEvents).toHaveLength(1);
    expect(runtimeEvents[0]).toMatchObject({
      type: "approval-request",
      approvalId: "sevt_tool",
      toolCallId: "sevt_tool",
      toolName: "bash",
      input: { command: "ls" },
      sessionId: "ses_fixture",
      turnId: "task_fixture",
      allowPersistentApproval: false,
    });
  });

  it("resumes a paused session with the exact tool confirmation event", async () => {
    mode = "approval";
    const runtimeEvents: AnthropicManagedAgentRuntimeEvent[] = [];
    const handler = makeHandler(runtimeEvents);
    const first = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the working tree." }],
        },
        context(),
      ),
    );
    const firstMetadata = (first as A2AHandlerResult).message.metadata?.[
      ANTHROPIC_MANAGED_AGENTS_METADATA_KEY
    ] as Record<string, unknown>;
    mode = "complete";

    const resumed = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Approve it." }],
          metadata: {
            [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
              ...firstMetadata,
              confirmations: [{ toolUseId: "sevt_tool", result: "allow" }],
            },
          },
        },
        context(),
      ),
    );

    expect(resumed.message.parts).toEqual([
      { type: "text", text: "managed answer" },
    ]);
    const eventRequests = requests.filter((request) =>
      request.path.endsWith("/events"),
    );
    expect(eventRequests[1]?.body).toEqual({
      events: [
        {
          type: "user.tool_confirmation",
          tool_use_id: "sevt_tool",
          result: "allow",
        },
      ],
    });
  });

  it("waits for the stream connection before posting and does not miss a reply", async () => {
    mode = "race";
    const handler = makeHandler([]);

    await expect(
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Start immediately." }],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      message: { parts: [{ type: "text", text: "managed answer" }] },
    });
    expect(streamConnected).toBe(true);
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /v1/sessions",
      "GET /v1/sessions/ses_fixture/events/stream",
      "POST /v1/sessions/ses_fixture/events",
    ]);
  });

  it("fails loudly when stream headers never arrive", async () => {
    mode = "connect-timeout";
    const handler = makeHandler([], {
      requestTimeoutMs: 5_000,
      streamConnectTimeoutMs: 25,
    });

    await expect(
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Wait for the stream." }],
        },
        context(),
      ),
    ).rejects.toMatchObject({
      name: "AnthropicManagedAgentsError",
      code: "stream_error",
      message: expect.stringContaining("timed out"),
    });
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /v1/sessions",
      "GET /v1/sessions/ses_fixture/events/stream",
    ]);
  });

  it("preserves credential rejection from stream requests", async () => {
    mode = "credential-rejected";
    const handler = makeHandler([]);

    await expect(
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Use the managed agent." }],
        },
        context(),
      ),
    ).rejects.toBeInstanceOf(RemoteAgentCredentialRejectedError);
  });

  it("treats termination after partial text as a failed state", async () => {
    mode = "terminated";
    const handler = makeHandler([]);

    await expect(
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Run the task." }],
        },
        context(),
      ),
    ).rejects.toMatchObject({
      name: "AnthropicManagedAgentsError",
      code: "failed_state",
      message: "sandbox crashed",
    });
  });

  it("rejects raw session IDs instead of treating them as continuations", async () => {
    const handler = makeHandler([]);

    await expect(
      withCaller(() =>
        handler(
          {
            role: "user",
            parts: [{ type: "text", text: "Approve it." }],
            metadata: {
              [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
                sessionId: "ses_fixture",
                confirmations: [{ toolUseId: "sevt_tool", result: "allow" }],
              },
            },
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ code: "continuation_invalid" });
  });

  it("binds a continuation token to its caller and organization", async () => {
    mode = "approval";
    const handler = makeHandler([]);
    const first = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the working tree." }],
        },
        context(),
      ),
    );
    const metadata = (first as A2AHandlerResult).message.metadata?.[
      ANTHROPIC_MANAGED_AGENTS_METADATA_KEY
    ];

    await expect(
      withCaller(
        () =>
          handler(
            {
              role: "user",
              parts: [{ type: "text", text: "Approve it." }],
              metadata: {
                [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
                  ...metadata,
                  confirmations: [{ toolUseId: "sevt_tool", result: "allow" }],
                },
              },
            },
            context(),
          ),
        "bob@example.test",
        "org_fixture",
      ),
    ).rejects.toMatchObject({ code: "continuation_invalid" });

    await expect(
      withCaller(
        () =>
          handler(
            {
              role: "user",
              parts: [{ type: "text", text: "Approve it." }],
              metadata: {
                [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
                  ...metadata,
                  confirmations: [{ toolUseId: "sevt_tool", result: "allow" }],
                },
              },
            },
            context(),
          ),
        "alice@example.test",
        "different_org",
      ),
    ).rejects.toMatchObject({ code: "continuation_invalid" });
  });

  it("rejects confirmations outside the signed pending tool set", async () => {
    mode = "approval";
    const handler = makeHandler([]);
    const first = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the working tree." }],
        },
        context(),
      ),
    );
    const metadata = (first as A2AHandlerResult).message.metadata?.[
      ANTHROPIC_MANAGED_AGENTS_METADATA_KEY
    ];

    await expect(
      withCaller(() =>
        handler(
          {
            role: "user",
            parts: [{ type: "text", text: "Approve it." }],
            metadata: {
              [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
                ...metadata,
                confirmations: [{ toolUseId: "forged_tool", result: "allow" }],
              },
            },
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ code: "continuation_invalid" });
  });

  it("rejects tampered continuation tokens", async () => {
    mode = "approval";
    const handler = makeHandler([]);
    const first = await withCaller(() =>
      handler(
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the working tree." }],
        },
        context(),
      ),
    );
    const metadata = (first as A2AHandlerResult).message.metadata?.[
      ANTHROPIC_MANAGED_AGENTS_METADATA_KEY
    ] as Record<string, unknown>;
    const token = String(metadata.continuationToken);
    const segments = token.split(".");
    const signature = segments[2] ?? "";
    const mutationOffset = Math.floor(signature.length / 2);
    const mutation = signature[mutationOffset] === "a" ? "b" : "a";
    segments[2] = `${signature.slice(0, mutationOffset)}${mutation}${signature.slice(mutationOffset + 1)}`;
    const tamperedToken = segments.join(".");

    await expect(
      withCaller(() =>
        handler(
          {
            role: "user",
            parts: [{ type: "text", text: "Approve it." }],
            metadata: {
              [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
                ...metadata,
                continuationToken: tamperedToken,
                confirmations: [{ toolUseId: "sevt_tool", result: "allow" }],
              },
            },
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ code: "continuation_invalid" });
  });
});
