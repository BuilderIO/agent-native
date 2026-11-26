import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { readQaBuildEvidence } from "./qa-build-evidence.ts";

test("binds build proof to the checked browser origin, account and rendered bundle", async (t) => {
  const email = "qa-fleet-4@fixture.mailosaur.net";
  const sha = "1".repeat(40);
  const appBuildId = "content-" + "2".repeat(32);
  let activeEmail = email;
  let healthRedirect = false;
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url?.endsWith("/auth/session")) {
      res.end(JSON.stringify({ email: activeEmail }));
    } else if (req.url?.endsWith("/health")) {
      if (healthRedirect) {
        res.writeHead(302, { Location: "/redirected" }).end();
        return;
      }
      res
        .setHeader("x-agent-native-build-sha", sha)
        .setHeader("x-agent-native-app-build-id", appBuildId)
        .end();
    } else {
      redirected = true;
      res.end();
    }
  }).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const pageGlobals = Object.assign(globalThis, {
    window: { location: { origin } },
    __AGENT_NATIVE_BUILD_ID__: appBuildId,
  });
  t.after(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "__AGENT_NATIVE_BUILD_ID__");
  });
  const page = {
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
  } as Parameters<typeof readQaBuildEvidence>[0];
  const app = origin + "/content-2";
  assert.deepEqual(await readQaBuildEvidence(page, app, email), {
    sha,
    appBuildId,
  });
  assert.equal(
    await readQaBuildEvidence(page, "http://localhost/content-2", email),
    null,
  );
  activeEmail = "qa-fleet-3@fixture.mailosaur.net";
  assert.equal(await readQaBuildEvidence(page, app, email), null);
  activeEmail = email;
  pageGlobals.__AGENT_NATIVE_BUILD_ID__ = "content-" + "3".repeat(32);
  assert.equal(await readQaBuildEvidence(page, app, email), null);
  pageGlobals.__AGENT_NATIVE_BUILD_ID__ = appBuildId;
  healthRedirect = true;
  assert.equal(await readQaBuildEvidence(page, app, email), null);
  assert.equal(redirected, false);
});
