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
        "signup+autoz-test@test-server.mailosaur.net",
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

test("ignores an earlier verification email for the same address", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.MAILOSAUR_API_KEY;
  const previousServerId = process.env.MAILOSAUR_SERVER_ID;
  process.env.MAILOSAUR_API_KEY = "test-key";
  process.env.MAILOSAUR_SERVER_ID = "test-server";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      return Response.json([
        {
          id: "earlier",
          subject: "Sign-in link",
          to: [{ email: "signup+autoz-test@test-server.mailosaur.net" }],
        },
        {
          id: "current",
          subject: "Sign-in link",
          to: [{ email: "signup+autoz-test@test-server.mailosaur.net" }],
        },
      ]);
    }
    assert.equal(url.pathname, "/api/messages/current");
    return Response.json({ id: "current", subject: "Sign-in link" });
  };

  try {
    const message = await waitForVerificationEmail(
      "signup+autoz-test@test-server.mailosaur.net",
      Date.now(),
      new Set(["earlier"]),
    );
    assert.equal(message.id, "current");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.MAILOSAUR_API_KEY;
    else process.env.MAILOSAUR_API_KEY = previousApiKey;
    if (previousServerId === undefined) delete process.env.MAILOSAUR_SERVER_ID;
    else process.env.MAILOSAUR_SERVER_ID = previousServerId;
  }
});
