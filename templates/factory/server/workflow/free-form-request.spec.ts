import { describe, expect, it } from "vitest";

import {
  FREE_FORM_DEFAULT_PAGES,
  FREE_FORM_MAX_PAGES,
  FREE_FORM_MAX_TIMEOUT_SECONDS,
  allowedResponseHeaders,
  checkFreeFormValue,
  freeFormRoleOf,
  isDeniedHeader,
  readFreeAuth,
  readFreeHeaders,
  readFreePagination,
  readFreePath,
  readFreeQuery,
  readFreeTimeout,
  type FreeFormCheck,
} from "./free-form-request.js";

function refusal<T>(check: FreeFormCheck<T>) {
  if (check.ok) throw new Error("Expected a refusal.");
  return check;
}

function value<T>(check: FreeFormCheck<T>): T {
  if (!check.ok) throw new Error(`Expected a value: ${check.message}`);
  return check.value;
}

describe("readFreePath", () => {
  it("keeps a multi-segment path as it is, with no leading slash", () => {
    expect(value(readFreePath("repos/acme/web/issues"))).toEqual({
      path: "repos/acme/web/issues",
      open: [],
    });
  });

  it("accepts one leading slash and drops it", () => {
    expect(value(readFreePath("/repos/acme/web")).path).toBe("repos/acme/web");
  });

  it("keeps one trailing slash, which some APIs need", () => {
    expect(value(readFreePath("organizations/acme/issues/")).path).toBe(
      "organizations/acme/issues/",
    );
  });

  it("percent-encodes what a segment cannot hold and leaves : and @ readable", () => {
    expect(value(readFreePath("docs/my file.md")).path).toBe(
      "docs/my%20file.md",
    );
    expect(value(readFreePath("users/@me/datasets:list")).path).toBe(
      "users/@me/datasets:list",
    );
    expect(value(readFreePath("a+b/ü")).path).toBe("a%2Bb/%C3%BC");
  });

  it.each([
    ["https://evil.test/x", "full_url_refused"],
    ["http://169.254.169.254/latest", "full_url_refused"],
    ["//evil.test/x", "full_url_refused"],
    ["file:/etc/passwd", "full_url_refused"],
  ])("refuses the full URL %s", (text, code) => {
    const refused = refusal(readFreePath(text));
    expect(refused.code).toBe(code);
    expect(refused.message).not.toContain("evil.test");
    expect(refused.message).not.toContain("169.254");
  });

  it.each([
    "..",
    "a/../b",
    "a/./b",
    ".",
    "%2e%2e",
    "%2E%2E/etc",
    ".%2e",
    "a/%2e%2e/b",
    "a//b",
    "/",
    "a\\b",
    "a\nb",
    "a\u0000b",
  ])("refuses the path %j", (text) => {
    expect(refusal(readFreePath(text)).code).toBe("unsafe_path_value");
  });

  it("refuses a ? or # and points to the query field", () => {
    for (const text of ["issues?state=open", "issues#top", "a/b?"]) {
      const refused = refusal(readFreePath(text));
      expect(refused.code).toBe("unsafe_path_value");
      expect(refused.message).toContain("query");
    }
  });

  it("never turns an encoded slash or dot into structure: a percent sign is literal", () => {
    expect(value(readFreePath("a%2Fb")).path).toBe("a%252Fb");
    expect(value(readFreePath("..%2fetc")).path).toBe("..%252fetc");
    expect(value(readFreePath("%252e%252e")).path).toBe("%25252e%25252e");
  });

  it("refuses a {name} nothing fills, and accepts one core fills as a whole segment", () => {
    expect(refusal(readFreePath("repos/{owner}/{repo}")).message).toContain(
      "not filled in",
    );
    expect(
      value(readFreePath("api/projects/{projectId}/insights", ["projectId"])),
    ).toEqual({
      path: "api/projects/{projectId}/insights",
      open: ["projectId"],
    });
    expect(
      refusal(readFreePath("api/projects/x{projectId}", ["projectId"])).code,
    ).toBe("unsafe_path_value");
    expect(refusal(readFreePath("{secret}", ["projectId"])).code).toBe(
      "unsafe_path_value",
    );
  });

  it("refuses empty or non-text input and never echoes the path", () => {
    expect(refusal(readFreePath("   ")).code).toBe("invalid_field");
    expect(refusal(readFreePath(42)).code).toBe("invalid_field");
    expect(refusal(readFreePath("a/../xyz-secret-9")).message).not.toContain(
      "xyz-secret-9",
    );
  });
});

