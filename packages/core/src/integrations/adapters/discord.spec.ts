import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";

const headers = vi.hoisted(() => new Map<string, string>());

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    getHeader: vi.fn((_event: unknown, name: string) =>
      headers.get(name.toLowerCase()),
    ),
    readRawBody: vi.fn(async (event: any) => event.context.__rawBody),
  };
});

import {
  assertPlatformCapability,
  UnsupportedPlatformCapabilityError,
} from "../types.js";
import { discordAdapter } from "./discord.js";

function eventWithRaw(raw: string): any {
  return { context: { __rawBody: raw } };
}

function commandInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "interaction-example",
    application_id: "application-example",
    type: 2,
    token: "interaction-token-example",
    guild_id: "guild-example",
    channel_id: "channel-example",
    member: {
      nick: "Example User",
      user: { id: "user-example", username: "example-user" },
    },
    data: {
      type: 1,
      name: "agent",
      options: [{ name: "prompt", type: 3, value: "Summarize this" }],
    },
    authorizing_integration_owners: { "0": "guild-example" },
    ...overrides,
  };
}

afterEach(() => {
  headers.clear();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("discordAdapter", () => {
  it("verifies Ed25519 signatures over the timestamp plus exact raw body", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-14T22:13:20.000Z"));
    const keyPair = nacl.sign.keyPair();
    const raw = JSON.stringify(commandInteraction());
    const timestamp = "1700000000";
    const signature = nacl.sign.detached(
      new TextEncoder().encode(timestamp + raw),
      keyPair.secretKey,
    );
    vi.stubEnv("DISCORD_APPLICATION_ID", "application-example");
    vi.stubEnv(
      "DISCORD_PUBLIC_KEY",
      Buffer.from(keyPair.publicKey).toString("hex"),
    );
    headers.set("x-signature-timestamp", timestamp);
    headers.set("x-signature-ed25519", Buffer.from(signature).toString("hex"));

    await expect(
      discordAdapter().verifyWebhook(eventWithRaw(raw)),
    ).resolves.toBe(true);

    headers.set("x-signature-ed25519", "00".repeat(64));
    await expect(
      discordAdapter().verifyWebhook(eventWithRaw(raw)),
    ).resolves.toBe(false);
  });

  it("rejects correctly signed requests outside the five-minute timestamp window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T14:00:00.000Z"));
    const keyPair = nacl.sign.keyPair();
    const raw = JSON.stringify(commandInteraction());
    vi.stubEnv("DISCORD_APPLICATION_ID", "application-example");
    vi.stubEnv(
      "DISCORD_PUBLIC_KEY",
      Buffer.from(keyPair.publicKey).toString("hex"),
    );

    for (const timestamp of [
      String(Math.floor(Date.now() / 1000) - 301),
      String(Math.floor(Date.now() / 1000) + 301),
    ]) {
      const signature = nacl.sign.detached(
        new TextEncoder().encode(timestamp + raw),
        keyPair.secretKey,
      );
      headers.set("x-signature-timestamp", timestamp);
      headers.set(
        "x-signature-ed25519",
        Buffer.from(signature).toString("hex"),
      );

      await expect(
        discordAdapter().verifyWebhook(eventWithRaw(raw)),
      ).resolves.toBe(false);
    }
  });

  it("acknowledges signed endpoint PINGs with PONG", async () => {
    const raw = JSON.stringify(
      commandInteraction({ type: 1, token: undefined, data: undefined }),
    );
    await expect(
      discordAdapter().handleVerification(eventWithRaw(raw)),
    ).resolves.toEqual({ handled: true, response: { type: 1 } });
  });

  it("normalizes slash commands without putting the response token in durable context", async () => {
    const incoming = await discordAdapter().parseIncomingMessage(
      eventWithRaw(JSON.stringify(commandInteraction())),
    );

    expect(incoming).toMatchObject({
      platform: "discord",
      externalThreadId:
        "app:application-example:guild:guild-example:channel:channel-example",
      text: "Summarize this",
      senderId: "user-example",
      senderName: "Example User",
      platformContext: {
        applicationId: "application-example",
        interactionId: "interaction-example",
        commandName: "agent",
      },
      responseContext: {
        interactionToken: "interaction-token-example",
      },
    });
    expect(incoming?.platformContext).not.toHaveProperty("interactionToken");
    expect(discordAdapter().getImmediateWebhookResponse?.(incoming!)).toEqual({
      status: 200,
      body: {
        type: 5,
        data: { allowed_mentions: { parse: [] } },
      },
    });
  });

  it("edits the deferred response and suppresses mentions", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }),
    );
    const incoming = await discordAdapter().parseIncomingMessage(
      eventWithRaw(JSON.stringify(commandInteraction())),
    );

    await discordAdapter().sendResponse(
      { text: "Done", platformContext: {} },
      incoming!,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://discord.com/api/v10/webhooks/application-example/interaction-token-example/messages/@original",
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      content: "Done",
      allowed_mentions: { parse: [] },
    });
  });

  it("reports proactive messaging as unsupported", () => {
    expect(() =>
      assertPlatformCapability(discordAdapter(), "proactiveMessages"),
    ).toThrow(UnsupportedPlatformCapabilityError);
  });
});
