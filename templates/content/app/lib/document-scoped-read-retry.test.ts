import { describe, expect, it } from "vitest";

import {
  documentScopedReadRetryDelay,
  documentScopedReadRetryOptions,
  isDocumentNotYetVisibleError,
  isWithinCreateSettlingWindow,
} from "./document-scoped-read-retry";

const settling = documentScopedReadRetryOptions(true);
const settled = documentScopedReadRetryOptions(false);

describe("document-scoped read retry", () => {
  it("treats 403 and 404 as a row that is not visible yet", () => {
    expect(isDocumentNotYetVisibleError({ status: 403 })).toBe(true);
    expect(isDocumentNotYetVisibleError({ status: 404 })).toBe(true);
  });

  it("does not classify other failures as not-yet-visible", () => {
    expect(isDocumentNotYetVisibleError({ status: 500 })).toBe(false);
    expect(isDocumentNotYetVisibleError({ status: 401 })).toBe(false);
    expect(isDocumentNotYetVisibleError(new Error("Failed to fetch"))).toBe(
      false,
    );
    expect(isDocumentNotYetVisibleError(undefined)).toBe(false);
  });

  it("rides out the create window with a bounded budget", () => {
    const error = { status: 403 };
    expect(settling.retry(0, error)).toBe(true);
    expect(settling.retry(3, error)).toBe(true);
    // The budget has to expire so a genuinely refused read still surfaces.
    expect(settling.retry(4, error)).toBe(false);
  });

  it("leaves every other failure class terminal on the first attempt", () => {
    expect(settling.retry(0, { status: 500 })).toBe(false);
    expect(settling.retry(0, { status: 502 })).toBe(false);
    expect(settling.retry(0, new Error("Failed to fetch"))).toBe(false);
  });

  it("does not retry a refusal once the row is past its settling window", () => {
    // A revoked share answers 403 exactly like a row that is not there yet.
    // Outside the window that is a real answer, not a window to ride out.
    expect(settled.retry(0, { status: 403 })).toBe(false);
    expect(settled.retry(0, { status: 404 })).toBe(false);
  });

  it("backs off between attempts and caps the wait", () => {
    expect(documentScopedReadRetryDelay(0)).toBe(250);
    expect(documentScopedReadRetryDelay(1)).toBe(500);
    expect(documentScopedReadRetryDelay(2)).toBe(1_000);
    expect(documentScopedReadRetryDelay(3)).toBe(2_000);
    expect(documentScopedReadRetryDelay(9)).toBe(2_000);
  });
});

describe("create settling window", () => {
  const now = Date.parse("2026-09-11T12:00:00.000Z");
  const at = (iso: string) => isWithinCreateSettlingWindow(iso, now);

  it("counts a just-created row as still settling", () => {
    expect(at("2026-09-11T12:00:00.000Z")).toBe(true);
    expect(at("2026-09-11T11:59:30.000Z")).toBe(true);
  });

  it("counts an established row as settled", () => {
    expect(at("2026-09-11T11:55:00.000Z")).toBe(false);
    expect(at("2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("absorbs a modestly skewed clock in either direction", () => {
    // A client behind the server reads its own fresh row as future-dated.
    expect(at("2026-09-11T12:00:30.000Z")).toBe(true);
    // A clock far enough off degrades to no retry rather than a wrong answer.
    expect(at("2026-09-11T12:30:00.000Z")).toBe(false);
  });

  it("treats an absent or unparseable timestamp as settled", () => {
    expect(isWithinCreateSettlingWindow(undefined, now)).toBe(false);
    expect(isWithinCreateSettlingWindow(null, now)).toBe(false);
    expect(isWithinCreateSettlingWindow("not a date", now)).toBe(false);
  });
});
