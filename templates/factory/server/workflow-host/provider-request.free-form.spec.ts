import { describe, expect, it } from "vitest";

import { genericOperations } from "../workflow/catalog/generic.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  PROVIDER_OUTPUT_BUDGET_CHARS,
  ProviderOperationError,
  buildProviderRequest,
  parseProviderResponse,
} from "./provider-request.js";

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

function failureOf(run: () => unknown): ProviderOperationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProviderOperationError) return error;
    throw error;
  }
  throw new Error("Expected a ProviderOperationError.");
}

const github = op("github.apiRequest");
const build = (fields: Record<string, unknown>, def = github) =>
  buildProviderRequest(def, { fields });

describe("the API request, built", () => {
  it("is a GET of the typed path and nothing else when only the path is given", () => {
    expect(build({ path: "repos/acme/web/issues" })).toEqual({
      method: "GET",
      path: "/repos/acme/web/issues",
      query: {},
      openPlaceholders: [],
    });
  });

  it("is the same request for a path with a leading slash", () => {
    expect(build({ path: "/repos/acme/web/issues" })).toEqual(
      build({ path: "repos/acme/web/issues" }),
    );
  });

  it("sends a GET with no body on every provider", () => {
    for (const { id } of genericOperations) {
      const built = build({ path: "x/y", query: { a: 1 } }, op(id));
      expect(built.method, id).toBe("GET");
      expect(built, id).not.toHaveProperty("body");
    }
  });

  it("repeats a list parameter and turns scalars into text", () => {
    expect(
      build({
        path: "search/issues",
        query: { q: "is:open", per_page: 50, "labels[]": ["bug", "p1"] },
      }).query,
    ).toEqual({ q: "is:open", per_page: "50", "labels[]": ["bug", "p1"] });
  });

  it("carries headers, the no-credential switch, the timeout and the paging config", () => {
    expect(
      build({
        path: "repos/acme/web/issues",
        headers: { "X-Request-Id": "r1" },
        authentication: "none",
        timeoutSeconds: 5,
        pagination: {
          cursorPath: "next",
          cursorParam: "after",
          itemsPath: "items",
        },
      }),
    ).toEqual({
      method: "GET",
      path: "/repos/acme/web/issues",
      query: {},
      openPlaceholders: [],
      headers: { "X-Request-Id": "r1" },
      auth: "none",
      timeoutMs: 5_000,
      fetchAllPages: {
        cursorPath: "next",
        cursorParam: "after",
        itemsPath: "items",
        maxPages: 3,
      },
    });
  });

  it("signs with the provider by default, so the default adds nothing", () => {
    const built = build({
      path: "user",
      authentication: "provider",
      includeStatus: false,
    });
    expect(built).not.toHaveProperty("auth");
    expect(built).not.toHaveProperty("includeStatus");
  });

  it("asks for the status when told to, but not beside paging", () => {
    expect(build({ path: "user", includeStatus: true }).includeStatus).toBe(
      true,
    );
    const error = failureOf(() =>
      build({
        path: "user",
        includeStatus: true,
        pagination: { cursorPath: "n", cursorParam: "c" },
      }),
    );
    expect(error.code).toBe("incompatible_fields");
  });

  it("keeps a {name} that core fills from the connection, and only for the providers that have one", () => {
    const posthog = build(
      { path: "api/projects/{projectId}/query/" },
      op("posthog.apiRequest"),
    );
    expect(posthog.path).toBe("/api/projects/{projectId}/query/");
    expect(posthog.openPlaceholders).toEqual(["projectId"]);
    expect(
      build(
        { path: "organizations/{orgSlug}/issues/" },
        op("sentry.apiRequest"),
      ).openPlaceholders,
    ).toEqual(["orgSlug"]);

    expect(
      failureOf(() => build({ path: "api/projects/{projectId}/x" })).code,
    ).toBe("unsafe_path_value");
  });

  it("has no way to set the method, a body or the host", () => {
    for (const name of ["method", "body", "url", "host", "baseUrl"]) {
      expect(
        failureOf(() => build({ path: "user", [name]: "x" })).code,
        name,
      ).toBe("unknown_field");
    }
  });

  it("needs a path", () => {
    expect(failureOf(() => build({})).code).toBe("missing_field");
    expect(failureOf(() => build({ path: "  " })).code).toBe("missing_field");
  });
});

