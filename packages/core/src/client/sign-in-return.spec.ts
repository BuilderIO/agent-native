import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeContinuation } from "../shared/sign-in-journey.js";
import { signInLandingLoader } from "./sign-in-landing.js";
import {
  buildSignInReturnHref,
  resolveSignInReturnHref,
  serverAuthReturnPath,
  serverMountReturnPath,
} from "./sign-in-return.js";

function stubUi(pathname: string, search = "", apiBaseUrl?: string) {
  vi.stubGlobal("window", {
    location: {
      pathname,
      search,
      hash: "",
      origin: "https://app.example.com",
      href: `https://app.example.com${pathname}${search}`,
    },
    __AGENT_NATIVE_CONFIG__: apiBaseUrl ? { apiBaseUrl } : {},
  });
}

function uiReturnTarget(href: string, serverBasePath = ""): string | null {
  const url = new URL(href);
  const resume = decodeContinuation(url.searchParams.get("c"), serverBasePath);
  if (!resume) return null;
  const hop = new URL(resume, url.origin);
  expect(hop.pathname).toBe(`${serverBasePath}/_agent-native/auth/ui-return`);
  return hop.searchParams.get("to");
}

describe("sign-in return with a separate server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the same-origin sign-in link when no server URL is set", () => {
    stubUi("/inbox", "?x=1");
    expect(resolveSignInReturnHref()).toMatch(/^\/sign-in\?c=/);
  });

  it("signs in on the server and resumes at the current UI location", () => {
    stubUi("/inbox", "?x=1", "https://api.example.com/mail");
    const href = resolveSignInReturnHref()!;
    expect(href).toMatch(/^https:\/\/api\.example\.com\/mail\/sign-in\?c=/);
    expect(uiReturnTarget(href, "/mail")).toBe(
      "https://app.example.com/inbox?x=1",
    );
  });

  it("does not mint a return from an auth entry page", () => {
    stubUi("/sign-in", "", "https://api.example.com");
    expect(resolveSignInReturnHref()).toBeNull();
    expect(buildSignInReturnHref()).toBe("https://api.example.com/sign-in");
  });

  it("falls back to the UI root when the location is too long to carry", () => {
    stubUi(`/inbox/${"a".repeat(600)}`, "", "https://api.example.com");
    expect(uiReturnTarget(resolveSignInReturnHref()!)).toBe(
      "https://app.example.com/",
    );
  });

  it("lands template root loaders on the UI home, not on themselves", () => {
    stubUi("/", "", "https://api.example.com");
    const response = signInLandingLoader({
      request: new Request("https://app.example.com/"),
    })!;
    expect(uiReturnTarget(response.headers.get("location")!)).toBe(
      "https://app.example.com/home",
    );
  });

  it("hands the server its own return path for auth steps it finishes", () => {
    stubUi("/inbox", "", "https://api.example.com/mail");
    const returnPath = serverAuthReturnPath("/clip/1?at=90");
    const hop = new URL(returnPath, "https://api.example.com");
    expect(hop.pathname).toBe("/mail/_agent-native/auth/ui-return");
    expect(hop.searchParams.get("to")).toBe(
      "https://app.example.com/clip/1?at=90",
    );
  });

  it("writes the UI return mount-relative for flows the server joins itself", () => {
    stubUi("/inbox", "", "https://api.example.com/mail");
    const hop = new URL(
      serverMountReturnPath("/settings?tab=github"),
      "https://api.example.com",
    );
    expect(hop.pathname).toBe("/_agent-native/auth/ui-return");
    expect(hop.searchParams.get("to")).toBe(
      "https://app.example.com/settings?tab=github",
    );
    stubUi("/inbox");
    expect(serverMountReturnPath("/settings")).toBe("/settings");
  });

  it("keeps the caller's return when the server shares the UI origin", () => {
    stubUi("/inbox");
    expect(serverAuthReturnPath("/clip/1")).toBe("/clip/1");
    expect(serverAuthReturnPath("/clip/1", "/sign-in?c=abc")).toBe(
      "/sign-in?c=abc",
    );
  });
});
