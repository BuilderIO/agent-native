import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readEnvConfigLayer } from "./env-layer.js";
import { experienceProfilesConfig } from "./experience-profiles.js";

it("denies reference access by default and rejects malformed reviewer identities", () => {
  expect(experienceProfilesConfig.parse({})).toEqual({ referenceEmails: [] });
  expect(() =>
    experienceProfilesConfig.parse({ referenceEmails: ["not-an-email"] }),
  ).toThrow();
});

describe("reference reviewer deployment configuration", () => {
  it("resolves only the declared server-side allowlist alias", () => {
    expect(
      readEnvConfigLayer(
        z.object({ experienceProfiles: experienceProfilesConfig }),
        {
          EXPERIENCE_REFERENCE_EMAILS: "reviewer@example.com,qa@example.com",
        },
      ).experienceProfiles,
    ).toEqual({ referenceEmails: ["reviewer@example.com", "qa@example.com"] });
  });
});
