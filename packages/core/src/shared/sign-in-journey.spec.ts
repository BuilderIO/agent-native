import { describe, expect, it } from "vitest";

import {
  SIGN_IN_CONTINUATION_MAX_LENGTH,
  SIGN_IN_CONTINUATION_PARAM,
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
  decodeContinuation,
  encodeContinuation,
  normalizeAppPath,
  signInJourney,
  signInJourneyInlineScript,
} from "./sign-in-journey.js";

describe("normalizeAppPath", () => {
  it("returns the normalised path for same-origin app paths", () => {
    expect(normalizeAppPath("/inbox")).toBe("/inbox");
    expect(normalizeAppPath("/inbox?label=a&b=2")).toBe("/inbox?label=a&b=2");
    expect(normalizeAppPath("/inbox#section")).toBe("/inbox#section");
    expect(normalizeAppPath("/a?b=1#c")).toBe("/a?b=1#c");
    expect(normalizeAppPath("/")).toBe("/");
  });

  it("returns null (not a lookalike default) for absent input", () => {
    expect(normalizeAppPath(null)).toBeNull();
    expect(normalizeAppPath(undefined)).toBeNull();
    expect(normalizeAppPath("")).toBeNull();
  });

  describe("open redirect vectors", () => {
    it("rejects absolute URLs", () => {
      expect(normalizeAppPath("https://evil.com/path")).toBeNull();
      expect(normalizeAppPath("http://evil.com/path")).toBeNull();
      expect(normalizeAppPath("javascript:alert(1)")).toBeNull();
      expect(normalizeAppPath("data:text/html,<x>")).toBeNull();
      // The sentinel origin itself must not be a bypass.
      expect(normalizeAppPath("http://an.invalid/foo")).toBeNull();
    });

    it("rejects protocol-relative URLs", () => {
      expect(normalizeAppPath("//evil.com")).toBeNull();
      expect(normalizeAppPath("//evil.com/path")).toBeNull();
      expect(normalizeAppPath("/\\evil.com/path")).toBeNull();
      expect(normalizeAppPath("\\\\evil.com/path")).toBeNull();
    });

    it("rejects a path escaping the app base path", () => {
      expect(normalizeAppPath("/mail/inbox", "/mail")).toBe("/mail/inbox");
      expect(normalizeAppPath("/mail", "/mail")).toBe("/mail");
      // Same-origin sibling app on a multi-app workspace host.
      expect(normalizeAppPath("/otherapp/admin", "/mail")).toBeNull();
      expect(normalizeAppPath("/mailicious/admin", "/mail")).toBeNull();
      expect(normalizeAppPath("/", "/mail")).toBeNull();
      // Traversal that WHATWG normalises out of the base path.
      expect(normalizeAppPath("/mail/../otherapp/admin", "/mail")).toBeNull();
    });

    it("rejects control characters used for header injection", () => {
      expect(normalizeAppPath("/foo\r\nLocation: /evil")).toBeNull();
      expect(normalizeAppPath("/foo\nbar")).toBeNull();
      expect(normalizeAppPath("/foo\tbar")).toBeNull();
      expect(normalizeAppPath("/foo\x00bar")).toBeNull();
      expect(normalizeAppPath("/foo\x7fbar")).toBeNull();
    });
  });

  it("rejects every auth entry path, at any base path", () => {
    expect(normalizeAppPath(SIGN_IN_ENTRY_PATH)).toBeNull();
    expect(normalizeAppPath(`${SIGN_IN_ENTRY_PATH}?c=abc`)).toBeNull();
    expect(normalizeAppPath(SIGN_IN_LEGACY_ENTRY_PATH)).toBeNull();
    expect(normalizeAppPath("/login")).toBeNull();
    expect(normalizeAppPath("/signup")).toBeNull();
    // The live base-path loop: `/myapp/login` has no `/_agent-native` marker,
    // so the old marker-only base resolver failed to recognise it as an auth
    // entry path and the already-signed-in bounce looped forever.
    expect(normalizeAppPath("/myapp/login", "/myapp")).toBeNull();
    expect(normalizeAppPath("/myapp/signup", "/myapp")).toBeNull();
    expect(
      normalizeAppPath(`/myapp${SIGN_IN_ENTRY_PATH}`, "/myapp"),
    ).toBeNull();
    expect(
      normalizeAppPath(`/myapp${SIGN_IN_LEGACY_ENTRY_PATH}`, "/myapp"),
    ).toBeNull();
  });
});

