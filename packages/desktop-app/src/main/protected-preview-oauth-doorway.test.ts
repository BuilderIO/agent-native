import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ProtectedPreviewOAuthDoorway } from "./protected-preview-oauth-doorway";

const servers: http.Server[] = [];
const doorways: ProtectedPreviewOAuthDoorway[] = [];

afterEach(async () => {
  await Promise.all(doorways.splice(0).map((doorway) => doorway.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function listen(
  handler: (request: IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function getRaw(
  url: string,
  headers: OutgoingHttpHeaders = {},
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
        });
      });
    });
    request.once("error", reject);
  });
}

function callbackState(flowId: string): string {
  const payload = Buffer.from(JSON.stringify({ f: flowId })).toString(
    "base64url",
  );
  return `${payload}.signature-not-trusted-for-routing`;
}

describe("ProtectedPreviewOAuthDoorway", () => {
  it("proxies only a registered starter and callback to its loopback app", async () => {
    const requests: Array<{
      url: string;
      headers: IncomingMessage["headers"];
    }> = [];
    const upstream = await listen((request, response) => {
      requests.push({
        url: request.url ?? "",
        headers: request.headers,
      });
      response.writeHead(302, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        location: "https://accounts.google.com/",
        "referrer-policy": "no-referrer",
        "set-cookie": "doorway=must-not-be-set; Path=/; HttpOnly",
        "www-authenticate": "Bearer example-upstream-challenge",
        "x-unlisted-response": "must-not-cross-doorway",
      });
      response.end();
    });
    const doorway = new ProtectedPreviewOAuthDoorway({ port: 0 });
    doorways.push(doorway);
    const flowId = "flow-12345";
    const unregister = await doorway.register(flowId, upstream.origin);

    const starter = await getRaw(
      `${doorway.origin}/_agent-native/google/auth-url?desktop=1&flow_id=${flowId}&redirect=1`,
      {
        authorization: "Bearer example-authorization-not-a-token",
        cookie: "session=example-cookie-not-a-session",
        "proxy-authorization": "Basic example-proxy-credentials",
        "user-agent": "AgentNativeDesktop/example",
        "x-unlisted-example": "must-not-cross-doorway",
      },
    );
    expect(starter.status).toBe(302);
    expect(requests[0]?.url).toBe(
      `/_agent-native/google/auth-url?desktop=1&flow_id=${flowId}&redirect=1`,
    );
    expect(requests[0]?.headers).toMatchObject({
      host: new URL(upstream.origin).host,
      "user-agent": "AgentNativeDesktop/example",
      "x-forwarded-host": new URL(doorway.origin).host,
      "x-forwarded-proto": "http",
    });
    expect(requests[0]?.headers).not.toHaveProperty("authorization");
    expect(requests[0]?.headers).not.toHaveProperty("cookie");
    expect(requests[0]?.headers).not.toHaveProperty("proxy-authorization");
    expect(requests[0]?.headers).not.toHaveProperty("x-unlisted-example");
    expect(starter.headers).toMatchObject({
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      location: "https://accounts.google.com/",
      "referrer-policy": "no-referrer",
    });
    expect(starter.headers).not.toHaveProperty("set-cookie");
    expect(starter.headers).not.toHaveProperty("www-authenticate");
    expect(starter.headers).not.toHaveProperty("x-unlisted-response");

    const callback = await fetch(
      `${doorway.origin}/_agent-native/google/callback?code=example&state=${encodeURIComponent(callbackState(flowId))}`,
      {
        redirect: "manual",
        headers: {
          authorization: "Bearer example-callback-not-a-token",
          cookie: "session=example-callback-not-a-session",
          "user-agent": "AgentNativeDesktop/example",
        },
      },
    );
    expect(callback.status).toBe(302);
    expect(requests[1]?.url).toContain(
      "/_agent-native/google/callback?code=example&state=",
    );
    expect(requests[1]?.headers["user-agent"]).toBe(
      "AgentNativeDesktop/example",
    );
    expect(requests[1]?.headers).not.toHaveProperty("authorization");
    expect(requests[1]?.headers).not.toHaveProperty("cookie");

    unregister();
  });

  it("rejects unrelated routes, unknown flows, and non-loopback targets", async () => {
    const doorway = new ProtectedPreviewOAuthDoorway({ port: 0 });
    doorways.push(doorway);
    const upstream = await listen((_request, response) => response.end("ok"));
    await doorway.register("known-flow", upstream.origin);

    expect((await fetch(`${doorway.origin}/collect`)).status).toBe(404);
    expect(
      (
        await fetch(
          `${doorway.origin}/_agent-native/google/auth-url?desktop=1&flow_id=unknown-flow&redirect=1`,
        )
      ).status,
    ).toBe(404);
    await expect(
      doorway.register("other-flow", "https://candidate.example.test"),
    ).rejects.toThrow("loopback HTTP origins");
  });

  it("shares one in-flight listener startup across concurrent registrations", async () => {
    const upstream = await listen((_request, response) => response.end("ok"));
    const doorway = new ProtectedPreviewOAuthDoorway({ port: 0 });
    doorways.push(doorway);

    const [unregisterFirst, unregisterSecond] = await Promise.all([
      doorway.register("concurrent-flow-one", upstream.origin),
      doorway.register("concurrent-flow-two", upstream.origin),
    ]);

    expect(
      (
        await fetch(
          `${doorway.origin}/_agent-native/google/auth-url?desktop=1&flow_id=concurrent-flow-one&redirect=1`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${doorway.origin}/_agent-native/google/auth-url?desktop=1&flow_id=concurrent-flow-two&redirect=1`,
        )
      ).status,
    ).toBe(200);

    unregisterFirst();
    unregisterSecond();
  });

  it("keeps the listener alive when an older flow unregisters during registration", async () => {
    const upstream = await listen((_request, response) => response.end("ok"));
    const doorway = new ProtectedPreviewOAuthDoorway({ port: 0 });
    doorways.push(doorway);

    const unregisterFirst = await doorway.register(
      "first-idle-flow",
      upstream.origin,
    );
    const secondRegistration = doorway.register(
      "second-idle-flow",
      upstream.origin,
    );
    unregisterFirst();
    const unregisterSecond = await secondRegistration;

    expect(
      (
        await fetch(
          `${doorway.origin}/_agent-native/google/auth-url?desktop=1&flow_id=second-idle-flow&redirect=1`,
        )
      ).status,
    ).toBe(200);

    unregisterSecond();
  });

  it("fails closed without interrupting a process that already owns the doorway port", async () => {
    const existing = await listen((_request, response) =>
      response.end("still here"),
    );
    const port = Number(new URL(existing.origin).port);
    const doorway = new ProtectedPreviewOAuthDoorway({ port });
    doorways.push(doorway);

    await expect(
      doorway.register("occupied-flow", "http://127.0.0.1:8083"),
    ).rejects.toThrow("already in use");
    expect(await (await fetch(existing.origin)).text()).toBe("still here");
  });
});
