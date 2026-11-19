import { afterEach, describe, expect, it, vi } from "vitest";

import { measureCpuMs } from "../testing/cpu-time";
import {
  normalizePathSegments,
  scrubLocationHash,
  scrubLocationState,
  scrubQueryString,
  scrubUrl,
} from "./url-scrub";

describe("scrubUrl", () => {
  it("preserves search-shaped text in a hash route outside the pathname", () => {
    expect(scrubUrl("/docs#/search/reference")).toBe("/docs#/search/reference");
  });

  it.each([
    ["/search/QA%20test/thread/fixture", "/search"],
    [
      "https://mail.example.test/search/QA%20test",
      "https://mail.example.test/search",
    ],
    [
      "/mail-app/search/QA%20test?account=fixture%40example.test",
      "/mail-app/search",
    ],
    [
      "/fixture%40example.test/search/QA%20test",
      "/fixture%40example.test/search",
    ],
  ])("redacts addressable search content from URL paths", (url, expected) => {
    expect(scrubUrl(url)).toBe(expected);
  });

  it("redacts local Plan bridge credentials carried in a fragment", () => {
    const url =
      "https://plan.agent-native.com/local-plans/local#bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://plan.agent-native.com/local-plans/local#bridge=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).not.toContain("127.0.0.1");
  });

  it("preserves ordinary section anchors", () => {
    expect(scrubUrl("https://plan.agent-native.com/plans/123#overview")).toBe(
      "https://plan.agent-native.com/plans/123#overview",
    );
  });

  it("redacts sensitive query values inside hash routes", () => {
    const url = "https://app.agent-native.com/auth#/verify?token=secret&step=1";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://app.agent-native.com/auth#/verify?token=%3Credacted%3E&step=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
  });

  it("redacts sensitive parameters before a question mark in parameter fragments", () => {
    const url =
      "https://app.agent-native.com/auth#token=secret&return=/inbox?tab=1";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toContain("#token=%3Credacted%3E");
    expect(scrubbed).not.toContain("token=secret");
  });

  it("redacts sensitive queries when a hash route prefix contains an equals sign", () => {
    const url = "https://app.agent-native.com/auth#/verify=legacy?token=secret";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://app.agent-native.com/auth#/verify=legacy?token=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
  });

  it.each([
    [
      "https://app.agent-native.com/auth#/verify&token=secret?step=1",
      "https://app.agent-native.com/auth#/verify&token=%3Credacted%3E?step=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#/verify&token=secret",
      "https://app.agent-native.com/auth#/verify&token=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#verify&token=secret",
      "https://app.agent-native.com/auth#verify&token=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#return=/inbox&code=secret?x=1",
      "https://app.agent-native.com/auth#return=%3Credacted%3E&code=%3Credacted%3E",
    ],
  ])("redacts sensitive parameters in hash route prefixes", (url, expected) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(expected);
    expect(scrubbed).not.toContain("secret");
  });

  it.each([
    "https://app.agent-native.com/auth#/verify%3Ftoken%3Dsecret",
    "https://app.agent-native.com/auth#/verify%253Ftoken%253Dsecret",
  ])("redacts ambiguous encoded hash route queries", (url) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).toContain("#%3Credacted%3E");
    expect(scrubbed).not.toContain("secret");
  });

  it("does not treat a sensitive parameter value as a hash route", () => {
    const url = "https://app.agent-native.com/auth#token=/inbox?tab=1";

    expect(scrubUrl(url)).toBe(
      "https://app.agent-native.com/auth#token=%3Credacted%3E",
    );
  });

  it.each([
    "https://app.agent-native.com/auth#return=/inbox?token=secret",
    "https://app.agent-native.com/auth#return=%2Finbox%3Ftoken%3Dsecret",
    "https://app.agent-native.com/auth#return=%252Finbox%253Ftoken%253Dsecret",
    "https://app.agent-native.com/auth#return=%252Finbox%253F%252574oken%253Dsecret",
  ])("redacts a sensitive query nested inside a hash parameter", (url) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).toContain("return=");
  });

  it("redacts nested URLs that exceed the decoding bound", () => {
    let nestedUrl = "/inbox?token=secret";
    for (let depth = 0; depth < 9; depth += 1) {
      nestedUrl = encodeURIComponent(nestedUrl);
    }

    const scrubbed = scrubUrl(
      `https://app.agent-native.com/auth#return=${nestedUrl}`,
    );

    expect(scrubbed).toContain("return=%3Credacted%3E");
    expect(scrubbed).not.toContain("secret");
  });

  it("redacts a nested hash parameter whose query holds any other parameter", () => {
    expect(
      scrubUrl("https://app.agent-native.com/auth#return=/inbox?tab=1"),
    ).toBe("https://app.agent-native.com/auth#return=%3Credacted%3E");
  });

  it("redacts configured attribution parameter aliases", () => {
    const url = "https://app.agent-native.com/sign-in?utm_source=x&ref=y";

    expect(scrubUrl(url, ["UTM-source"])).toBe(
      "https://app.agent-native.com/sign-in?utm_source=%3Credacted%3E&ref=y",
    );
    expect(scrubUrl(url, { additionalSensitiveParams: ["ref"] })).toBe(
      "https://app.agent-native.com/sign-in?utm_source=x&ref=%3Credacted%3E",
    );
  });

  it.each([
    [
      "https://app.agent-native.com/auth#/verify&tab=1?step=2",
      "https://app.agent-native.com/auth#/verify&tab=%3Credacted%3E?step=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#/verify&tab=1",
      "https://app.agent-native.com/auth#/verify&tab=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#verify&tab=1",
      "https://app.agent-native.com/auth#verify&tab=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#return=/inbox&tab=1?step=2",
      "https://app.agent-native.com/auth#return=%3Credacted%3E&tab=%3Credacted%3E",
    ],
  ])(
    "redacts every non-attribution hash route prefix parameter",
    (url, expected) => {
      expect(scrubUrl(url)).toBe(expected);
    },
  );

  it("redacts Mail search terms from absolute and relative URLs", () => {
    const query = "private.sender@example.com";
    const absolute = scrubUrl(
      `https://mail.agent-native.com/all?q=${encodeURIComponent(query)}&tab=inbox`,
      ["q"],
    );
    const relative = scrubUrl(`/all?q=${encodeURIComponent(query)}`, ["q"]);

    expect(absolute).toBe(
      "https://mail.agent-native.com/all?q=%3Credacted%3E&tab=%3Credacted%3E",
    );
    expect(relative).toBe("/all?q=%3Credacted%3E");
    expect(absolute).not.toContain(query);
    expect(relative).not.toContain(encodeURIComponent(query));
  });

  it("redacts the signed agent_access token from pageview and replay URLs", () => {
    const secret = "signed.agent.token";
    const absolute = scrubUrl(
      `https://analytics.agent-native.com/sessions/rec_1?frame=1&agent_access=${secret}`,
    );
    const relative = scrubUrl(`/sessions/rec_1?agent_access=${secret}&frame=1`);

    expect(absolute).toBe(
      "https://analytics.agent-native.com/sessions/rec_1?frame=%3Credacted%3E&agent_access=%3Credacted%3E",
    );
    expect(relative).toBe(
      "/sessions/rec_1?agent_access=%3Credacted%3E&frame=%3Credacted%3E",
    );
    expect(`${absolute}${relative}`).not.toContain(secret);
  });

  it.each(["__an_embed_token", "clip_intake"])(
    "redacts the signed %s token from pageview and replay URLs",
    (param) => {
      const secret = "signed.link.token";
      const url = scrubUrl(
        `https://clips.agent-native.com/record?clip_intake_id=intake_1&${param}=${secret}`,
      );

      expect(url).toBe(
        `https://clips.agent-native.com/record?clip_intake_id=%3Credacted%3E&${param}=%3Credacted%3E`,
      );
    },
  );

  it("redacts a parameter no allowlist names, such as another app's q", () => {
    expect(scrubUrl("https://example.com/search?q=public-topic")).toBe(
      "https://example.com/search?q=%3Credacted%3E",
    );
  });
});

