import { H3 } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIRST_TOUCH_SERVER_PATH } from "../shared/first-touch-persistence.js";
import { encodeFirstTouchServerCookieValue } from "./attribution.js";
import { createFirstTouchHandler } from "./first-touch-route.js";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function app() {
  return new H3().use(FIRST_TOUCH_SERVER_PATH, createFirstTouchHandler());
}

function post(
  firstTouch: unknown,
  headers: Record<string, string> = {},
  body = JSON.stringify({ firstTouch }),
) {
  return app().fetch(
    new Request(`https://clips.agent-native.com${FIRST_TOUCH_SERVER_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body,
    }),
  );
}

function serverCookie(touch: Record<string, string>) {
  return `an_fts=${encodeFirstTouchServerCookieValue(touch)}`;
}

function setCookies(response: Response) {
  return response.headers.getSetCookie();
}

function storedTouch(response: Response) {
  const cookie = setCookies(response).find((c) => c.startsWith("an_fts="));
  if (!cookie) return undefined;
  const value = cookie.slice("an_fts=".length).split(";", 1)[0]!;
  return JSON.parse(decodeURIComponent(value)) as Record<string, string>;
}

const sourced = {
  utm_source: "youtube",
  landing_path: "/",
  landed_at: "2026-10-10T00:00:00.000Z",
};
const direct = { landing_path: "/", landed_at: "2026-10-12T00:00:00.000Z" };

describe("first-touch server cookie route", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an anonymous visitor's first touch for a year from the visit", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const response = await post(sourced);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stored: true,
      firstTouch: { utm_source: "youtube" },
    });
    const [cookie] = setCookies(response);
    expect(cookie).toContain(
      `Expires=${new Date(Date.parse(sourced.landed_at) + 365 * DAY_MS).toUTCString()}`,
    );
    expect(cookie).toContain("Path=/; SameSite=Lax; Secure");
    expect(cookie).not.toMatch(/HttpOnly|Domain=/i);
    expect(storedTouch(response)).toMatchObject({ v: "1", ...sourced });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("writes the browser's an_ft and an_lt again for 30 days", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const ft = encodeURIComponent(JSON.stringify(sourced));
    const lt = encodeURIComponent(
      JSON.stringify({ utm_source: "linkedin", touched_at: sourced.landed_at }),
    );
    const response = await post(sourced, {
      cookie: `${serverCookie(sourced)}; an_ft=${ft}; an_lt=${lt}`,
    });

    expect(setCookies(response)).toEqual([
      `an_ft=${ft}; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
      `an_lt=${lt}; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
    ]);
  });

  it("doesn't echo a browser cookie that isn't a touch", async () => {
    const response = await post(sourced, {
      cookie: "an_ft=not-json; an_lt=%7B%7D%3B%20Domain%3Devil",
    });

    expect(
      setCookies(response).filter((c) => !c.startsWith("an_fts=")),
    ).toEqual([]);
  });

  it("refuses requests from another origin", async () => {
    const crossSite = await post(sourced, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(setCookies(crossSite)).toEqual([]);

    const sameSite = await post(sourced, { "sec-fetch-site": "same-site" });
    expect(sameSite.status).toBe(403);

    const navigation = await post(sourced, { "sec-fetch-site": "none" });
    expect(navigation.status).toBe(403);

    const otherOrigin = await app().fetch(
      new Request(`https://clips.agent-native.com${FIRST_TOUCH_SERVER_PATH}`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: JSON.stringify({ firstTouch: sourced }),
      }),
    );
    expect(otherOrigin.status).toBe(403);

    const noOrigin = await post(sourced, { "sec-fetch-site": "" });
    expect(noOrigin.status).toBe(403);

    const sameOrigin = await app().fetch(
      new Request(`https://clips.agent-native.com${FIRST_TOUCH_SERVER_PATH}`, {
        method: "POST",
        headers: { origin: "https://clips.agent-native.com" },
        body: JSON.stringify({ firstTouch: sourced }),
      }),
    );
    expect(sameOrigin.status).toBe(200);
  });

  it("accepts only POST", async () => {
    const response = await app().fetch(
      new Request(`https://clips.agent-native.com${FIRST_TOUCH_SERVER_PATH}`),
    );
    expect(response.status).toBe(405);
  });

  it("keeps a sourced first touch when a stale direct one arrives later", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const response = await post(direct, { cookie: serverCookie(sourced) });

    expect(await response.json()).toMatchObject({
      stored: true,
      firstTouch: { utm_source: "youtube" },
    });
    expect(setCookies(response)).toEqual([]);
  });

  it("upgrades a direct first touch to the first visit with a source", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const later = { ...sourced, landed_at: "2026-10-14T00:00:00.000Z" };
    const response = await post(later, { cookie: serverCookie(direct) });

    expect(storedTouch(response)).toMatchObject({ utm_source: "youtube" });
  });

  it("keeps the earlier of two sourced visits", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const later = {
      ref: "alice",
      landing_path: "/",
      landed_at: "2026-10-15T00:00:00.000Z",
    };
    const keep = await post(later, { cookie: serverCookie(sourced) });
    expect(setCookies(keep)).toEqual([]);

    const replace = await post(sourced, { cookie: serverCookie(later) });
    expect(storedTouch(replace)).toMatchObject({ utm_source: "youtube" });
  });

  it("ignores a cookie from another format version", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const future = encodeURIComponent(JSON.stringify({ ...sourced, v: "2" }));
    const response = await post(direct, { cookie: `an_fts=${future}` });

    expect(storedTouch(response)).toMatchObject({ v: "1", ...direct });
  });

  it.each([
    ["x-country", "DE"],
    ["x-country", "fr"],
    ["cf-ipcountry", "NL"],
    [
      "x-nf-geo",
      Buffer.from(JSON.stringify({ country: { code: "IE" } })).toString(
        "base64",
      ),
    ],
  ])(
    "stores nothing and clears attribution until the visitor consents (%s: %s)",
    async (header, value) => {
      const response = await post(sourced, { [header]: value });

      expect(await response.json()).toEqual({
        stored: false,
        reason: "consent_required",
      });
      expect(setCookies(response)).toEqual([
        expect.stringMatching(/^an_fts=; Max-Age=0; Path=\//),
        expect.stringMatching(/^an_ft=; Max-Age=0; Path=\//),
        expect.stringMatching(/^an_lt=; Max-Age=0; Path=\//),
      ]);
    },
  );

  it("stores a visitor outside those countries", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    for (const country of ["US", "GB", "CH"]) {
      const response = await post(sourced, { "x-country": country });
      expect(storedTouch(response)).toMatchObject({ utm_source: "youtube" });
    }
  });

  it("stores a consent-region visitor who accepted targeting cookies", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const accepted = await post(sourced, {
      "x-country": "DE",
      cookie: "an_consent=1.p0.t1",
    });
    expect(storedTouch(accepted)).toMatchObject({ utm_source: "youtube" });

    const performanceOnly = await post(sourced, {
      "x-country": "DE",
      cookie: "an_consent=1.p1.t0",
    });
    expect(await performanceOnly.json()).toMatchObject({ stored: false });
  });

  it("does not store a first touch older than a year", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const old = {
      ...sourced,
      landed_at: new Date(NOW - 366 * DAY_MS).toISOString(),
    };
    const response = await post(old);

    expect(await response.json()).toEqual({ stored: false, reason: "expired" });
    expect(setCookies(response)).toEqual([]);
  });

  it("keeps a valid server copy when the browser sends one older than a year", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const expired = {
      ...sourced,
      landed_at: new Date(NOW - 400 * DAY_MS).toISOString(),
    };
    const response = await post(expired, {
      cookie: serverCookie({ v: "1", ...direct }),
    });

    expect(await response.json()).toMatchObject({
      stored: true,
      firstTouch: direct,
    });
    expect(storedTouch(response)).toBeUndefined();
  });

  it("counts a future visit time from now", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const response = await post({
      ...sourced,
      landed_at: "2030-01-01T00:00:00.000Z",
    });

    expect(setCookies(response)[0]).toContain(
      `Expires=${new Date(NOW + 365 * DAY_MS).toUTCString()}`,
    );
  });

  it("fits a large first touch into the cookie budget, keeping the visit time", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const large = {
      gclid: "g".repeat(120),
      msclkid: "m".repeat(120),
      utm_source: "💡".repeat(120),
      utm_medium: "💡".repeat(120),
      utm_campaign: "💡".repeat(120),
      utm_content: "💡".repeat(120),
      utm_term: "💡".repeat(120),
      landed_at: sourced.landed_at,
    };
    const response = await post(large);
    const cookie = setCookies(response)[0]!;

    expect(cookie.split(";", 1)[0]!.length).toBeLessThanOrEqual(1500);
    expect(storedTouch(response)).toMatchObject({
      landed_at: sourced.landed_at,
      gclid: large.gclid,
      capture_truncated: "1",
    });
  });

  it("rejects bodies that are too large, malformed, or missing a touch", async () => {
    const tooLarge = await post(null, {}, "x".repeat(9 * 1024));
    expect(tooLarge.status).toBe(413);

    // A streamed body declares no length, so the cap applies while reading.
    const streamed = await app().fetch(
      new Request(`https://clips.agent-native.com${FIRST_TOUCH_SERVER_PATH}`, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: new ReadableStream({
          start(controller) {
            for (let i = 0; i < 20; i += 1) {
              controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
            }
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
    );
    expect(streamed.status).toBe(413);

    const malformed = await post(null, {}, "{");
    expect(malformed.status).toBe(400);

    const empty = await post(null, {}, JSON.stringify({ firstTouch: {} }));
    expect(empty.status).toBe(400);
  });
});
