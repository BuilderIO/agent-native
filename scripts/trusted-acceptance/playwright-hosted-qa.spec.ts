import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPlaywrightHostedQaBrowser } from "./playwright-hosted-qa.ts";

describe("Playwright hosted-QA adapter", () => {
  it("keeps auth requests and consent on the exact acceptance origin", async () => {
    const calls: string[] = [];
    const adapter = createPlaywrightHostedQaBrowser(
      {
        request: {
          async post(url) {
            calls.push(`post:${url}`);
            return { status: () => 200, async json() {} };
          },
          async get(url) {
            calls.push(`get:${url}`);
            return {
              status: () => 200,
              async json() {
                return { user: { email: "qa@example.test" } };
              },
            };
          },
        },
        async goto(url) {
          calls.push(`goto:${String(url)}`);
          return null;
        },
        locator(selector) {
          calls.push(`locator:${selector}`);
          return {
            async click() {
              calls.push("click");
            },
          } as never;
        },
      },
      "https://calendar.acceptance.example.test",
    );

    assert.deepEqual(
      await adapter.postJson("/_agent-native/auth/login", {
        email: "qa@example.test",
        password: "in-memory-only",
      }),
      { status: 200 },
    );
    assert.deepEqual(await adapter.getJson("/_agent-native/auth/session"), {
      user: { email: "qa@example.test" },
    });
    await adapter.authorize?.(
      "https://calendar.acceptance.example.test/mcp/oauth/authorize?state=x",
    );
    assert.deepEqual(calls, [
      "post:https://calendar.acceptance.example.test/_agent-native/auth/login",
      "get:https://calendar.acceptance.example.test/_agent-native/auth/session",
      "goto:https://calendar.acceptance.example.test/mcp/oauth/authorize?state=x",
      'locator:button[name="decision"][value="approve"]',
      "click",
    ]);
  });

  it("rejects ordinary preview, production, and cross-origin consent URLs", async () => {
    assert.throws(() =>
      createPlaywrightHostedQaBrowser(
        {} as never,
        "https://calendar.agent-native.com",
      ),
    );
    const adapter = createPlaywrightHostedQaBrowser(
      {
        request: {} as never,
        async goto() {
          return null;
        },
        locator() {
          return {} as never;
        },
      },
      "https://calendar.acceptance.example.test",
    );
    await assert.rejects(
      adapter.authorize?.("https://calendar.agent-native.com/oauth/authorize"),
      /left the exact acceptance origin/,
    );
  });
});
