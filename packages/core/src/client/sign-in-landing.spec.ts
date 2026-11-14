import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeContinuation,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { signInLandingLoader } from "./sign-in-landing.js";

describe("signInLandingLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    "",
    "?filter=unread#item",
    "?return=/sample",
    "?c=nested&return=/sample",
    "?name=%E2%9C%93&filter=a%26b",
  ])("reaches auth first with root query treated as home data %s", (suffix) => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    const response = signInLandingLoader({
      request: new Request(`https://workspace.example/sample${suffix}`),
      authFirst: true,
    });
    const location = new URL(
      response!.headers.get("location")!,
      "https://workspace.example",
    );
    expect(location.pathname).toBe("/sample/sign-in");
    expect(decodeContinuation(location.searchParams.get("c"), "/sample")).toBe(
      `/sample/home${suffix}`,
    );
    expect(
      signInJourney({
        at: location.pathname + location.search,
        continuation: location.searchParams.get("c"),
        basePath: "/sample",
        homePath: "/home",
      }).resumeHref,
    ).toBe(`/sample/home${suffix}`);
    expect(response!.headers.get("X-Remix-Reload-Document")).toBe("true");
    expect(response!.headers.get("x-agent-native-ssr-key")).toBe("query");
  });

  it("bounds an oversized auth-first continuation at the configured home", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    const response = signInLandingLoader({
      request: new Request(
        `https://workspace.example/sample?filter=${"x".repeat(600)}`,
      ),
      authFirst: true,
    });
    const location = new URL(
      response!.headers.get("location")!,
      "https://workspace.example",
    );
    expect(location.pathname).toBe("/sample/sign-in");
    expect(decodeContinuation(location.searchParams.get("c"), "/sample")).toBe(
      "/sample/home",
    );
  });

  it("keeps an auth-first app's root home available", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    vi.stubGlobal("window", {
      location: { pathname: "/sample" },
      __AGENT_NATIVE_CONFIG__: { appHomePath: "/" },
    });
    expect(signInLandingLoader({ authFirst: true })).toBeNull();
  });

  it("does not apply auth-first workspace handling to standalone entry", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "0");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    expect(
      signInLandingLoader({ authFirst: true })!.headers.get("location"),
    ).toBe("/sample/sign-in");
  });

  it("document-redirects to the mounted app sign-in page", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/account-expert");

    const response = signInLandingLoader();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account-expert/sign-in");
    expect(response.headers.get("X-Remix-Reload-Document")).toBe("true");
  });

  it("opens the mounted home directly in a shared workspace", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");

    const response = signInLandingLoader("/home");

    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("/mail/home");
    expect(response!.headers.get("X-Remix-Reload-Document")).toBe("true");
  });

  it("uses the workspace home when React Router supplies loader arguments", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    expect(
      signInLandingLoader({
        request: new Request("https://workspace.example/sample"),
      })!.headers.get("location"),
    ).toBe("/sample/home");
  });

  it("preserves workspace entry queries and fragments in the direct home handoff", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    const response = signInLandingLoader({
      request: new Request(
        "https://workspace.example/sample?filter=unread#item",
      ),
    });
    expect(response!.headers.get("location")).toBe(
      "/sample/home?filter=unread#item",
    );
    expect(response!.headers.get("x-agent-native-ssr-key")).toBe("query");
  });

  it.each(["/inbox", "/"])(
    "resolves the injected workspace home %s without a separate auth document",
    (homePath) => {
      vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
      vi.stubGlobal("window", {
        location: { pathname: "/sample" },
        __AGENT_NATIVE_CONFIG__: { appHomePath: homePath },
      });
      const result = signInLandingLoader();
      if (homePath === "/") expect(result).toBeNull();
      else expect(result!.headers.get("location")).toBe("/sample/inbox");
    },
  );

  it("uses an app's workspace-manifest home without importing a template catalog", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sample");
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APP_ID", "sample");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify({ apps: [{ id: "sample", homePath: "/inbox" }] }),
    );
    expect(signInLandingLoader()!.headers.get("location")).toBe(
      "/sample/inbox",
    );
  });

  it("keeps standalone home entry on the sign-in journey", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "0");
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");
    expect(signInLandingLoader("/home")!.headers.get("location")).toBe(
      "/mail/sign-in",
    );
  });

  it("preserves a workspace's explicit remote API sign-in journey", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      runtime: { apiBaseUrl: "https://api.example.test/mail" },
    });
    const response = signInLandingLoader(
      "/home",
      new Request("https://ui.example.test/mail"),
    );
    const target = new URL(response!.headers.get("location")!);
    expect(target.origin).toBe("https://api.example.test");
    expect(target.pathname).toBe("/mail/sign-in");
    const continuation = decodeContinuation(
      target.searchParams.get("c"),
      "/mail",
    );
    const uiReturn = new URL(continuation!, target.origin);
    expect(uiReturn.searchParams.get("to")).toBe(
      "https://ui.example.test/mail/home",
    );
  });

  it.each([
    "//outside.test/home",
    "/\\outside.test/home",
    "/home\nnext",
    "/home?next=outside",
    "/home#next",
    "/home\x7f",
  ])("does not use an unsafe workspace home %j", (home) => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/mail");
    expect(signInLandingLoader(home)!.headers.get("location")).toBe(
      "/mail/sign-in",
    );
  });

  it("leaves the root route available when it is the configured app home", () => {
    expect(signInLandingLoader("/")).toBeNull();
  });
});