describe("scrubUrl allowlist", () => {
  const canary = "canary-secret-value";

  it.each([
    "p-key",
    "api-key",
    "mcp_token",
    "nstoken",
    "x-sig-sso",
    "access_token",
    "amp;code",
  ])("redacts the %s query parameter", (key) => {
    const scrubbed = scrubUrl(`https://app.example.test/x?${key}=${canary}`);

    expect(scrubbed).not.toContain(canary);
    expect(scrubbed).toContain("%3Credacted%3E");
  });

  it("decodes &amp; before matching parameter names", () => {
    const scrubbed = scrubUrl(
      `https://app.example.test/x?utm_source=a&amp;code=${canary}&amp;amp;state=${canary}`,
    );

    expect(scrubbed).toBe(
      "https://app.example.test/x?utm_source=a&code=%3Credacted%3E&state=%3Credacted%3E",
    );
  });

  it.each([
    `https://app.example.test/x#access_token=${canary}&token_type=bearer`,
    `https://app.example.test/x#/cb?id_token=${canary}`,
    `/x?next=${encodeURIComponent(`https://other.test/?p-key=${canary}`)}`,
    `/x?next=${encodeURIComponent(encodeURIComponent(`/y?api-key=${canary}`))}`,
    `/x?utm_source=${encodeURIComponent(`/y?api-key=${canary}`)}`,
    `https://user:${canary}@app.example.test/x`,
  ])("redacts hash, nested, and userinfo credentials in %s", (url) => {
    expect(scrubUrl(url)).not.toContain(canary);
  });

  it("keeps the attribution parameters dashboards read", () => {
    const attribution =
      "ref=clip_share&via=user_1&utm_source=news&utm_medium=email&utm_campaign=c&utm_content=a&utm_term=b&utm_id=9&gclid=g1&msclkid=m1&vector_source=v&site_referrer=google.com&site_landing_path=%2Fblog";

    expect(
      scrubUrl(`https://app.example.test/x?${attribution}&p-key=${canary}`),
    ).toBe(`https://app.example.test/x?${attribution}&p-key=%3Credacted%3E`);
  });

  it("redacts an attribution parameter that carries a nested URL query", () => {
    const scrubbed = scrubUrl(
      `/x?site_landing_path=${encodeURIComponent(`/blog?token=${canary}`)}&utm_source=news`,
    );

    expect(scrubbed).toBe(
      "/x?site_landing_path=%3Credacted%3E&utm_source=news",
    );
  });

  it("scrubs a URL with thousands of repeated parameters in linear time", () => {
    const repeated = "utm_source=a&".repeat(20_000);

    let scrubbed: string | undefined;
    const cpuMs = measureCpuMs(() => {
      scrubbed = scrubUrl(`https://app.example.test/x?${repeated}p-key=s`);
    });

    expect(scrubbed).toContain("p-key=%3Credacted%3E");
    expect(cpuMs).toBeLessThan(500);
  });

  it("scrubs a URL with thousands of distinct parameters in linear time", () => {
    const distinct = Array.from(
      { length: 20_000 },
      (_, index) => `k${index}=v${index}`,
    ).join("&");

    let scrubbed: string | undefined;
    const cpuMs = measureCpuMs(() => {
      scrubbed = scrubUrl(
        `https://app.example.test/x?${distinct}&utm_source=news#${distinct}`,
      );
    });

    expect(scrubbed).toContain("k19999=%3Credacted%3E");
    expect(scrubbed).toContain("utm_source=news#k0=%3Credacted%3E");
    expect(cpuMs).toBeLessThan(500);
  });

  it("scrubs a nested query of thousands of distinct attribution parameters in linear time", () => {
    const nested = encodeURIComponent(
      `/y?${Array.from({ length: 40_000 }, (_, index) => `utm_k${index}=v`).join("&")}`,
    );
    const url = `/x?utm_source=${nested}&p-key=s`;

    let scrubbed: string | undefined;
    const cpuMs = measureCpuMs(() => {
      scrubbed = scrubUrl(url);
    });

    expect(scrubbed).toBe(`/x?utm_source=${nested}&p-key=%3Credacted%3E`);
    expect(cpuMs).toBeLessThan(500);
  });

  it("collapses a repeated redacted parameter to one entry and keeps repeated kept ones", () => {
    expect(scrubUrl("/x?a=1&utm_source=n&a=2&utm_source=m")).toBe(
      "/x?a=%3Credacted%3E&utm_source=n&utm_source=m",
    );
    expect(
      scrubUrl(
        "/x?utm_source=n&utm_source=%2Fy%3Ftoken%3D1&utm_source=m&ref=r",
      ),
    ).toBe("/x?utm_source=%3Credacted%3E&ref=r");
    expect(scrubUrl("/x?a=1&b=2&a=3#a=1&b=2&a=3")).toBe(
      "/x?a=%3Credacted%3E&b=%3Credacted%3E#a=%3Credacted%3E&b=%3Credacted%3E",
    );
  });

  it("drops the query and hash from a URL it cannot parse", () => {
    expect(scrubUrl(`https://bad host/path?token=${canary}#${canary}`)).toBe(
      "https://bad host/path",
    );
  });

  it.each([
    ["https://user:password@bad host/path?token=x", "https://bad host/path"],
    [
      "https://user:password@exa mple.com:99999/p?code=1#frag",
      "https://exa mple.com:99999/p",
    ],
    ["//user:password@bad host/p?token=x", "//bad host/p"],
    ["https:\\\\user:password@bad host/p?token=x", "https:\\\\bad host/p"],
    ["https:user:password@bad host/p?token=x", "https:bad host/p"],
    ["https://user:pa@ss@bad host/p#x", "https://bad host/p"],
    ["ftp://user:password@bad host/p", "ftp://bad host/p"],
  ])("drops credentials from the authority of %s", (url, expected) => {
    expect(scrubUrl(url)).toBe(expected);
  });

  it("keeps an @ in the path of a URL it cannot parse", () => {
    expect(scrubUrl("https://bad host/@handle/profile?token=x")).toBe(
      "https://bad host/@handle/profile",
    );
  });
});

