import { describe, expect, it } from "vitest";

import {
  documentScopedReadRetryDelay,
  isDocumentNotYetVisibleError,
  retryDocumentScopedRead,
} from "./document-scoped-read-retry";

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
    expect(retryDocumentScopedRead(0, error)).toBe(true);
    expect(retryDocumentScopedRead(3, error)).toBe(true);
    // The budget has to expire so a genuinely refused read still surfaces.
    expect(retryDocumentScopedRead(4, error)).toBe(false);
  });

  it("leaves every other failure class terminal on the first attempt", () => {
    expect(retryDocumentScopedRead(0, { status: 500 })).toBe(false);
    expect(retryDocumentScopedRead(0, { status: 502 })).toBe(false);
    expect(retryDocumentScopedRead(0, new Error("Failed to fetch"))).toBe(
      false,
    );
  });

  it("backs off between attempts and caps the wait", () => {
    expect(documentScopedReadRetryDelay(0)).toBe(250);
    expect(documentScopedReadRetryDelay(1)).toBe(500);
    expect(documentScopedReadRetryDelay(2)).toBe(1_000);
    expect(documentScopedReadRetryDelay(3)).toBe(2_000);
    expect(documentScopedReadRetryDelay(9)).toBe(2_000);
  });
});
