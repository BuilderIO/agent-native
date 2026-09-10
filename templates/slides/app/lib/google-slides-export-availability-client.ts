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
 * Drops the cached verdict so the next export menu asks the server again. Call
 * this after a Google Slides export fails at runtime: the failure is evidence
 * the cached "available" answer may be stale, but not proof of it, so this
 * re-checks rather than assuming the integration is broken.
 */
export function invalidateGoogleSlidesExportAvailability(): void {
  inFlight = null;
}

/** Exposed for tests; the promise is otherwise cached for the page's lifetime. */
export function resetGoogleSlidesExportAvailabilityCache(): void {
  inFlight = null;
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
  inFlight ??= load().catch(
    () => ({ available: true }) as GoogleSlidesExportAvailability,
  );
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
