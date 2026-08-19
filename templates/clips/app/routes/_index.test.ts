import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "./_index";

function expectLibraryRedirect(
  routeLoader: typeof loader | typeof clientLoader,
  url = "https://clips.agent-native.com/?from=home",
) {
  let thrown: unknown;
  try {
    routeLoader({ url: new URL(url) } as never);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/library?from=home");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
}

describe("Clips root route", () => {
  it("marks the SSR redirect as cacheable HTML", () => {
    expectLibraryRedirect(loader);
  });

  it("keeps client navigations on the same redirect contract", () => {
    expectLibraryRedirect(clientLoader);
  });
});
