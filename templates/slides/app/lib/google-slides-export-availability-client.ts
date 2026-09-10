import { agentNativePath } from "@agent-native/core/client/api-path";
import { useEffect, useState } from "react";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

/**
 * Every export surface asks the same question on mount, so the in-flight
 * request is shared rather than repeated per menu.
 */
let inFlight: Promise<GoogleSlidesExportAvailability> | null = null;

/**
 * The verdict is org-scoped on the server and can change without this page
 * reloading — switching organization only invalidates React Query caches, which
 * this module is not one of, and repairing the Google client fixes it server
 * side with no client event at all. So a resolved verdict expires instead of
 * living as long as the tab. The sibling status readers in this app refetch on
 * every mount; this keeps the shared dedupe while staying about as fresh.
 */
const VERDICT_TTL_MS = 30_000;

let cached: {
  value: GoogleSlidesExportAvailability;
  expiresAt: number;
} | null = null;

/**
 * Drops the cached verdict so the next export menu asks the server again. Call
 * this after a Google Slides export fails at runtime: the failure is evidence
 * the cached "available" answer may be stale, but not proof of it, so this
 * re-checks rather than assuming the integration is broken.
 */
export function invalidateGoogleSlidesExportAvailability(): void {
  inFlight = null;
  cached = null;
}

/** Exposed for tests; production callers rely on the TTL. */
export function resetGoogleSlidesExportAvailabilityCache(): void {
  inFlight = null;
  cached = null;
}

type StatusBody = { googleSlidesExport?: GoogleSlidesExportAvailability };

/** `unreadable` is kept distinct from a body that simply carries no verdict. */
async function readStatusBody(
  response: Response,
): Promise<{ body: StatusBody } | { unreadable: true }> {
  try {
    return { body: (await response.json()) as StatusBody };
  } catch {
    return { unreadable: true };
  }
}

async function load(): Promise<GoogleSlidesExportAvailability> {
  const response = await fetch(
    new URL(
      agentNativePath("/_agent-native/google-docs/status"),
      window.location.origin,
    ),
    { credentials: "same-origin" },
  );
  const result = await readStatusBody(response);
  // No verdict is not the same as a negative one. An older server, an auth
  // error, or an unreadable body says nothing about the integration, and
  // hiding a working export on that basis would be worse than the bug this
  // gate exists to prevent.
  if ("unreadable" in result) return { available: true };
  const reported = result.body?.googleSlidesExport;
  if (!reported || typeof reported.available !== "boolean") {
    return { available: true };
  }
  return reported;
}

export function fetchGoogleSlidesExportAvailability(): Promise<GoogleSlidesExportAvailability> {
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  inFlight ??= load()
    .catch(() => ({ available: true }) as GoogleSlidesExportAvailability)
    .then((value) => {
      cached = { value, expiresAt: Date.now() + VERDICT_TTL_MS };
      inFlight = null;
      return value;
    });
  return inFlight;
}

/**
 * `enabled` keeps the probe off the deck editor's load path: the answer is only
 * needed once an export menu is open, which is still long before anyone clicks.
 */
export function useGoogleSlidesExportAvailability(
  enabled: boolean,
): GoogleSlidesExportAvailability {
  const [availability, setAvailability] =
    useState<GoogleSlidesExportAvailability>({ available: true });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetchGoogleSlidesExportAvailability().then((result) => {
      if (active) setAvailability(result);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return availability;
}
