import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBuilderConnectState,
  getBuilderBrowserOriginForEvent,
  isBuilderConnectCallbackUrlAllowed,
  resolveBuilderConnectCallbackUrl,
} from "./builder-browser.js";
import { readBuilderConnectPendingState } from "./core-routes-plugin.js";

const PREVIEW_HOST = "preview-branch-abc123.builderio.xyz";
const PREVIEW_ORIGIN = "https://" + PREVIEW_HOST;
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

/** Fusion edge keeps the preview Host all the way to the app server. */
function directPreviewEvent(path?: string): H3Event {
  return createConnectEvent(
    { host: PREVIEW_HOST, "x-forwarded-proto": "https" },
    path,
  );
}

/** Workspace gateway proxies to the app on loopback and forwards the host. */
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
  // A workspace deploy behind a Builder preview: every configured origin is
  // the loopback workspace gateway.
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
      // A loopback callback resolves on the visitor's machine, never on the
      // preview server that stored this flow's pending row.
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
    // What /builder/connect persists on the pending row.
    const storedRedirectUri = resolveBuilderConnectCallbackUrl(
      directPreviewEvent(),
      state,
    );
    // What /builder/callback recomputes to verify the round trip.
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
    // A local dev server started from a Fusion container advertises the preview
    // origin through FUSION_ENV_ORIGIN, but a browser that reached the app on
    // loopback shares the machine and must keep the loopback callback.
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
