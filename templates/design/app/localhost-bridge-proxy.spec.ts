// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  LOCALHOST_BRIDGE_RELAY_HEADER,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";
import {
  createLocalhostBridgeFetchProxy as createLocalhostBridgeFetchProxyImpl,
  installLocalhostBridgeFetchProxy,
  type LocalhostBridgeTransport,
} from "./localhost-bridge-proxy.js";

const pageOrigin = "https://beta.design.agent-native.com";
const transport: LocalhostBridgeTransport = {
  designId: "design_1",
  connectionId: "conn_1",
  bridgeUrl: "http://127.0.0.1:7666",
};
const testChainId = "c".repeat(48);

function createLocalhostBridgeFetchProxy(
  context: LocalhostBridgeTransport,
  fetchImpl: Parameters<typeof createLocalhostBridgeFetchProxyImpl>[1],
  options?: Parameters<typeof createLocalhostBridgeFetchProxyImpl>[2],
) {
  return createLocalhostBridgeFetchProxyImpl(context, fetchImpl, {
    ...options,
    createMotionRelayChainId:
      options?.createMotionRelayChainId ?? (() => testChainId),
  });
}

function relay(
  operation: LocalhostBridgeRelay["operation"],
  extra: Partial<LocalhostBridgeRelay> = {},
  context: LocalhostBridgeTransport = transport,
  requestOverride?: Record<string, unknown>,
): LocalhostBridgeRelay {
  const challenge =
    extra.challenge ??
    (extra.step ? "signed-server-challenge-placeholder" : undefined);
  const payload = extra.payload ?? {};
  let bridgeRequest: Record<string, unknown>;
  if (requestOverride ?? extra.bridgeRequest) {
    bridgeRequest = requestOverride ?? extra.bridgeRequest!;
  } else if (operation === "read-file") {
    bridgeRequest = {
      relPath: extra.path,
      ...(challenge ? { motionRelayChallenge: challenge } : {}),
    };
  } else if (operation === "verify-module-provenance") {
    bridgeRequest = {
      routePath: extra.path,
      modulePath: extra.relPath,
      ...(challenge ? { motionRelayChallenge: challenge } : {}),
    };
  } else if (operation === "list-files") {
    bridgeRequest = {};
  } else if (operation === "apply-edit" && payload.patch) {
    const patch = payload.patch as Record<string, unknown>;
    bridgeRequest = {
      relPath: extra.relPath,
      search: patch.search,
      replace: patch.replace,
      expectedVersionHash: payload.expectedVersionHash,
      requireExpectedVersionHash: payload.requireExpectedVersionHash,
      ...(challenge ? { motionRelayChallenge: challenge } : {}),
    };
  } else {
    bridgeRequest = {
      ...payload,
      relPath: extra.relPath ?? payload.relPath,
      ...(challenge ? { motionRelayChallenge: challenge } : {}),
    };
  }
  return {
    __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
    operation,
    designId: context.designId,
    connectionId: context.connectionId,
    ...extra,
    ...(challenge ? { challenge } : {}),
    ...(extra.step
      ? {
          chainId: testChainId,
          actionName: extra.actionName ?? "get-motion-timeline",
          inputHash: "d".repeat(64),
        }
      : {}),
    bridgeRequest,
    bridgeOperationCapability: "one-use-capability-placeholder",
  };
}

