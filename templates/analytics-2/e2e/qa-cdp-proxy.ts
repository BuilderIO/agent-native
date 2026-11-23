import { createServer } from "node:http";

import { WebSocket, WebSocketServer, type RawData } from "ws";

type TargetInfo = { targetId: string; type: string; browserContextId?: string };
type Message = {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: {
    browserContextId?: string;
    targetId?: string;
    sessionId?: string;
    targetInfo?: TargetInfo;
    windowId?: number;
    discover?: boolean;
    flatten?: boolean;
  };
  result?: {
    browserContextId?: string;
    targetId?: string;
    sessionId?: string;
    windowId?: number;
  };
  error?: { code: number; message: string };
};
type Pending =
  | {
      internal: true;
      resolve: (result: Message["result"]) => void;
      reject: (error: Error) => void;
    }
  | {
      internal: false;
      id: number;
      method: string;
      contextId: string | undefined;
    };

export async function qaBrowserEndpoint() {
  const port = process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT ?? "9455";
  if (
    !/^[1-9][0-9]{3,4}$/.test(port) ||
    Number(port) < 1024 ||
    Number(port) > 65535
  )
    throw new Error("QA browser port is invalid");
  const origin = new URL("http://127.0.0.1");
  origin.port = port;
  const endpoint = new URL("/json/version", origin);
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok)
    throw new Error(`QA browser version HTTP ${response.status}`);
  const version: unknown = await response.json();
  if (
    !version ||
    typeof version !== "object" ||
    !("webSocketDebuggerUrl" in version) ||
    typeof version.webSocketDebuggerUrl !== "string"
  )
    throw new Error("QA browser endpoint missing");
  const upstreamUrl = new URL(version.webSocketDebuggerUrl);
  if (
    upstreamUrl.protocol !== "ws:" ||
    upstreamUrl.hostname !== "127.0.0.1" ||
    upstreamUrl.port !== port
  )
    throw new Error("Unexpected QA browser endpoint");
  return { url: upstreamUrl, version };
}

