import { describe, it, expect } from "vitest";

import {
  isLocalDevelopmentOrigin,
  parseWorkspaceUrl,
  shouldOfferWorkspace,
} from "./workspace-url.js";

describe("parseWorkspaceUrl", () => {
  it("normalizes a bare host to an https origin", () => {
    expect(parseWorkspaceUrl("agent-workspace.builder.io")).toEqual({
      ok: true,
      url: "https://agent-workspace.builder.io",
    });
  });

  it("drops path, query, and hash", () => {
    expect(
      parseWorkspaceUrl("https://workspace.example.com/apps?tab=1#x"),
    ).toEqual({ ok: true, url: "https://workspace.example.com" });
  });

  it("keeps an explicit port and scheme", () => {
    expect(parseWorkspaceUrl("http://localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
  });

  it("rejects non-http schemes rather than storing them as a link target", () => {
    // eslint-disable-next-line no-script-url
    expect(parseWorkspaceUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseWorkspaceUrl("data:text/html,x").ok).toBe(false);
  });

  it("rejects empty and hostname-less input", () => {
    expect(parseWorkspaceUrl("   ").ok).toBe(false);
    expect(parseWorkspaceUrl("workspace").ok).toBe(false);
  });
});

describe("shouldOfferWorkspace", () => {
  it("offers the workspace when the member is on another host", () => {
    expect(
      shouldOfferWorkspace(
        "https://dispatch.agent-native.com/apps",
        "https://agent-workspace.builder.io",
      ),
    ).toBe(true);
  });

  it("stays quiet when already on the workspace, whatever the path", () => {
    expect(
      shouldOfferWorkspace(
        "https://agent-workspace.builder.io/settings/team",
        "agent-workspace.builder.io",
      ),
    ).toBe(false);
  });

  it("stays quiet for an org with no workspace", () => {
    expect(
      shouldOfferWorkspace("https://dispatch.agent-native.com", null),
    ).toBe(false);
  });

  it("stays quiet rather than linking a stored value it cannot parse", () => {
    expect(
      shouldOfferWorkspace("https://dispatch.agent-native.com", "not a url"),
    ).toBe(false);
  });

  it("treats a differing port as a different deployment", () => {
    expect(
      shouldOfferWorkspace(
        "http://localhost:3000/apps",
        "http://localhost:4000",
      ),
    ).toBe(true);
  });
});

describe("isLocalDevelopmentOrigin", () => {
  it.each([
    "http://localhost:3000/apps",
    "http://127.0.0.1:3000/apps",
    "http://[::1]:3000/apps",
    "http://preview.localhost:3000/apps",
  ])("recognizes %s as local", (url) => {
    expect(isLocalDevelopmentOrigin(url)).toBe(true);
  });

  it("does not classify hosted previews as local", () => {
    expect(
      isLocalDevelopmentOrigin("https://dispatch.agent-native.com/apps"),
    ).toBe(false);
  });
});
