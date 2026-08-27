import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CHANNEL_TOKEN_BYTES = 32;

export interface GoogleDocsPushHeaders {
  channelId?: string | null;
  channelToken?: string | null;
  resourceId?: string | null;
}

export function createGoogleDocsChannelAuth(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(CHANNEL_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashGoogleDocsChannelToken(token) };
}

export function hashGoogleDocsChannelToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Google Drive delivers channel tokens, not Pub/Sub OIDC bearer tokens. */
export function verifyGoogleDocsChannel(
  expected: Record<string, unknown> | null | undefined,
  received: GoogleDocsPushHeaders,
): boolean {
  const expectedChannelId = expected?.channelId;
  const expectedTokenHash = expected?.channelTokenHash;

  if (
    typeof expectedChannelId !== "string" ||
    typeof expectedTokenHash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(expectedTokenHash) ||
    received.channelId !== expectedChannelId ||
    !received.channelToken
  ) {
    return false;
  }

  const expectedHash = Buffer.from(expectedTokenHash, "hex");
  const receivedHash = Buffer.from(
    hashGoogleDocsChannelToken(received.channelToken),
    "hex",
  );
  if (
    expectedHash.length !== receivedHash.length ||
    !timingSafeEqual(expectedHash, receivedHash)
  ) {
    return false;
  }

  const expectedResourceId = expected?.resourceId;
  return (
    typeof expectedResourceId !== "string" ||
    received.resourceId === expectedResourceId
  );
}
