import { describe, expect, it, vi } from "vitest";

import {
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";
import {
  createLocalhostBridgeFetchProxy,
  type LocalhostBridgeTransport,
} from "./localhost-bridge-proxy.js";

const pageOrigin = "https://beta.design.agent-native.com";
const transport: LocalhostBridgeTransport = {
  designId: "design_1",
  connectionId: "conn_1",
  bridgeUrl: "http://127.0.0.1:7666",
  bridgeToken: "bridge-token",
};

function relay(
  operation: LocalhostBridgeRelay["operation"],
  extra: Partial<LocalhostBridgeRelay> = {},
): LocalhostBridgeRelay {
  return {
    __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
    operation,
    designId: transport.designId,
    connectionId: transport.connectionId,
    ...extra,
  };
}

describe("localhost bridge browser relay", () => {
  it("keeps the hosted action policy call and relays an authorized read locally", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          expect(
            new Headers(init?.headers).get("X-Agent-Native-Localhost-Bridge"),
          ).toBe("1");
          return Response.json(relay("read-file", { path: "src/App.tsx" }));
        }
        expect(url).toBe("http://127.0.0.1:7666/read-file");
        expect(new Headers(init?.headers).get("X-Bridge-Token")).toBe(
          transport.bridgeToken,
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
        });
        return Response.json({
          content: "export default function App() {}\n",
          versionHash: "hash-1",
        });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/read-local-file?designId=design_1&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      designId: "design_1",
      connectionId: "conn_1",
      path: "src/App.tsx",
      content: "export default function App() {}\n",
      versionHash: "hash-1",
      readonly: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("relays a consented source write with the action payload intact", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return Response.json(relay("write-file", { relPath: "src/App.tsx" }));
        }
        expect(url).toBe("http://127.0.0.1:7666/write-file");
        expect(new Headers(init?.headers).get("X-Bridge-Token")).toBe(
          transport.bridgeToken,
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
          content: "export default function App() {}\n",
          expectedVersionHash: "hash-1",
          requireExpectedVersionHash: true,
        });
        return Response.json({ versionHash: "hash-2" });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/write-local-file`,
      {
        method: "POST",
        body: JSON.stringify({
          designId: "design_1",
          connectionId: "conn_1",
          relPath: "src/App.tsx",
          content: "export default function App() {}\n",
          expectedVersionHash: "hash-1",
          requireExpectedVersionHash: true,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      designId: "design_1",
      relPath: "src/App.tsx",
      operation: "write",
      written: true,
      versionHash: "hash-2",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes a cross-design denial through without touching the local bridge", async () => {
    const denied = Response.json(
      { error: "The visual-edit capability does not cover this design." },
      { status: 403 },
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/_agent-native/actions/read-local-file");
      return denied;
    });

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/read-local-file?designId=other-design&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "The visual-edit capability does not cover this design.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
