import assert from "node:assert/strict";
import test from "node:test";

import { isConfirmedOpenAiKeyInstall, validateOpenAiKey } from "./provider-key";

test("requires the user-scoped OpenAI install response contract", () => {
  const valid = {
    status: 200,
    body: '{"ok":true,"key":"OPENAI_API_KEY","scope":"user"}',
  };
  assert.equal(isConfirmedOpenAiKeyInstall(valid), true);
  assert.equal(
    isConfirmedOpenAiKeyInstall({
      status: 204,
      body: "",
    }),
    false,
  );
  assert.equal(
    isConfirmedOpenAiKeyInstall({
      status: 200,
      body: '{"ok":true,"key":"OPENAI_API_KEY","scope":"org"}',
    }),
    false,
  );
});
test("validates the model execution path, not only the models listing", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    await validateOpenAiKey("sk-example-dedicated");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    requests.map(({ url, method }) => ({ url, method })),
    [
      { url: "https://api.openai.com/v1/models", method: "GET" },
      { url: "https://api.openai.com/v1/responses", method: "POST" },
    ],
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
    model: "gpt-5.6-luna",
    input: "Reply with OK.",
    max_output_tokens: 16,
    store: false,
  });
});

test("rejects a key that can list models but cannot execute luna", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    return new Response("{}", { status: call === 1 ? 200 : 403 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      validateOpenAiKey("sk-example-restricted"),
      /gpt-5\.6-luna.*HTTP 403/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
