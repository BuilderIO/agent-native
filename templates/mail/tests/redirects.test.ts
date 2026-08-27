import { afterEach, describe, expect, it, vi } from "vitest";

import { clientLoader, loader } from "../app/routes/_index";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockPreferences(
  result:
    | { ok: true; pinnedLabels: string[] | undefined }
    | { ok: false; reject?: false }
    | { ok: false; reject: true },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if ("reject" in result && result.reject) {
        throw new Error("request failed");
      }
      if (!result.ok) {
        return new Response("fail", { status: 500 });
      }
      return new Response(
        JSON.stringify({ pinnedLabels: result.pinnedLabels }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
}

async function expectInboxRedirect(
  routeLoader: typeof loader | typeof clientLoader,
  fetchResult:
    | { ok: true; pinnedLabels: string[] | undefined }
    | { ok: false; reject?: false }
    | { ok: false; reject: true },
  expectedLocation: string,
) {
  mockPreferences(fetchResult);
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
    return expectInboxRedirect(
      loader,
      { ok: true, pinnedLabels: [] },
      "/inbox",
    );
  });

  it("keeps first-use Important selected on client navigation", () => {
    return expectInboxRedirect(
      clientLoader,
      { ok: true, pinnedLabels: undefined },
      "/inbox?label=important",
    );
  });

  it("routes an explicitly saved empty pin list on the client", () => {
    return expectInboxRedirect(
      clientLoader,
      { ok: true, pinnedLabels: [] },
      "/inbox",
    );
  });

  it("stays neutral on a non-2xx preference read", () => {
    return expectInboxRedirect(clientLoader, { ok: false }, "/inbox");
  });

  it("stays neutral on a rejected preference read", () => {
    return expectInboxRedirect(
      clientLoader,
      { ok: false, reject: true },
      "/inbox",
    );
  });
});
