import { H3 } from "h3";
import { describe, expect, it } from "vitest";

import { CONSENT_REGION_PATH } from "../shared/consent.js";
import { createConsentRegionHandler } from "./consent-route.js";

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
