import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable request body so each test can drive a different submission payload.
const state = vi.hoisted(() => ({
  body: null as unknown,
  inserted: [] as Array<Record<string, unknown>>,
  responses: [] as Array<Record<string, unknown>>,
  deliveries: [] as Array<Record<string, unknown>>,
  headers: {} as Record<string, string | undefined>,
  integrationOutcomes: [] as Array<"succeeded" | "failed">,
  throwAfterDeliveryStatusWriteFor: null as string | null,
  requestContexts: [] as Array<Record<string, unknown>>,
  session: null as null | { email?: string; orgId?: string },
}));

const sendEmail = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => {}),
);
const fireIntegrations = vi.hoisted(() => vi.fn());
const buildIntegrationDeliverySnapshots = vi.hoisted(() => vi.fn());
const deliverIntegrationDelivery = vi.hoisted(() => vi.fn());

const publishedForm = {
  id: "form_1",
  title: "Agent-Native Feedback",
  slug: "agent-native-feedback",
  fields: JSON.stringify([
    { id: "msg", type: "textarea", label: "Feedback", required: false },
  ]),
  settings: JSON.stringify({}),
  status: "published",
  ownerEmail: "owner@example.com",
  deletedAt: null as string | null,
};

vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  getRouterParam: () => "form_1",
  getQuery: () => ({}),
  getRequestHeader: (_event: unknown, name: string) =>
    state.headers[name.toLowerCase()],
  setResponseStatus: vi.fn(),
  getRequestIP: () => "1.2.3.4",
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: async () => state.session,
  readBody: async () => state.body,
  runWithRequestContext: (ctx: Record<string, unknown>, fn: () => unknown) => {
    state.requestContexts.push(ctx);
    return fn();
  },
  verifyCaptcha: async () => ({ success: true }),
  emailStrong: (value: string) => value,
  renderEmail: ({ paragraphs }: { paragraphs: string[] }) => ({
    html: paragraphs.join("\n"),
    text: paragraphs.join("\n"),
  }),
  sendEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStatePut: async () => {},
}));

