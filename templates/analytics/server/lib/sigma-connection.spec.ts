import { describe, expect, it } from "vitest";

import {
  normalizeSigmaBaseUrl,
  parseSigmaDirectCredentials,
} from "./sigma-connection.js";

describe("Sigma direct credentials", () => {
  it("keeps saved credentials on existing Sigma subdomains readable", () => {
    expect(
      parseSigmaDirectCredentials(
        JSON.stringify({
          clientId: "client-id",
          clientSecret: "client-secret",
          baseUrl: "https://custom.sigmacomputing.com",
        }),
      ),
    ).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      baseUrl: "https://custom.sigmacomputing.com",
    });
  });

  it("rejects Sigma URLs that could target another origin", () => {
    expect(
      normalizeSigmaBaseUrl("https://sigmacomputing.com.attacker.example"),
    ).toBeNull();
    expect(
      normalizeSigmaBaseUrl("http://custom.sigmacomputing.com"),
    ).toBeNull();
  });
});
