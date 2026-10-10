// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  acceptNativeViewedSourceReplacement,
  beginNativeViewedSourceReplacement,
  invalidateNativeViewedSource,
  readNativeViewedSourceLease,
  registerNativeViewedSource,
} from "./native-viewed-source-lease";

function source() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return { iframe, doc: iframe.contentDocument! };
}

describe("parent-held native viewed source lease", () => {
  afterEach(() => document.body.replaceChildren());

  it("pins the loaded document and clears the pin until its exact morph is applied", () => {
    const { iframe, doc } = source();
    registerNativeViewedSource(iframe, doc, "14:abc");
    expect(readNativeViewedSourceLease(iframe, doc)).toBe("14:abc");

    const first = beginNativeViewedSourceReplacement(iframe, doc, "15:def");
    expect(readNativeViewedSourceLease(iframe, doc)).toBeUndefined();
    registerNativeViewedSource(iframe, doc, "14:abc");
    expect(readNativeViewedSourceLease(iframe, doc)).toBeUndefined();
    expect(acceptNativeViewedSourceReplacement(iframe, doc, "wrong")).toBe(
      false,
    );
    expect(acceptNativeViewedSourceReplacement(iframe, doc, first)).toBe(true);
    expect(readNativeViewedSourceLease(iframe, doc)).toBe("15:def");
  });

  it("rejects a late acknowledgement and never transfers a lease to a replacement document", () => {
    const { iframe, doc } = source();
    registerNativeViewedSource(iframe, doc, "14:abc");
    const oldRequest = beginNativeViewedSourceReplacement(
      iframe,
      doc,
      "15:def",
    );
    const newRequest = beginNativeViewedSourceReplacement(
      iframe,
      doc,
      "16:ghi",
    );
    expect(acceptNativeViewedSourceReplacement(iframe, doc, oldRequest)).toBe(
      false,
    );
    const replacement =
      document.implementation.createHTMLDocument("replacement");
    expect(
      acceptNativeViewedSourceReplacement(iframe, replacement, newRequest),
    ).toBe(false);
    expect(readNativeViewedSourceLease(iframe, replacement)).toBeUndefined();
    expect(acceptNativeViewedSourceReplacement(iframe, doc, newRequest)).toBe(
      true,
    );
    expect(readNativeViewedSourceLease(iframe, doc)).toBe("16:ghi");
    registerNativeViewedSource(iframe, replacement, "17:jkl");
    expect(readNativeViewedSourceLease(iframe, doc)).toBeUndefined();
    expect(readNativeViewedSourceLease(iframe, replacement)).toBe("17:jkl");
  });

  it("treats a late unversioned invalidation as an unreadable source", () => {
    const { iframe, doc } = source();
    registerNativeViewedSource(iframe, doc, "14:abc");
    const requestId = beginNativeViewedSourceReplacement(iframe, doc, "15:def");
    expect(acceptNativeViewedSourceReplacement(iframe, doc, requestId)).toBe(
      true,
    );
    invalidateNativeViewedSource(iframe, doc);
    expect(readNativeViewedSourceLease(iframe, doc)).toBeUndefined();
  });

  it("rejects malformed hashes instead of silently missing a pin", () => {
    const { iframe, doc } = source();
    expect(() => registerNativeViewedSource(iframe, doc, "")).toThrow(
      TypeError,
    );
    expect(() =>
      beginNativeViewedSourceReplacement(iframe, doc, "invalid"),
    ).toThrow();
  });

  it("invalidates after an unproven partial mutation and refuses a late ack", () => {
    const { iframe, doc } = source();
    registerNativeViewedSource(iframe, doc, "14:abc");
    const requestId = beginNativeViewedSourceReplacement(iframe, doc, "15:def");
    invalidateNativeViewedSource(iframe, doc);
    expect(acceptNativeViewedSourceReplacement(iframe, doc, requestId)).toBe(
      false,
    );
    expect(readNativeViewedSourceLease(iframe, doc)).toBeUndefined();
  });
});
