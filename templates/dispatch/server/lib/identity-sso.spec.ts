import { describe, it, expect } from "vitest";

import {
  DEFAULT_ALLOWED_HOST_SUFFIXES,
  IDENTITY_SCOPE,
  IDENTITY_TOKEN_TTL,
  IDENTITY_TOKEN_TTL_SECONDS,
  buildIdentityClaims,
  buildRedirectLocation,
  getConfiguredHostSuffixes,
  isAllowedRedirectUri,
} from "./identity-sso.js";

describe("isAllowedRedirectUri — the critical open-redirect guard", () => {
  describe("accepts first-party + localhost", () => {
    it("accepts https first-party subdomains", () => {
      expect(isAllowedRedirectUri("https://mail.agent-native.com/cb")).toBe(
        true,
      );
      expect(
        isAllowedRedirectUri("https://calendar.agent-native.com/auth/callback"),
      ).toBe(true);
      expect(
        isAllowedRedirectUri("https://analytics.agent-native.com/x?a=1#frag"),
      ).toBe(true);
    });

    it("accepts deep first-party subdomains", () => {
      expect(isAllowedRedirectUri("https://a.b.c.agent-native.com/cb")).toBe(
        true,
      );
    });

    it("accepts localhost over http and https (dev)", () => {
      expect(isAllowedRedirectUri("http://localhost:3000/cb")).toBe(true);
      expect(isAllowedRedirectUri("https://localhost:3000/cb")).toBe(true);
      expect(isAllowedRedirectUri("http://127.0.0.1:5173/auth")).toBe(true);
      expect(isAllowedRedirectUri("http://[::1]:8080/cb")).toBe(true);
    });

    it("accepts an extra host suffix passed explicitly", () => {
      expect(
        isAllowedRedirectUri("https://app.staging.example.com/cb", {
          allowedHostSuffixes: [".staging.example.com"],
        }),
      ).toBe(true);
    });
  });

  describe("REJECTS everything else", () => {
    it("rejects a plain evil host", () => {
      expect(isAllowedRedirectUri("https://evil.com/cb")).toBe(false);
      expect(isAllowedRedirectUri("https://evil.com/")).toBe(false);
    });

    it("rejects suffix-spoof: agent-native.com.evil.com", () => {
      expect(isAllowedRedirectUri("https://agent-native.com.evil.com/cb")).toBe(
        false,
      );
    });

    it("rejects prefix/substring-spoof hosts", () => {
      expect(isAllowedRedirectUri("https://evil-agent-native.com/cb")).toBe(
        false,
      );
      expect(isAllowedRedirectUri("https://notagent-native.com/cb")).toBe(
        false,
      );
      // bare apex is intentionally NOT allowed (apps are subdomains)
      expect(isAllowedRedirectUri("https://agent-native.com/cb")).toBe(false);
    });

    it("rejects non-https for non-loopback hosts", () => {
      expect(isAllowedRedirectUri("http://mail.agent-native.com/cb")).toBe(
        false,
      );
    });

    it("rejects non-http(s) schemes", () => {
      expect(isAllowedRedirectUri("javascript:alert(document.cookie)")).toBe(
        false,
      );
      expect(isAllowedRedirectUri("data:text/html;base64,PHNjcmlwdD4=")).toBe(
        false,
      );
      expect(isAllowedRedirectUri("ftp://mail.agent-native.com/cb")).toBe(
        false,
      );
    });

    it("rejects embedded credentials (open-redirect obfuscation)", () => {
      // userinfo host is good, but the URL parser host is good too — the
      // credential form is still an exfil/obfuscation vector, reject it.
      expect(
        isAllowedRedirectUri("https://attacker@mail.agent-native.com/cb"),
      ).toBe(false);
      expect(isAllowedRedirectUri("https://u:p@mail.agent-native.com/cb")).toBe(
        false,
      );
      // Classic trick: real host in userinfo, evil host is the real host.
      expect(
        isAllowedRedirectUri("https://mail.agent-native.com@evil.com/cb"),
      ).toBe(false);
    });

    it("rejects relative / non-absolute / empty / non-string", () => {
      expect(isAllowedRedirectUri("/relative/path")).toBe(false);
      expect(isAllowedRedirectUri("mail.agent-native.com/cb")).toBe(false);
      expect(isAllowedRedirectUri("")).toBe(false);
      expect(isAllowedRedirectUri(undefined)).toBe(false);
      expect(isAllowedRedirectUri(null)).toBe(false);
      expect(isAllowedRedirectUri(42)).toBe(false);
      expect(isAllowedRedirectUri({})).toBe(false);
    });

    it("rejects scheme-relative //evil.com", () => {
      expect(isAllowedRedirectUri("//evil.com/cb")).toBe(false);
    });

    it("rejects control chars (CRLF header injection / NUL / DEL)", () => {
      expect(
        isAllowedRedirectUri(
          "https://mail.agent-native.com/cb\r\nSet-Cookie: x=1",
        ),
      ).toBe(false);
      // NUL and DEL bytes via escapes so this source stays plain ASCII.
      expect(
        isAllowedRedirectUri(
          "https://mail.agent-native.com/cb" + String.fromCharCode(0),
        ),
      ).toBe(false);
      expect(
        isAllowedRedirectUri(
          "https://mail.agent-native.com/cb" + String.fromCharCode(127),
        ),
      ).toBe(false);
    });

    it("does not allow the configured env suffix to be empty/wildcard", () => {
      expect(getConfiguredHostSuffixes({} as NodeJS.ProcessEnv)).toEqual([]);
      expect(
        getConfiguredHostSuffixes({
          IDENTITY_SSO_ALLOWED_HOST_SUFFIXES: " , . , ",
        } as unknown as NodeJS.ProcessEnv),
      ).toEqual([]);
      expect(
        getConfiguredHostSuffixes({
          IDENTITY_SSO_ALLOWED_HOST_SUFFIXES:
            "staging.example.com, .preview.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toEqual([".staging.example.com", ".preview.example.com"]);
    });
  });

  it("default allowlist is exactly .agent-native.com", () => {
    expect(DEFAULT_ALLOWED_HOST_SUFFIXES).toEqual([".agent-native.com"]);
  });
});

describe("buildIdentityClaims — exact claim set, no secrets", () => {
  it("produces sub/email/scope/jti and omits empty optionals", () => {
    const c = buildIdentityClaims({ email: "user@acme.com" });
    expect(c.sub).toBe("user@acme.com");
    expect(c.email).toBe("user@acme.com");
    expect(c.scope).toBe(IDENTITY_SCOPE);
    expect(c.scope).toBe("identity");
    expect(typeof c.jti).toBe("string");
    expect(c.jti.length).toBeGreaterThan(10);
    expect("name" in c).toBe(false);
    expect("org_domain" in c).toBe(false);
  });

  it("includes name + org_domain when present", () => {
    const c = buildIdentityClaims({
      email: "u@acme.com",
      name: "  Ada Lovelace ",
      orgDomain: " acme.com ",
    });
    expect(c.name).toBe("Ada Lovelace");
    expect(c.org_domain).toBe("acme.com");
  });

  it("omits blank name / org_domain", () => {
    const c = buildIdentityClaims({
      email: "u@acme.com",
      name: "   ",
      orgDomain: "",
    });
    expect("name" in c).toBe(false);
    expect("org_domain" in c).toBe(false);
  });

  it("never carries a password/secret-like field", () => {
    const c = buildIdentityClaims({ email: "u@acme.com", name: "U" });
    const keys = Object.keys(c).sort();
    expect(keys).toEqual(["email", "jti", "name", "scope", "sub"]);
  });

  it("jti is unique per call", () => {
    const a = buildIdentityClaims({ email: "u@acme.com" });
    const b = buildIdentityClaims({ email: "u@acme.com" });
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("token TTL", () => {
  it("is short (<= 5 min) and the jose duration string matches the seconds", () => {
    expect(IDENTITY_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(IDENTITY_TOKEN_TTL_SECONDS).toBeGreaterThan(0);
    // "2m" duration string must equal the documented seconds value.
    expect(IDENTITY_TOKEN_TTL).toBe("2m");
    expect(IDENTITY_TOKEN_TTL_SECONDS).toBe(120);
  });
});

describe("buildRedirectLocation — token + state placement", () => {
  it("appends token and state as query params, preserving existing query", () => {
    const loc = buildRedirectLocation(
      "https://mail.agent-native.com/cb?keep=1",
      "JWT.HERE.SIG",
      "opaque-state-123",
    );
    const u = new URL(loc);
    expect(u.origin).toBe("https://mail.agent-native.com");
    expect(u.pathname).toBe("/cb");
    expect(u.searchParams.get("keep")).toBe("1");
    expect(u.searchParams.get("token")).toBe("JWT.HERE.SIG");
    expect(u.searchParams.get("state")).toBe("opaque-state-123");
  });

  it("omits state when not provided but always includes token", () => {
    const loc = buildRedirectLocation(
      "https://calendar.agent-native.com/auth",
      "TKN",
      null,
    );
    const u = new URL(loc);
    expect(u.searchParams.get("token")).toBe("TKN");
    expect(u.searchParams.has("state")).toBe(false);
  });

  it("does not mutate / re-encode an opaque state value's identity", () => {
    const state = "a+b/c=d&e";
    const loc = buildRedirectLocation(
      "https://mail.agent-native.com/cb",
      "TKN",
      state,
    );
    // URL round-trips it; the parsed value must equal the original.
    expect(new URL(loc).searchParams.get("state")).toBe(state);
  });
});
