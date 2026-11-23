import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureUiCapability,
  fetchUiAction,
  uiActionHeaders,
} from "./ui-capability.js";

test("uiActionHeaders includes same-origin and frontend CSRF headers", () => {
  const headers = uiActionHeaders("https://labs.agent-native.com/analytics-2");
  assert.deepEqual(headers, {
    origin: "https://labs.agent-native.com",
    "sec-fetch-site": "same-origin",
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  });
});

test("fetchUiAction mints ui-capability and retries once on 403 ui_capability_required", async () => {
  const calls: Array<{
    kind: string;
    url: string;
    headers?: Record<string, string>;
  }> = [];
  let attempt = 0;
  const fakeRequest = {
    async get(url: string, opts?: { headers?: Record<string, string> }) {
      calls.push({ kind: "get", url, headers: opts?.headers });
      return { ok: () => true, status: () => 200 };
    },
    async fetch(url: string, opts?: { headers?: Record<string, string> }) {
      attempt += 1;
      calls.push({ kind: "fetch", url, headers: opts?.headers });
      if (attempt === 1) {
        return {
          status: () => 403,
          ok: () => false,
          async text() {
            return JSON.stringify({ errorCode: "ui_capability_required" });
          },
        };
      }
      return {
        status: () => 200,
        ok: () => true,
        async text() {
          return JSON.stringify({ ok: true });
        },
      };
    },
  };

  const base = "https://labs.agent-native.com/analytics-2";
  const reply = await fetchUiAction(
    fakeRequest as never,
    base,
    `${base}/_agent-native/actions/delete-project`,
    { method: "POST", data: { projectId: "prj_1" } },
  );
  assert.equal(reply.status(), 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.kind, "fetch");
  assert.equal(calls[1]?.kind, "get");
  assert.equal(calls[1]?.url, `${base}/_agent-native/ui-capability`);
  assert.equal(calls[1]?.headers?.origin, "https://labs.agent-native.com");
  assert.equal(calls[2]?.kind, "fetch");
  assert.equal(calls[2]?.headers?.["sec-fetch-site"], "same-origin");
});

test("ensureUiCapability throws on non-2xx capability response", async () => {
  const fakeRequest = {
    async get() {
      return { ok: () => false, status: () => 401 };
    },
  };
  await assert.rejects(
    ensureUiCapability(
      fakeRequest as never,
      "https://labs.agent-native.com/analytics-2",
    ),
    /ui-capability: HTTP 401/,
  );
});
