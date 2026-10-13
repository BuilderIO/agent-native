import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBuilderConnectState,
  getBuilderBrowserStatusForEvent,
  getBuilderBrowserOriginForEvent,
  getBuilderConnectCallbackOriginFromUrl,
  isBuilderConnectCallbackUrlAllowed,
  resolveBuilderConnectCallbackUrl,
} from "./builder-browser.js";
import { readBuilderConnectPendingState } from "./core-routes-plugin.js";

const PREVIEW_HOST = "preview-branch-abc123.builderio.xyz";
const PREVIEW_ORIGIN = "https://" + PREVIEW_HOST;
const ALIAS_ORIGIN = "https://forms.projects.builder.my";
const GATEWAY_ORIGIN = "http://127.0.0.1:8080";

const ORIGIN_ENV_KEYS = [
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "URL",
  "DEPLOY_URL",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "FUSION_ENV_ORIGIN",
  "VITE_FUSION_ENV_ORIGIN",
  "BUILDER_PREVIEW_URL",
  "VITE_BUILDER_PREVIEW_URL",
];

function createConnectEvent(
  headers: Record<string, string>,
  path = "/_agent-native/builder/connect",
): H3Event {
  const requestHeaders = new Headers(headers);
  return {
    req: {
      method: "GET",
      url: path,
      headers: requestHeaders,
      context: { clientAddress: "127.0.0.1" },
    },
    url: new URL(PREVIEW_ORIGIN + path),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        headers,
        socket: { remoteAddress: "127.0.0.1" },
        url: path,
        method: "GET",
      },
    },
    headers: requestHeaders,
    context: {},
    path,
  } as unknown as H3Event;
}

function directPreviewEvent(path?: string): H3Event {
  return createConnectEvent(
    { host: PREVIEW_HOST, "x-forwarded-proto": "https" },
    path,
  );
}

function proxiedPreviewEvent(path?: string): H3Event {
  return createConnectEvent(
    {
      host: "127.0.0.1:8080",
      "x-forwarded-host": PREVIEW_HOST,
      "x-forwarded-proto": "https",
    },
    path,
  );
}

const savedEnv = { ...process.env };

beforeEach(() => {
  for (const key of ORIGIN_ENV_KEYS) delete process.env[key];
  delete process.env.OAUTH_STATE_SECRET;
  process.env.BETTER_AUTH_SECRET = "test-secret-9f2a7c";
  process.env.AGENT_NATIVE_WORKSPACE = "1";
  process.env.WORKSPACE_OAUTH_ORIGIN = GATEWAY_ORIGIN + "/";
  process.env.WORKSPACE_GATEWAY_URL = GATEWAY_ORIGIN + "/";
  process.env.APP_URL = GATEWAY_ORIGIN + "/";
  process.env.BETTER_AUTH_URL = GATEWAY_ORIGIN + "/";
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  vi.restoreAllMocks();
});

