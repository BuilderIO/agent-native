import { afterEach, describe, expect, it, vi } from "vitest";

import { slackAdapter } from "./slack.js";

const originalNodeEnv = process.env.NODE_ENV;

describe("slackAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_ALLOWED_TEAM_IDS;
    delete process.env.SLACK_ALLOWED_API_APP_IDS;
  });

  it("answers Slack URL verification with the raw challenge string", async () => {
    const adapter = slackAdapter();
    const event = {
      context: {
        __rawBody: JSON.stringify({
          type: "url_verification",
          challenge: "qa-challenge",
        }),
      },
    } as any;

    await expect(adapter.handleVerification(event)).resolves.toEqual({
      handled: true,
      response: "qa-challenge",
    });
  });

  it("hydrates a verified Slack sender identity before the agent runs", async () => {
    const adapter = slackAdapter({
      resolveBotToken: async () => "xoxb-example-not-real",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              user: {
                name: "alice",
                real_name: "Alice Example",
                profile: {
                  email: "alice@example.test",
                  real_name: "Alice Example",
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      adapter.hydrateIncomingIdentity?.({
        platform: "slack",
        externalThreadId: "A123:T123:D123:1.2",
        text: "hello",
        senderId: "U123",
        tenantId: "T123",
        conversationType: "dm",
        platformContext: { teamId: "T123" },
        timestamp: Date.now(),
      }),
    ).resolves.toMatchObject({
      senderEmail: "alice@example.test",
      senderName: "Alice Example",
      senderVerified: true,
      actorTrust: { memberType: "member", verified: true },
    });
  });

  it("re-attempts identity lookup shortly after a failed users.info call", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error("transient slack blip");
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = slackAdapter({
      resolveBotToken: async () => "xoxb-example-not-real",
    });

    await expect(
      adapter.hydrateIncomingIdentity?.({
        platform: "slack",
        externalThreadId: "A777:T777:D777:1.2",
        text: "hello",
        senderId: "U777",
        tenantId: "T777",
        conversationType: "dm",
        platformContext: { teamId: "T777" },
        timestamp: Date.now(),
      }),
    ).resolves.toMatchObject({
      senderVerified: false,
      actorTrust: { memberType: "unknown", verified: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Immediately after the failure, the short negative cache absorbs retries.
    await adapter.hydrateIncomingIdentity?.({
      platform: "slack",
      externalThreadId: "A777:T777:D777:1.2",
      text: "hello again",
      senderId: "U777",
      tenantId: "T777",
      conversationType: "dm",
      platformContext: { teamId: "T777" },
      timestamp: Date.now(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Well before the 10-minute positive TTL, the lookup is re-attempted, so
    // a transient users.info blip cannot fail-close this sender's identity.
    vi.setSystemTime(Date.now() + 31_000);
    await adapter.hydrateIncomingIdentity?.({
      platform: "slack",
      externalThreadId: "A777:T777:D777:1.2",
      text: "hello once more",
      senderId: "U777",
      tenantId: "T777",
      conversationType: "dm",
      platformContext: { teamId: "T777" },
      timestamp: Date.now(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves a previously verified sender when later identity hydration fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("transient second-stage users.info failure");
      }),
    );
    const adapter = slackAdapter({
      resolveBotToken: async () => "xoxb-example-not-real",
    });
    const verifiedIncoming = {
      platform: "slack" as const,
      externalThreadId: "A778:T778:D778:1.2",
      text: "hello",
      senderId: "U778",
      senderEmail: "verified@example.test",
      senderVerified: true,
      actorTrust: { memberType: "member" as const, verified: true },
      tenantId: "T778",
      conversationType: "dm" as const,
      platformContext: { teamId: "T778" },
      timestamp: Date.now(),
    };

    await expect(
      adapter.hydrateIncomingIdentity?.(verifiedIncoming),
    ).resolves.toEqual(verifiedIncoming);
  });

  it("rejects system notice delivery when no Slack bot token can be resolved", async () => {
    const adapter = slackAdapter({
      resolveBotToken: async () => undefined,
    });

    await expect(
      adapter.sendSystemNotice?.(
        {
          platform: "slack",
          externalThreadId: "A123:T123:D123:1.2",
          text: "",
          senderId: "U123",
          tenantId: "T123",
          conversationType: "dm",
          platformContext: { teamId: "T123", channelId: "D123" },
          timestamp: Date.now(),
        },
        "Please reconnect Slack.",
        { dedupeKey: "missing-token" },
      ),
    ).rejects.toThrow("Slack bot token not configured for system notice");
  });

  it("maps Slack Connect strangers to external member trust", async () => {
    const adapter = slackAdapter({
      resolveBotToken: async () => "xoxb-example-not-real",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              user: {
                name: "connect-stranger",
                is_stranger: true,
                profile: {
                  email: "stranger@partner.test",
                  real_name: "Connect Stranger",
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      adapter.hydrateIncomingIdentity?.({
        platform: "slack",
        externalThreadId: "A888:T888:D888:1.2",
        text: "hello",
        senderId: "U888",
        tenantId: "T888",
        conversationType: "dm",
        platformContext: { teamId: "T888" },
        timestamp: Date.now(),
      }),
    ).resolves.toMatchObject({
      actorTrust: { memberType: "external", verified: true },
    });
  });

  it("does not bold-wrap bare URLs", () => {
    const formatted = slackAdapter().formatAgentResponse(
      "**https://slides.agent-native.com/deck/deck-qa**",
    );

    expect(formatted.text).toBe(
      "<https://slides.agent-native.com/deck/deck-qa>",
    );
  });

  it("rejects Slack events in production when the team allowlist is missing", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      slackAdapter().parseIncomingMessage(slackEvent({ team_id: "T999" })),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "Slack workspace is not connected",
    });
  });

  it("rejects Slack events in production when the team allowlist is empty", async () => {
    process.env.NODE_ENV = "production";
    process.env.SLACK_ALLOWED_TEAM_IDS = " , ";

    await expect(
      slackAdapter().parseIncomingMessage(slackEvent({ team_id: "T999" })),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "Slack workspace is not connected",
    });
  });

  it("keeps accepting Slack events without a team allowlist outside production", async () => {
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const parsed = await slackAdapter().parseIncomingMessage(
      slackEvent({ team_id: "T999" }),
    );

    expect(parsed).toMatchObject({
      platform: "slack",
      externalThreadId: "A123:T999:C123:123.456",
      text: "ship it",
      senderId: "U123",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("SLACK_ALLOWED_TEAM_IDS not set"),
    );
  });

  it("uses workspace and app ids in the canonical thread key", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await slackAdapter().parseIncomingMessage(
      slackEvent({ team_id: "T111", api_app_id: "A111" }),
    );
    const second = await slackAdapter().parseIncomingMessage(
      slackEvent({ team_id: "T222", api_app_id: "A111" }),
    );

    expect(first?.externalThreadId).toBe("A111:T111:C123:123.456");
    expect(second?.externalThreadId).toBe("A111:T222:C123:123.456");
    expect(first?.externalThreadId).not.toBe(second?.externalThreadId);
  });

  it("ignores ambient channel messages and inactive thread replies", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const isThreadActive = vi.fn(async () => false);
    const adapter = slackAdapter({ isThreadActive });

    await expect(
      adapter.parseIncomingMessage(
        slackEvent({
          event: {
            type: "message",
            channel: "C123",
            channel_type: "channel",
            user: "U123",
            text: "ambient chatter",
            ts: "123.456",
          },
        }),
      ),
    ).resolves.toBeNull();
    expect(isThreadActive).not.toHaveBeenCalled();

    await expect(
      adapter.parseIncomingMessage(
        slackEvent({
          event: {
            type: "message",
            channel: "C123",
            channel_type: "channel",
            user: "U123",
            text: "steer the active task",
            thread_ts: "111.222",
            ts: "123.456",
          },
        }),
      ),
    ).resolves.toBeNull();
    expect(isThreadActive).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: "A123:T123:C123:111.222",
        triggerKind: "thread_reply",
      }),
    );
  });

  it("accepts ordinary replies only for an active workspace-qualified thread", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const isThreadActive = vi.fn(async () => true);

    const parsed = await slackAdapter({ isThreadActive }).parseIncomingMessage(
      slackEvent({
        event: {
          type: "message",
          channel: "C123",
          channel_type: "channel",
          user: "U123",
          text: "change the output format",
          thread_ts: "111.222",
          ts: "123.456",
        },
      }),
    );

    expect(parsed).toMatchObject({
      externalThreadId: "A123:T123:C123:111.222",
      text: "change the output format",
      triggerKind: "thread_reply",
      threadRef: "111.222",
      replyRef: "123.456",
    });
  });

  it("accepts one scoped clarification reply without opening ambient channel intake", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const isThreadActive = vi.fn(async () => false);
    const consumeAwaitingInput = vi.fn(async () => true);
    const adapter = slackAdapter({ isThreadActive, consumeAwaitingInput });

    await expect(
      adapter.parseIncomingMessage(
        slackEvent({
          event: {
            type: "message",
            channel: "C123",
            channel_type: "channel",
            user: "U123",
            text: "ambient chatter",
            ts: "123.456",
          },
        }),
      ),
    ).resolves.toBeNull();
    expect(consumeAwaitingInput).not.toHaveBeenCalled();

    const parsed = await adapter.parseIncomingMessage(
      slackEvent({
        event: {
          type: "message",
          channel: "C123",
          channel_type: "channel",
          user: "U123",
          text: "New prospects",
          thread_ts: "111.222",
          ts: "123.456",
        },
      }),
    );

    expect(parsed).toMatchObject({
      externalThreadId: "A123:T123:C123:111.222",
      text: "New prospects",
      triggerKind: "thread_reply",
    });
    expect(consumeAwaitingInput).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: "A123:T123:C123:111.222",
        senderId: "U123",
      }),
    );
  });

  it("accepts Agent View direct messages and preserves same-workspace app context", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const parsed = await slackAdapter().parseIncomingMessage(
      slackEvent({
        event: {
          type: "message",
          channel: "D123",
          channel_type: "im",
          user: "U123",
          text: "summarize what I am viewing",
          ts: "123.456",
          app_context: {
            entities: [
              {
                type: "slack#/types/channel_id",
                value: "C999",
                team_id: "T123",
              },
              {
                type: "slack#/types/channel_id",
                value: "COTHER",
                team_id: "T999",
              },
            ],
          },
        },
      }),
    );

    expect(parsed).toMatchObject({
      externalThreadId: "A123:T123:D123:123.456",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        activeContextChannelId: "C999",
        agentContext: [
          {
            type: "slack#/types/channel_id",
            value: "C999",
            teamId: "T123",
          },
        ],
      },
    });
  });

  it("preserves Slack's canonical permalink for the source thread", async () => {
    process.env.NODE_ENV = "development";
    process.env.SLACK_BOT_TOKEN = "slack-token-example";
    process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const parsed = new URL(String(url));
        expect(parsed.pathname).toBe("/api/chat.getPermalink");
        expect(parsed.searchParams.get("channel")).toBe("C123");
        expect(parsed.searchParams.get("message_ts")).toBe("111.222");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              permalink:
                "https://example-workspace.slack.com/archives/C123/p111222?thread_ts=111.222&cid=C123",
            }),
          ),
        );
      }),
    );

    const parsed = await slackAdapter().parseIncomingMessage(
      slackEvent({
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> add this design ask",
          thread_ts: "111.222",
          ts: "123.456",
        },
      }),
    );

    expect(parsed?.sourceUrl).toBe(
      "https://example-workspace.slack.com/archives/C123/p111222?thread_ts=111.222&cid=C123",
    );
    expect(parsed?.platformContext.threadPermalink).toBe(parsed?.sourceUrl);
  });

  it("ignores non-Slack permalink responses", async () => {
    process.env.NODE_ENV = "development";
    process.env.SLACK_BOT_TOKEN = "slack-token-example";
    process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              permalink: "https://example.invalid/archives/C123/p123456",
            }),
          ),
      ),
    );

    const parsed = await slackAdapter().parseIncomingMessage(slackEvent());

    expect(parsed?.sourceUrl).toBeUndefined();
    expect(parsed?.platformContext.threadPermalink).toBeUndefined();
  });

  it("uses the exact managed installation token instead of the legacy env token", async () => {
    process.env.NODE_ENV = "development";
    process.env.SLACK_BOT_TOKEN = "legacy-token";
    process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
    const resolveBotToken = vi.fn(async () => "managed-token");
    const authorizations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization) authorizations.push(authorization);
        return new Response(JSON.stringify({ ok: true }));
      }),
    );

    const parsed = await slackAdapter({ resolveBotToken }).parseIncomingMessage(
      slackEvent(),
    );
    await slackAdapter({ resolveBotToken }).sendResponse(
      { text: "done", platformContext: {} },
      parsed!,
    );

    expect(resolveBotToken).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "T123" }),
    );
    expect(authorizations).toContain("Bearer managed-token");
    expect(authorizations).not.toContain("Bearer legacy-token");
  });

  it("hydrates bounded thread context, reactions, file references, and trust", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        calls.push(parsed);
        if (parsed.pathname.endsWith("/conversations.replies")) {
          return new Response(
            JSON.stringify({
              ok: true,
              messages: Array.from({ length: 20 }, (_, index) => ({
                user: `U${index}`,
                text: `${index}:${"x".repeat(2_100)}`,
                ts: `${100 + index}.000`,
                reactions: [{ name: "eyes", count: index + 1 }],
                files:
                  index === 19
                    ? [
                        {
                          id: "F123",
                          name: "brief.pdf",
                          mimetype: "application/pdf",
                          size: 42,
                          permalink: "https://example.slack.com/files/F123",
                          url_private_download:
                            "https://files.slack.com/files-pri/F123/download",
                        },
                      ]
                    : [],
              })),
            }),
          );
        }
        if (parsed.pathname.endsWith("/conversations.info")) {
          return new Response(
            JSON.stringify({
              ok: true,
              channel: {
                name: "launch-room",
                is_private: true,
                is_ext_shared: true,
              },
            }),
          );
        }
        if (parsed.pathname.endsWith("/users.info")) {
          return new Response(
            JSON.stringify({
              ok: true,
              user: {
                is_restricted: true,
                profile: {
                  display_name: "Workspace guest",
                  email: "guest@example.com",
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify({ ok: false }));
      }),
    );
    const adapter = slackAdapter({
      resolveBotToken: async () => "managed-token",
    });

    const hydrated = await adapter.hydrateIncomingMessage?.({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "summarize",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "111.222" },
    });

    const repliesCall = calls.find((call) =>
      call.pathname.endsWith("/conversations.replies"),
    );
    expect(repliesCall?.searchParams.get("limit")).toBe("15");
    expect(hydrated).toMatchObject({
      senderName: "Workspace guest",
      senderEmail: "guest@example.com",
      senderVerified: true,
      conversationType: "private_channel",
      actorTrust: { memberType: "guest", verified: true },
      platformContext: {
        channelName: "launch-room",
        isExternalShared: true,
      },
    });
    expect(hydrated?.contextMessages).toHaveLength(15);
    expect(hydrated?.contextMessages?.[0].text.startsWith("5:")).toBe(true);
    expect(hydrated?.contextMessages?.[0].text).toHaveLength(2_000);
    expect(hydrated?.contextMessages?.at(-1)).toMatchObject({
      reactions: [{ name: "eyes", count: 20 }],
      files: [
        {
          id: "F123",
          name: "brief.pdf",
          mimetype: "application/pdf",
          size: 42,
        },
      ],
    });
    expect(hydrated?.files).toEqual([
      expect.objectContaining({ id: "F123", name: "brief.pdf" }),
    ]);
  });

  it("verifies Agent View channel access before hydrating its context into a DM", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        const method = parsed.pathname.split("/").at(-1)!;
        const channel = parsed.searchParams.get("channel");
        calls.push(`${method}:${channel ?? ""}`);
        if (method === "conversations.info" && channel === "D123") {
          return new Response(
            JSON.stringify({ ok: true, channel: { is_im: true } }),
          );
        }
        if (method === "conversations.info" && channel === "C999") {
          return new Response(
            JSON.stringify({ ok: true, channel: { name: "launch-room" } }),
          );
        }
        if (method === "conversations.history" && channel === "C999") {
          return new Response(
            JSON.stringify({
              ok: true,
              messages: [
                { user: "U456", text: "Launch is Friday", ts: "120.000" },
              ],
            }),
          );
        }
        return new Response(JSON.stringify({ ok: false }));
      }),
    );

    const hydrated = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).hydrateIncomingMessage?.({
      platform: "slack",
      externalThreadId: "A123:T123:D123:123.456",
      text: "summarize this",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: {
        channelId: "D123",
        threadTs: "123.456",
        activeContextChannelId: "C999",
      },
    });

    expect(calls.indexOf("conversations.info:C999")).toBeLessThan(
      calls.indexOf("conversations.history:C999"),
    );
    expect(hydrated).toMatchObject({
      conversationType: "dm",
      platformContext: {
        activeContextChannelId: "C999",
        activeContextChannelName: "launch-room",
      },
      contextMessages: [
        expect.objectContaining({
          text: "[Active Slack context #launch-room] Launch is Friday",
        }),
      ],
    });
  });

  it("streams native Slack task progress and stops with the final answer", async () => {
    vi.useFakeTimers();
    const requests: Array<{ method: string; body: Record<string, any> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = new URL(url).pathname.split("/").at(-1)!;
        requests.push({
          method,
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return new Response(
          JSON.stringify(
            method === "chat.startStream"
              ? { ok: true, ts: "999.000" }
              : { ok: true },
          ),
        );
      }),
    );
    const adapter = slackAdapter({
      resolveBotToken: async () => "managed-token",
    });
    const progress = await adapter.startRunProgress?.({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "build it",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "111.222" },
    });

    expect(progress).not.toBeNull();
    expect(progress?.ref).toEqual({
      kind: "slack-stream",
      streamTs: "999.000",
    });
    await progress?.onEvent({
      type: "tool_start",
      tool: "create-report",
      id: "call-1",
      input: {},
    } as any);
    await vi.advanceTimersByTimeAsync(1_000);
    await progress?.onEvent({
      type: "tool_done",
      tool: "create-report",
      id: "call-1",
      result: "ok",
    } as any);
    await vi.advanceTimersByTimeAsync(1_000);
    await progress?.complete({
      text: "Report complete.",
      platformContext: {},
    });

    expect(requests[0]).toMatchObject({
      method: "chat.startStream",
      body: {
        channel: "C123",
        thread_ts: "111.222",
        task_display_mode: "plan",
        markdown_text: "I’m looking into this for you.",
        chunks: [
          {
            type: "plan_update",
            title: "I’m looking into this for you",
          },
          {
            type: "task_update",
            id: "agent-native:context",
            title: "Review the request",
            status: "in_progress",
            details: "Finding the information needed for an answer",
          },
        ],
      },
    });
    expect(
      requests.filter((request) => request.method === "chat.appendStream"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({
            chunks: [
              expect.objectContaining({
                type: "task_update",
                status: "in_progress",
              }),
            ],
          }),
        }),
        expect.objectContaining({
          body: expect.objectContaining({
            chunks: [
              expect.objectContaining({
                type: "task_update",
                status: "complete",
              }),
            ],
          }),
        }),
      ]),
    );
    expect(
      requests.find((request) => request.method === "chat.stopStream"),
    ).toMatchObject({
      method: "chat.stopStream",
      body: {
        channel: "C123",
        ts: "999.000",
        markdown_text: "Report complete.",
      },
    });
  });

  it("resumes a Slack stream without starting a second task card", async () => {
    const requests: Array<{ method: string; body: Record<string, any> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({
          method: new URL(url).pathname.split("/").at(-1)!,
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return new Response(JSON.stringify({ ok: true }));
      }),
    );
    const progress = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).resumeRunProgress?.(
      {
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        text: "build it",
        senderId: "U123",
        tenantId: "T123",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "111.222" },
      },
      { kind: "slack-stream", streamTs: "999.003" },
    );

    await progress?.onEvent({
      type: "agent_call_progress",
      agent: "Design",
      state: "working",
      elapsedSeconds: 20,
      detail: "Continuing in the background",
    });
    await progress?.onEvent({
      type: "agent_call",
      agent: "Design",
      status: "done",
    });
    await progress?.complete({
      text: "Created the Design Ask.",
      platformContext: {},
    });

    expect(progress?.ref).toEqual({
      kind: "slack-stream",
      streamTs: "999.003",
    });
    expect(
      requests.find((request) => request.method === "chat.startStream"),
    ).toBeUndefined();
    expect(
      requests.filter((request) => request.method === "chat.appendStream"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({
            ts: "999.003",
            chunks: [
              expect.objectContaining({
                type: "task_update",
                title: "Contact Design",
                status: "in_progress",
              }),
            ],
          }),
        }),
      ]),
    );
    expect(
      requests.find((request) => request.method === "chat.stopStream"),
    ).toMatchObject({
      body: expect.objectContaining({ ts: "999.003" }),
    });
  });

  it("does not resume an invalid Slack progress reference", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const progress = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).resumeRunProgress?.(
      {
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "111.222" },
      },
      { kind: "not-slack", streamTs: "999.003" },
    );

    expect(progress).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a safe diagnostic when Slack rejects starting a native stream", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "missing_scope" })),
      ),
    );

    const progress = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).startRunProgress?.({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "build it",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "111.222" },
    });

    expect(progress).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[slack] chat.startStream failed; using standard reply",
      {
        errorCode: "missing_scope",
        hasRecipientTeam: true,
        hasRecipientUser: true,
        isDirectMessage: false,
      },
    );
  });

  it("records a safe diagnostic when a native stream progress append fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const method = new URL(url).pathname.split("/").at(-1)!;
        if (method === "chat.startStream") {
          return new Response(JSON.stringify({ ok: true, ts: "999.002" }));
        }
        if (method === "chat.appendStream") {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_arguments" }),
          );
        }
        return new Response(JSON.stringify({ ok: true }));
      }),
    );
    const progress = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).startRunProgress?.({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "build it",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "111.222" },
    });

    await progress?.onEvent({
      type: "tool_start",
      tool: "create-report",
      id: "call-1",
      input: {},
    } as any);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(warn).toHaveBeenCalledWith(
      "[slack] chat.appendStream failed; progress may be stale",
      { chunkType: "task_update", errorCode: "invalid_arguments" },
    );
  });

  it("keeps one Slack task card updated with downstream A2A progress", async () => {
    vi.useFakeTimers();
    const requests: Array<{ method: string; body: Record<string, any> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = new URL(url).pathname.split("/").at(-1)!;
        requests.push({
          method,
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return new Response(
          JSON.stringify(
            method === "chat.startStream"
              ? { ok: true, ts: "999.001" }
              : { ok: true },
          ),
        );
      }),
    );
    const progress = await slackAdapter({
      resolveBotToken: async () => "managed-token",
    }).startRunProgress?.({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "analyze launch performance",
      senderId: "U123",
      tenantId: "T123",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "111.222" },
    });

    await progress?.onEvent({
      type: "agent_call",
      agent: "Analytics",
      status: "start",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await progress?.onEvent({
      type: "agent_call_progress",
      agent: "Analytics",
      state: "working",
      elapsedSeconds: 30,
      detail: "Joining HubSpot and BigQuery data",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await progress?.onEvent({
      type: "agent_call",
      agent: "Analytics",
      status: "done",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await progress?.complete({ text: "Report complete.", platformContext: {} });

    const agentUpdates = requests
      .filter((request) => request.method === "chat.appendStream")
      .flatMap((request) => request.body.chunks ?? [])
      .filter(
        (chunk) =>
          chunk.type === "task_update" && chunk.title === "Contact Analytics",
      );

    expect(agentUpdates).toHaveLength(3);
    expect(new Set(agentUpdates.map((chunk) => chunk.id))).toEqual(
      new Set([agentUpdates[0]?.id]),
    );
    expect(agentUpdates.map((chunk) => chunk.status)).toEqual([
      "in_progress",
      "in_progress",
      "complete",
    ]);
    expect(agentUpdates[0]).toMatchObject({
      details: "I’m contacting Analytics for an answer.",
    });
    expect(agentUpdates[1]).toMatchObject({
      details:
        "Working · 30s — Joining HubSpot and BigQuery data. This is taking longer than usual, but Analytics is still working. I’ll post the result here.",
    });
  });

  it("aborts hung Slack delivery requests", async () => {
    vi.useFakeTimers();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    let deliverySignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("assistant.threads.setStatus")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }
        deliverySignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            resolve(new Response(JSON.stringify({ ok: true })));
          });
        });
      }),
    );

    const delivery = slackAdapter().sendResponse(
      { text: "done", platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "make a deck",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await delivery;

    expect(deliverySignal?.aborted).toBe(true);
  });

  it("keeps generated Slack section blocks within Block Kit limits", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      { text: "a".repeat(3605), platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask starter",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    const sectionBlocks = deliveryBodies[0].blocks.filter(
      (block: any) => block.type === "section",
    );
    expect(sectionBlocks).toHaveLength(2);
    expect(
      sectionBlocks.every((block: any) => block.text.text.length <= 3000),
    ).toBe(true);
  });

  it("does not send whitespace-only Slack replies", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        deliveryUrls.push(String(url));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      { text: " \n\t ", platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask starter",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    expect(
      deliveryUrls.some(
        (url) =>
          url.includes("chat.postMessage") || url.includes("chat.update"),
      ),
    ).toBe(false);
  });

  it("drops blank Slack chunks and still sends non-empty content", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      {
        text: `${" ".repeat(4001)}Deck: https://example.com/decks/qa`,
        platformContext: {},
      },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask slides",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    expect(deliveryBodies).toHaveLength(1);
    expect(deliveryBodies[0].text).toBe("Deck: https://example.com/decks/qa");
  });

  it("does not send whitespace-only proactive Slack messages", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        deliveryUrls.push(String(url));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendMessageToTarget?.(
      { text: "\n\n ", platformContext: {} },
      { platform: "slack", destination: "C123" },
    );

    expect(deliveryUrls.some((url) => url.includes("chat.postMessage"))).toBe(
      false,
    );
  });

  it("keeps block-rich Slack replies when fallback text is blank", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Deck is ready." },
      },
    ];

    await slackAdapter().sendResponse(
      {
        text: " ",
        platformContext: { blocks },
      },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask slides",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    expect(deliveryBodies).toHaveLength(1);
    expect(deliveryBodies[0].text).toBe("Response");
    expect(deliveryBodies[0].blocks).toEqual(blocks);
  });

  it("splits Slack section blocks by UTF-8 bytes, not JS character length", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const deliveryBodies: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("chat.postMessage")) {
          deliveryBodies.push(JSON.parse(String(init?.body ?? "{}")));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }),
    );

    await slackAdapter().sendResponse(
      { text: `${"a".repeat(2994)}🗄️`, platformContext: {} },
      {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "ask starter",
        timestamp: 1,
        platformContext: { channelId: "C123", threadTs: "123.456" },
      },
    );

    const sectionBlocks = deliveryBodies[0].blocks.filter(
      (block: any) => block.type === "section",
    );
    expect(sectionBlocks.length).toBeGreaterThan(1);
    expect(
      sectionBlocks.every(
        (block: any) => Buffer.byteLength(block.text.text, "utf8") <= 3000,
      ),
    ).toBe(true);
  });
});

function slackEvent(overrides: Record<string, unknown> = {}) {
  return {
    context: {
      __rawBody: JSON.stringify({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event_id: "Ev123",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> ship it",
          ts: "123.456",
        },
        ...overrides,
      }),
    },
  } as any;
}