describe("continuation tokens", () => {
  it("round-trips a path exactly, query and hash included", () => {
    for (const path of [
      "/inbox",
      "/inbox?label=important&page=2#top",
      "/notes/caf%C3%A9",
      "/oauth/authorize?client_id=x&state=y&code_challenge=z",
    ]) {
      expect(decodeContinuation(encodeContinuation(path))).toBe(path);
    }
  });

  it("survives non-ASCII payloads (percent-encoded by the URL parser)", () => {
    const normalized = normalizeAppPath("/搜索?q=日本語#节");
    expect(normalized).toBe(
      "/%E6%90%9C%E7%B4%A2?q=%E6%97%A5%E6%9C%AC%E8%AA%9E#%E8%8A%82",
    );
    expect(decodeContinuation(encodeContinuation("/搜索?q=日本語#节"))).toBe(
      normalized,
    );
  });

  it("does not look like a URL, so nothing downstream can re-wrap it", () => {
    const token = encodeContinuation("/inbox?a=1");
    expect(token).not.toContain("/");
    expect(token).not.toContain("?");
    expect(token).not.toContain(":");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses to mint a token for anything not returnable", () => {
    expect(encodeContinuation(SIGN_IN_ENTRY_PATH)).toBe("");
    expect(encodeContinuation(SIGN_IN_LEGACY_ENTRY_PATH)).toBe("");
    expect(encodeContinuation("https://evil.com")).toBe("");
    expect(encodeContinuation("//evil.com")).toBe("");
    expect(encodeContinuation(null)).toBe("");
  });

  it("re-validates on decode — encode-time validation is never trusted", () => {
    // A hand-crafted token, as a user pasting a URL could supply.
    const forge = (p: string) =>
      btoa(encodeURIComponent(p))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    expect(decodeContinuation(forge("https://evil.com"))).toBeNull();
    expect(decodeContinuation(forge("//evil.com"))).toBeNull();
    expect(decodeContinuation(forge(SIGN_IN_ENTRY_PATH))).toBeNull();
    expect(decodeContinuation(forge(SIGN_IN_LEGACY_ENTRY_PATH))).toBeNull();
    expect(decodeContinuation(forge("/otherapp/admin"), "/mail")).toBeNull();
    expect(decodeContinuation(forge("/foo\r\nx"))).toBeNull();
  });

  it("rejects garbage and oversized tokens", () => {
    expect(decodeContinuation(null)).toBeNull();
    expect(decodeContinuation("")).toBeNull();
    expect(decodeContinuation("!!!not base64!!!")).toBeNull();
    expect(
      decodeContinuation("x".repeat(SIGN_IN_CONTINUATION_MAX_LENGTH + 1)),
    ).toBeNull();
    expect(encodeContinuation(`/${"a".repeat(2000)}`)).toBe("");
  });
});

describe("nesting is structurally impossible", () => {
  it("decoding a continuation yields a path, never another continuation", () => {
    const inner = encodeContinuation("/inbox");
    const outer = encodeContinuation(`${SIGN_IN_ENTRY_PATH}?c=${inner}`);
    // The only producer refuses: an auth entry path is not returnable.
    expect(outer).toBe("");
  });

  it("the sign-in URL captured as the current location produces no token", () => {
    const first = signInJourney({ at: "/inbox" });
    expect(first.signInHref).toBe(
      `${SIGN_IN_ENTRY_PATH}?${SIGN_IN_CONTINUATION_PARAM}=${encodeContinuation("/inbox")}`,
    );
    // Now the browser is on that URL and something asks for a journey again.
    // Old behaviour re-encoded the sign-in URL as a fresh `?return=`; here the
    // re-encoding step has no input at all.
    const second = signInJourney({
      at: first.signInHref!,
      continuation: encodeContinuation("/inbox"),
    });
    expect(second.signInHref).toBeNull();
    expect(second.resumeHref).toBe("/inbox");

    // And again, to prove it cannot grow.
    const third = signInJourney({
      at: `${SIGN_IN_ENTRY_PATH}?c=${encodeContinuation("/inbox")}`,
      continuation: encodeContinuation("/inbox"),
    });
    expect(third).toEqual(second);
  });
});