describe("Builder connect callback origin behind a Builder-hosted preview", () => {
  it.each([
    ["preview Host preserved", directPreviewEvent],
    ["loopback proxy with forwarded preview Host", proxiedPreviewEvent],
  ])(
    "keeps the OAuth callback on the preview origin (%s)",
    (_label, createEvent) => {
      const event = createEvent();
      const state = createBuilderConnectState();
      const callbackUrl = resolveBuilderConnectCallbackUrl(event, state);

      expect(getBuilderBrowserOriginForEvent(event)).toBe(PREVIEW_ORIGIN);
      expect(callbackUrl).not.toContain("127.0.0.1");
      expect(callbackUrl).toBe(
        PREVIEW_ORIGIN +
          "/_agent-native/builder/callback?state=" +
          encodeURIComponent(state),
      );
      expect(isBuilderConnectCallbackUrlAllowed(callbackUrl!, event)).toBe(
        true,
      );
    },
  );

  it("resolves the same callback URL at connect and at callback time", () => {
    const state = createBuilderConnectState();
    const storedRedirectUri = resolveBuilderConnectCallbackUrl(
      directPreviewEvent(),
      state,
    );
    const expectedRedirectUri = resolveBuilderConnectCallbackUrl(
      directPreviewEvent("/_agent-native/builder/callback"),
      state,
    );

    expect(storedRedirectUri).toBeTruthy();
    expect(expectedRedirectUri).toBe(storedRedirectUri);
  });

  it("still uses the loopback origin for plain local development", () => {
    const event = createConnectEvent({ host: "127.0.0.1:8080" });
    const state = createBuilderConnectState();

    expect(resolveBuilderConnectCallbackUrl(event, state)).toBe(
      GATEWAY_ORIGIN +
        "/_agent-native/builder/callback?state=" +
        encodeURIComponent(state),
    );
  });

  it("keeps a loopback request on loopback even when a preview origin is in env", () => {
    process.env.FUSION_ENV_ORIGIN = PREVIEW_ORIGIN;
    const event = createConnectEvent({ host: "127.0.0.1:8080" });
    const state = createBuilderConnectState();

    expect(resolveBuilderConnectCallbackUrl(event, state)).toBe(
      GATEWAY_ORIGIN +
        "/_agent-native/builder/callback?state=" +
        encodeURIComponent(state),
    );
  });

  it("leaves a configured public deploy origin untouched", () => {
    for (const key of ORIGIN_ENV_KEYS) delete process.env[key];
    process.env.APP_URL = "https://workspace.example.com";
    const event = createConnectEvent({
      host: "workspace.example.com",
      "x-forwarded-proto": "https",
    });
    const state = createBuilderConnectState();

    expect(resolveBuilderConnectCallbackUrl(event, state)).toBe(
      "https://workspace.example.com/_agent-native/builder/callback?state=" +
        encodeURIComponent(state),
    );
  });

  it("keeps callback redirects on the same-origin Fusion preview alias", () => {
    process.env.NODE_ENV = "production";
    process.env.FUSION_ENV_ORIGIN = PREVIEW_ORIGIN;
    const statusEvent = createConnectEvent({
      host: "127.0.0.1:8080",
      "sec-fetch-site": "same-origin",
      "x-agent-native-preview-origin": ALIAS_ORIGIN,
    });
    const connectUrl = getBuilderBrowserStatusForEvent(statusEvent).connectUrl;
    const parsedConnectUrl = new URL(connectUrl);
    const connectEvent = createConnectEvent(
      { host: "127.0.0.1:8080" },
      parsedConnectUrl.pathname + parsedConnectUrl.search,
    );
    const state = createBuilderConnectState();
    const redirectUri = resolveBuilderConnectCallbackUrl(connectEvent, state);

    expect(parsedConnectUrl.origin).toBe(ALIAS_ORIGIN);
    expect(redirectUri).toBe(
      ALIAS_ORIGIN +
        "/_agent-native/builder/callback?state=" +
        encodeURIComponent(state),
    );

    const callbackEvent = createConnectEvent(
      { host: "127.0.0.1:8080" },
      "/_agent-native/builder/callback?state=" + encodeURIComponent(state),
    );
    const storedOrigin = getBuilderConnectCallbackOriginFromUrl(redirectUri!);

    expect(storedOrigin).toBe(ALIAS_ORIGIN);
    expect(
      resolveBuilderConnectCallbackUrl(callbackEvent, state, storedOrigin!),
    ).toBe(redirectUri);
    expect(
      isBuilderConnectCallbackUrlAllowed(
        redirectUri!,
        callbackEvent,
        storedOrigin!,
      ),
    ).toBe(true);
  });

  it("uses a same-origin proof for Builder Cloud hosts without app URL config", () => {
    process.env.NODE_ENV = "production";
    for (const key of ORIGIN_ENV_KEYS) delete process.env[key];
    const cloudOrigin = "https://forms.builder.cloud";
    const statusEvent = createConnectEvent({
      host: "forms.builder.cloud",
      "sec-fetch-site": "same-origin",
      "x-agent-native-preview-origin": cloudOrigin,
    });
    const connectUrl = getBuilderBrowserStatusForEvent(statusEvent).connectUrl;
    const parsedConnectUrl = new URL(connectUrl);
    const state = createBuilderConnectState();
    const connectEvent = createConnectEvent(
      { host: "forms.builder.cloud" },
      parsedConnectUrl.pathname + parsedConnectUrl.search,
    );

    expect(parsedConnectUrl.origin).toBe(cloudOrigin);
    expect(resolveBuilderConnectCallbackUrl(connectEvent, state)).toBe(
      cloudOrigin +
        "/_agent-native/builder/callback?state=" +
        encodeURIComponent(state),
    );
  });

  it("ignores preview-origin headers on cross-site status requests", () => {
    process.env.NODE_ENV = "production";
    process.env.FUSION_ENV_ORIGIN = PREVIEW_ORIGIN;
    const event = createConnectEvent({
      host: "127.0.0.1:8080",
      "sec-fetch-site": "cross-site",
      "x-agent-native-preview-origin": ALIAS_ORIGIN,
    });

    expect(getBuilderBrowserStatusForEvent(event).connectUrl).toBe(
      PREVIEW_ORIGIN + "/_agent-native/builder/connect",
    );
  });
});

describe("Builder connect callback without a matching pending flow", () => {
  it("denies a callback whose state was never issued", async () => {
    const unknownState = createBuilderConnectState();
    const read = vi.fn(async () => null);

    await expect(
      readBuilderConnectPendingState(unknownState, read as never),
    ).resolves.toBeNull();
    expect(read).toHaveBeenCalledWith(
      "builder-connect-pending:" + unknownState,
    );
  });

  it("accepts the pending row a fresh connect flow stored for this state", async () => {
    const state = createBuilderConnectState();
    const redirectUri = resolveBuilderConnectCallbackUrl(
      directPreviewEvent(),
      state,
    );
    const store = new Map<string, Record<string, unknown>>([
      [
        "builder-connect-pending:" + state,
        {
          ownerEmail: "owner@example.com",
          redirectUri,
          expiresAt: Date.now() + 600_000,
        },
      ],
    ]);
    const read = (async (key: string) => store.get(key) ?? null) as never;

    await expect(
      readBuilderConnectPendingState(state, read),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      redirectUri,
    });
  });
});
