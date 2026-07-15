import { mockEvent, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldBypassAuthForBuilderConnect } from "./auth.js";
import {
  BUILDER_RELAY_SECRET_ENV,
  BUILDER_RELAY_TARGET_ORIGINS_ENV,
  BUILDER_RELAY_SIGNATURE_HEADER,
  BUILDER_RELAY_TIMESTAMP_HEADER,
  BUILDER_RELAY_FLOW_HEADER,
  BUILDER_RELAY_STATE_PARAM,
  buildBuilderCliAuthUrl,
  createBuilderBrowserCallbackErrorPage,
  createBuilderRelayRequest,
  signBuilderPreviewRelayState,
  verifyBuilderPreviewRelayState,
  verifyBuilderPreviewRelayStateForCallback,
  verifyBuilderRelayRequest,
  type BuilderRelayCredentials,
} from "./builder-browser.js";
import {
  consumeBuilderRelayRequest,
  readBuilderRelayRequestBody,
  type BuilderRelayPendingRecord,
} from "./core-routes-plugin.js";

const NOW = Date.UTC(2026, 6, 14, 18, 0, 0);
const OWNER = "owner@example.com";
const TARGET = "https://0123456789abcdef01234567--content.netlify.app";
const MUTABLE_TARGET = "https://deploy-preview-42--content.netlify.app";
const FLOW_ID = "builderRelayFlowExample000001";
const SECRET = "builder-relay-secret-example-at-least-32-characters";

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

function makeRelay(targetOrigin = TARGET) {
  return signBuilderPreviewRelayState({
    ownerEmail: OWNER,
    targetOrigin,
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

function callbackEvent(relayState: string, origin = TARGET): H3Event {
  return mockEvent(
    new Request(
      `${origin}/_agent-native/builder/callback?${BUILDER_RELAY_STATE_PARAM}=${encodeURIComponent(relayState)}`,
    ),
  );
}

describe("Builder preview callback relay", () => {
  const originalSecret = process.env[BUILDER_RELAY_SECRET_ENV];
  const originalTargetOrigins = process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV];
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env[BUILDER_RELAY_SECRET_ENV] = SECRET;
    process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV] = TARGET;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env[BUILDER_RELAY_SECRET_ENV];
    } else {
      process.env[BUILDER_RELAY_SECRET_ENV] = originalSecret;
    }
    if (originalTargetOrigins === undefined) {
      delete process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV];
    } else {
      process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV] = originalTargetOrigins;
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
    const event = callbackEvent(relay.state);
    expect(
      verifyBuilderPreviewRelayStateForCallback(relay.state, { now: NOW }),
    ).toEqual(relay.payload);
    expect(
      shouldBypassAuthForBuilderConnect(
        event,
        "/_agent-native/builder/callback",
      ),
    ).toBe(true);
    expect(
      shouldBypassAuthForBuilderConnect(event, "/_agent-native/builder/relay"),
    ).toBe(true);
  });

  it("requires the corporate callback target to be an exact allowlisted origin", () => {
    const relay = makeRelay();
    const event = callbackEvent(relay.state);

    process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV] =
      "https://another-preview.netlify.app, https://*.netlify.app";

    expect(verifyBuilderPreviewRelayState(relay.state, { now: NOW })).toEqual(
      relay.payload,
    );
    expect(
      verifyBuilderPreviewRelayStateForCallback(relay.state, { now: NOW }),
    ).toBeNull();
    expect(
      shouldBypassAuthForBuilderConnect(
        event,
        "/_agent-native/builder/callback",
      ),
    ).toBe(false);
  });

  it("rejects an allowlisted mutable Netlify deploy-preview alias at the callback", () => {
    const relay = makeRelay(MUTABLE_TARGET);
    const event = callbackEvent(relay.state, MUTABLE_TARGET);
    process.env[BUILDER_RELAY_TARGET_ORIGINS_ENV] = MUTABLE_TARGET;

    expect(verifyBuilderPreviewRelayState(relay.state, { now: NOW })).toEqual(
      relay.payload,
    );
    expect(
      verifyBuilderPreviewRelayStateForCallback(relay.state, { now: NOW }),
    ).toBeNull();
    expect(
      shouldBypassAuthForBuilderConnect(
        event,
        "/_agent-native/builder/callback",
      ),
    ).toBe(false);
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
    process.env[BUILDER_RELAY_SECRET_ENV] =
      "different-relay-secret-example-at-least-32-characters";
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

  it("describes relay setup failures as pre-authorization configuration errors", () => {
    const page = createBuilderBrowserCallbackErrorPage(
      `${BUILDER_RELAY_SECRET_ENV} is required for Builder preview authorization relay.`,
      {
        title: "Builder preview connection isn't configured",
        body: "This preview needs its secure Builder callback relay configured before authorization can start.",
        closeHint:
          "Close this popup and ask the preview owner to finish Builder relay setup.",
      },
    );

    expect(page).toContain("Builder preview connection isn&#39;t configured");
    expect(page).toContain("before authorization can start");
    expect(page).not.toContain("Builder authorized your account");
  });

  it("fails closed when the dedicated relay secret is shorter than 32 characters", () => {
    process.env[BUILDER_RELAY_SECRET_ENV] = "too-short-example";
    expect(() => makeRelay()).toThrow("at least 32 characters");
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
    process.env[BUILDER_RELAY_SECRET_ENV] =
      "wrong-relay-secret-example-at-least-32-characters";
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

  it("rejects an oversized relay body without relying on content-length", async () => {
    const request = new Request(
      `${TARGET}/content/_agent-native/builder/relay`,
      {
        method: "POST",
        body: "x".repeat(64 * 1024 + 1),
      },
    );
    expect(request.headers.get("content-length")).toBeNull();

    await expect(
      readBuilderRelayRequestBody(mockEvent(request)),
    ).rejects.toMatchObject({ status: 413 });
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
