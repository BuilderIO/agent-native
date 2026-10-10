// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  acceptNativeViewedSourceReplacement,
  beginNativeViewedSourceReplacement,
  registerNativeViewedSource,
} from "@/components/design/design-canvas/native-viewed-source-lease";

import { pinNativeViewedSource } from "./native-viewed-source-version";

function viewedSource(versionHash?: string) {
  const iframe = document.createElement("iframe");
  const doc = document.implementation.createHTMLDocument("Native source");
  const viewedWindow = {
    __agentNativeSourceProvenance: { versionHash: "" },
  };
  Object.defineProperties(iframe, {
    contentDocument: { configurable: true, value: doc },
    contentWindow: { configurable: true, value: viewedWindow },
  });
  document.body.appendChild(iframe);
  if (versionHash) registerNativeViewedSource(iframe, doc, versionHash);
  return { iframe, doc, viewedWindow };
}

describe("viewed native source pin", () => {
  afterEach(() => document.body.replaceChildren());

  it("pins host-authored source even when scripted positional proof is blank", () => {
    const source = viewedSource("14:abc");
    const pin = pinNativeViewedSource(source);
    expect(pin.expectedVersionHash).toBe("14:abc");
    expect(source.viewedWindow.__agentNativeSourceProvenance.versionHash).toBe(
      "",
    );
    pin.assertStillViewed();

    const requestId = beginNativeViewedSourceReplacement(
      source.iframe,
      source.doc,
      "15:def",
    );
    expect(pin.assertStillViewed).toThrowError(
      expect.objectContaining({ code: "source-stale" }),
    );
    expect(
      acceptNativeViewedSourceReplacement(source.iframe, source.doc, requestId),
    ).toBe(true);
    expect(pin.assertStillViewed).toThrowError(
      expect.objectContaining({ code: "source-stale" }),
    );
  });

  it("rejects a missing initial lease and a replaced iframe document", () => {
    const source = viewedSource();
    expect(() => pinNativeViewedSource(source)).toThrowError(
      expect.objectContaining({ code: "scene-unreadable" }),
    );
    registerNativeViewedSource(source.iframe, source.doc, "14:abc");
    const pin = pinNativeViewedSource(source);
    Object.defineProperty(source.iframe, "contentDocument", {
      configurable: true,
      value: document.implementation.createHTMLDocument("replacement"),
    });
    expect(pin.assertStillViewed).toThrowError(
      expect.objectContaining({ code: "source-stale" }),
    );
  });
});
