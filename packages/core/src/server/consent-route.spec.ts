import { H3 } from "h3";
import { describe, expect, it } from "vitest";

import { CONSENT_PATH, CONSENT_REGION_PATH } from "../shared/consent.js";
import {
  createConsentHandler,
  createConsentRegionHandler,
} from "./consent-route.js";

function region(headers: Record<string, string> = {}, method = "GET") {
  return new H3().use(CONSENT_REGION_PATH, createConsentRegionHandler()).fetch(
    new Request(`https://clips.agent-native.com${CONSENT_REGION_PATH}`, {
      method,
      headers,
    }),
  );
}

describe("consent region route", () => {
  it.each([
    [{ "x-country": "DE" }, "consent"],
    [{ "cf-ipcountry": "no" }, "consent"],
    [
      {
        "x-nf-geo": Buffer.from(
          JSON.stringify({ country: { code: "RE" } }),
        ).toString("base64"),
      },
      "consent",
    ],
    [{ "x-country": "US" }, "none"],
    [{ "x-country": "GB" }, "none"],
    [{ "x-country": "CH" }, "none"],
    [{}, "unknown"],
    [{ "x-nf-geo": "not base64 json" }, "unknown"],
  ])("answers from the geo header (%o → %s)", async (headers, expected) => {
    const response = await region(headers);

    expect(await response.json()).toEqual({ region: expected });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts only GET", async () => {
    const response = await region({}, "POST");
    expect(response.status).toBe(405);
  });
});

function postChoice(
  body: string,
  { host = "clips.agent-native.com", fetchSite = "same-origin" } = {},
) {
  return new H3().use(CONSENT_PATH, createConsentHandler()).fetch(
    new Request(`https://${host}${CONSENT_PATH}`, {
      method: "POST",
      headers: { "sec-fetch-site": fetchSite },
      body,
    }),
  );
}

describe("consent route", () => {
  it("keeps the choice for a year across agent-native.com", async () => {
    const response = await postChoice(JSON.stringify({ choice: "1.p1.t0" }));

    expect(await response.json()).toEqual({
      stored: true,
      choice: { performance: true, targeting: false },
    });
    expect(response.headers.getSetCookie()).toEqual([
      "an_consent=1.p1.t0; Max-Age=31536000; Path=/; SameSite=Lax; Domain=agent-native.com; Secure",
    ]);
  });

  it("keeps a host-only cookie elsewhere", async () => {
    const response = await postChoice(JSON.stringify({ choice: "1.p0.t0" }), {
      host: "example.com",
    });

    expect(response.headers.getSetCookie()[0]).not.toContain("Domain=");
  });

  it("refuses other origins and bad choices", async () => {
    const crossSite = await postChoice(JSON.stringify({ choice: "1.p1.t1" }), {
      fetchSite: "cross-site",
    });
    expect(crossSite.status).toBe(403);

    expect((await postChoice("{")).status).toBe(400);
    const injected = await postChoice(
      JSON.stringify({ choice: "1.p1.t1; Domain=evil.example" }),
    );
    expect(injected.status).toBe(400);
    expect(injected.headers.getSetCookie()).toEqual([]);
  });
});