describe("readFreeQuery", () => {
  it("turns scalars into text and repeats a parameter for a list", () => {
    expect(
      value(
        readFreeQuery({
          state: "open",
          per_page: 50,
          draft: false,
          "labels[]": ["bug", "p1"],
          "created.after": "2026-01-01",
        }),
      ),
    ).toEqual({
      state: "open",
      per_page: "50",
      draft: "false",
      "labels[]": ["bug", "p1"],
      "created.after": "2026-01-01",
    });
  });

  it("sends a parameter with an empty list no times", () => {
    expect(value(readFreeQuery({ ids: [] }))).toEqual({});
  });

  it.each([
    ["an array", ["a"]],
    ["text", "a=b"],
    ["null", null],
    ["a key with a space", { "a b": "x" }],
    ["a key with an ampersand", { "a&b": "x" }],
    ["a key with an equals sign", { "a=b": "x" }],
    ["a null value", { a: null }],
    ["a nested object", { a: { b: 1 } }],
    ["a nested list", { a: [["x"]] }],
    ["an infinite number", { a: Number.POSITIVE_INFINITY }],
    ["a line break in a value", { a: "x\r\nInjected: 1" }],
    ["a line break in a list value", { a: ["ok", "x\ny"] }],
    ["a value over the limit", { a: "x".repeat(2_001) }],
  ])("refuses %s", (_label, query) => {
    expect(refusal(readFreeQuery(query)).code).toBe("invalid_query");
  });

  it("refuses more than 40 parameters and more than 100 values", () => {
    const many = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [`p${index}`, "x"]),
    );
    expect(refusal(readFreeQuery(many)).code).toBe("invalid_query");
    expect(
      refusal(
        readFreeQuery({ ids: Array.from({ length: 101 }, (_, i) => `${i}`) }),
      ).code,
    ).toBe("invalid_query");
  });

  it("does not echo a bad parameter name", () => {
    expect(refusal(readFreeQuery({ "bad name!": "x" })).message).not.toContain(
      "bad name",
    );
  });
});

describe("readFreeHeaders", () => {
  it("accepts ordinary request headers, keeping their names", () => {
    expect(
      value(
        readFreeHeaders({
          Accept: "application/json",
          "X-Request-Id": "nightly-1",
          "If-None-Match": '"abc"',
          "Notion-Version": "2022-06-28",
        }),
      ),
    ).toEqual({
      Accept: "application/json",
      "X-Request-Id": "nightly-1",
      "If-None-Match": '"abc"',
      "Notion-Version": "2022-06-28",
    });
  });

  it.each([
    "Authorization",
    "authorization",
    "Proxy-Authorization",
    "Cookie",
    "Set-Cookie",
    "Host",
    "Content-Length",
    "Transfer-Encoding",
    "Connection",
    "Forwarded",
    "X-Forwarded-For",
    "X-HTTP-Method-Override",
    "X-Method-Override",
    "X-API-Key",
    "api-key",
    "ApiKey",
    "X-Auth-Token",
    "X-Access-Token",
    "X-Client-Secret",
    "X-Shop-Password",
    "X-Hub-Signature",
  ])("refuses the header %s by name, never echoing its value", (name) => {
    const refused = refusal(readFreeHeaders({ [name]: "hunter2-value" }));
    expect(refused.code).toBe("header_denied");
    expect(refused.message).toContain(`"${name}"`);
    expect(refused.message).not.toContain("hunter2-value");
    expect(isDeniedHeader(name)).toBe(true);
  });

  it("does not refuse the headers providers set for versioning", () => {
    for (const name of [
      "X-GitHub-Api-Version",
      "Notion-Version",
      "Accept-Language",
    ]) {
      expect(isDeniedHeader(name), name).toBe(false);
    }
  });

  it.each([
    ["an array", ["a"]],
    ["a number value", { "X-A": 1 }],
    ["a null value", { "X-A": null }],
    ["a line break in a value", { "X-A": "x\r\nX-B: 1" }],
    ["a NUL in a value", { "X-A": "x\u0000" }],
    ["a name with a space", { "X A": "x" }],
    ["a name with a colon", { "X:A": "x" }],
    ["the same header twice", { "X-A": "1", "x-a": "2" }],
    ["a value over the limit", { "X-A": "x".repeat(1_001) }],
  ])("refuses %s", (_label, headers) => {
    expect(refusal(readFreeHeaders(headers)).code).toBe("invalid_header");
  });

  it("refuses more than 20 headers", () => {
    const many = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`X-H${index}`, "x"]),
    );
    expect(refusal(readFreeHeaders(many)).code).toBe("invalid_header");
  });
});