const operationReceipt = "a".repeat(64);

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
        expect(new Headers(init?.headers).has("X-Bridge-Token")).toBe(false);
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
          bridgeOperationCapability: "one-use-capability-placeholder",
        });
        return Response.json({
          content: "export default function App() {}\n",
          versionHash: "hash-1",
          operationReceipt,
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
          return Response.json(
            relay("write-file", { relPath: "src/App.tsx" }, transport, {
              relPath: "src/App.tsx",
              content: "export default function App() {}\n",
              expectedVersionHash: "hash-1",
              requireExpectedVersionHash: true,
            }),
          );
        }
        expect(url).toBe("http://127.0.0.1:7666/write-file");
        expect(new Headers(init?.headers).has("X-Bridge-Token")).toBe(false);
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
          content: "export default function App() {}\n",
          expectedVersionHash: "hash-1",
          requireExpectedVersionHash: true,
          bridgeOperationCapability: "one-use-capability-placeholder",
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

  it("reads a Motion source through the browser relay and resumes the query", async () => {
    const sourceRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-read",
    });
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          if (url.includes("continue-motion-localhost-relay")) {
            const body = JSON.parse(String(init?.body));
            expect(body).toMatchObject({
              action: "get-motion-timeline",
              input: {
                designId: "design_1",
                sourceRef: "screen_1",
              },
              responses: [
                {
                  relay: sourceRelay,
                  result: {
                    designId: "design_1",
                    connectionId: "conn_1",
                    path: "src/App.tsx",
                    content: "export default function App() {}\n",
                    versionHash: "hash-1",
                    readonly: false,
                    operationReceipt,
                  },
                },
              ],
            });
            return Response.json({
              timelines: [{ source: "recovered-react" }],
            });
          }
          expect(
            new Headers(init?.headers).get(LOCALHOST_BRIDGE_RELAY_HEADER),
          ).toBe("1");
          return Response.json(sourceRelay);
        }
        expect(url).toBe("http://127.0.0.1:7666/read-file");
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
          motionRelayChallenge: sourceRelay.challenge,
          bridgeOperationCapability: sourceRelay.bridgeOperationCapability,
        });
        return Response.json({
          content: "export default function App() {}\n",
          versionHash: "hash-1",
          operationReceipt,
        });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/get-motion-timeline?designId=design_1&sourceRef=screen_1`,
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      timelines: [{ source: "recovered-react" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("relays a route-rooted module membership proof without returning source content", async () => {
    const provenanceRelay = relay("verify-module-provenance", {
      path: "app/routes/home.tsx",
      relPath: "app/components/Card.tsx",
      step: "source-provenance",
      actionName: "apply-motion-edit",
    });
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          if (url.includes("continue-motion-localhost-relay")) {
            const continuation = JSON.parse(String(init?.body));
            expect(continuation.responses).toEqual([
              {
                relay: provenanceRelay,
                result: {
                  designId: "design_1",
                  connectionId: "conn_1",
                  routePath: "app/routes/home.tsx",
                  modulePath: "app/components/Card.tsx",
                  reachable: true,
                  operationReceipt,
                },
              },
            ]);
            return Response.json({ sourcePatched: true });
          }
          return Response.json(provenanceRelay);
        }
        expect(url).toBe("http://127.0.0.1:7666/verify-module-provenance");
        expect(JSON.parse(String(init?.body))).toEqual({
          routePath: "app/routes/home.tsx",
          modulePath: "app/components/Card.tsx",
          motionRelayChallenge: provenanceRelay.challenge,
          bridgeOperationCapability: provenanceRelay.bridgeOperationCapability,
        });
        return Response.json({
          routePath: "app/routes/home.tsx",
          modulePath: "app/components/Card.tsx",
          reachable: true,
          operationReceipt,
        });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/apply-motion-edit`,
      { method: "POST", body: JSON.stringify({ designId: "design_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sourcePatched: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not continue a Motion relay when the bridge omits its receipt", async () => {
    const sourceRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-read",
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(pageOrigin)) return Response.json(sourceRelay);
      return Response.json({ content: "source", versionHash: "a".repeat(64) });
    });
    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });

    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/get-motion-timeline?designId=design_1`,
      { method: "GET" },
    );

    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a distinct error for malformed Motion action JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        relay("read-file", { path: "src/App.tsx", step: "source-read" }),
      ),
    );
    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });

    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/apply-motion-edit`,
      { method: "POST", body: "{" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The Motion source relay action input is not valid JSON.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not treat a continuation 401 as a rejected localhost bridge token", async () => {
    const sourceRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-read",
    });
    const onBridgeTokenRejected = vi.fn();
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return url.includes("continue-motion-localhost-relay")
            ? Response.json({ error: "Session expired." }, { status: 401 })
            : Response.json(sourceRelay);
        }
        return Response.json({
          content: "export default function App() {}\n",
          versionHash: "hash-1",
          operationReceipt,
        });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
      onBridgeTokenRejected,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/get-motion-timeline?designId=design_1&sourceRef=screen_1`,
      { method: "GET" },
    );

    expect(response.status).toBe(401);
    expect(onBridgeTokenRejected).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("writes an applied Motion source edit through the relay before resuming", async () => {
    const sourceRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-read",
    });
    const writeRelay = relay("write-file", {
      relPath: "src/App.tsx",
      step: "source-write",
      payload: {
        relPath: "src/App.tsx",
        content: "export default function App() { /* managed motion */ }\n",
        expectedVersionHash: "hash-1",
        requireExpectedVersionHash: true,
      },
    });
    const actionInput = {
      designId: "design_1",
      sourceRef: "screen_1",
      localSource: {
        connectionId: "conn_1",
        modulePath: "src/App.tsx",
        moduleVersionHash: "hash-1",
      },
      tracks: [],
      durationMs: 500,
    };
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          if (url.includes("continue-motion-localhost-relay")) {
            const body = JSON.parse(String(init?.body));
            if (body.responses.length === 1) {
              expect(body).toMatchObject({
                action: "apply-motion-edit",
                input: actionInput,
                responses: [
                  {
                    relay: sourceRelay,
                    result: {
                      designId: "design_1",
                      connectionId: "conn_1",
                      path: "src/App.tsx",
                      content: "export default function App() {}\n",
                      versionHash: "hash-1",
                      readonly: false,
                    },
                  },
                ],
              });
              return Response.json(writeRelay);
            }
            expect(body.responses).toHaveLength(2);
            expect(body.responses[1].relay).toEqual(writeRelay);
            expect(body.responses[1].result).toMatchObject({
              designId: "design_1",
              relPath: "src/App.tsx",
              operation: "write",
              written: true,
              versionHash: "hash-2",
              operationReceipt,
            });
            return Response.json({ persisted: true, sourcePatched: true });
          }
          expect(
            new Headers(init?.headers).get(LOCALHOST_BRIDGE_RELAY_HEADER),
          ).toBe("1");
          return Response.json(sourceRelay);
        }
        if (url.endsWith("/read-file")) {
          return Response.json({
            content: "export default function App() {}\n",
            versionHash: "hash-1",
            operationReceipt,
          });
        }
        expect(url).toBe("http://127.0.0.1:7666/write-file");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          ...writeRelay.bridgeRequest,
          bridgeOperationCapability: writeRelay.bridgeOperationCapability,
        });
        expect(new Headers(init?.headers).has("X-Bridge-Token")).toBe(false);
        return Response.json({ versionHash: "hash-2", operationReceipt });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/apply-motion-edit`,
      { method: "POST", body: JSON.stringify(actionInput) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      persisted: true,
      sourcePatched: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("confirms a Motion timeline removal through the relay before resuming", async () => {
    const initialSource = "export default function App() { /* managed */ }\n";
    const cleanedSource = "export default function App() {}\n";
    const sourceRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-read",
    });
    const writeRelay = relay("write-file", {
      relPath: "src/App.tsx",
      step: "source-write",
      payload: {
        relPath: "src/App.tsx",
        content: cleanedSource,
        expectedVersionHash: "hash-1",
        requireExpectedVersionHash: true,
      },
    });
    const confirmRelay = relay("read-file", {
      path: "src/App.tsx",
      step: "source-confirm",
    });
    const actionInput = { designId: "design_1", timelineId: "timeline_1" };
    let readCount = 0;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          if (url.includes("continue-motion-localhost-relay")) {
            const body = JSON.parse(String(init?.body));
            if (body.responses.length === 1) {
              return Response.json(writeRelay);
            }
            if (body.responses.length === 2) {
              return Response.json(confirmRelay);
            }
            expect(body).toMatchObject({
              action: "remove-motion-timeline",
              input: actionInput,
              responses: [
                { relay: sourceRelay },
                { relay: writeRelay },
                { relay: confirmRelay },
              ],
            });
            expect(body.responses[2].result).toMatchObject({
              content: cleanedSource,
              versionHash: "hash-2",
            });
            return Response.json({ deleted: true, sourcePatched: true });
          }
          return Response.json(sourceRelay);
        }
        if (url.endsWith("/read-file")) {
          readCount += 1;
          return Response.json({
            content: readCount === 1 ? initialSource : cleanedSource,
            versionHash: readCount === 1 ? "hash-1" : "hash-2",
            operationReceipt,
          });
        }
        expect(url).toBe("http://127.0.0.1:7666/write-file");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          ...writeRelay.bridgeRequest,
          bridgeOperationCapability: writeRelay.bridgeOperationCapability,
        });
        return Response.json({ versionHash: "hash-2", operationReceipt });
      },
    );

    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });
    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/remove-motion-timeline`,
      { method: "POST", body: JSON.stringify(actionInput) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      sourcePatched: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("flattens an apply-edit patch before sending it to the bridge", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return Response.json(
            relay("apply-edit", { relPath: "src/App.tsx" }, transport, {
              relPath: "src/App.tsx",
              search: "old",
              replace: "new",
              expectedVersionHash: "hash-1",
              requireExpectedVersionHash: true,
            }),
          );
        }
        expect(url).toBe("http://127.0.0.1:7666/apply-edit");
        expect(JSON.parse(String(init?.body))).toEqual({
          relPath: "src/App.tsx",
          search: "old",
          replace: "new",
          expectedVersionHash: "hash-1",
          requireExpectedVersionHash: true,
          bridgeOperationCapability: "one-use-capability-placeholder",
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
          patch: {
            search: "old",
            replace: "new",
            relPath: "other.ts",
            expectedVersionHash: "attacker-hash",
            requireExpectedVersionHash: false,
          },
          expectedVersionHash: "hash-1",
          requireExpectedVersionHash: true,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      designId: "design_1",
      relPath: "src/App.tsx",
      operation: "patch",
      written: true,
      versionHash: "hash-2",
    });
  });

  it.each(["read-file", "list-files", "write-file", "apply-edit"] as const)(
    "rejects a successful %s response without its required payload",
    async (operation) => {
      const fetchImpl = vi.fn(
        async (input: RequestInfo | URL): Promise<Response> => {
          const url = String(input);
          if (url.startsWith(pageOrigin)) {
            return Response.json(
              relay(operation, {
                ...(operation === "read-file" ? { path: "src/App.tsx" } : {}),
                ...(operation === "write-file" || operation === "apply-edit"
                  ? { relPath: "src/App.tsx" }
                  : {}),
              }),
            );
          }
          return Response.json({});
        },
      );
      const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
        origin: pageOrigin,
      });
      const request =
        operation === "read-file"
          ? `${pageOrigin}/_agent-native/actions/read-local-file?designId=design_1&connectionId=conn_1&path=src%2FApp.tsx`
          : operation === "list-files"
            ? `${pageOrigin}/_agent-native/actions/list-local-files?designId=design_1&connectionId=conn_1`
            : `${pageOrigin}/_agent-native/actions/write-local-file`;
      const response = await proxy(request, {
        method:
          operation === "write-file" || operation === "apply-edit"
            ? "POST"
            : "GET",
        ...(operation === "write-file" || operation === "apply-edit"
          ? {
              body: JSON.stringify({
                designId: "design_1",
                connectionId: "conn_1",
                relPath: "src/App.tsx",
                content: "new",
                ...(operation === "apply-edit"
                  ? { patch: { search: "old", replace: "new" } }
                  : {}),
              }),
            }
          : {}),
      });

      expect(response.status).toBe(502);
    },
  );

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

  it("does not follow a bridge redirect with the bridge token", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return Response.json(relay("read-file", { path: "src/App.tsx" }));
        }
        expect(new Headers(init?.headers).has("X-Bridge-Token")).toBe(false);
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example/collect" },
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

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The local visual-edit bridge returned an unexpected redirect.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an opaque browser redirect without constructing status zero", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return Response.json(relay("read-file", { path: "src/App.tsx" }));
        }
        return {
          ok: false,
          status: 0,
          type: "opaqueredirect",
        } as Response;
      },
    );
    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
    });

    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/read-local-file?designId=design_1&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The local visual-edit bridge returned an unexpected redirect.",
    });
  });

  it("notifies the caller when the bridge rejects the cached token", async () => {
    const onBridgeTokenRejected = vi.fn();
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.startsWith(pageOrigin)) {
          return Response.json(relay("read-file", { path: "src/App.tsx" }));
        }
        return Response.json(
          { error: "Invalid bridge token." },
          { status: 401 },
        );
      },
    );
    const proxy = createLocalhostBridgeFetchProxy(transport, fetchImpl, {
      origin: pageOrigin,
      onBridgeTokenRejected,
    });

    const response = await proxy(
      `${pageOrigin}/_agent-native/actions/read-local-file?designId=design_1&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );

    expect(response.status).toBe(401);
    expect(onBridgeTokenRejected).toHaveBeenCalledTimes(1);
  });

  it("drops a rejected persisted token and restores the original fetch", async () => {
    window.sessionStorage.setItem(
      "agent-native:visual-edit-bridge-v1",
      JSON.stringify(transport),
    );
    const originalFetch = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.startsWith(window.location.origin)) {
          return Response.json(relay("read-file", { path: "src/App.tsx" }));
        }
        return Response.json(
          { error: "Invalid bridge token." },
          { status: 401 },
        );
      },
    );
    window.fetch = originalFetch as typeof window.fetch;

    installLocalhostBridgeFetchProxy(transport);
    const proxiedFetch = window.fetch;
    const response = await window.fetch(
      `${window.location.origin}/_agent-native/actions/read-local-file?designId=design_1&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );

    expect(response.status).toBe(401);
    expect(
      window.sessionStorage.getItem("agent-native:visual-edit-bridge-v1"),
    ).toBeNull();
    expect(window.fetch).not.toBe(proxiedFetch);
  });

  it("does not let an old relay rejection tear down the newer proxy", async () => {
    const transportA = {
      ...transport,
      designId: "design-a",
      bridgeUrl: "http://127.0.0.1:7666",
    };
    const transportB = {
      ...transport,
      designId: "design-b",
      bridgeUrl: "http://127.0.0.1:7667",
    };
    const onRejectedA = vi.fn();
    let resolveA!: (response: Response) => void;
    const pendingA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const originalFetch = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.startsWith(window.location.origin)) {
          return url.includes("design-a")
            ? Response.json(
                relay("read-file", { path: "src/App.tsx" }, transportA),
              )
            : Response.json(
                relay("read-file", { path: "src/App.tsx" }, transportB),
              );
        }
        if (url === `${transportA.bridgeUrl}/read-file`) return pendingA;
        return Response.json({ content: "new", versionHash: "hash-b" });
      },
    );
    window.fetch = originalFetch as typeof window.fetch;

    installLocalhostBridgeFetchProxy(transportA, {
      onBridgeTokenRejected: onRejectedA,
    });
    const requestA = window.fetch(
      `${window.location.origin}/_agent-native/actions/read-local-file?designId=design-a&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );
    await Promise.resolve();

    const disposeB = installLocalhostBridgeFetchProxy(transportB);
    resolveA(
      Response.json({ error: "Invalid bridge token." }, { status: 401 }),
    );
    await requestA;

    expect(onRejectedA).not.toHaveBeenCalled();
    expect(window.fetch).not.toBe(originalFetch);
    const responseB = await window.fetch(
      `${window.location.origin}/_agent-native/actions/read-local-file?designId=design-b&connectionId=conn_1&path=src%2FApp.tsx`,
      { method: "GET" },
    );
    expect(responseB.status).toBe(200);
    await expect(responseB.json()).resolves.toMatchObject({
      designId: "design-b",
      content: "new",
    });
    disposeB();
  });
});