describe("scrubUrl route paths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubManifest(origin: string) {
    vi.stubGlobal("window", {
      location: { origin },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "" },
          "routes/share.$shareId": {
            id: "routes/share.$shareId",
            parentId: "root",
            path: "share/:shareId",
          },
          "routes/inbox": {
            id: "routes/inbox",
            parentId: "root",
            path: "inbox",
          },
        },
      },
    });
  }

  it("reports the matched route template instead of the path", () => {
    stubManifest("https://clips.example.test");

    expect(
      scrubUrl(
        `https://clips.example.test/share/abc?utm_source=x&p-key=canary`,
        { routePath: true },
      ),
    ).toBe(
      "https://clips.example.test/share/:shareId?utm_source=x&p-key=%3Credacted%3E",
    );
    expect(scrubUrl("/share/abc", { routePath: true })).toBe("/share/:shareId");
    expect(scrubUrl("/inbox", { routePath: true })).toBe("/inbox");
  });

  it("does not apply this app's routes to another origin's path", () => {
    stubManifest("https://clips.example.test");

    expect(
      scrubUrl("https://other.example.test/share/abc", { routePath: true }),
    ).toBe("https://other.example.test/share/abc");
  });

  it("replaces id-looking segments when no route is known", () => {
    expect(
      scrubUrl("/share/3f2a9c1e-7b4d-4e11-9a0f-1c2d3e4f5a6b/view?token=s", {
        routePath: true,
      }),
    ).toBe("/share/:id/view?token=%3Credacted%3E");
    expect(scrubUrl("/orders/1234567", { routePath: true })).toBe(
      "/orders/:id",
    );
    expect(scrubUrl("/invite/alice@example.com", { routePath: true })).toBe(
      "/invite/:id",
    );
    expect(scrubUrl("/settings/model", { routePath: true })).toBe(
      "/settings/model",
    );
  });

  it("leaves the path alone unless asked for the route", () => {
    expect(scrubUrl("/share/3f2a9c1e-7b4d-4e11-9a0f-1c2d3e4f5a6b")).toBe(
      "/share/3f2a9c1e-7b4d-4e11-9a0f-1c2d3e4f5a6b",
    );
  });
});

