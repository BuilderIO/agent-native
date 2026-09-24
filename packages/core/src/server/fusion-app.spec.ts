import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveBuilderRequestAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: resolveBuilderRequestAuthorizationMock,
}));

vi.mock("./builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.example.test",
  getBuilderAppHost: () => "https://builder.example.test",
}));

import {
  getFusionDeploys,
  pushFusionBranch,
  sendFusionBranchMessage,
} from "./fusion-app.js";

describe("Fusion Builder authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses OAuth without legacy API key fields", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await pushFusionBranch({ projectId: "project-1", branchName: "main" });

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:projects:write",
    });
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.searchParams.has("apiKey")).toBe(false);
    expect(url.searchParams.has("userId")).toBe(false);
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>" },
    });
  });

  it("uses the project read scope for deploy listing", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deploys: [] }), { status: 200 }),
    );

    await expect(getFusionDeploys({ projectId: "project-1" })).resolves.toEqual(
      [],
    );

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:projects:read",
    });
  });

  it("uses legacy public-key fields when available", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "bpk-example",
      authorization: "Bearer bpk-example",
      source: "legacy",
      legacyPublicKey: "public-key",
      userId: "user-1",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await pushFusionBranch({ projectId: "project-1", branchName: "main" });

    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.searchParams.get("apiKey")).toBe("public-key");
    expect(url.searchParams.get("userId")).toBe("user-1");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer bpk-example" },
    });
  });
});

