import { describe, expect, it, vi } from "vitest";

import type { GoogleOAuthPreflight } from "./google-oauth-preflight.js";
import {
  googleDriveRedirectUri,
  resolveGoogleSlidesExportAvailability,
} from "./google-slides-export-availability.js";

const ORIGIN = "https://beta.slides.example.com";

type PreflightArgs = {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
};

function preflightReturning(value: GoogleOAuthPreflight) {
  return vi.fn(async (_args: PreflightArgs) => value);
}

describe("resolveGoogleSlidesExportAvailability", () => {
  it("is unavailable when no Google OAuth client is configured", async () => {
    const preflight = preflightReturning({ status: "ok" });
    await expect(
      resolveGoogleSlidesExportAvailability({
        configured: false,
        clientId: null,
        origin: ORIGIN,
        preflight,
      }),
    ).resolves.toEqual({ available: false, reason: "not-configured" });
    expect(preflight).not.toHaveBeenCalled();
  });

  it("stays available for a connected account when no client is configured", async () => {
    // An unexpired stored upload token uploads without resolving client
    // credentials, so this export works and must not be gated.
    const preflight = preflightReturning({ status: "ok" });
    await expect(
      resolveGoogleSlidesExportAvailability({
        configured: false,
        clientId: null,
        origin: ORIGIN,
        hasUploadCapableAccount: true,
        preflight,
      }),
    ).resolves.toEqual({ available: true });
    // Nothing is about to start an authorization request, so nothing to probe.
    expect(preflight).not.toHaveBeenCalled();
  });

  it("stays available for a connected account even when Google rejects new grants", async () => {
    await expect(
      resolveGoogleSlidesExportAvailability({
        configured: true,
        clientId: "client-id",
        origin: ORIGIN,
        hasUploadCapableAccount: true,
        preflight: preflightReturning({
          status: "rejected",
          code: "redirect_uri_mismatch",
        }),
      }),
    ).resolves.toEqual({ available: true });
  });

  it("is unavailable when Google refuses the authorization request", async () => {
    await expect(
      resolveGoogleSlidesExportAvailability({
        configured: true,
        clientId: "client-id",
        origin: ORIGIN,
        preflight: preflightReturning({
          status: "rejected",
          code: "redirect_uri_mismatch",
        }),
      }),
    ).resolves.toEqual({
      available: false,
      reason: "oauth-rejected",
      code: "redirect_uri_mismatch",
    });
  });

  it("stays available when the probe reaches no verdict", async () => {
    await expect(
      resolveGoogleSlidesExportAvailability({
        configured: true,
        clientId: "client-id",
        origin: ORIGIN,
        preflight: preflightReturning({
          status: "unknown",
          reason: "TimeoutError",
        }),
      }),
    ).resolves.toEqual({ available: true });
  });

  it("probes the callback the export button actually navigates to", async () => {
    const preflight = preflightReturning({ status: "ok" });
    await resolveGoogleSlidesExportAvailability({
      configured: true,
      clientId: "client-id",
      origin: ORIGIN,
      preflight,
    });
    const args = preflight.mock.calls[0]?.[0];
    expect(args?.redirectUri).toBe(`${ORIGIN}/_agent-native/google/callback`);
    expect(args?.scopes).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
  });

  it("builds the shared root Google callback, not an app-scoped one", () => {
    expect(googleDriveRedirectUri(ORIGIN)).toBe(
      `${ORIGIN}/_agent-native/google/callback`,
    );
  });
});
