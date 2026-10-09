import { createServer } from "node:http";
import { connect as netConnect, type Server, type Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  isPublicIpAddress,
  isReplayRequestAllowed,
  replayBrowserLaunchOptions,
  startReplaySocksRelay,
} from "./journey-capture-network";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function connectSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function socketReader(socket: Socket) {
  let buffer = Buffer.alloc(0);
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    notify();
  });
  socket.once("error", (error) => {
    failure = error;
    notify();
  });
  socket.once("end", () => {
    failure ??= new Error("test_socket_ended");
    notify();
  });
  socket.once("close", () => {
    failure ??= new Error("test_socket_closed");
    notify();
  });

  return async (length: number) => {
    while (buffer.length < length && !failure) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (buffer.length < length) throw failure;
    const result = buffer.subarray(0, length);
    buffer = buffer.subarray(length);
    return result;
  };
}

async function socksConnect(
  socket: Socket,
  host: string,
  port: number,
): Promise<Buffer> {
  const read = socketReader(socket);
  socket.write(Buffer.from([5, 1, 0]));
  expect([...(await read(2))]).toEqual([5, 0]);
  const hostname = Buffer.from(host);
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  socket.write(
    Buffer.concat([
      Buffer.from([5, 1, 0, 3, hostname.byteLength]),
      hostname,
      portBytes,
    ]),
  );
  return read(10);
}

