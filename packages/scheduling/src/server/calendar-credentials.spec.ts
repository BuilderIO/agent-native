import { afterEach, describe, expect, it, vi } from "vitest";

import { BookingLifecycleError } from "./booking-service.js";
import {
  isWorkspaceCalendarRef,
  resolveCalendarCredential,
  setCalendarCredentialResolver,
} from "./calendar-credentials.js";

afterEach(() => setCalendarCredentialResolver(null));

describe("resolving a calendar ref before a provider sees it", () => {
  it("returns a legacy id untouched, with no provider-facing credentials", async () => {
    const resolved = await resolveCalendarCredential(
      "legacy-row-id",
      "google_calendar",
    );
    expect(resolved).toEqual({ credentialId: "legacy-row-id" });
  });

  it("resolves a workspace ref through the host resolver and keeps the ref", async () => {
    const resolver = vi.fn(async () => ({ accessToken: "scoped-token" }));
    setCalendarCredentialResolver(resolver);
    const resolved = await resolveCalendarCredential(
      "workspace:20930b58-da7f-4ea4-b11e-999bd9b48fb4",
      "google_calendar",
    );
    expect(resolver).toHaveBeenCalledWith({
      connectionId: "20930b58-da7f-4ea4-b11e-999bd9b48fb4",
      providerKind: "google_calendar",
    });
    expect(resolved).toEqual({
      credentialId: "workspace:20930b58-da7f-4ea4-b11e-999bd9b48fb4",
      credentials: { accessToken: "scoped-token" },
    });
  });

  it("refuses every way a workspace ref can fail, and never falls back to a legacy read", async () => {
    const refusals: (() => void)[] = [
      () => setCalendarCredentialResolver(null),
      () => setCalendarCredentialResolver(async () => null),
      () => setCalendarCredentialResolver(async () => ({})),
      () =>
        setCalendarCredentialResolver(async () => {
          throw new Error("revoked");
        }),
      () => setCalendarCredentialResolver(async () => ({ accessToken: "x" })),
    ];
    for (const install of refusals) {
      install();
      const ref = install.toString().includes("accessToken")
        ? "workspace:   "
        : "workspace:connection-1";
      await expect(
        resolveCalendarCredential(ref, "google_calendar"),
      ).rejects.toBeInstanceOf(BookingLifecycleError);
      await expect(
        resolveCalendarCredential(ref, "google_calendar"),
      ).rejects.toBeInstanceOf(BookingLifecycleError);
    }
  });

  it("carries a typed code so the app can say which connection failed", async () => {
    setCalendarCredentialResolver(async () => null);
    try {
      await resolveCalendarCredential("workspace:c1", "office365");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(BookingLifecycleError);
      const lifecycle = error as BookingLifecycleError;
      expect(lifecycle.errorCode).toBe("calendar_credential_unavailable");
      expect(lifecycle.statusCode).toBe(502);
      expect(lifecycle.message).toBe(
        "That calendar connection is not available.",
      );
    }
  });

  it("recognises only the workspace form", () => {
    expect(isWorkspaceCalendarRef("workspace:abc")).toBe(true);
    expect(isWorkspaceCalendarRef("legacy")).toBe(false);
    expect(isWorkspaceCalendarRef(null)).toBe(false);
    expect(isWorkspaceCalendarRef(undefined)).toBe(false);
  });

  it("has nothing to resolve when no ref is stored", async () => {
    expect(await resolveCalendarCredential(null, "google_calendar")).toBeNull();
    expect(await resolveCalendarCredential("", "google_calendar")).toBeNull();
  });
});

describe("calendars outside the legacy table", () => {
  it("asks the host and keeps the ref a provider is called with", async () => {
    const { setExternalCalendarSource, getExternalCalendarSource } =
      await import("./calendar-credentials.js");
    const loader = async () => [
      {
        credentialId: "workspace:conn-1",
        providerKind: "google_calendar",
        calendarExternalIds: ["primary"],
      },
    ];
    setExternalCalendarSource(loader);
    expect(getExternalCalendarSource()).toBe(loader);
    expect(
      await getExternalCalendarSource()!({ userEmail: "owner@example.com" }),
    ).toEqual([
      {
        credentialId: "workspace:conn-1",
        providerKind: "google_calendar",
        calendarExternalIds: ["primary"],
      },
    ]);
    setExternalCalendarSource(null);
    expect(getExternalCalendarSource()).toBeNull();
  });
});