vi.mock("../lib/integrations.js", () => ({
  buildIntegrationDeliverySnapshots,
  deliverIntegrationDelivery,
  fireIntegrations,
}));

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  const paramsFromWhere = (condition: unknown): unknown[] => {
    const visit = (value: unknown): unknown[] => {
      if (!value || typeof value !== "object") return [];
      if (
        (value as { constructor?: { name?: string } }).constructor?.name ===
        "Param"
      ) {
        return [(value as { value: unknown }).value];
      }
      if (Array.isArray(value)) return value.flatMap(visit);
      const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
      return Array.isArray(chunks) ? chunks.flatMap(visit) : [];
    };
    return visit(condition);
  };
  const getDb = () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (condition?: unknown) => {
          const params = paramsFromWhere(condition);
          if (table === schema.responses) {
            return Promise.resolve(state.responses);
          }
          if (table === schema.responseDeliveries) {
            const matchesId = state.deliveries.some(
              (delivery) => delivery.id === params[0],
            );
            return Promise.resolve(
              state.deliveries.filter(
                (delivery) =>
                  !params[0] ||
                  (matchesId
                    ? delivery.id === params[0]
                    : delivery.responseId === params[0]),
              ),
            );
          }
          return Promise.resolve(
            publishedForm.status === "published" && !publishedForm.deletedAt
              ? [publishedForm]
              : [],
          );
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (
        input: Record<string, unknown> | Array<Record<string, unknown>>,
      ) => {
        const values = Array.isArray(input) ? input : [input];
        const persist = () => {
          for (const value of values) {
            if (table === schema.responses) {
              state.inserted.push(value);
              if (value.idempotencyKey) {
                state.responses.push({ ...value });
              }
            } else if (
              table === schema.responseDeliveries &&
              !state.deliveries.some(
                (delivery) =>
                  delivery.responseId === value.responseId &&
                  delivery.destination === value.destination,
              )
            ) {
              state.deliveries.push({ ...value });
            }
          }
        };
        const builder: any = {};
        builder.onConflictDoNothing = () => builder;
        builder.returning = async () => {
          const v = values[0]!;
          if (table !== schema.responses) {
            persist();
            return [];
          }
          if (
            state.responses.some(
              (response) =>
                response.formId === v.formId &&
                response.idempotencyKey === v.idempotencyKey,
            )
          ) {
            return [];
          }
          persist();
          return [{ id: v.id }];
        };
        builder.then = (
          onFulfilled: (value: void) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve().then(persist).then(onFulfilled, onRejected);
        return builder;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        const execute = (condition?: unknown) => {
          const params = paramsFromWhere(condition);
          if (table === schema.responses) {
            for (const response of state.responses) {
              if (!params[0] || response.id === params[0]) {
                Object.assign(response, values);
              }
            }
            return;
          }
          for (const delivery of state.deliveries) {
            if (params[0] && delivery.id !== params[0]) continue;
            const staleAt = params[params.length - 1];
            if (
              values.status === "processing" &&
              delivery.status !== "pending" &&
              delivery.status !== "failed" &&
              (delivery.status !== "processing" ||
                typeof delivery.claimedAt !== "string" ||
                typeof staleAt !== "string" ||
                delivery.claimedAt >= staleAt)
            ) {
              continue;
            }
            if (
              values.status !== "processing" &&
              params[1] &&
              delivery.claimToken !== params[1]
            ) {
              continue;
            }
            Object.assign(delivery, values);
            if (
              values.status === "succeeded" &&
              delivery.destination === state.throwAfterDeliveryStatusWriteFor
            ) {
              state.throwAfterDeliveryStatusWriteFor = null;
              throw new Error("status write response lost");
            }
            return [{ id: delivery.id }];
          }
          return [];
        };
        return {
          where: (condition?: unknown) => {
            const result = {
              returning: async () => execute(condition),
              then: (
                onFulfilled: (value: unknown) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) =>
                Promise.resolve()
                  .then(() => execute(condition))
                  .then(onFulfilled, onRejected),
            };
            return result;
          },
        };
      },
    }),
    transaction: async (callback: (tx: any) => unknown) => callback(getDb()),
  });
  return { getDb, schema };
});

const { reconcileResponseDeliveries, submitForm } =
  await import("./submissions.js");

async function submit(body: unknown) {
  state.body = body;
  return (submitForm as unknown as (e: unknown) => Promise<unknown>)({});
}

