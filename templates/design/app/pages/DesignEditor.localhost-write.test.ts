import { describe, expect, it } from "vitest";

import { resolveLocalhostSourceWriteContent } from "./design-editor/editor-state";
import {
  localhostConsentRequestDisposition,
  localhostConsentRequestRefetchInterval,
} from "./design-editor/localhost-consent-request";

describe("resolveLocalhostSourceWriteContent", () => {
  it("uses the authenticated live snapshot for URL-backed HTML screens", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/settings",
        liveSnapshotHtml: "<!doctype html><html><body>Settings</body></html>",
      }),
    ).toContain("<body>Settings</body>");
  });

  it("fails closed while an HTML source snapshot is unavailable", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/settings",
        liveSnapshotHtml: undefined,
      }),
    ).toBeNull();
  });

  it("never treats a route URL as writable HTML or CSS source", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/",
        liveSnapshotHtml: "http://127.0.0.1:5173/",
      }),
    ).toBeNull();
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".css",
        persistedContent: "https://localhost:5173",
        liveSnapshotHtml: undefined,
      }),
    ).toBeNull();
  });

  it("allows an actual CSS source payload", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".css",
        persistedContent: ":root { --accent: #7c3aed; }",
        liveSnapshotHtml: undefined,
      }),
    ).toBe(":root { --accent: #7c3aed; }");
  });
});

describe("localhostConsentRequestDisposition", () => {
  it("shows and clears a new request", () => {
    expect(
      localhostConsentRequestDisposition({
        requestKey: "design:requested-at",
        lastHandledKey: null,
        failedClearKey: null,
      }),
    ).toBe("show-and-clear");
  });

  it("retries a failed clear without showing the request again", () => {
    expect(
      localhostConsentRequestDisposition({
        requestKey: "design:requested-at",
        lastHandledKey: "design:requested-at",
        failedClearKey: "design:requested-at",
      }),
    ).toBe("retry-clear");
  });

  it("ignores a request that was already cleared", () => {
    expect(
      localhostConsentRequestDisposition({
        requestKey: "design:requested-at",
        lastHandledKey: "design:requested-at",
        failedClearKey: null,
      }),
    ).toBe("ignore");
  });

  it("backs off idle polling and retries only a failed clear", () => {
    expect(
      localhostConsentRequestRefetchInterval({
        requestKey: null,
        failedClearKey: null,
        queryFailed: false,
      }),
    ).toBe(10_000);
    expect(
      localhostConsentRequestRefetchInterval({
        requestKey: "design:requested-at",
        failedClearKey: null,
        queryFailed: false,
      }),
    ).toBe(false);
    expect(
      localhostConsentRequestRefetchInterval({
        requestKey: "design:requested-at",
        failedClearKey: "design:requested-at",
        queryFailed: false,
      }),
    ).toBe(1_000);
  });
});
