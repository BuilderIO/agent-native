import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldBypassAuthForBuilderConnect } from "./auth.js";
import {
  BUILDER_RELAY_SECRET_ENV,
  BUILDER_RELAY_SIGNATURE_HEADER,
  BUILDER_RELAY_TIMESTAMP_HEADER,
  BUILDER_RELAY_FLOW_HEADER,
  BUILDER_RELAY_STATE_PARAM,
  buildBuilderCliAuthUrl,
  createBuilderRelayRequest,
  signBuilderPreviewRelayState,
  verifyBuilderPreviewRelayState,
  verifyBuilderRelayRequest,
  type BuilderRelayCredentials,
} from "./builder-browser.js";
import {
  consumeBuilderRelayRequest,
  type BuilderRelayPendingRecord,
} from "./core-routes-plugin.js";

const NOW = Date.UTC(2026, 6, 14, 18, 0, 0);
const OWNER = "owner@example.com";
const TARGET = "https://deploy-preview-42--content.netlify.app";
const FLOW_ID = "builderRelayFlowExample000001";
const SECRET = "builder-relay-secret-example";

const credentials: BuilderRelayCredentials = {
  privateKey: "private-key-example",
  publicKey: "public-key-example",
  userId: "user-example",
  orgName: "Example Organization",
  orgKind: "space",
  subscription: "example-plan",
  subscriptionLevel: "example-level",
  subscriptionName: "Example Plan",
  isEnterprise: false,
  isFreeAccount: false,
};

function makeRelay() {
  return signBuilderPreviewRelayState({
    ownerEmail: OWNER,
    targetOrigin: TARGET,
    basePath: "/content",
    flowId: FLOW_ID,
    now: NOW,
  });
}

function headersOf(request: ReturnType<typeof createBuilderRelayRequest>) {
  return {
    timestamp: request.headers[BUILDER_RELAY_TIMESTAMP_HEADER],
    flowId: request.headers[BUILDER_RELAY_FLOW_HEADER],
    signature: request.headers[BUILDER_RELAY_SIGNATURE_HEADER],
  };
}