describe("submitForm pageUrl pass-through", () => {
  beforeEach(() => {
    state.inserted.length = 0;
    state.responses.length = 0;
    state.deliveries.length = 0;
    state.headers = {};
    state.integrationOutcomes = [];
    state.throwAfterDeliveryStatusWriteFor = null;
    state.requestContexts.length = 0;
    state.session = null;
    publishedForm.status = "published";
    publishedForm.deletedAt = null;
    publishedForm.fields = JSON.stringify([
      { id: "msg", type: "textarea", label: "Feedback", required: false },
    ]);
    publishedForm.settings = JSON.stringify({});
    sendEmail.mockClear();
    fireIntegrations.mockReset();
    buildIntegrationDeliverySnapshots.mockReset();
    deliverIntegrationDelivery.mockReset();
    buildIntegrationDeliverySnapshots.mockImplementation(
      (
        integrations: Array<{
          id: string;
          type: string;
          name: string;
          enabled: boolean;
          url: string;
        }>,
        submission: unknown,
      ) =>
        integrations
          .filter((integration) => integration.enabled && integration.url)
          .map((integration) => ({
            ...integration,
            payload: submission,
          })),
    );
    deliverIntegrationDelivery.mockImplementation(async () => {
      if ((state.integrationOutcomes.shift() ?? "succeeded") === "failed") {
        throw new Error("integration unavailable");
      }
    });
    fireIntegrations.mockImplementation(
      async (
        integrations: Array<{ id: string; enabled: boolean; url: string }>,
        _submission: unknown,
        options?: {
          deliveryStatus?: Record<string, string>;
          onStatusChange?: (key: string, status: string) => Promise<void>;
        },
      ) => {
        for (const integration of integrations) {
          if (!integration.enabled || !integration.url) continue;
          await options?.onStatusChange?.(
            `integration:${integration.id}`,
            "succeeded",
          );
        }
        return options?.deliveryStatus ?? {};
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists UTM context while scrubbing sensitive page URL metadata", async () => {
    const res = await submit({
      data: { msg: "love it" },
      _meta: {
        pageUrl:
          "https://clips.agent-native.com/library?utm_source=slack&access_token=example-access-token&id_token=example-id-token&refresh_token=example-refresh-token&authorization=example-authorization&api_key=example-api-key&key=example-key&secret=example-secret&session=example-session&token=example-token&share_token=example-share-token",
        submitterEmail: "user@example.com",
        clientSurface: "tauri",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.pageUrl).toBe(
      "https://clips.agent-native.com/library?utm_source=slack&access_token=%3Credacted%3E&id_token=%3Credacted%3E&refresh_token=%3Credacted%3E&authorization=%3Credacted%3E&api_key=%3Credacted%3E&key=%3Credacted%3E&secret=%3Credacted%3E&session=%3Credacted%3E&token=%3Credacted%3E&share_token=%3Credacted%3E",
    );
    expect(state.inserted[0]!.submitterEmail).toBe("user@example.com");
    expect(state.inserted[0]!.clientSurface).toBe("tauri");
  });

  it("stores null when no page context is sent (direct fill)", async () => {
    const res = await submit({ data: { msg: "no page" } });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.pageUrl).toBeNull();
    expect(state.inserted[0]!.clientSurface).toBeNull();
  });

  it("replays an idempotent submission without inserting a duplicate response", async () => {
    state.headers["idempotency-key"] = "feedback-request-1";

    const first = await submit({ data: { msg: "same response" } });
    const second = await submit({ data: { msg: "same response" } });

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual(first);
    expect(state.inserted).toHaveLength(1);
    expect(state.responses).toHaveLength(1);
  });

  it("reconciles a failed delivery without another public submission", async () => {
    state.headers["idempotency-key"] = "feedback-request-independent";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
      ],
    });
    state.integrationOutcomes = ["failed", "succeeded"];

    const first = await submit({ data: { msg: "independent retry" } });
    const result = await reconcileResponseDeliveries(
      String(state.responses[0]!.id),
    );

    expect(first).toMatchObject({ retryable: true });
    expect(result).toEqual({
      success: true,
      retryable: false,
      id: state.responses[0]!.id,
    });
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(2);
  });

  it("renews a live delivery claim during a long provider call", async () => {
    vi.useFakeTimers();
    state.headers["idempotency-key"] = "feedback-request-lease";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
      ],
    });
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    deliverIntegrationDelivery.mockImplementationOnce(async () => {
      markStarted();
      await held;
    });

    const firstPromise = submit({ data: { msg: "long delivery" } });
    await started;
    await vi.advanceTimersByTimeAsync(60_001);

    const second = await submit({ data: { msg: "long delivery" } });

    expect(second).toMatchObject({
      error: "Response delivery is still pending",
      retryable: true,
    });
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(1);

    release();
    expect(await firstPromise).toMatchObject({ success: true });
  });

  it("keeps the aggregate delivery summary current across concurrent retries", async () => {
    state.headers["idempotency-key"] = "feedback-request-summary-race";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
        {
          id: "discord",
          type: "discord",
          name: "Discord",
          enabled: true,
          url: "https://example.com/discord",
        },
      ],
    });
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    deliverIntegrationDelivery.mockImplementation(async (snapshot) => {
      if ((snapshot as { id: string }).id === "slack") {
        markStarted();
        await held;
      }
    });

    const firstPromise = submit({ data: { msg: "summary race" } });
    await started;
    const second = await submit({ data: { msg: "summary race" } });

    expect(second).toMatchObject({ retryable: true });
    release();
    expect(await firstPromise).toMatchObject({ success: true });
    expect(JSON.parse(String(state.responses[0]!.deliveryStatus))).toEqual({
      "application-state": "succeeded",
      "integration:discord": "succeeded",
      "integration:slack": "succeeded",
    });
  });

  it("reconciles an idempotent response after its form is unpublished and archived", async () => {
    state.headers["idempotency-key"] = "feedback-request-lifecycle";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
      ],
    });
    state.integrationOutcomes = ["failed", "succeeded"];

    const first = await submit({ data: { msg: "lifecycle retry" } });
    publishedForm.status = "draft";
    publishedForm.deletedAt = "2026-08-28T00:00:00.000Z";
    const second = await submit({ data: { msg: "lifecycle retry" } });

    expect(first).toMatchObject({ retryable: true });
    expect(second).toMatchObject({ success: true });
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(2);
  });

  it("retries only incomplete destinations and reports partial delivery as retryable", async () => {
    state.headers["idempotency-key"] = "feedback-request-2";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
        {
          id: "discord",
          type: "discord",
          name: "Discord",
          enabled: true,
          url: "https://example.com/discord",
        },
      ],
    });
    state.integrationOutcomes = ["succeeded", "failed", "succeeded"];

    const first = await submit({ data: { msg: "partial delivery" } });
    expect(first).toMatchObject({
      error: "Response delivery is still pending",
      retryable: true,
    });
    expect(state.inserted).toHaveLength(1);
    expect(
      JSON.parse(String(state.responses[0]!.deliveryStatus)),
    ).toMatchObject({
      "application-state": "succeeded",
      "integration:slack": "succeeded",
      "integration:discord": "failed",
    });

    const second = await submit({ data: { msg: "partial delivery" } });
    expect(second).toMatchObject({ success: true });
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(3);
    expect(deliverIntegrationDelivery.mock.calls[2]?.[0].id).toBe("discord");
    expect(
      JSON.parse(String(state.responses[0]!.deliveryStatus)),
    ).toMatchObject({
      "integration:slack": "succeeded",
      "integration:discord": "succeeded",
    });
  });

  it("serializes concurrent retries for the same destination", async () => {
    state.headers["idempotency-key"] = "feedback-request-concurrent";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
      ],
    });
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    deliverIntegrationDelivery.mockImplementationOnce(async () => {
      markStarted();
      await held;
    });

    const firstPromise = submit({ data: { msg: "concurrent delivery" } });
    await started;
    const second = await submit({ data: { msg: "concurrent delivery" } });

    expect(second).toMatchObject({
      error: "Response delivery is still pending",
      retryable: true,
    });
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(1);

    release();
    expect(await firstPromise).toMatchObject({ success: true });
  });

  it("reconciles a status write that was applied before its response was lost", async () => {
    state.headers["idempotency-key"] = "feedback-request-reconcile";
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/slack",
        },
      ],
    });
    state.throwAfterDeliveryStatusWriteFor = "integration:slack";

    const first = await submit({ data: { msg: "reconcile delivery" } });
    const second = await submit({ data: { msg: "reconcile delivery" } });

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual(first);
    expect(deliverIntegrationDelivery).toHaveBeenCalledTimes(1);
    expect(
      state.deliveries.find(
        (delivery) => delivery.destination === "integration:slack",
      ),
    ).toMatchObject({
      destination: "integration:slack",
      status: "succeeded",
      claimToken: null,
    });
  });

  it("replays the original schema, integration destination, and payload", async () => {
    state.headers["idempotency-key"] = "feedback-request-snapshot";
    publishedForm.fields = JSON.stringify([
      {
        id: "msg",
        type: "textarea",
        label: "Original feedback",
        required: false,
      },
    ]);
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "slack",
          type: "slack",
          name: "Slack",
          enabled: true,
          url: "https://example.com/original-slack",
        },
      ],
    });
    state.integrationOutcomes = ["failed", "succeeded"];

    const first = await submit({ data: { msg: "immutable feedback" } });
    expect(first).toMatchObject({ retryable: true });

    publishedForm.fields = JSON.stringify([
      {
        id: "msg",
        type: "textarea",
        label: "Changed feedback",
        required: false,
      },
    ]);
    publishedForm.settings = JSON.stringify({
      integrations: [
        {
          id: "discord",
          type: "discord",
          name: "Discord",
          enabled: true,
          url: "https://example.com/changed-discord",
        },
      ],
    });

    const second = await submit({ data: { msg: "immutable feedback" } });
    const retriedSnapshot = deliverIntegrationDelivery.mock.calls[1]?.[0];

    expect(second).toMatchObject({ success: true });
    expect(retriedSnapshot).toMatchObject({
      id: "slack",
      url: "https://example.com/original-slack",
      payload: {
        fields: [expect.objectContaining({ label: "Original feedback" })],
      },
    });
    expect(retriedSnapshot?.payload).not.toEqual(
      expect.objectContaining({
        fields: [expect.objectContaining({ label: "Changed feedback" })],
      }),
    );
  });

  it("emails the form owner when new response emails are enabled", async () => {
    publishedForm.settings = JSON.stringify({ emailOnNewResponses: true });

    const res = await submit({ data: { msg: "Please call me" } });

    expect(res).toMatchObject({ success: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "New response: Agent-Native Feedback",
      }),
    );
    expect(state.requestContexts).toContainEqual({
      userEmail: "owner@example.com",
      orgId: undefined,
    });
    const emailArgs = sendEmail.mock.calls[0]?.[0] as
      | { text?: string }
      | undefined;
    expect(emailArgs?.text).toContain("Please call me");
  });

  it("does not email the owner by default", async () => {
    const res = await submit({ data: { msg: "No email please" } });

    expect(res).toMatchObject({ success: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the submission successful when email delivery fails", async () => {
    publishedForm.settings = JSON.stringify({ emailOnNewResponses: true });
    sendEmail.mockRejectedValueOnce(new Error("provider unavailable"));

    const res = await submit({ data: { msg: "Still saved" } });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
  });

  it("drops an unknown client surface to null", async () => {
    const res = await submit({
      data: { msg: "spoofed" },
      _meta: { clientSurface: "android-native" },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.clientSurface).toBeNull();
  });

  it("drops synthetic anonymous submitter emails forwarded in _meta", async () => {
    const res = await submit({
      data: { msg: "anonymous feedback" },
      _meta: {
        submitterEmail:
          "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBeNull();
  });

  it("drops synthetic anonymous submitter emails from the Forms session", async () => {
    state.session = {
      email: "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
    };

    const res = await submit({ data: { msg: "host session is anonymous" } });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBeNull();
  });

  it("strips values from hidden conditional fields before storing a response", async () => {
    publishedForm.fields = JSON.stringify([
      {
        id: "event_type",
        type: "radio",
        label: "Event type",
        options: ["Virtual", "Physical"],
        required: true,
      },
      {
        id: "venue",
        type: "text",
        label: "Venue",
        required: true,
        conditional: {
          fieldId: "event_type",
          operator: "equals",
          value: "Physical",
        },
      },
    ]);

    const res = await submit({
      data: { event_type: "Virtual", venue: "Sensitive venue detail" },
    });

    expect(res).toMatchObject({ success: true });
    expect(JSON.parse(String(state.inserted[0]!.data))).toEqual({
      event_type: "Virtual",
    });
  });

  it("falls back to a real metadata email when the Forms session is anonymous", async () => {
    state.session = {
      email: "anon-ee79aaee-98e2-452a-9476-5205713803c0@agent-native.com",
    };

    const res = await submit({
      data: { msg: "cross-app feedback" },
      _meta: { submitterEmail: "real-user@example.com" },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.submitterEmail).toBe("real-user@example.com");
  });

  it("suppresses identity, IP, and source metadata in strict anonymous mode", async () => {
    publishedForm.settings = JSON.stringify({ anonymous: true });
    state.session = { email: "signed-in@example.com" };

    const res = await submit({
      data: { msg: "private feedback" },
      _meta: {
        submitterEmail: "metadata@example.com",
        chatSessionId: "chat-sensitive",
        activeRunId: "run-sensitive",
        pageUrl: "https://example.test/account/private",
        clientSurface: "web",
      },
    });

    expect(res).toMatchObject({ success: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      ip: null,
      submitterEmail: null,
      pageUrl: null,
      clientSurface: null,
    });
  });
});
