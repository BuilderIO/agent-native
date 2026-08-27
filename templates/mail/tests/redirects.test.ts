import { afterEach, describe, expect, it, vi } from "vitest";

import { clientLoader, loader } from "../app/routes/_index";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockPreferences(pinnedLabels: string[] | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ pinnedLabels }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

async function expectInboxRedirect(
  routeLoader: typeof loader | typeof clientLoader,
  pinnedLabels: string[] | undefined,
  expectedLocation: string,
) {
  mockPreferences(pinnedLabels);
  let thrown: unknown;
  try {
    await routeLoader({ request: new Request("https://mail.test/") } as never);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(expectedLocation);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
}

describe("Mail root route", () => {
  it("keeps the server redirect preference-free for the public shell", () => {
    return expectInboxRedirect(loader, [], "/inbox");
  });

  it("keeps first-use Important selected on client navigation", () => {
    return expectInboxRedirect(
      clientLoader,
      undefined,
      "/inbox?label=important",
    );
  });

  it("routes an explicitly saved empty pin list on the client", () => {
    return expectInboxRedirect(clientLoader, [], "/inbox");
  });
});
