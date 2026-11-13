import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createEmbedSessionTicket = vi.hoisted(() => vi.fn());
const consumeOneTimeJti = vi.hoisted(() => vi.fn());

vi.mock("./embed-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embed-session.js")>()),
  createEmbedSessionTicket: (...a: any[]) => createEmbedSessionTicket(...a),
}));
vi.mock("./identity-sso-store.js", () => ({
  consumeOneTimeJti: (...a: any[]) => consumeOneTimeJti(...a),
}));
vi.mock("./embed-request-origin.js", () => ({
  resolveEmbedRequestOrigin: () => "https://labs.test",
}));

import { signA2AToken } from "../a2a/client.js";
import {
  createEmbedHandoffStartUrl,
  EMBED_HANDOFF_QUERY_PARAM,
  embedTicketFromHandoff,
} from "./embed-handoff.js";

const event = {} as any;
const MAIL_URL = "https://labs.test/mail-2";
const MAIL_START = "https://labs.test/mail-2/_agent-native/embed/start";

async function mintHandoff(targetAppUrl = MAIL_URL): Promise<string> {
  const started = await createEmbedHandoffStartUrl({
    targetAppUrl,
    targetPath: "/inbox?__an_mcp_chat_bridge=1",
    ownerEmail: "owner@example.com",
    chrome: "minimal",
  });
  expect(started).not.toBeNull();
  return new URL(started!.startUrl).searchParams.get(
    EMBED_HANDOFF_QUERY_PARAM,
  )!;
}

describe("embed handoff between workspace apps", () => {
  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", "workspace-secret");
    vi.stubEnv("APP_BASE_PATH", "/mail-2");
    createEmbedSessionTicket.mockReset();
    createEmbedSessionTicket.mockResolvedValue({
      ticket: "local-ticket",
      ticketHash: "hash",
      expiresAt: 1,
    });
    consumeOneTimeJti.mockReset();
    consumeOneTimeJti.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("addresses the start URL to the target app's embed start route", async () => {
    const started = await createEmbedHandoffStartUrl({
      targetAppUrl: `${MAIL_URL}/`,
      targetPath: "/inbox",
      ownerEmail: "owner@example.com",
    });
    expect(started?.startUrl.split("?")[0]).toBe(MAIL_START);
  });

  it("exchanges a fresh handoff for a local ticket once", async () => {
    const handoff = await mintHandoff();

    await expect(embedTicketFromHandoff(event, handoff)).resolves.toBe(
      "local-ticket",
    );
    expect(createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox?__an_mcp_chat_bridge=1",
      scope: "minimal",
      audienceHost: "https://labs.test",
    });
    expect(consumeOneTimeJti).toHaveBeenCalledWith(
      expect.stringMatching(/^embed-handoff:/),
    );
  });

  it("refuses a replayed handoff", async () => {
    const handoff = await mintHandoff();
    consumeOneTimeJti.mockResolvedValue(true);

    await expect(embedTicketFromHandoff(event, handoff)).resolves.toBeNull();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("refuses a handoff addressed to another app", async () => {
    const handoff = await mintHandoff("https://labs.test/calendar");

    await expect(embedTicketFromHandoff(event, handoff)).resolves.toBeNull();
    expect(consumeOneTimeJti).not.toHaveBeenCalled();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("refuses a handoff signed with another secret", async () => {
    const handoff = await mintHandoff();
    vi.stubEnv("A2A_SECRET", "other-secret");

    await expect(embedTicketFromHandoff(event, handoff)).resolves.toBeNull();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("refuses an ordinary A2A user token for the same route", async () => {
    const token = await signA2AToken(
      "owner@example.com",
      undefined,
      undefined,
      {
        preferGlobalSecret: true,
        audience: MAIL_START,
        expiresIn: "60s",
        extraClaims: { jti: "j1", embed_target: "/inbox" },
      },
    );

    await expect(embedTicketFromHandoff(event, token)).resolves.toBeNull();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("refuses a long-lived handoff", async () => {
    const token = await signA2AToken(
      "owner@example.com",
      undefined,
      undefined,
      {
        preferGlobalSecret: true,
        audience: MAIL_START,
        expiresIn: "1h",
        extraClaims: {
          scope: "embed-handoff",
          jti: "j2",
          embed_target: "/inbox",
        },
      },
    );

    await expect(embedTicketFromHandoff(event, token)).resolves.toBeNull();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("refuses a handoff dated in the future", async () => {
    const jose = await import("jose");
    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({
      sub: "owner@example.com",
      scope: "embed-handoff",
      jti: "j3",
      embed_target: "/inbox",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(MAIL_START)
      .setIssuedAt(now + 3600)
      .setExpirationTime(now + 3700)
      .sign(new TextEncoder().encode("workspace-secret"));

    await expect(embedTicketFromHandoff(event, token)).resolves.toBeNull();
    expect(createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("mints nothing without the workspace secret", async () => {
    vi.stubEnv("A2A_SECRET", "");

    await expect(
      createEmbedHandoffStartUrl({
        targetAppUrl: MAIL_URL,
        targetPath: "/inbox",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toBeNull();
  });
});