describe("the API request, refused", () => {
  it.each([
    ["a full URL", { path: "https://evil.test/user" }, "full_url_refused"],
    [
      "a protocol-relative URL",
      { path: "//evil.test/user" },
      "full_url_refused",
    ],
    ["a dot-dot segment", { path: "repos/../admin" }, "unsafe_path_value"],
    ["an encoded dot-dot", { path: "repos/%2e%2e/admin" }, "unsafe_path_value"],
    ["an empty segment", { path: "repos//admin" }, "unsafe_path_value"],
    ["a question mark", { path: "user?x=1" }, "unsafe_path_value"],
    ["a hash", { path: "user#x" }, "unsafe_path_value"],
    ["a backslash", { path: "repos\\admin" }, "unsafe_path_value"],
    ["a line break", { path: "user\nHost: evil" }, "unsafe_path_value"],
    ["a non-object query", { path: "user", query: "a=b" }, "invalid_query"],
    [
      "a query value with a line break",
      { path: "user", query: { a: "1\r\nX: y" } },
      "invalid_query",
    ],
    [
      "an Authorization header",
      { path: "user", headers: { Authorization: "Bearer x" } },
      "header_denied",
    ],
    [
      "a token header",
      { path: "user", headers: { "X-Api-Token": "x" } },
      "header_denied",
    ],
    [
      "a non-text header",
      { path: "user", headers: { "X-A": 1 } },
      "invalid_header",
    ],
    [
      "a timeout over a minute",
      { path: "user", timeoutSeconds: 61 },
      "invalid_timeout",
    ],
    [
      "paging with no cursor parameter",
      { path: "user", pagination: { cursorPath: "next" } },
      "invalid_pagination",
    ],
    [
      "more pages than the cap",
      {
        path: "user",
        pagination: { cursorPath: "n", cursorParam: "c", maxPages: 50 },
      },
      "invalid_pagination",
    ],
    [
      "an unknown sign-in",
      { path: "user", authentication: "basic" },
      "invalid_field",
    ],
  ])("refuses %s with %s", (_label, fields, code) => {
    expect(failureOf(() => build(fields)).code).toBe(code);
  });

  it("names the denied header and never shows its value or the path", () => {
    const error = failureOf(() =>
      build({
        path: "user",
        headers: { "X-Client-Secret": "super-secret-value" },
      }),
    );
    expect(error.message).toContain("X-Client-Secret");
    expect(error.message).not.toContain("super-secret-value");

    const path = failureOf(() => build({ path: "https://evil.test/leak-9" }));
    expect(path.message).not.toContain("leak-9");
    expect(path.message).not.toContain("evil.test");
  });
});

describe("the API request, answered", () => {
  it("returns the provider's JSON exactly as another read does", () => {
    const body = { ok: true, user: { id: "U1" } };
    const curated = parseProviderResponse(op("slack.findUserByEmail"), body);
    const open = parseProviderResponse(op("slack.apiRequest"), body);
    expect(open).toEqual(curated);
    expect(open.output).toEqual(body);
    expect(open.truncated).toBe(false);
  });

  it("cuts a big answer at the existing budget and says so", () => {
    const body = {
      items: Array.from({ length: 5_000 }, (_, index) => ({
        id: index,
        title: `A fairly long issue title number ${index}`,
      })),
    };
    const parsed = parseProviderResponse(github, body);
    expect(parsed.truncated).toBe(true);
    expect(parsed.output).toMatchObject({ truncated: true });
    expect(JSON.stringify(parsed.output).length).toBeLessThanOrEqual(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });

  it("wraps the body with the status and a few headers when asked", () => {
    const parsed = parseProviderResponse(github, [{ id: 1 }], {
      includeStatus: {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.example.test/?page=2>; rel="next"',
          "x-ratelimit-remaining": "58",
          "set-cookie": "session=abc",
          "www-authenticate": "Bearer",
          authorization: "Bearer abc",
        },
      },
    });
    expect(parsed.output).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        link: '<https://api.example.test/?page=2>; rel="next"',
        "x-ratelimit-remaining": "58",
      },
      body: [{ id: 1 }],
    });
    expect(parsed.truncated).toBe(false);
  });

  it("keeps the wrapped answer inside the budget, with the cut flag beside the body", () => {
    const body = {
      items: Array.from({ length: 5_000 }, (_, index) => ({
        id: index,
        title: `A fairly long issue title number ${index}`,
      })),
    };
    const parsed = parseProviderResponse(github, body, {
      includeStatus: { status: 200, headers: { etag: '"x"' } },
    });
    const output = parsed.output as {
      status: number;
      headers: Record<string, string>;
      body: { items: unknown[] };
      truncated?: boolean;
    };
    expect(parsed.truncated).toBe(true);
    expect(output.truncated).toBe(true);
    expect(output.body).not.toHaveProperty("truncated");
    expect(output.body.items.length).toBeGreaterThan(0);
    expect(output.headers).toEqual({ etag: '"x"' });
    expect(JSON.stringify(parsed.output).length).toBeLessThanOrEqual(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });

  it("refuses an answer that is not JSON instead of passing it on as empty", () => {
    const error = failureOf(() => parseProviderResponse(github, undefined));
    expect(error.code).toBe("unexpected_response");
  });
});