describe("normalizePathSegments", () => {
  it.each([
    ["/a/3f2a9c1e-7b4d-4e11-9a0f-1c2d3e4f5a6b", "/a/:id"],
    ["/a/deadbeef", "/a/:id"],
    ["/a/deadbee", "/a/deadbee"],
    ["/a/123456", "/a/:id"],
    ["/a/12345", "/a/12345"],
    ["/a/abcdefghijklmnopqrst", "/a/:id"],
    ["/a/abcdefghijklmnopqrs", "/a/abcdefghijklmnopqrs"],
    ["/a/b%40c.test/edit", "/a/:id/edit"],
    ["/a/:shareId", "/a/:shareId"],
  ])("%s -> %s", (path, expected) => {
    expect(normalizePathSegments(path)).toBe(expected);
  });
});

describe("scrubLocationHash", () => {
  it.each([
    ["", ""],
    ["#overview", "#overview"],
    [
      "#access_token=canary&state=canary",
      "#access_token=%3Credacted%3E&state=%3Credacted%3E",
    ],
    ["access_token=canary", "access_token=%3Credacted%3E"],
    ["#/verify?token=canary", "#/verify?token=%3Credacted%3E"],
  ])("%s -> %s", (hash, expected) => {
    expect(scrubLocationHash(hash)).toBe(expected);
  });
});

