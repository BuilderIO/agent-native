import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "../app/routes/_index";

function expectInboxRedirect(routeLoader: typeof loader | typeof clientLoader) {
  let thrown: unknown;
  try {
    routeLoader({} as never);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/inbox?label=important");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
}

describe("Mail root route", () => {
  it("marks the server redirect as cacheable HTML", () => {
    expectInboxRedirect(loader);
  });

  it("marks the client redirect as cacheable HTML", () => {
    expectInboxRedirect(clientLoader);
  });
});
