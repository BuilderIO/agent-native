import { describe, it, expect } from "vitest";

import {
  buildSlackUserAuthorizeUrl,
  mapSlackUserOAuthResponse,
} from "./slack-user-oauth.js";
const MARK = "SENTINEL_DO_NOT_LEAK_9f3";
const NOW = 1700000000000;
const authArgs = () => ({
  clientId: "1234567890.1234567890",
  redirectUri: "https://example.com/slack/oauth/callback",
  state: "st_" + MARK,
  userScopes: ["channels:read", "users:read"],
});
const response = () => ({
  ok: true,
  app_id: "A12345678",
  team: { id: "T12345678", name: "DO_NOT_COPY_TEAM_NAME" },
  authed_user: {
    id: "U12345678",
    scope: "channels:read,users:read",
    access_token: "xoxp-user-" + MARK,
    token_type: "user",
  },
});
const errOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e && typeof e.message === "string" ? e.message : String(e);
  }
};
describe("buildSlackUserAuthorizeUrl", () => {
  it("emits a user-only URL with user_scope, no bot scope", () => {
    const u = new URL(buildSlackUserAuthorizeUrl(authArgs()));
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("1234567890.1234567890");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://example.com/slack/oauth/callback",
    );
    expect(u.searchParams.get("state")).toBe("st_" + MARK);
    expect(u.searchParams.get("user_scope")).toBe("channels:read,users:read");
    expect(u.searchParams.has("scope")).toBe(false);
    expect(u.searchParams.has("team")).toBe(false);
  });
  it("dedupes/sorts scopes and includes a valid optional team", () => {
    const u = new URL(
      buildSlackUserAuthorizeUrl({
        ...authArgs(),
        userScopes: ["users:read", "channels:read", "users:read", "im:read"],
        teamId: "T12345678",
      }),
    );
    expect(u.searchParams.get("user_scope")).toBe(
      "channels:read,im:read,users:read",
    );
    expect(u.searchParams.get("team")).toBe("T12345678");
  });
  it("rejects invalid inputs with one constant, non-leaking error", () => {
    const bad = [
      { ...authArgs(), clientId: "" },
      { ...authArgs(), clientId: "   " },
      { ...authArgs(), clientId: "x".repeat(513) },
      { ...authArgs(), state: "" },
      { ...authArgs(), state: "x".repeat(4097) },
      { ...authArgs(), redirectUri: "http://example.com/cb" },
      { ...authArgs(), redirectUri: "not-a-url" },
      { ...authArgs(), userScopes: [] },
      { ...authArgs(), userScopes: ["Chat:Write"] },
      { ...authArgs(), userScopes: ["1bad"] },
      { ...authArgs(), userScopes: ["a b"] },
      { ...authArgs(), userScopes: ["x".repeat(129)] },
      {
        ...authArgs(),
        userScopes: Array.from({ length: 257 }, (_, i) => `s${i}`),
      },
      { ...authArgs(), teamId: " bad" },
      { ...authArgs(), teamId: "-bad" },
    ];
    const msgs = bad.map((a) => errOf(() => buildSlackUserAuthorizeUrl(a)));
    expect(msgs.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
    expect(new Set(msgs).size).toBe(1);
    const only = [...new Set(msgs)][0];
    expect(only).not.toContain(MARK);
    expect(only).not.toContain("http://example.com");
    expect(only).not.toContain("Chat:Write");
  });
});
describe("mapSlackUserOAuthResponse", () => {
  it("maps a user-only response with no fabrication or bot fallback", () => {
    const out = mapSlackUserOAuthResponse(response(), NOW);
    expect(Object.keys(out).sort()).toEqual([
      "apiAppId",
      "bundle",
      "externalUserId",
      "teamId",
    ]);
    expect(out).toMatchObject({
      teamId: "T12345678",
      apiAppId: "A12345678",
      externalUserId: "U12345678",
    });
    expect(Object.keys(out.bundle).sort()).toEqual([
      "accessToken",
      "scopes",
      "tokenType",
    ]);
    expect(out.bundle.accessToken).toBe("xoxp-user-" + MARK);
    expect(out.bundle.tokenType).toBe("user");
    expect(out.bundle.scopes).toEqual(["channels:read", "users:read"]);
    expect("refreshToken" in out.bundle).toBe(false);
    expect("expiresAt" in out.bundle).toBe(false);
    expect(JSON.stringify(out)).not.toContain("DO_NOT_COPY_TEAM_NAME");
    expect(out.bot).toBeUndefined();
  });
  it("dedupes/sorts scopes and maps a rotating bundle", () => {
    const r = response();
    r.authed_user.scope = "users:read,channels:read,users:read,im:read";
    r.authed_user.refresh_token = "xoxe-refresh-" + MARK;
    r.authed_user.expires_in = 3600;
    const out = mapSlackUserOAuthResponse(r, NOW);
    expect(out.bundle.scopes).toEqual([
      "channels:read",
      "im:read",
      "users:read",
    ]);
    expect(Object.keys(out.bundle).sort()).toEqual([
      "accessToken",
      "expiresAt",
      "refreshToken",
      "scopes",
      "tokenType",
    ]);
    expect(out.bundle.refreshToken).toBe("xoxe-refresh-" + MARK);
    expect(out.bundle.expiresAt).toBe(NOW + 3600 * 1000);
  });
  it("keeps the user bundle when a bot token is also present", () => {
    const r = response();
    r.access_token = "xoxb-bot-" + MARK;
    r.bot_user_id = "B12345678";
    const out = mapSlackUserOAuthResponse(r, NOW);
    expect(out.bundle.accessToken).toBe("xoxp-user-" + MARK);
    expect(JSON.stringify(out)).not.toContain("xoxb");
  });
  it("rejects bot-only and structurally invalid responses", () => {
    const cases = [];
    let r = response();
    delete r.authed_user;
    cases.push(r);
    r = response();
    r.ok = false;
    cases.push(r);
    r = response();
    delete r.ok;
    cases.push(r);
    r = response();
    delete r.app_id;
    cases.push(r);
    r = response();
    delete r.team.id;
    cases.push(r);
    r = response();
    delete r.authed_user.id;
    cases.push(r);
    r = response();
    r.authed_user.token_type = "bot";
    cases.push(r);
    r = response();
    delete r.authed_user.token_type;
    cases.push(r);
    r = response();
    r.authed_user.scope = "";
    cases.push(r);
    r = response();
    r.authed_user.scope = "Chat:Write";
    cases.push(r);
    for (const c of cases)
      expect(() => mapSlackUserOAuthResponse(c, NOW)).toThrow();
  });
  it("rejects a response carrying a scope outside the read-only set", () => {
    const r = response();
    r.authed_user.scope = "channels:read,chat:write";
    expect(() => mapSlackUserOAuthResponse(r, NOW)).toThrow();
  });
  it("rejects invalid tokens, ids, and expiry", () => {
    const muts = [
      (r) => {
        r.authed_user.access_token = "";
      },
      (r) => {
        r.authed_user.access_token = " tok";
      },
      (r) => {
        r.authed_user.access_token = "tok ";
      },
      (r) => {
        r.authed_user.access_token = "a".repeat(65537);
      },
      (r) => {
        r.authed_user.refresh_token = "";
      },
      (r) => {
        r.authed_user.refresh_token = " r ";
      },
      (r) => {
        r.app_id = "";
      },
      (r) => {
        r.app_id = "x".repeat(300);
      },
      (r) => {
        r.team.id = "";
      },
      (r) => {
        r.authed_user.id = "U 1";
      },
    ];
    for (const m of muts) {
      const r = response();
      m(r);
      expect(() => mapSlackUserOAuthResponse(r, NOW)).toThrow();
    }
    for (const [v, n] of [
      [0, NOW],
      [-1, NOW],
      [1.5, NOW],
      [NaN, NOW],
      [Infinity, NOW],
      [Number.MAX_SAFE_INTEGER, NOW],
      [3600, NaN],
      [3600, Infinity],
      [3600, 1.5],
      [3600, -1e15],
    ]) {
      const r = response();
      r.authed_user.expires_in = v;
      expect(() => mapSlackUserOAuthResponse(r, n)).toThrow();
    }
  });
  it("uses one constant generic error and leaks no body", () => {
    const a = response();
    a.ok = false;
    const b = response();
    b.authed_user.token_type = "bot";
    const c = response();
    c.authed_user.access_token = "bad token " + MARK;
    const m1 = errOf(() => mapSlackUserOAuthResponse(a, NOW));
    const m2 = errOf(() => mapSlackUserOAuthResponse(b, NOW));
    const m3 = errOf(() => mapSlackUserOAuthResponse(c, NOW));
    expect(m1).toBe(m2);
    expect(m2).toBe(m3);
    for (const m of [m1, m2, m3]) {
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toContain(MARK);
      expect(m).not.toContain("bad token");
      expect(m).not.toContain("xox");
    }
  });
  it("performs no network or console output", () => {
    const saved = {
      f: globalThis.fetch,
      l: console.log,
      e: console.error,
      w: console.warn,
    };
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      throw new Error("network");
    };
    console.log = () => {
      calls++;
    };
    console.error = () => {
      calls++;
    };
    console.warn = () => {
      calls++;
    };
    try {
      buildSlackUserAuthorizeUrl(authArgs());
      mapSlackUserOAuthResponse(response(), NOW);
    } finally {
      globalThis.fetch = saved.f;
      console.log = saved.l;
      console.error = saved.e;
      console.warn = saved.w;
    }
    expect(calls).toBe(0);
  });
});
