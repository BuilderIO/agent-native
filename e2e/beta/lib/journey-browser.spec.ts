import assert from "node:assert/strict";
import test from "node:test";

import type { APIRequestContext } from "@playwright/test";

import { callAction } from "./journey-browser";

const MISMATCH_BODY = JSON.stringify({
  error: "This browser tab must reload before it can use this app.",
  code: "client_build_mismatch",
});

/** An action route gated the way Slides' is since #6598. */
function compatibilityGatedRequest(required: string) {
  const sent: (string | undefined)[] = [];
  const respond = async (
    _url: string,
    options: { headers: Record<string, string> },
  ) => {
    const compatibility =
      options.headers["X-Agent-Native-Client-Compatibility"];
    sent.push(compatibility);
    const ok = compatibility === required;
    return {
      status: () => (ok ? 200 : 409),
      ok: () => ok,
      headers: (): Record<string, string> =>
        ok
          ? {}
          : {
              "x-agent-native-client-mismatch": "1",
              "x-agent-native-client-compatibility": required,
            },
      text: async () => (ok ? '{"designSystems":[]}' : MISMATCH_BODY),
    };
  };
  const request = {
    get: respond,
    post: respond,
    delete: respond,
  } as unknown as APIRequestContext;
  return { request, sent };
}

test("an action call adopts the compatibility version the app requires, as a reloaded tab would", async () => {
  const origin = "https://beta.slides.example.test";
  const { request, sent } = compatibilityGatedRequest("slides-write-v1");

  const first = await callAction(request, origin, "list-design-systems");
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(sent, [undefined, "slides-write-v1"]);

  const second = await callAction(request, origin, "list-design-systems");
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(sent.slice(2), ["slides-write-v1"]);
});

test("a mismatch that names no version comes back as it was, not retried", async () => {
  const origin = "https://beta.unnamed.example.test";
  let calls = 0;
  const respond = async () => {
    calls += 1;
    return {
      status: () => 409,
      ok: () => false,
      headers: () => ({ "x-agent-native-client-mismatch": "1" }),
      text: async () => MISMATCH_BODY,
    };
  };
  const request = { get: respond } as unknown as APIRequestContext;

  const call = await callAction(request, origin, "list-design-systems");
  assert.equal(call.status, 409);
  assert.equal(calls, 1);
});
