import { afterEach, describe, expect, it } from "vitest";
import { resolveLegacyToolsRedirect } from "./core-routes-plugin.js";

describe("resolveLegacyToolsRedirect", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  it("redirects /tools to /extensions", () => {
    expect(resolveLegacyToolsRedirect("/tools", "")).toBe("/extensions");
  });

  it("redirects /tools/<id> to /extensions/<id>", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc-123", "")).toBe(
      "/extensions/abc-123",
    );
  });

  it("preserves query strings", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc", "?foo=bar")).toBe(
      "/extensions/abc?foo=bar",
    );
  });

  it("redirects nested /tools/<id>/something paths", () => {
    expect(resolveLegacyToolsRedirect("/tools/abc/edit", "")).toBe(
      "/extensions/abc/edit",
    );
  });

  it("redirects under APP_BASE_PATH (workspace deploy)", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(resolveLegacyToolsRedirect("/dispatch/tools/abc", "")).toBe(
      "/dispatch/extensions/abc",
    );
  });

  it("redirects /tools under APP_BASE_PATH with no id", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(resolveLegacyToolsRedirect("/dispatch/tools", "?x=1")).toBe(
      "/dispatch/extensions?x=1",
    );
  });

  it("returns null for /_agent-native/tools (API namespace)", () => {
    expect(resolveLegacyToolsRedirect("/_agent-native/tools", "")).toBeNull();
    expect(
      resolveLegacyToolsRedirect("/_agent-native/tools/abc", ""),
    ).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(resolveLegacyToolsRedirect("/extensions", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/extensions/abc", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/inbox", "")).toBeNull();
  });

  it("does not match /toolsuffix or /tools-foo (must be exact or have / separator)", () => {
    expect(resolveLegacyToolsRedirect("/toolsfoo", "")).toBeNull();
    expect(resolveLegacyToolsRedirect("/tools-x", "")).toBeNull();
  });

  it("falls through when path is outside APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    // /tools without the /dispatch prefix is outside this app's base path,
    // so stripAppBasePath leaves it unchanged and the helper still matches.
    // The redirect target is built relative to the configured base path.
    expect(resolveLegacyToolsRedirect("/tools/abc", "")).toBe(
      "/dispatch/extensions/abc",
    );
  });

  it("VITE_APP_BASE_PATH wins over APP_BASE_PATH", () => {
    process.env.VITE_APP_BASE_PATH = "/mail";
    process.env.APP_BASE_PATH = "/ignored";
    expect(resolveLegacyToolsRedirect("/mail/tools/abc", "")).toBe(
      "/mail/extensions/abc",
    );
  });
});
