import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";

import { queryEchoSafeRedirect } from "./query-echo-safe-redirect.js";

const ORIGIN = "https://beta.content.agent-native.com";
const VERIFY =
  "/_agent-native/auth/ba/magic-link/verify?token=one-time-token&callbackURL=%2F";

function eventFor(
  pathAndQuery: string,
  headers: Record<string, string> = { "sec-fetch-mode": "navigate" },
): H3Event {
  const url = new URL(pathAndQuery, ORIGIN);
  return {
    url,
    req: new Request(url, { headers }),
    path: pathAndQuery,
  } as unknown as H3Event;
}

function redirect(location: string): Response {
  const headers = new Headers({ location });
  headers.append("set-cookie", "an_session=abc; Path=/; HttpOnly");
  headers.append("set-cookie", "an_session_hint=1; Path=/");
  return new Response(null, { status: 302, headers });
}

describe("queryEchoSafeRedirect", () => {
  it("lands a navigation on the bare callback with a page Netlify passes through untouched", async () => {
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      redirect(`${ORIGIN}/page/doc_1`),
      ORIGIN,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      "an_session=abc; Path=/; HttpOnly",
      "an_session_hint=1; Path=/",
    ]);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0;url=${ORIGIN}/page/doc_1">`,
    );
    expect(html).not.toContain("one-time-token");
  });

  it("keeps a path Location working when the request named no usable host", () => {
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      redirect("/"),
      "https://",
    );
    expect(response.status).toBe(200);
  });

  it("keeps the 302 when the edge would not copy a query onto it", () => {
    const unchanged = [
      // A failed or used link must still reach the page with its error code.
      queryEchoSafeRedirect(
        eventFor(VERIFY),
        redirect("/?error=INVALID_TOKEN"),
        ORIGIN,
      ),
      queryEchoSafeRedirect(
        eventFor("/_agent-native/auth/x"),
        redirect("/"),
        ORIGIN,
      ),
      queryEchoSafeRedirect(
        eventFor(VERIFY),
        redirect("https://accounts.google.com/o/oauth2/v2/auth"),
        ORIGIN,
      ),
      queryEchoSafeRedirect(
        eventFor(VERIFY, { "sec-fetch-mode": "cors" }),
        redirect("/"),
        ORIGIN,
      ),
    ];
    for (const response of unchanged) expect(response.status).toBe(302);
  });

  it("does not take a path the URL parser reads as another host for a same-origin one", () => {
    // The parser drops the tab, leaving a scheme-relative URL.
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      redirect("/\t/evil.test"),
      ORIGIN,
    );
    expect(response.status).toBe(302);
  });

  it("keeps a method-preserving redirect, which a navigating page would turn into a GET", () => {
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      new Response(null, { status: 307, headers: { location: "/" } }),
      ORIGIN,
    );
    expect(response.status).toBe(307);
  });
});