describe("Builder preview callback relay", () => {
  const originalSecret = process.env[BUILDER_RELAY_SECRET_ENV];
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env[BUILDER_RELAY_SECRET_ENV] = SECRET;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env[BUILDER_RELAY_SECRET_ENV];
    } else {
      process.env[BUILDER_RELAY_SECRET_ENV] = originalSecret;
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("binds a versioned state to the owner, exact target, base path, purpose, and lifetime", () => {
    const relay = makeRelay();
    expect(verifyBuilderPreviewRelayState(relay.state, { now: NOW })).toEqual(
      relay.payload,
    );
    expect(relay.payload).toMatchObject({
      v: 1,
      purpose: "builder-preview-callback-relay",
      flowId: FLOW_ID,
      ownerEmail: OWNER,
      targetOrigin: TARGET,
      basePath: "/content",
      iat: NOW,
      exp: NOW + 10 * 60 * 1000,
    });
  });

  it("keeps the approved corporate callback as the first hop", () => {
    const relay = makeRelay();
    const cliAuthUrl = new URL(
      buildBuilderCliAuthUrl(
        "https://auth.agent-native.com",
        "callback-state-example",
        { previewOrigin: TARGET, relayState: relay.state },
      ),
    );
    const redirectUrl = new URL(cliAuthUrl.searchParams.get("redirect_url")!);
    expect(redirectUrl.origin).toBe("https://auth.agent-native.com");
    expect(redirectUrl.searchParams.get(BUILDER_RELAY_STATE_PARAM)).toBe(
      relay.state,
    );
    expect(cliAuthUrl.searchParams.get("preview_url")).toBe(
      "https://auth.agent-native.com",
    );
  });

  it("allows the HMAC-authenticated relay and corporate callback through the session guard", () => {
    const relay = makeRelay();
    const callbackEvent = {
      node: {
        req: {
          url: `/_agent-native/builder/callback?${BUILDER_RELAY_STATE_PARAM}=${encodeURIComponent(relay.state)}`,
        },
      },
      path: "/_agent-native/builder/callback",
    } as unknown as H3Event;
    expect(
      shouldBypassAuthForBuilderConnect(
        callbackEvent,
        "/_agent-native/builder/callback",
      ),
    ).toBe(true);
    expect(
      shouldBypassAuthForBuilderConnect(
        callbackEvent,
        "/_agent-native/builder/relay",
      ),
    ).toBe(true);
  });

  it("rejects tampered, expired, far-future, unsafe-target, and wrong-secret state", () => {
    const relay = makeRelay();
    const [encoded, mac] = relay.state.split(".");
    expect(
      verifyBuilderPreviewRelayState(`${encoded}.${mac.slice(0, -1)}x`, {
        now: NOW,
      }),
    ).toBeNull();
    expect(
      verifyBuilderPreviewRelayState(relay.state, {
        now: NOW + 10 * 60 * 1000 + 1,
      }),
    ).toBeNull();
    expect(
      verifyBuilderPreviewRelayState(relay.state, {
        now: NOW - 2 * 60 * 1000 - 1,
      }),
    ).toBeNull();
    process.env[BUILDER_RELAY_SECRET_ENV] = "different-secret-example";
    expect(
      verifyBuilderPreviewRelayState(relay.state, { now: NOW }),
    ).toBeNull();
    expect(() =>
      signBuilderPreviewRelayState({
        ownerEmail: OWNER,
        targetOrigin: "http://169.254.169.254",
        now: NOW,
      }),
    ).toThrow("not an approved preview origin");
  });

  it("fails closed when the dedicated relay secret is missing", () => {
    delete process.env[BUILDER_RELAY_SECRET_ENV];
    expect(() => makeRelay()).toThrow(BUILDER_RELAY_SECRET_ENV);
  });

  it("signs timestamp, flow id, and body digest and rejects body/time tampering", () => {
    const relay = makeRelay();
    const request = createBuilderRelayRequest(relay.state, credentials, {
      now: NOW,
    });
    const headers = headersOf(request);
    expect(
      verifyBuilderRelayRequest({
        body: request.body,
        ...headers,
        requestOrigin: TARGET,
        requestBasePath: "/content",
        now: NOW,
      }),
    ).not.toBeNull();
    expect(
      verifyBuilderRelayRequest({
        body: request.body.replace("public-key-example", "tampered-example"),
        ...headers,
        requestOrigin: TARGET,
        requestBasePath: "/content",
        now: NOW,
      }),
    ).toBeNull();
    expect(
      verifyBuilderRelayRequest({
        body: request.body,
        ...headers,
        requestOrigin: TARGET,
        requestBasePath: "/content",
        now: NOW + 2 * 60 * 1000 + 1,
      }),
    ).toBeNull();
    expect(
      verifyBuilderRelayRequest({
        body: request.body,
        ...headers,
        requestOrigin: "https://different-preview.netlify.app",
        requestBasePath: "/content",
        now: NOW,
      }),
    ).toBeNull();
    process.env[BUILDER_RELAY_SECRET_ENV] = "wrong-relay-secret-example";
    expect(
      verifyBuilderRelayRequest({
        body: request.body,
        ...headers,
        requestOrigin: TARGET,
        requestBasePath: "/content",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("moves credentials between isolated stores once and scopes solely from preview pending state", async () => {
    const gatewayStore = new Map<string, Record<string, unknown>>();
    const previewStore = new Map<string, Record<string, unknown>>();
    const previewCredentialStore = new Map<string, Record<string, unknown>>();
    gatewayStore.set("gateway-sentinel", { untouched: true });
    const relay = makeRelay();
    const pending: BuilderRelayPendingRecord = {
      ownerEmail: OWNER,
      orgId: "trusted-org",
      role: "admin",
      targetOrigin: TARGET,
      basePath: "/content",
      expiresAt: relay.payload.exp,
    };
    previewStore.set(`builder-pending-relay:${FLOW_ID}`, pending);

    const bodyCredentials = {
      ...credentials,
      ownerEmail: "attacker@example.com",
      orgId: "attacker-org",
      role: "owner",
    } as BuilderRelayCredentials;
    const request = createBuilderRelayRequest(relay.state, bodyCredentials, {
      now: NOW,
    });
    const writes: unknown[] = [];
    const dependencies = {
      getPending: async (key: string) => previewStore.get(key) ?? null,
      deletePending: async (key: string) => previewStore.delete(key),
      writeCredentials: async (
        ownerEmail: string,
        value: BuilderRelayCredentials,
        scope: { orgId: string | null; role: string | null },
      ) => {
        writes.push({ ownerEmail, value, scope });
        previewCredentialStore.set(ownerEmail, { value, scope });
      },
    };
    const input = {
      rawBody: request.body,
      ...headersOf(request),
      requestOrigin: TARGET,
      requestBasePath: "/content",
      now: NOW,
    };

    await expect(
      consumeBuilderRelayRequest(input, dependencies),
    ).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual([
      {
        ownerEmail: OWNER,
        value: credentials,
        scope: { orgId: "trusted-org", role: "admin" },
      },
    ]);
    expect(gatewayStore).toEqual(
      new Map([["gateway-sentinel", { untouched: true }]]),
    );
    expect(previewStore.size).toBe(0);
    expect(previewCredentialStore.get(OWNER)).toEqual({
      value: credentials,
      scope: { orgId: "trusted-org", role: "admin" },
    });

    await expect(
      consumeBuilderRelayRequest(input, dependencies),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: "No active Builder relay flow",
    });
    expect(writes).toHaveLength(1);
  });

  it("requires deleteSetting to report true before writing", async () => {
    const relay = makeRelay();
    const request = createBuilderRelayRequest(relay.state, credentials, {
      now: NOW,
    });
    const writeCredentials = vi.fn();
    const result = await consumeBuilderRelayRequest(
      {
        rawBody: request.body,
        ...headersOf(request),
        requestOrigin: TARGET,
        requestBasePath: "/content",
        now: NOW,
      },
      {
        getPending: async () => ({
          ownerEmail: OWNER,
          orgId: null,
          role: null,
          targetOrigin: TARGET,
          basePath: "/content",
          expiresAt: NOW + 1,
        }),
        deletePending: async () => false,
        writeCredentials,
      },
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Builder relay flow was already consumed",
    });
    expect(writeCredentials).not.toHaveBeenCalled();
  });

  it("keeps credentials out of the fixed second-hop URL and emits no secret logs", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const relay = makeRelay();
    const request = createBuilderRelayRequest(relay.state, credentials, {
      now: NOW,
    });
    expect(request.url).toBe(`${TARGET}/content/_agent-native/builder/relay`);
    expect(request.url).not.toContain("?");
    expect(request.url).not.toContain(credentials.privateKey);
    expect(request.url).not.toContain(credentials.publicKey);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
