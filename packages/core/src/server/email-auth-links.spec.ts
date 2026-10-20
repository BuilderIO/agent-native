import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emailAuthLinkFields,
  emailAuthLinkLandingPage,
  emailAuthLinkLandingUrl,
  emailAuthVerificationPath,
  emailAuthVerificationUrl,
} from "./email-auth-links.js";

describe("email authentication links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [
      "magic-link",
      "https://design.agent-native.com/_agent-native/auth/ba/magic-link/verify?token=magic-token&callbackURL=%2F_agent-native%2Fsign-in",
    ],
    [
      "verify-email",
      "https://design.agent-native.com/_agent-native/auth/ba/verify-email?token=verify-token&callbackURL=%2F_agent-native%2Fsign-in",
    ],
  ] as const)(
    "routes %s links through the confirmation page",
    (kind, value) => {
      const landing = emailAuthLinkLandingUrl(value);

      expect(landing).toBeTruthy();
      const url = new URL(landing!);
      expect(url.pathname).toBe("/_agent-native/auth/email-link/landing");
      expect(url.searchParams.get("kind")).toBe(kind);
      expect(url.searchParams.get("token")).toBe(
        kind === "magic-link" ? "magic-token" : "verify-token",
      );
      expect(url.searchParams.get("callbackURL")).toBe(
        "/_agent-native/sign-in",
      );
    },
  );

  it("preserves a base path and custom framework prefix exactly once", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/workspace");
    vi.stubEnv(
      "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
      "/_platform",
    );
    const landing = emailAuthLinkLandingUrl(
      "https://design.agent-native.com/workspace/_platform/auth/ba/verify-email?token=verify-token",
    );

    expect(new URL(landing!).pathname).toBe(
      "/workspace/_platform/auth/email-link/landing",
    );
  });

  it("leaves desktop links on their dedicated callback flow", () => {
    expect(
      emailAuthLinkLandingUrl(
        "https://dispatch.agent-native.com/_agent-native/auth/ba/magic-link/verify?token=magic-token&callbackURL=%2F_agent-native%2Fauth%2Fmagic-link%2Fdesktop-callback%3Fflow_id%3Dflow-1%26verifier%3Dverifier-1",
      ),
    ).toBeUndefined();
  });

  it("does not rewrite unknown auth endpoints or missing tokens", () => {
    expect(
      emailAuthLinkLandingUrl(
        "https://design.agent-native.com/_agent-native/auth/ba/reset-password?token=reset-token",
      ),
    ).toBeUndefined();
    expect(
      emailAuthLinkLandingUrl(
        "https://design.agent-native.com/_agent-native/auth/ba/verify-email",
      ),
    ).toBeUndefined();
  });

  it("reconstructs Better Auth verification requests on the app origin", () => {
    const values = {
      kind: "magic-link",
      token: "magic token",
      callbackURL: "/_agent-native/sign-in?verified=1",
      newUserCallbackURL: "https://design.agent-native.com/welcome",
    };
    const fields = emailAuthLinkFields(values);
    const target = emailAuthVerificationUrl(
      "https://design.agent-native.com/_agent-native/auth/ba/magic-link/verify",
      values,
    );

    expect(fields).toEqual(values);
    expect(target?.pathname).toBe("/_agent-native/auth/ba/magic-link/verify");
    expect(target?.searchParams.get("token")).toBe("magic token");
    expect(target?.searchParams.get("callbackURL")).toBe(
      "/_agent-native/sign-in?verified=1",
    );
    expect(
      emailAuthVerificationUrl(
        "https://design.agent-native.com/_agent-native/auth/ba/magic-link/verify",
        { ...values, callbackURL: "https://evil.example/steal" },
      )?.searchParams.get("callbackURL"),
    ).toBe("https://evil.example/steal");
    expect(
      emailAuthVerificationUrl(
        "https://design.agent-native.com/_agent-native/auth/ba/verify-email",
        { kind: "unsupported", token: "token" },
      ),
    ).toBeUndefined();
    expect(
      emailAuthLinkFields({
        kind: "magic-link",
        token: "token",
        callbackURL: 42,
      }),
    ).toBeUndefined();
  });

  it("wraps cross-origin magic-link callbacks for Better Auth to validate", () => {
    const callbackURL = "https://workspace.example.test/after-auth";
    const landing = emailAuthLinkLandingUrl(
      `https://design.agent-native.com/_agent-native/auth/ba/magic-link/verify?token=magic-token&callbackURL=${encodeURIComponent(callbackURL)}`,
    );

    expect(landing).toBeTruthy();
    expect(new URL(landing!).searchParams.get("callbackURL")).toBe(callbackURL);
  });

  it("renders a localized, non-cacheable POST confirmation form", async () => {
    const response = emailAuthLinkLandingPage(
      "https://design.agent-native.com/_agent-native/auth/email-link/landing",
      {
        kind: "verify-email",
        token: "token<&",
        callbackURL: '/sign-in?value="quoted"',
      },
      {
        title: "Continuar para iniciar sesión",
        message: "Selecciona Continuar para terminar de iniciar sesión.",
        action: "Continuar",
      },
      "es-ES",
      "ltr",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self'",
    );
    expect(html).toContain('<html lang="es-ES" dir="ltr">');
    expect(html).toContain('method="post"');
    expect(html).toContain("Continuar");
    expect(html).toContain("token&lt;&amp;");
    expect(html).toContain("&quot;quoted&quot;");
  });

  it("resolves only supported verification kinds", () => {
    expect(emailAuthVerificationPath("magic-link")).toBe(
      "/_agent-native/auth/ba/magic-link/verify",
    );
    expect(emailAuthVerificationPath("verify-email")).toBe(
      "/_agent-native/auth/ba/verify-email",
    );
    expect(emailAuthVerificationPath("reset-password")).toBeUndefined();
  });
});