describe("scrubLocationState", () => {
  const canary = "canary-secret-value";

  it("keeps only the declared query keys, exact and prefix, and redacts the rest", () => {
    expect(
      scrubLocationState(
        {
          pathname: "/sessions",
          search: `?token=${canary}&range=7d&f_region=emea&other=1`,
          hash: "",
        },
        ["range", "f_*"],
      ),
    ).toEqual({
      pathname: "/sessions",
      search:
        "?token=%3Credacted%3E&range=7d&f_region=emea&other=%3Credacted%3E",
      hash: "",
      searchParams: {
        token: "<redacted>",
        range: "7d",
        f_region: "emea",
        other: "<redacted>",
      },
    });
  });

  it("redacts every value, keeping the key names, when no key is declared", () => {
    const state = scrubLocationState({
      pathname: "/inbox",
      search: `?q=private&code=${canary}&utm_source=news&ref=friend`,
      hash: `#access_token=${canary}`,
    });

    expect(state.searchParams).toEqual({
      q: "<redacted>",
      code: "<redacted>",
      utm_source: "<redacted>",
      ref: "<redacted>",
    });
    expect(state.hash).toBe("#access_token=%3Credacted%3E");
    expect(JSON.stringify(state)).not.toContain(canary);
  });

  it("keeps an attribution parameter only when the app declares it", () => {
    const location = {
      pathname: "/sessions",
      search: "?utm_source=a&gclid=b&range=7d",
      hash: "",
    };

    expect(scrubLocationState(location, ["range"]).searchParams).toEqual({
      utm_source: "<redacted>",
      gclid: "<redacted>",
      range: "7d",
    });
    expect(
      scrubLocationState(location, ["range", "utm_*"]).searchParams,
    ).toEqual({ utm_source: "a", gclid: "<redacted>", range: "7d" });
  });

  it("redacts a declared key whose value is a URL carrying an undeclared one", () => {
    const state = scrubLocationState(
      {
        pathname: "/x",
        search: `?next=${encodeURIComponent(`/y?token=${canary}`)}&range=7d`,
        hash: "",
      },
      ["next", "range"],
    );

    expect(state.searchParams).toEqual({ next: "<redacted>", range: "7d" });
  });

  it("leaves the path and plain anchors alone", () => {
    expect(
      scrubLocationState({
        pathname: "/search/QA%20test",
        search: "",
        hash: "#overview",
      }),
    ).toEqual({
      pathname: "/search/QA%20test",
      search: "",
      hash: "#overview",
      searchParams: {},
    });
  });
});

describe("scrubUrl keepParams", () => {
  it("keeps exact and prefix patterns, and lets an extra sensitive name win", () => {
    expect(
      scrubUrl("/x?a=1&b=2&f_x=3&f_y=4&c=5", {
        keepParams: ["a", "f_*"],
        additionalSensitiveParams: ["f_y"],
      }),
    ).toBe("/x?a=1&b=%3Credacted%3E&f_x=3&f_y=%3Credacted%3E&c=%3Credacted%3E");
  });
});

describe("scrubQueryString", () => {
  it("redacts every value but the attribution parameters, in each shape a report holds", () => {
    const expected = "code=%3Credacted%3E&utm_source=docs";
    expect(scrubQueryString("?code=CANARY&utm_source=docs")).toBe(expected);
    expect(scrubQueryString({ code: "CANARY", utm_source: "docs" })).toBe(
      expected,
    );
    expect(
      scrubQueryString([
        ["code", "CANARY"],
        ["utm_source", "docs"],
      ]),
    ).toBe(expected);
  });

  it("returns nothing for a request with no query string", () => {
    expect(scrubQueryString(undefined)).toBeUndefined();
    expect(scrubQueryString("")).toBe("");
  });
});