describe("Fusion branch message outcomes", () => {
  const args = {
    projectId: "project-1",
    branchName: "main",
    prompt: "Update the heading",
  };
  const ack = { type: "message-sent" };
  const done = {
    type: "ai",
    event: {
      type: "done",
      id: "completion-1",
      actions: [{ type: "text", content: "Updated" }],
      stopReason: "end_turn",
    },
  };
  const aiError = {
    type: "ai",
    event: {
      type: "error",
      message: "Model unavailable",
      code: "service-unavailable",
    },
  };

  function respond(chunks: unknown[]) {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(chunks.map((chunk) => JSON.stringify(chunk)).join("\n")),
    );
  }

  function respondUntilAbort(chunks: unknown[]) {
    vi.mocked(fetch).mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks)
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(chunk) + "\n"),
                );
              init!.signal!.addEventListener(
                "abort",
                () => controller.error(init!.signal!.reason),
                { once: true },
              );
            },
          }),
        ),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      userId: "user-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports only dispatch for the default fire-and-forget acknowledgment", async () => {
    respond([{ type: "sending-message" }, ack]);
    await expect(sendFusionBranchMessage(args)).resolves.toEqual({
      sent: true,
      outcome: "dispatched",
      doneObserved: false,
    });
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string),
    ).toMatchObject({ fireAndForget: true });
  });

  it.each([
    [],
    [{ type: "validating-branch" }],
    [{ type: "sending-message" }],
    [{ success: true }],
  ])(
    "does not infer dispatch from empty or preparatory streams: %j",
    async (...chunks) => {
      respond(chunks);
      const result = await sendFusionBranchMessage(args);
      expect(result).toMatchObject({
        sent: false,
        outcome: "incomplete",
        doneObserved: false,
      });
      expect(result.error).toContain("dispatch acknowledgment");
    },
  );

  it("does not treat a missing response body as dispatch", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      sent: false,
      outcome: "incomplete",
    });
  });

  it("requires done when waiting even after dispatch is acknowledged", async () => {
    respond([ack]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toMatchObject({
      sent: true,
      outcome: "incomplete",
      doneObserved: false,
    });
  });

  it("reports done with final text, without claiming DSI publication", async () => {
    respond([done, ack]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toEqual({
      sent: true,
      outcome: "completed",
      doneObserved: true,
      response: "Updated",
    });
  });

  it("recognizes a done event without text", async () => {
    respond([{ type: "ai", event: { type: "done", actions: [] } }]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toEqual({
      sent: true,
      outcome: "completed",
      doneObserved: true,
    });
  });

  it("does not infer completion from agent activity", async () => {
    respond([{ type: "ai", event: { type: "delta", delta: "Working" } }]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toMatchObject({
      sent: true,
      outcome: "incomplete",
      doneObserved: false,
    });
  });

  it("preserves every upstream error even when a later done or acknowledgment arrives", async () => {
    respond([
      { type: "error", error: "Container warning" },
      aiError,
      done,
      { type: "error", message: "Finalization failed" },
      ack,
    ]);
    const result = await sendFusionBranchMessage({
      ...args,
      fireAndForget: false,
    });
    expect(result).toMatchObject({
      sent: true,
      outcome: "failed",
      doneObserved: true,
      response: "Updated",
      errors: ["Container warning", "Model unavailable", "Finalization failed"],
    });
    expect(result.error).toBe(result.errors!.join("\n"));
  });

  it("does not mark dispatch for a failure after sending-message preparation", async () => {
    respond([
      { type: "sending-message" },
      { type: "error", error: "Container rejected request" },
    ]);
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      sent: false,
      outcome: "failed",
      doneObserved: false,
      error: "Container rejected request",
    });
  });

  it("separates child diagnostics from parent batch failures without treating child done as parent done", async () => {
    respond([
      {
        type: "ai",
        event: {
          type: "batch",
          steps: [
            { type: "agent", step: done.event },
            { type: "agent", step: aiError.event },
            { type: "error", message: "Another failure" },
          ],
        },
      },
      ack,
    ]);
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      outcome: "failed",
      doneObserved: false,
      errors: ["Another failure"],
      diagnostics: ["Model unavailable"],
    });
  });

  it.each([
    { step: aiError.event, diagnostic: "Model unavailable" },
    {
      step: { ...done.event, stopReason: "error" },
      diagnostic: "Agent completion stopped: error",
    },
    {
      step: {
        ...done.event,
        actions: [{ type: "file", errors: ["Child apply failed"] }],
      },
      diagnostic: "Child apply failed",
    },
    {
      step: { ...done.event, errors: ["Child completion failed"] },
      diagnostic: "Child completion failed",
    },
  ])(
    "allows the parent to recover from a child failure: $diagnostic",
    async ({ step, diagnostic }) => {
      respond([
        {
          type: "ai",
          event: { type: "agent", step: { type: "batch", steps: [step] } },
        },
        {
          type: "ai",
          event: { type: "delta", delta: "Recovered in the parent" },
        },
        done,
        ack,
      ]);
      const result = await sendFusionBranchMessage({
        ...args,
        fireAndForget: false,
      });
      expect(result).toEqual({
        sent: true,
        outcome: "completed",
        doneObserved: true,
        response: "Updated",
        diagnostics: [diagnostic],
      });
    },
  );

  it("does not promote a child done event to parent completion after a child failure", async () => {
    respond([
      {
        type: "ai",
        event: {
          type: "agent",
          step: { type: "batch", steps: [aiError.event, done.event] },
        },
      },
      ack,
    ]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toMatchObject({
      outcome: "incomplete",
      doneObserved: false,
      diagnostics: ["Model unavailable"],
      errors: ["Branch message stream ended without an agent done event"],
    });
  });

  it.each([
    { terminal: aiError, message: "Model unavailable" },
    {
      terminal: { type: "error", error: "Parent dispatch failed" },
      message: "Parent dispatch failed",
    },
    {
      terminal: {
        type: "ai",
        event: {
          ...done.event,
          actions: [{ type: "file", errors: ["Parent apply failed"] }],
        },
      },
      message: "Parent apply failed",
    },
    {
      terminal: { type: "ai", event: { ...done.event, stopReason: "error" } },
      message: "Agent completion stopped: error",
    },
  ])(
    "keeps propagated parent failures terminal: $message",
    async ({ terminal, message }) => {
      respond([
        { type: "ai", event: { type: "agent", step: aiError.event } },
        terminal,
        ack,
      ]);
      await expect(
        sendFusionBranchMessage({ ...args, fireAndForget: false }),
      ).resolves.toMatchObject({
        outcome: "failed",
        errors: [message],
        diagnostics: ["Model unavailable"],
      });
    },
  );

  it("recognizes a parent done within a batch", async () => {
    respond([{ type: "ai", event: { type: "batch", steps: [done.event] } }]);
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      outcome: "completed",
      doneObserved: true,
    });
  });

  it("separates intermediate file/tool diagnostics from final action failures", async () => {
    respond([
      { type: "ai", event: { type: "file", errors: ["File failed"] } },
      {
        type: "ai",
        event: {
          type: "tool_result",
          result: { is_error: true, content: "Tool failed" },
        },
      },
      {
        type: "ai",
        event: {
          type: "done",
          actions: [{ type: "file", errors: ["Apply failed"] }],
        },
      },
      ack,
    ]);
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      outcome: "failed",
      doneObserved: true,
      errors: ["Apply failed"],
      diagnostics: ["File failed", "Tool failed"],
    });
  });

  it("completes after a recovered tool error without promoting diagnostics to failures", async () => {
    respond([
      {
        type: "ai",
        event: {
          type: "tool_result",
          result: { is_error: true, content: "File not found" },
        },
      },
      {
        type: "ai",
        event: {
          type: "tool_result",
          result: { is_error: false, content: "Read the correct file" },
        },
      },
      done,
      ack,
    ]);
    const result = await sendFusionBranchMessage({
      ...args,
      fireAndForget: false,
    });
    expect(result).toEqual({
      sent: true,
      outcome: "completed",
      doneObserved: true,
      response: "Updated",
      diagnostics: ["File not found"],
    });
    expect(result.error).toBeUndefined();
    expect(result.errors).toBeUndefined();
  });

  it("retains tool diagnostics without treating an unfinished stream as recovered", async () => {
    respond([
      {
        type: "ai",
        event: {
          type: "tool_result",
          result: { is_error: true, content: "File not found" },
        },
      },
    ]);
    await expect(
      sendFusionBranchMessage({ ...args, fireAndForget: false }),
    ).resolves.toMatchObject({
      outcome: "incomplete",
      doneObserved: false,
      diagnostics: ["File not found"],
      errors: ["Branch message stream ended without an agent done event"],
    });
  });

  it.each([true, false])(
    "sends successive prompts to the exact same project and branch with fireAndForget=%s",
    async (fireAndForget) => {
      const ref = {
        projectId: "dsi-project-42",
        branchName: "design-system/Brand v2",
      };
      respond(fireAndForget ? [ack] : [done, ack]);
      const prompts = [
        "Make the type scale larger",
        "Keep that scale and refine the palette",
      ];
      for (const prompt of prompts) {
        await expect(
          sendFusionBranchMessage({ ...ref, prompt, fireAndForget }),
        ).resolves.toMatchObject({
          sent: true,
          outcome: fireAndForget ? "dispatched" : "completed",
        });
      }
      expect(fetch).toHaveBeenCalledTimes(2);
      vi.mocked(fetch).mock.calls.forEach(([input, init], index) => {
        expect(String(input)).toBe(
          "https://api.example.test/projects/branch/message",
        );
        expect(init!.method).toBe("POST");
        expect(JSON.parse(init!.body as string)).toEqual({
          ...ref,
          fireAndForget,
          userMessage: {
            userPrompt: prompts[index],
            user: { source: "agent-native", role: "user", userId: "user-1" },
          },
        });
      });
    },
  );

  it.each([
    "error",
    "aborted",
    "max_tokens",
    "content_filter",
    "refusal",
    "model_context_window_exceeded",
  ])(
    "does not report successful completion for stop reason %s",
    async (stopReason) => {
      respond([{ type: "ai", event: { ...done.event, stopReason } }, ack]);
      await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
        outcome: "failed",
        doneObserved: true,
        error: `Agent completion stopped: ${stopReason}`,
      });
    },
  );

  it.each([null, {}, []])(
    "rejects malformed AI events without inferring dispatch: %j",
    async (event) => {
      respond([{ type: "ai", event }]);
      await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
        sent: false,
        outcome: "failed",
        doneObserved: false,
      });
    },
  );

  it("does not accept malformed done events", async () => {
    respond([{ type: "ai", event: { type: "done" } }, ack]);
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      outcome: "failed",
      doneObserved: false,
    });
  });

  it.each(["not json", "[]", "null"])(
    "does not silently discard invalid stream records: %s",
    async (invalidLine) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          `${invalidLine}\n${JSON.stringify(done)}\n${JSON.stringify(ack)}`,
        ),
      );
      await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
        sent: true,
        outcome: "failed",
        errors: ["Invalid JSON object in branch message stream"],
      });
    },
  );

  it.each(['{"type":', "[]", "null"])(
    "does not claim completion when malformed EOF follows done: %s",
    async (invalidTail) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          `${JSON.stringify(done)}\n${JSON.stringify(ack)}\n${invalidTail}`,
        ),
      );
      await expect(
        sendFusionBranchMessage({ ...args, fireAndForget: false }),
      ).resolves.toMatchObject({
        sent: true,
        outcome: "failed",
        doneObserved: true,
        errors: ["Invalid JSON object in branch message stream"],
      });
    },
  );

  it("handles split UTF-8/NDJSON chunks and an unterminated final record", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        ...done,
        event: {
          ...done.event,
          actions: [{ type: "text", content: "Updated café" }],
        },
      }),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      ),
    );
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      outcome: "completed",
      response: "Updated café",
    });
  });

  it.each([false, true])(
    "distinguishes timeout with observed dispatch=%s",
    async (dispatched) => {
      vi.useFakeTimers();
      respondUntilAbort(dispatched ? [ack] : [{ type: "sending-message" }]);
      const pending = sendFusionBranchMessage({
        ...args,
        fireAndForget: false,
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(result).toMatchObject({
        sent: dispatched,
        outcome: "timed_out",
        doneObserved: false,
      });
      expect(result.error).toContain(
        dispatched ? "after message dispatch" : "before message dispatch",
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retains an AI error when the stream subsequently times out", async () => {
    vi.useFakeTimers();
    respondUntilAbort([aiError]);
    const pending = sendFusionBranchMessage({ ...args, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({
      sent: true,
      outcome: "timed_out",
      errors: [
        "Model unavailable",
        "Timed out after message dispatch; completion is unknown",
      ],
    });
  });

  it("keeps done observation without claiming completion when the stream times out later", async () => {
    vi.useFakeTimers();
    respondUntilAbort([done]);
    const pending = sendFusionBranchMessage({ ...args, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({
      sent: true,
      outcome: "timed_out",
      doneObserved: true,
    });
  });

  it("preserves dispatch and prior failures on a transport error", async () => {
    const chunks = [ack, aiError];
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk)
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify(chunk) + "\n"),
              );
            else controller.error(new Error("Socket closed"));
          },
        }),
      ),
    );
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      sent: true,
      outcome: "failed",
      errors: ["Model unavailable", "Socket closed"],
    });
  });

  it("reports HTTP and connection failures without claiming dispatch", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("Permission denied", { status: 403 }))
      .mockRejectedValueOnce(new Error("Connection failed"));
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      sent: false,
      outcome: "failed",
      error: "Permission denied",
    });
    await expect(sendFusionBranchMessage(args)).resolves.toMatchObject({
      sent: false,
      outcome: "failed",
      error: "Connection failed",
    });
  });

  it("forwards an explicit request identity using the actual upstream field", async () => {
    respond([ack]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        sendFusionBranchMessage({ ...args, requestId: "request-1" }),
      ).resolves.toMatchObject({
        requestId: "request-1",
        outcome: "dispatched",
      });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      const body = JSON.parse(init!.body as string);
      expect(body.userMessage).toMatchObject({
        userPrompt: args.prompt,
        idempotencyKey: "request-1",
        user: { userId: "user-1" },
      });
      expect(body.userMessage).not.toHaveProperty("id");
      expect(body).not.toHaveProperty("requestId");
    }
  });

  it("rejects empty identities before making a service request", async () => {
    await expect(
      sendFusionBranchMessage({ ...args, requestId: " " }),
    ).rejects.toThrow("requestId must not be empty");
    expect(fetch).not.toHaveBeenCalled();
  });
});
