import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserContext } from "@playwright/test";

import {
  installOpenAiKey,
  isConfirmedOpenAiKeyInstall,
  validateOpenAiKey,
} from "./provider-key";

test("requires the user-scoped OpenAI install response contract", () => {
  const valid = {
    status: 200,
    body: '{"ok":true,"key":"OPENAI_API_KEY","baseUrlKey":"OPENAI_BASE_URL","scope":"user"}',
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
  assert.equal(
    isConfirmedOpenAiKeyInstall({
      status: 200,
      body: '{"ok":true,"key":"OPENAI_API_KEY","scope":"user"}',
    }),
    false,
  );
});

test("passes the canonical endpoint through the browser evaluation boundary", async () => {
  let evaluateArgs: readonly unknown[] | undefined;
  const page = {
    async goto() {},
    async evaluate(_callback: unknown, args: readonly unknown[]) {
      evaluateArgs = args;
      return {
        status: 200,
        body: '{"ok":true,"key":"OPENAI_API_KEY","baseUrlKey":"OPENAI_BASE_URL","scope":"user"}',
      };
    },
    async close() {},
  };
  const context = {
    async newPage() {
      return page;
    },
  } as unknown as BrowserContext;

  const result = await installOpenAiKey(
    context,
    "https://beta.example.test",
    "sk-example-dedicated",
  );

  assert.equal(result.installed, true);
  assert.deepEqual(evaluateArgs, [
    "/_agent-native/agent-engine/api-key",
    "sk-example-dedicated",
    "https://api.openai.com/v1",
  ]);
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