describe("authentication, timeout and pagination", () => {
  it("maps provider to core's default sign-in and none to none", () => {
    expect(value(readFreeAuth("provider"))).toBe("default");
    expect(value(readFreeAuth("none"))).toBe("none");
    expect(refusal(readFreeAuth("basic")).code).toBe("invalid_field");
  });

  it("turns seconds into milliseconds, from 1 to the ceiling", () => {
    expect(value(readFreeTimeout(1))).toBe(1_000);
    expect(value(readFreeTimeout(2.5))).toBe(2_500);
    expect(value(readFreeTimeout(FREE_FORM_MAX_TIMEOUT_SECONDS))).toBe(60_000);
    for (const bad of [0, 0.5, 61, -3, Number.NaN, "10", null]) {
      expect(refusal(readFreeTimeout(bad)).code, String(bad)).toBe(
        "invalid_timeout",
      );
    }
  });

  it("reads a cursor paging config and defaults the page count", () => {
    expect(
      value(
        readFreePagination({
          cursorPath: "response_metadata.next_cursor",
          cursorParam: "cursor",
          itemsPath: "members",
          maxPages: 4,
        }),
      ),
    ).toEqual({
      cursorPath: "response_metadata.next_cursor",
      cursorParam: "cursor",
      itemsPath: "members",
      maxPages: 4,
    });
    expect(
      value(readFreePagination({ cursorPath: "next", cursorParam: "after" })),
    ).toEqual({
      cursorPath: "next",
      cursorParam: "after",
      maxPages: FREE_FORM_DEFAULT_PAGES,
    });
  });

  it("caps pages at the named limit instead of quietly lowering them", () => {
    expect(FREE_FORM_MAX_PAGES).toBeLessThan(10);
    expect(
      value(
        readFreePagination({
          cursorPath: "n",
          cursorParam: "c",
          maxPages: FREE_FORM_MAX_PAGES,
        }),
      ).maxPages,
    ).toBe(FREE_FORM_MAX_PAGES);
    expect(
      refusal(
        readFreePagination({
          cursorPath: "n",
          cursorParam: "c",
          maxPages: FREE_FORM_MAX_PAGES + 1,
        }),
      ).code,
    ).toBe("invalid_pagination");
  });

  it.each([
    ["not an object", "next"],
    ["no cursorParam", { cursorPath: "next" }],
    ["no cursorPath", { cursorParam: "after" }],
    ["a cursor path with a bracket", { cursorPath: "a[0]", cursorParam: "c" }],
    ["a prototype path", { cursorPath: "a.__proto__.b", cursorParam: "c" }],
    ["a bad parameter name", { cursorPath: "n", cursorParam: "a b" }],
    [
      "a bad items path",
      { cursorPath: "n", cursorParam: "c", itemsPath: "a b" },
    ],
    ["zero pages", { cursorPath: "n", cursorParam: "c", maxPages: 0 }],
    [
      "a fractional page count",
      { cursorPath: "n", cursorParam: "c", maxPages: 1.5 },
    ],
    ["an unknown setting", { cursorPath: "n", cursorParam: "c", mode: "page" }],
    [
      "a body cursor, which a GET cannot send",
      { cursorPath: "n", cursorBodyPath: "c" },
    ],
  ])("refuses %s", (_label, pagination) => {
    expect(refusal(readFreePagination(pagination)).code).toBe(
      "invalid_pagination",
    );
  });
});

