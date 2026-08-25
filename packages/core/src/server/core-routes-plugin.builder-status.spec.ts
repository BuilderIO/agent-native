import { describe, expect, it } from "vitest";

import {
  BUILDER_STATUS_ROUTE_SUFFIXES,
  mountBuilderStatusRouteAliases,
  resolveOAuthCustodyBuilderKeyStatus,
} from "./core-routes-plugin.js";

describe("Builder status route aliases", () => {
  it("retains the legacy path and mounts the neutral connection-status alias", () => {
    expect(BUILDER_STATUS_ROUTE_SUFFIXES).toEqual([
      "/builder/status",
      "/connection-status/builder",
    ]);
  });

  it("mounts both aliases with the exact same handler", () => {
    const handler = () => ({ configured: false });
    const mounted: Array<{ path: string; handler: typeof handler }> = [];

    mountBuilderStatusRouteAliases(
      (path, mountedHandler) => {
        mounted.push({ path, handler: mountedHandler });
      },
      "/_agent-native",
      handler,
    );

    expect(mounted.map(({ path }) => path)).toEqual([
      "/_agent-native/builder/status",
      "/_agent-native/connection-status/builder",
    ]);
    expect(mounted[0]?.handler).toBe(handler);
    expect(mounted[1]?.handler).toBe(handler);
  });
});

describe("resolveOAuthCustodyBuilderKeyStatus", () => {
  it("reports confirmed-absent keys distinctly from a failed key lookup", async () => {
    const confirmedAbsent = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => ({
        privateKey: null,
        publicKey: null,
        orgName: null,
        lookupFailed: false,
      }),
    });
    expect(confirmedAbsent.privateKeyConfigured).toBe(false);
    expect(confirmedAbsent.publicKeyConfigured).toBe(false);
    expect(confirmedAbsent).toMatchObject({ keyLookupFailed: false });

    // The store can also fail "softly" — resolving with lookupFailed: true
    // rather than throwing (e.g. an org-membership lookup error swallowed
    // inside resolveScopedBuilderCredentials). No `try/catch` around the
    // call would ever see this one; it has to come through on the field.
    const softFailure = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => ({
        privateKey: null,
        publicKey: null,
        orgName: null,
        lookupFailed: true,
      }),
    });
    expect(softFailure).toMatchObject({ keyLookupFailed: true });

    const thrown = await resolveOAuthCustodyBuilderKeyStatus({
      resolveCredentialsDetailed: async () => {
        throw new Error("credential store unavailable");
      },
    });
    // A transient failure to read the key pair must not read the same as
    // "the user never configured Builder keys" — the two states need a
    // caller-visible flag, not just an identical pair of `false`s.
    expect(thrown.privateKeyConfigured).toBe(false);
    expect(thrown.publicKeyConfigured).toBe(false);
    expect(thrown).toMatchObject({ keyLookupFailed: true });
  });
});
