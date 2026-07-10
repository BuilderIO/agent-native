import { createHmac } from "node:crypto";

import { createApp, createRouter, defineEventHandler } from "h3";
import { describe, expect, it, vi } from "vitest";

import {
  AutomationConnectorError,
  createAutomationCallbackHandler,
  createAutomationRuntime,
  type AutomationWorkflowDefinition,
} from "./index.js";

const workflow: AutomationWorkflowDefinition = {
  id: "notify-release",
  connectorId: "n8n",
  name: "Notify release",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  response: { mode: "asynchronous" },
  capabilities: {
    invokesExternalWorkflow: true,
    receivesCallback: true,
    supportsIdempotency: true,
    supportsSynchronousResponse: false,
    supportsAsynchronousResponse: true,
    mayCauseExternalSideEffects: true,
  },
  outbound: {
    baseUrl: "https://workflow.example.test",
    path: "/webhook/release",
    headers: { authorization: "${automationSecret.N8N_WEBHOOK_CREDENTIAL}" },
    idempotencyHeader: "idempotency-key",
    retry: { maxAttempts: 2, retryDelayMs: 0 },
  },
  inbound: {
    authentication: {
      kind: "hmac-sha256",
      secretRef: "AUTOMATION_CALLBACK_SECRET",
      header: "x-signature",
    },
    eventIdHeader: "x-event-id",
    triggersAgentExecution: true,
  },
};