describe("allowedResponseHeaders", () => {
  it("keeps the headers that describe the answer and nothing that signs in", () => {
    expect(
      allowedResponseHeaders({
        "content-type": "application/json",
        Link: '<https://example.test/?page=2>; rel="next"',
        etag: '"x"',
        date: "Fri, 30 Oct 2026 12:00:00 GMT",
        "retry-after": "5",
        "x-ratelimit-remaining": "99",
        "X-RateLimit-Reset": "1700000000",
        "set-cookie": "session=abc",
        "www-authenticate": "Bearer realm=x",
        authorization: "Bearer abc",
        "x-powered-by": "express",
        "x-request-id": "r1",
      }),
    ).toEqual({
      "content-type": "application/json",
      link: '<https://example.test/?page=2>; rel="next"',
      etag: '"x"',
      date: "Fri, 30 Oct 2026 12:00:00 GMT",
      "retry-after": "5",
      "x-ratelimit-remaining": "99",
      "x-ratelimit-reset": "1700000000",
    });
  });

  it("returns nothing for headers that are not an object of text", () => {
    expect(allowedResponseHeaders(undefined)).toEqual({});
    expect(allowedResponseHeaders(["a"])).toEqual({});
    expect(allowedResponseHeaders({ "content-type": 5 })).toEqual({});
  });
});

describe("checkFreeFormValue", () => {
  const names = {
    path: "path",
    query: "query",
    headers: "headers",
    auth: "authentication",
    timeoutSeconds: "timeoutSeconds",
    pagination: "pagination",
    includeStatus: "includeStatus",
    placeholders: ["projectId"],
  };

  it("names the role of each field", () => {
    expect(freeFormRoleOf(names, "path")).toBe("path");
    expect(freeFormRoleOf(names, "authentication")).toBe("auth");
    expect(freeFormRoleOf(names, "timeoutSeconds")).toBe("timeoutSeconds");
    expect(freeFormRoleOf(names, "other")).toBeUndefined();
  });

  it("gives the same refusal a run would, for a fixed value", () => {
    expect(checkFreeFormValue(names, "path", "a/../b")?.message).toContain(
      "segment",
    );
    expect(checkFreeFormValue(names, "path", "a/../b")?.code).toBe(
      "unsafe_path_value",
    );
    expect(
      checkFreeFormValue(names, "headers", { Authorization: "x" })?.message,
    ).toContain('"Authorization"');
    expect(
      checkFreeFormValue(names, "headers", { Authorization: "x" })?.code,
    ).toBe("header_denied");
    expect(checkFreeFormValue(names, "timeoutSeconds", 99)?.message).toContain(
      "1 to 60",
    );
    expect(checkFreeFormValue(names, "timeoutSeconds", 99)?.code).toBe(
      "invalid_timeout",
    );
    expect(
      checkFreeFormValue(names, "path", "api/projects/{projectId}/x"),
    ).toBeNull();
  });

  it("leaves an empty path to the required-field check and has nothing to say about the rest", () => {
    expect(checkFreeFormValue(names, "path", "  ")).toBeNull();
    expect(checkFreeFormValue(names, "auth", "none")).toBeNull();
    expect(checkFreeFormValue(names, "includeStatus", true)).toBeNull();
  });
});