describe("journey capture replay network relay", () => {
  it("routes public destinations through Chromium's resolver-free SOCKS proxy", () => {
    const options = replayBrowserLaunchOptions("socks5://127.0.0.1:43123");

    expect(options).toMatchObject({
      proxy: { server: "socks5://127.0.0.1:43123", bypass: "" },
      args: [
        "--proxy-bypass-list=<-loopback>",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--dns-prefetch-disable",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
  });

  it("keeps destination lookup failures distinct from denied requests", async () => {
    const lookupError = new Error("resolver_failure");

    await expect(
      isReplayRequestAllowed(
        "https://recorded-assets.example.com/image.png",
        "https://analytics.example.com",
        async () => {
          throw lookupError;
        },
      ),
    ).rejects.toMatchObject({
      message: "replay_dns_lookup_failed",
      cause: lookupError,
    });
  });

  it("opens only the exact loopback Analytics origin and closes owned sockets", async () => {
    const appServer = createServer((_request, response) => {
      response.end("replay-frame");
    });
    const appPort = await listen(appServer);
    const relay = await startReplaySocksRelay(`http://127.0.0.1:${appPort}`);
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );

    try {
      expect([...(await socksConnect(socket, "127.0.0.1", appPort))]).toEqual([
        5, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      ]);
      socket.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${appPort}\r\nConnection: close\r\n\r\n`,
      );
      let response = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", (chunk) => (response += chunk.toString("utf8")));
        socket.once("end", resolve);
        socket.once("error", reject);
      });
      expect(response).toContain("200 OK");
      expect(response).toContain("replay-frame");
    } finally {
      socket.destroy();
      await relay.close();
      await close(appServer);
    }
  });

  it("dials the numeric public address returned by the checked lookup", async () => {
    const targetServer = createServer((_request, response) => {
      response.end("recorded-image");
    });
    const targetPort = await listen(targetServer);
    const lookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
    const connect = vi.fn(async (address: string, port: number) => {
      expect(address).toBe("8.8.8.8");
      expect(port).toBe(443);
      return connectSocket("127.0.0.1", targetPort);
    });
    const relay = await startReplaySocksRelay("https://analytics.example.com", {
      lookup,
      connect,
    });
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );

    try {
      expect([...(await socksConnect(socket, "recorded.com", 443))]).toEqual([
        5, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      ]);
      const tunneledPayload = "x".repeat(2_048);
      socket.write(
        `GET /image.png HTTP/1.1\r\nHost: recorded.com\r\nX-Payload: ${tunneledPayload}\r\nConnection: close\r\n\r\n`,
      );
      let response = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", (chunk) => (response += chunk.toString("utf8")));
        socket.once("end", resolve);
        socket.once("error", reject);
      });
      expect(response).toContain("recorded-image");
      expect(lookup).toHaveBeenCalledExactlyOnceWith("recorded.com");
      expect(connect).toHaveBeenCalledExactlyOnceWith("8.8.8.8", 443);
    } finally {
      socket.destroy();
      await relay.close();
      await close(targetServer);
    }
  });

  it("returns an explicit SOCKS failure after every checked address rejects", async () => {
    const lookup = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ]);
    const connect = vi.fn(async (address: string, port: number) => {
      expect([address, port]).toEqual(["8.8.8.8", 443]);
      throw new Error("connect_refused");
    });
    const relay = await startReplaySocksRelay("https://analytics.example.com", {
      lookup,
      connect,
    });
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );

    try {
      expect([...(await socksConnect(socket, "recorded.com", 443))]).toEqual([
        5, 2, 0, 1, 0, 0, 0, 0, 0, 0,
      ]);
      expect(lookup).toHaveBeenCalledExactlyOnceWith("recorded.com");
      expect(connect.mock.calls.map(([address]) => address)).toEqual([
        "8.8.8.8",
        "1.1.1.1",
      ]);
    } finally {
      socket.destroy();
      await relay.close();
    }
  });

  it("returns buffered bytes to the tunnel after CONNECT succeeds", async () => {
    const targetServer = createServer((_request, response) => {
      response.end("recorded-image");
    });
    const targetPort = await listen(targetServer);
    let startConnect: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      startConnect = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const connect = vi.fn(async () => {
      startConnect?.();
      await connectGate;
      return connectSocket("127.0.0.1", targetPort);
    });
    const relay = await startReplaySocksRelay("https://analytics.example.com", {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      connect,
    });
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );

    try {
      const read = socketReader(socket);
      socket.write(Buffer.from([5, 1, 0]));
      expect([...(await read(2))]).toEqual([5, 0]);
      const hostname = Buffer.from("recorded.com");
      const port = Buffer.alloc(2);
      port.writeUInt16BE(443);
      socket.write(
        Buffer.concat([
          Buffer.from([5, 1, 0, 3, hostname.byteLength]),
          hostname,
          port,
        ]),
      );
      await connectStarted;

      const tunneledPayload = "x".repeat(2_048);
      await new Promise<void>((resolve, reject) => {
        socket.write(
          `GET /image.png HTTP/1.1\r\nHost: recorded.com\r\nX-Payload: ${tunneledPayload}\r\nConnection: close\r\n\r\n`,
          (error) => (error ? reject(error) : resolve()),
        );
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      releaseConnect?.();

      expect([...(await read(10))]).toEqual([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
      let response = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", (chunk) => (response += chunk.toString("utf8")));
        socket.once("end", resolve);
        socket.once("error", reject);
      });
      expect(response).toContain("recorded-image");
      expect(connect).toHaveBeenCalledOnce();
    } finally {
      releaseConnect?.();
      socket.destroy();
      await relay.close();
      await close(targetServer);
    }
  });

  it("rejects private DNS answers before dialing a replay-controlled host", async () => {
    const connect = vi.fn(async () => {
      throw new Error("must_not_connect");
    });
    const relay = await startReplaySocksRelay("https://analytics.example.com", {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      connect,
    });
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );

    try {
      expect([
        ...(await socksConnect(socket, "recorded.example", 443)),
      ]).toEqual([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      socket.destroy();
      await relay.close();
    }
  });

  it("does not dial a destination when the relay closes during DNS resolution", async () => {
    let resolveLookup:
      | ((addresses: Array<{ address: string; family: number }>) => void)
      | undefined;
    const lookup = vi.fn(
      () =>
        new Promise<Array<{ address: string; family: number }>>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    const connect = vi.fn(async () => {
      throw new Error("must_not_connect");
    });
    const relay = await startReplaySocksRelay("https://analytics.example.com", {
      lookup,
      connect,
    });
    const proxyUrl = new URL(relay.server);
    const socket = await connectSocket(
      proxyUrl.hostname,
      Number(proxyUrl.port),
    );
    const read = socketReader(socket);

    try {
      socket.write(Buffer.from([5, 1, 0]));
      expect([...(await read(2))]).toEqual([5, 0]);
      const hostname = Buffer.from("recorded.com");
      const targetPort = Buffer.alloc(2);
      targetPort.writeUInt16BE(443);
      socket.write(
        Buffer.concat([
          Buffer.from([5, 1, 0, 3, hostname.byteLength]),
          hostname,
          targetPort,
        ]),
      );
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
      await relay.close();
      resolveLookup?.([{ address: "8.8.8.8", family: 4 }]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(connect).not.toHaveBeenCalled();
    } finally {
      socket.destroy();
      await relay.close();
    }
  });
});
