import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function redirect(location: string, status = 302): Response {
  const headers = new Headers({ location });
  headers.append("set-cookie", "an_session=abc; Path=/; HttpOnly");
  headers.append("set-cookie", "an_session_hint=1; Path=/");
  return new Response(null, { status, headers });
}

async function landingUrl(response: Response): Promise<string | undefined> {
  return (await response.text()).match(/content="0;url=([^"]*)"/)?.[1];
}

describe("queryEchoSafeRedirect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lands a navigation on the bare callback with a page Netlify passes through untouched", async () => {
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      redirect(`${ORIGIN}/page/doc_1`),
    );
    const html = await response.clone().text();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      "an_session=abc; Path=/; HttpOnly",
      "an_session_hint=1; Path=/",
    ]);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await landingUrl(response)).toBe(`${ORIGIN}/page/doc_1`);
    expect(html).not.toContain("one-time-token");
  });

  it("lands on another app's bare URL, which the edge would also append to", async () => {
    const response = queryEchoSafeRedirect(
      eventFor("/_agent-native/identity/bootstrap/activate?activation=spent"),
      redirect("https://content.agent-native.com/page/doc_1"),
    );
    expect(response.status).toBe(200);
    expect(await landingUrl(response)).toBe(
      "https://content.agent-native.com/page/doc_1",
    );
  });

  // Workspace mounts and the dev gateway add the prefix only to a 3xx Location.
  it("carries the app base path the mount would have added to the redirect", async () => {
    vi.stubEnv("APP_BASE_PATH", "/calendar");
    const event = eventFor("/calendar/_agent-native/google/callback?code=x");

    expect(await landingUrl(queryEchoSafeRedirect(event, redirect("/")))).toBe(
      "/calendar",
    );
    expect(
      await landingUrl(queryEchoSafeRedirect(event, redirect("/settings"))),
    ).toBe("/calendar/settings");
    expect(
      await landingUrl(queryEchoSafeRedirect(event, redirect("/calendar/day"))),
    ).toBe("/calendar/day");
  });

  it("keeps the 302 when the edge would not copy a query onto it", () => {
    const unchanged = [
      // A failed or used link must still reach the page with its error code.
      queryEchoSafeRedirect(
        eventFor(VERIFY),
        redirect("/?error=INVALID_TOKEN"),
      ),
      queryEchoSafeRedirect(eventFor("/_agent-native/auth/x"), redirect("/")),
      queryEchoSafeRedirect(
        eventFor(VERIFY, { "sec-fetch-mode": "cors" }),
        redirect("/"),
      ),
    ];
    for (const response of unchanged) expect(response.status).toBe(302);
  });

  it("keeps the 302 for destinations a navigating page must not run", () => {
    const unchanged = [
      // A 302 refuses these; `location.replace` would run the script.
      queryEchoSafeRedirect(eventFor(VERIFY), redirect("javascript:alert(1)")),
      queryEchoSafeRedirect(eventFor(VERIFY), redirect("agentnative://auth")),
      // The parser drops the tab, leaving a scheme-relative URL.
      queryEchoSafeRedirect(eventFor(VERIFY), redirect("/\t/evil.test")),
    ];
    for (const response of unchanged) expect(response.status).toBe(302);
  });

  it("keeps a method-preserving redirect, which a navigating page would turn into a GET", () => {
    const response = queryEchoSafeRedirect(
      eventFor(VERIFY),
      redirect("/", 307),
    );
    expect(response.status).toBe(307);
  });
});
