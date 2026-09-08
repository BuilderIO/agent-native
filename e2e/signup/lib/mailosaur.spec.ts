import assert from "node:assert/strict";
import test from "node:test";

import {
  isMailosaurInconclusiveError,
  waitForVerificationEmail,
} from "./mailosaur";

test("classifies Mailosaur rate limits as inconclusive", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.MAILOSAUR_API_KEY;
  const previousServerId = process.env.MAILOSAUR_SERVER_ID;
  process.env.MAILOSAUR_API_KEY = "test-key";
  process.env.MAILOSAUR_SERVER_ID = "test-server";
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });

  try {
    await assert.rejects(
      waitForVerificationEmail(
        "signup+qa-test-bot-test@test-server.mailosaur.net",
        Date.now() - 1_000,
      ),
      (error: unknown) => {
        assert.equal(isMailosaurInconclusiveError(error), true);
        assert.match((error as Error).message, /HTTP 429/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.MAILOSAUR_API_KEY;
    else process.env.MAILOSAUR_API_KEY = previousApiKey;
    if (previousServerId === undefined) delete process.env.MAILOSAUR_SERVER_ID;
    else process.env.MAILOSAUR_SERVER_ID = previousServerId;
  }
});
