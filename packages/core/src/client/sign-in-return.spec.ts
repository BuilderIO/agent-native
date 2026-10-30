import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeContinuation } from "../shared/sign-in-journey.js";
import { signInLandingLoader } from "./sign-in-landing.js";
import {
  buildSignInReturnHref,
  resolveSignInReturnHref,
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
});
