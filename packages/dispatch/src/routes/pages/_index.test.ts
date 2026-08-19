import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "./_index";

function expectOverviewRedirect(
  routeLoader: typeof loader | typeof clientLoader,
) {
  let thrown: unknown;
  try {
    routeLoader({
      url: new URL("https://dispatch.example/?thread=thread-1"),
    } as never);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/overview?thread=thread-1");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
}

describe("Dispatch root route", () => {
  it("marks the server redirect as cacheable HTML", () => {
    expectOverviewRedirect(loader);
  });

  it("marks the client redirect as cacheable HTML", () => {
    expectOverviewRedirect(clientLoader);
  });
});
