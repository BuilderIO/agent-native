import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, describe, it } from "node:test";

import {
  diffTraffic,
  median,
  scaffoldArgs,
  startCountingProxy,
  type CountingProxy,
} from "./bench-create.ts";

const proxies: CountingProxy[] = [];
const servers: net.Server[] = [];
after(async () => {
  for (const proxy of proxies) await proxy.close();
  for (const server of servers) server.close();
});

/** A server that sends `reply` bytes, then closes once it has read `expect` bytes. */
async function byteServer(reply: number, expect: number): Promise<number> {
  const server = net.createServer((socket) => {
    let read = 0;
    socket.on("data", (chunk) => {
      read += chunk.length;
      if (read >= expect) socket.end();
    });
    socket.write(Buffer.alloc(reply, 1));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

function tunnel(
  proxy: CountingProxy,
  port: number,
  send: number,
): Promise<number> {
  const { port: proxyPort } = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: Number(proxyPort),
      method: "CONNECT",
      path: `127.0.0.1:${port}`,
    });
    req.on("connect", (res, socket, head: Buffer) => {
      assert.equal(res.statusCode, 200);
      // Tunnel bytes that arrive in the same read as the proxy's 200 come
      // through `head`, not the socket's data events.
      let received = head.length;
      socket.on("data", (chunk: Buffer) => (received += chunk.length));
      socket.on("end", () => resolve(received));
      socket.write(Buffer.alloc(send, 2));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("bench-create counting proxy", () => {
  it("counts each direction's bytes and each connection per host", async () => {
    const proxy = await startCountingProxy();
    proxies.push(proxy);
    const port = await byteServer(300_000, 7_000);
    const host = `127.0.0.1:${port}`;

    assert.equal(await tunnel(proxy, port, 7_000), 300_000);
    const first = proxy.snapshot();
    assert.deepEqual(first[host], {
      received: 300_000,
      sent: 7_000,
      connections: 1,
      errors: 0,
    });

    assert.equal(await tunnel(proxy, port, 7_000), 300_000);
    assert.deepEqual(diffTraffic(first, proxy.snapshot()), {
      [host]: { received: 300_000, sent: 7_000, connections: 1, errors: 0 },
    });
  });

  it("refuses plain HTTP so uncounted traffic fails the run", async () => {
    const proxy = await startCountingProxy();
    proxies.push(proxy);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get(`${proxy.url}/`, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject);
    });
    assert.equal(status, 501);
    assert.equal(proxy.plainRequests(), 1);
  });
});

describe("scaffoldArgs", () => {
  it("passes --standalone to create and skips add-app", () => {
    assert.deepEqual(
      scaffoldArgs("@agent-native/core", {
        template: "chat",
        standalone: true,
        addApp: undefined,
      }),
      {
        create: ["create", "bench-ws", "--template", "chat", "--standalone"],
        addApp: undefined,
      },
    );
  });

  it("forces a workspace, which create alone won't make without a terminal", () => {
    assert.deepEqual(
      scaffoldArgs("@agent-native/core", {
        template: "dispatch",
        standalone: false,
        addApp: undefined,
      }).create,
      ["create-workspace", "bench-ws", "--template", "dispatch"],
    );
  });

  it("adds the app under its own name so it can't collide with create's", () => {
    assert.deepEqual(
      scaffoldArgs("@agent-native/core", {
        template: "dispatch",
        standalone: false,
        addApp: "dispatch",
      }).addApp,
      ["add-app", "bench-app", "--template", "dispatch"],
    );
  });

  it("drops the create subcommand for a dedicated create package", () => {
    assert.deepEqual(
      scaffoldArgs("create-agent-native", {
        template: "dispatch",
        standalone: false,
        addApp: undefined,
      }).create,
      ["bench-ws", "--template", "dispatch"],
    );
  });

  it("refuses add-app for a package without core's CLI", () => {
    assert.throws(
      () =>
        scaffoldArgs("create-agent-native", {
          template: "dispatch",
          standalone: false,
          addApp: "content",
        }),
      /create-agent-native doesn't have/,
    );
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.throws(() => median([]));
  });
});
