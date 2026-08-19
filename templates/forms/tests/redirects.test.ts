import { SSR_QUERY_CACHE_KEY_HEADER } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "../app/routes/_index";

function expectAskRedirect(routeLoader: typeof loader | typeof clientLoader) {
  let thrown: unknown;
  try {
    routeLoader({ url: new URL("https://forms.example/?from=home") } as never);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/ask?from=home");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get(SSR_QUERY_CACHE_KEY_HEADER)).toBe("query");
}

describe("Forms root route", () => {
  it("marks the server redirect as cacheable HTML", () => {
    expectAskRedirect(loader);
  });

  it("marks the client redirect as cacheable HTML", () => {
    expectAskRedirect(clientLoader);
  });
});