describe("signInJourney", () => {
  it("sends an unauthenticated visitor to sign-in and back where they started", () => {
    const journey = signInJourney({ at: "/share/abc?v=1#t=30" });
    expect(journey.signInHref).toContain(`${SIGN_IN_ENTRY_PATH}?c=`);
    const token = new URL(
      journey.signInHref!,
      "http://x.invalid",
    ).searchParams.get("c");
    expect(decodeContinuation(token)).toBe("/share/abc?v=1#t=30");
  });

  it("resumes to the continuation once a session exists", () => {
    const journey = signInJourney({
      at: SIGN_IN_ENTRY_PATH,
      continuation: encodeContinuation("/inbox?label=a"),
    });
    expect(journey.resumeHref).toBe("/inbox?label=a");
  });

  it("keeps accepting the legacy ?return= grammar forever", () => {
    // Generated apps in the wild hand-write this and are not upgradeable.
    const journey = signInJourney({
      at: "/_agent-native/sign-in?return=%2Finbox",
      legacyReturn: "/inbox",
    });
    expect(journey.resumeHref).toBe("/inbox");
  });

  it.each([
    "/..//evil.com",
    "/.//evil.com",
    "/a/../..//evil.com",
    "/%2e%2e//evil.com",
  ])(
    "rejects normalized protocol-relative legacy returns: %s",
    (legacyReturn) => {
      const journey = signInJourney({
        at: `${SIGN_IN_ENTRY_PATH}?return=${encodeURIComponent(legacyReturn)}`,
        legacyReturn,
      });
      expect(journey.resumeHref.startsWith("//")).toBe(false);
      expect(journey.resumeHref).toBe("/");
    },
  );

  it("prefers the continuation over a legacy return", () => {
    const journey = signInJourney({
      at: SIGN_IN_ENTRY_PATH,
      continuation: encodeContinuation("/new"),
      legacyReturn: "/old",
    });
    expect(journey.resumeHref).toBe("/new");
  });

  it("a signed-in user on an auth entry path resumes home instead of looping", () => {
    for (const at of [
      "/login",
      "/signup",
      SIGN_IN_ENTRY_PATH,
      SIGN_IN_LEGACY_ENTRY_PATH,
    ]) {
      const journey = signInJourney({ at });
      expect(journey.signInHref).toBeNull();
      expect(journey.resumeHref).toBe("/");
    }
  });

  it("does not loop on an auth entry path under a base path", () => {
    // The reproducible base-path loop: `/myapp/login` was not recognised as an
    // auth entry path, so the resume target was the login page itself.
    const journey = signInJourney({ at: "/myapp/login", basePath: "/myapp" });
    expect(journey.signInHref).toBeNull();
    expect(journey.resumeHref).toBe("/myapp");
  });

  it("signInHref is null — not a fallback — when already at sign-in", () => {
    // Load-bearing: RequireSession has no self-redirect guard left, so a
    // non-null fallback here would `location.replace` the same URL forever.
    expect(signInJourney({ at: SIGN_IN_ENTRY_PATH }).signInHref).toBeNull();
    expect(signInJourney({ at: SIGN_IN_LEGACY_ENTRY_PATH }).signInHref).toBe(
      null,
    );
    expect(
      signInJourney({ at: `/myapp${SIGN_IN_ENTRY_PATH}`, basePath: "/myapp" })
        .signInHref,
    ).toBeNull();
    expect(
      signInJourney({
        at: `/myapp${SIGN_IN_LEGACY_ENTRY_PATH}`,
        basePath: "/myapp",
      }).signInHref,
    ).toBeNull();
  });

  it("falls back to home rather than an invalid continuation", () => {
    const journey = signInJourney({
      at: SIGN_IN_ENTRY_PATH,
      continuation: "not-a-real-token-%%%",
    });
    expect(journey.resumeHref).toBe("/");
  });

  it("preserves search params for login-form-at-this-URL routes", () => {
    // `/_agent-native/open`, the MCP authorize page, and `agent-native connect`
    // serve the login form AT their own URL; client_id/state/PKCE must survive.
    const at =
      "/_agent-native/mcp/authorize?client_id=abc&state=xyz&code_challenge=pkce";
    const journey = signInJourney({ at });
    expect(journey.resumeHref).toBe(at);
    const token = new URL(
      journey.signInHref!,
      "http://x.invalid",
    ).searchParams.get("c");
    expect(decodeContinuation(token)).toBe(at);
  });

  it("carries the base path on both hrefs", () => {
    const journey = signInJourney({ at: "/mail/inbox", basePath: "/mail" });
    expect(journey.signInHref).toContain(`/mail${SIGN_IN_ENTRY_PATH}?c=`);
    expect(journey.resumeHref).toBe("/mail/inbox");
  });
});

describe("signInJourneyInlineScript", () => {
  it("emits a runtime that behaves identically to the module", () => {
    const script = signInJourneyInlineScript();
    const evaluated = new Function(
      `${script}; return __anCreateSignInJourney("/mail");`,
    )() as {
      signInJourney: typeof signInJourney;
      decodeContinuation: (t: string | null) => string | null;
      encodeContinuation: (p: string | null) => string;
      homeHref: () => string;
    };
    expect(evaluated.homeHref()).toBe("/mail");
    expect(evaluated.encodeContinuation("/mail/inbox")).toBe(
      encodeContinuation("/mail/inbox", "/mail"),
    );
    expect(
      evaluated.decodeContinuation(encodeContinuation("/otherapp/x")),
    ).toBeNull();
    expect(evaluated.signInJourney({ at: "/mail/login" })).toEqual(
      signInJourney({ at: "/mail/login", basePath: "/mail" }),
    );
  });
});