export async function startOwnedQaCdpProxy() {
  const { url: upstreamUrl, version } = await qaBrowserEndpoint();
  const server = createServer((req, res) => {
    if (req.url !== "/json/version" && req.url !== "/json/version/") {
      res.writeHead(404);
      res.end();
      return;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      res.writeHead(503);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ...version,
        webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/cdp`,
      }),
    );
  });
  const wss = new WebSocketServer({ server });
  const connections = new Set<WebSocket>();
  wss.on("connection", (client) => {
    const upstream = new WebSocket(upstreamUrl.href);
    connections.add(upstream);
    const contexts = new Set<string>();
    const targets = new Set<string>();
    const sessions = new Set<string>();
    const browserSessions = new Set<string>();
    const windows = new Set<number>();
    const attaching = new Map<string, Promise<void>>();
    const pending = new Map<number, Pending>();
    let nextId = 0;
    let ready = false;
    let resolveDiscovery: () => void = () => {};
    let rejectDiscovery: (error: Error) => void = () => {};
    const discoveryReady = new Promise<void>((resolve, reject) => {
      resolveDiscovery = resolve;
      rejectDiscovery = reject;
    });
    void discoveryReady.catch(() => {});
    const send = (method: string, params: Message["params"] = {}) =>
      new Promise<Message["result"]>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { internal: true, resolve, reject });
        upstream.send(JSON.stringify({ id, method, params }));
      });
    const attachOnce = (targetId: string): Promise<void> => {
      const existing = attaching.get(targetId);
      if (existing) return existing;
      if (targets.has(targetId)) return Promise.resolve();
      targets.add(targetId);
      const promise = send("Target.attachToTarget", { targetId, flatten: true })
        .then(() => {})
        .catch((error: unknown) => {
          targets.delete(targetId);
          throw error;
        })
        .finally(() => attaching.delete(targetId));
      // Flat mode routes nested session messages through this connection.
      attaching.set(targetId, promise);
      return promise;
    };
    const handleOpen = async () => {
      await send("Target.setDiscoverTargets", { discover: true });
      ready = true;
      resolveDiscovery();
    };
    upstream.on("open", () => {
      void handleOpen().catch(() => {
        rejectDiscovery(new Error("QA target discovery failed"));
        client.close();
      });
    });
    const handleClientMessage = async (bytes: RawData) => {
      await discoveryReady;
      const message = JSON.parse(String(bytes)) as Message;
      if (typeof message.id !== "number" || !message.method)
        throw new Error("Invalid CDP request");
      const deny = (reason: string) =>
        client.send(
          JSON.stringify({
            id: message.id,
            error: { code: -32000, message: reason },
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          }),
        );
      if (
        message.sessionId &&
        !sessions.has(message.sessionId) &&
        !browserSessions.has(message.sessionId)
      ) {
        deny("Session is not owned by this connection");
        return;
      }
      if (
        message.method === "Target.detachFromTarget" &&
        (!message.params?.sessionId ||
          (!sessions.has(message.params.sessionId) &&
            !browserSessions.has(message.params.sessionId)))
      ) {
        deny("Session is not owned by this connection");
        return;
      }
      if (
        message.method === "Target.getTargetInfo" &&
        message.params?.targetId &&
        !targets.has(message.params.targetId)
      ) {
        deny("Target is not owned by this connection");
        return;
      }
      if (
        ["Target.createTarget", "Target.disposeBrowserContext"].includes(
          message.method,
        ) &&
        (!message.params?.browserContextId ||
          !contexts.has(message.params.browserContextId))
      ) {
        deny("Context is not owned by this connection");
        return;
      }
      if (
        ["Target.attachToTarget", "Target.closeTarget"].includes(
          message.method,
        ) &&
        (!message.params?.targetId || !targets.has(message.params.targetId))
      ) {
        deny("Target is not owned by this connection");
        return;
      }
      if (
        [
          "Browser.close",
          "Target.activateTarget",
          "Page.bringToFront",
          "Target.sendMessageToTarget",
          "Target.autoAttachRelated",
          "Target.setDiscoverTargets",
        ].includes(message.method)
      ) {
        deny("Operation is disabled by the scoped relay");
        return;
      }
      if (
        message.method === "Browser.getWindowForTarget" &&
        (message.params?.targetId
          ? !targets.has(message.params.targetId)
          : !message.sessionId || !sessions.has(message.sessionId))
      ) {
        deny("Target is not owned by this connection");
        return;
      }
      if (
        message.method === "Browser.setWindowBounds" &&
        (message.params?.windowId === undefined ||
          !windows.has(message.params.windowId))
      ) {
        deny("Window is not owned by this connection");
        return;
      }
      if (
        message.method.startsWith("Storage.") &&
        (!message.params?.browserContextId ||
          !contexts.has(message.params.browserContextId))
      ) {
        deny("Storage context is not owned by this connection");
        return;
      }
      const browserMethods = [
        "Browser.getVersion",
        "Browser.getWindowForTarget",
        "Browser.setWindowBounds",
        "Browser.setDownloadBehavior",
        "Browser.grantPermissions",
        "Browser.resetPermissions",
        "Browser.setPermission",
      ];
      if (
        message.method.startsWith("Browser.") &&
        !browserMethods.includes(message.method)
      ) {
        deny("Browser operation is disabled by the scoped relay");
        return;
      }
      if (
        [
          "Browser.grantPermissions",
          "Browser.resetPermissions",
          "Browser.setPermission",
        ].includes(message.method) &&
        (!message.params?.browserContextId ||
          !contexts.has(message.params.browserContextId))
      ) {
        deny("Context is not owned by this connection");
        return;
      }
      if (
        message.method === "Browser.setDownloadBehavior" &&
        message.params?.browserContextId &&
        !contexts.has(message.params.browserContextId)
      ) {
        deny("Context is not owned by this connection");
        return;
      }
      if (
        (message.method === "Target.setAutoAttach" &&
          (!message.sessionId || !sessions.has(message.sessionId))) ||
        (message.method === "Browser.setDownloadBehavior" &&
          !message.params?.browserContextId)
      ) {
        client.send(
          JSON.stringify({
            id: message.id,
            result: {},
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          }),
        );
        return;
      }
      const id = ++nextId;
      pending.set(id, {
        internal: false,
        id: message.id,
        method: message.method,
        contextId: message.params?.browserContextId,
      });
      upstream.send(
        JSON.stringify({
          ...message,
          ...(message.method === "Target.createBrowserContext"
            ? { params: { ...message.params, disposeOnDetach: true } }
            : {}),
          id,
        }),
      );
    };
    client.on("message", (bytes) => {
      void handleClientMessage(bytes).catch(() => client.close());
    });
    const handleUpstreamMessage = async (bytes: RawData) => {
      const message = JSON.parse(String(bytes)) as Message;
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (request.internal) {
          message.error
            ? request.reject(new Error(message.error.message))
            : request.resolve(message.result);
          return;
        }
        if (
          request.method === "Target.attachToBrowserTarget" &&
          message.result?.sessionId
        )
          browserSessions.add(message.result.sessionId);
        if (
          request.method === "Target.createBrowserContext" &&
          message.result?.browserContextId
        )
          contexts.add(message.result.browserContextId);
        if (
          request.method === "Target.disposeBrowserContext" &&
          !message.error &&
          request.contextId
        )
          contexts.delete(request.contextId);
        if (
          request.method === "Browser.getWindowForTarget" &&
          message.result?.windowId !== undefined
        )
          windows.add(message.result.windowId);
        if (
          request.method === "Target.createTarget" &&
          message.result?.targetId
        )
          await attachOnce(message.result.targetId);
        client.send(JSON.stringify({ ...message, id: request.id }));
        return;
      }
      if (
        message.method === "Target.attachedToTarget" &&
        message.params?.sessionId &&
        ((message.params.targetInfo?.browserContextId &&
          contexts.has(message.params.targetInfo.browserContextId)) ||
          (message.sessionId && sessions.has(message.sessionId)))
      )
        sessions.add(message.params.sessionId);
      if (message.method === "Target.targetCreated") {
        const info = message.params?.targetInfo;
        if (
          ready &&
          info?.type === "page" &&
          info.browserContextId &&
          contexts.has(info.browserContextId)
        )
          await attachOnce(info.targetId);
        return;
      }
      if (
        ["Target.targetDestroyed", "Target.targetInfoChanged"].includes(
          message.method ?? "",
        )
      )
        return;
      client.send(String(bytes));
    };
    upstream.on("message", (bytes) => {
      void handleUpstreamMessage(bytes).catch(() => client.close());
    });
    const close = () => {
      connections.delete(upstream);
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      )
        upstream.close();
    };
    client.on("close", close);
    client.on("error", close);
    upstream.on("close", () => {
      connections.delete(upstream);
      client.close();
    });
    upstream.on("error", () => {
      rejectDiscovery(new Error("QA browser connection failed"));
      client.close();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("QA relay did not bind");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of wss.clients) client.close();
      for (const socket of connections) socket.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
