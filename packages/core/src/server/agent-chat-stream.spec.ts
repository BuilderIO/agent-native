import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  AGENT_CHAT_STREAM_TOKEN_TTL_SECONDS,
  createAgentChatStreamToken,
  readAgentChatStreamBearerToken,
  verifyAgentChatStreamToken,
} from "./agent-chat-stream.js";

const TEST_SECRET = "agent-chat-stream-test-secret-0123456789";

describe("agent-chat stream tokens", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://calendar.example.test");
    vi.stubEnv("BETTER_AUTH_SECRET", TEST_SECRET);
    resetAppConfigForTests();
  });

  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
  });

  it("round-trips the session owner and organization through a short-lived token", async () => {
    const token = await createAgentChatStreamToken({
      ownerEmail: " steve@example.test ",
      orgId: "org-calendar",
    });

    expect(await verifyAgentChatStreamToken(token)).toEqual({
      ownerEmail: "steve@example.test",
      orgId: "org-calendar",
    });
    expect(token.split(".")).toHaveLength(3);
    expect(AGENT_CHAT_STREAM_TOKEN_TTL_SECONDS).toBe(900);
  });

  it("rejects a token minted for another purpose", async () => {
    const token = await new jose.SignJWT({
      token_type: "different-purpose",
      sub: "steve@example.test",
      org_id: null,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("https://calendar.example.test")
      .setAudience("https://calendar.example.test")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(TEST_SECRET));

    expect(await verifyAgentChatStreamToken(token)).toBeNull();
  });

  it("extracts only a bounded bearer token", () => {
    expect(readAgentChatStreamBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(readAgentChatStreamBearerToken("Basic abc.def")).toBeNull();
    expect(readAgentChatStreamBearerToken(`Bearer ${"a".repeat(4097)}`)).toBe(
      null,
    );
  });
});