function makeRuntime(
  overrides: Parameters<typeof createAutomationRuntime>[0] = {},
) {
  return createAutomationRuntime({
    workflows: [workflow],
    resolveSecret: async () => "test-only-secret-not-real",
    fetch: vi.fn(
      async () =>
        new Response(JSON.stringify({ receipt: "test-only-secret-not-real" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
    ),
    claimInboundEvent: vi.fn(async () => true),
    releaseInboundEvent: vi.fn(async () => {}),
    enqueueInboundEvent: vi.fn(async () => {}),
    ...overrides,
  });
}

function callbackSignature(rawBody: string): string {
  return `sha256=${createHmac("sha256", "test-only-secret-not-real")
    .update(rawBody)
    .digest("hex")}`;
}

function callbackApp(runtime: ReturnType<typeof makeRuntime>) {
  const app = createApp();
  const router = createRouter();
  router.post(
    "/callback/:workflowId",
    defineEventHandler(createAutomationCallbackHandler(runtime)),
  );
  app.use(router);
  return app;
}

describe("automation runtime", () => {
  it("only invokes static allow-listed workflow targets and redacts credentials", async () => {
    const runtime = makeRuntime();
    const result = await runtime.invoke({
      workflowId: "notify-release",
      userEmail: "owner@example.test",
      input: { release: "v1" },
      idempotencyKey: "event-release-0001",
    });

    expect(result).toMatchObject({
      status: "accepted",
      httpStatus: 202,
      output: { receipt: "[REDACTED]" },
    });

    const blocked = makeRuntime({
      workflows: [
        {
          ...workflow,
          outbound: {
            ...workflow.outbound!,
            path: "https://untrusted.example.test/webhook",
          },
        },
      ],
    });
    await expect(
      blocked.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-0002",
      }),
    ).rejects.toMatchObject({ code: "blocked_target" });
  });

  it("bounds request and response payloads", async () => {
    const runtime = makeRuntime({
      workflows: [
        {
          ...workflow,
          outbound: {
            ...workflow.outbound!,
            maxRequestBytes: 8,
            maxResponseBytes: 4,
          },
        },
      ],
    });

    await expect(
      runtime.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: { too: "large" },
        idempotencyKey: "event-release-0003",
      }),
    ).rejects.toMatchObject({ code: "payload_too_large" });

    let responseStreamCancelled = false;
    const bounded = makeRuntime({
      workflows: [
        {
          ...workflow,
          outbound: { ...workflow.outbound!, maxResponseBytes: 4 },
        },
      ],
      fetch: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(
                  new TextEncoder().encode("response-is-intentionally-long"),
                );
              },
              cancel() {
                responseStreamCancelled = true;
              },
            }),
          ),
      ),
    });
    await expect(
      bounded.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-0004",
      }),
    ).resolves.toMatchObject({ responseTruncated: true, output: "resp" });
    expect(responseStreamCancelled).toBe(true);
  });

  it("retries transient failures but not arbitrary errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"queued":true}', { status: 202 }));
    const runtime = makeRuntime({ fetch });

    await expect(
      runtime.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-0005",
      }),
    ).resolves.toMatchObject({ attempts: 2, output: { queued: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries network errors up to the configured maximum", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response('{"queued":true}', { status: 202 }));
    const runtime = makeRuntime({ fetch });

    await expect(
      runtime.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-network",
      }),
    ).resolves.toMatchObject({ attempts: 2, output: { queued: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry nonretryable connector errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("invalid request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const runtime = makeRuntime({ fetch });

    await expect(
      runtime.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-invalid",
      }),
    ).rejects.toMatchObject({ code: "request_failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries timed-out requests up to the configured maximum", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const runtime = makeRuntime({
      workflows: [
        {
          ...workflow,
          outbound: {
            ...workflow.outbound!,
            timeoutMs: 1,
            retry: { maxAttempts: 2, retryDelayMs: 0 },
          },
        },
      ],
      fetch,
    });

    await expect(
      runtime.invoke({
        workflowId: "notify-release",
        userEmail: "owner@example.test",
        input: {},
        idempotencyKey: "event-release-0006",
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects unauthenticated callbacks before enqueueing agent work", async () => {
    const enqueueInboundEvent = vi.fn(async () => {});
    const runtime = makeRuntime({ enqueueInboundEvent });

    await expect(
      runtime.receiveCallback({
        workflowId: "notify-release",
        rawBody: '{"release":"v1"}',
        headers: new Headers({ "x-signature": "wrong" }),
      }),
    ).rejects.toMatchObject({ code: "authentication_failed" });
    expect(enqueueInboundEvent).not.toHaveBeenCalled();
  });

  it("claims callback event IDs durably before enqueueing", async () => {
    const claimInboundEvent = vi.fn(async () => false);
    const releaseInboundEvent = vi.fn(async () => {});
    const enqueueInboundEvent = vi.fn(async () => {});
    const runtime = makeRuntime({
      claimInboundEvent,
      releaseInboundEvent,
      enqueueInboundEvent,
    });
    const rawBody = '{"release":"v1"}';
    const signature = callbackSignature(rawBody);

    await expect(
      runtime.receiveCallback({
        workflowId: "notify-release",
        rawBody,
        headers: new Headers({
          "x-event-id": "provider-event-1",
          "x-signature": signature,
        }),
      }),
    ).resolves.toEqual({
      accepted: true,
      duplicate: true,
      eventId: "provider-event-1",
    });
    expect(enqueueInboundEvent).not.toHaveBeenCalled();
    expect(releaseInboundEvent).not.toHaveBeenCalled();
  });

  it("releases failed enqueue claims so provider retries can enqueue", async () => {
    const claimedEventIds = new Set<string>();
    const claimInboundEvent = vi.fn(async (input: { eventId: string }) => {
      if (claimedEventIds.has(input.eventId)) return false;
      claimedEventIds.add(input.eventId);
      return true;
    });
    const releaseInboundEvent = vi.fn(async (input: { eventId: string }) => {
      claimedEventIds.delete(input.eventId);
    });
    const enqueueInboundEvent = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("queue temporarily unavailable"));
    const runtime = makeRuntime({
      claimInboundEvent,
      releaseInboundEvent,
      enqueueInboundEvent,
    });
    const rawBody = '{"release":"v1"}';
    const input = {
      workflowId: "notify-release",
      rawBody,
      headers: new Headers({
        "x-event-id": "provider-event-retry",
        "x-signature": callbackSignature(rawBody),
      }),
    };

    await expect(runtime.receiveCallback(input)).rejects.toThrow(
      "queue temporarily unavailable",
    );
    expect(releaseInboundEvent).toHaveBeenCalledWith({
      workflow,
      eventId: "provider-event-retry",
    });

    await expect(runtime.receiveCallback(input)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      eventId: "provider-event-retry",
    });
    expect(claimInboundEvent).toHaveBeenCalledTimes(2);
    expect(enqueueInboundEvent).toHaveBeenCalledTimes(2);
  });

  it("requires a provider event ID before agent-triggering callbacks enqueue", async () => {
    const claimInboundEvent = vi.fn(async () => true);
    const enqueueInboundEvent = vi.fn(async () => {});
    const runtime = makeRuntime({ claimInboundEvent, enqueueInboundEvent });
    const rawBody = '{"release":"v1"}';

    await expect(
      runtime.receiveCallback({
        workflowId: "notify-release",
        rawBody,
        headers: new Headers({
          "x-signature": callbackSignature(rawBody),
        }),
      }),
    ).rejects.toMatchObject({ code: "missing_idempotency" });
    expect(claimInboundEvent).not.toHaveBeenCalled();
    expect(enqueueInboundEvent).not.toHaveBeenCalled();
  });

  it("fails closed when agent-triggering callbacks lack a release handler", async () => {
    const runtime = createAutomationRuntime({
      workflows: [workflow],
      resolveSecret: async () => "test-only-secret-not-real",
      claimInboundEvent: vi.fn(async () => true),
      enqueueInboundEvent: vi.fn(async () => {}),
    });
    const rawBody = "{}";
    const signature = callbackSignature(rawBody);

    await expect(
      runtime.receiveCallback({
        workflowId: "notify-release",
        rawBody,
        headers: new Headers({ "x-signature": signature }),
      }),
    ).rejects.toMatchObject({
      code: "invalid_configuration",
    } satisfies Partial<AutomationConnectorError>);
  });

  it("returns 5xx and releases the claim when durable enqueueing fails", async () => {
    const releaseInboundEvent = vi.fn(async () => {});
    const runtime = makeRuntime({
      releaseInboundEvent,
      enqueueInboundEvent: vi.fn(async () => {
        throw new Error("queue temporarily unavailable");
      }),
    });
    const rawBody = '{"release":"v1"}';
    const response = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        headers: {
          "x-event-id": "provider-event-5xx",
          "x-signature": callbackSignature(rawBody),
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(500);
    expect(releaseInboundEvent).toHaveBeenCalledWith({
      workflow,
      eventId: "provider-event-5xx",
    });
  });

  it("keeps authentication and missing event ID failures as 4xx", async () => {
    const runtime = makeRuntime();
    const rawBody = '{"release":"v1"}';
    const unauthenticated = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        headers: {
          "x-event-id": "provider-event-auth",
          "x-signature": "wrong",
        },
        body: rawBody,
      },
    );
    const missingEventId = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        headers: { "x-signature": callbackSignature(rawBody) },
        body: rawBody,
      },
    );

    expect(unauthenticated.status).toBe(401);
    expect(missingEventId.status).toBe(400);
  });

  it("returns 5xx for callback configuration failures", async () => {
    const runtime = createAutomationRuntime({
      workflows: [workflow],
      resolveSecret: async () => "test-only-secret-not-real",
    });
    const rawBody = "{}";
    const response = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        headers: {
          "x-event-id": "provider-event-config",
          "x-signature": callbackSignature(rawBody),
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(500);
  });

  it("rejects declared oversized callback bodies before reading them", async () => {
    const runtime = makeRuntime({
      workflows: [
        {
          ...workflow,
          inbound: { ...workflow.inbound!, maxRequestBytes: 8 },
        },
      ],
    });
    const response = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        headers: { "content-length": "100" },
        body: "oversized",
      },
    );

    expect(response.status).toBe(413);
  });

  it("stops buffering chunked callback bodies at the workflow limit", async () => {
    let pullCount = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new TextEncoder().encode("123456"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const runtime = makeRuntime({
      workflows: [
        {
          ...workflow,
          inbound: { ...workflow.inbound!, maxRequestBytes: 8 },
        },
      ],
    });
    const response = await callbackApp(runtime).request(
      "https://app.example.test/callback/notify-release",
      {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    expect(response.status).toBe(413);
    expect(pullCount).toBe(2);
    expect(cancelled).toBe(true);
  });
});
