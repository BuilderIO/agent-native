import { describe, expect, it } from "vitest";

import { APP_STATUS, DEFAULT_APP_STATUS } from "./app-status.js";
import { AUTH_MARKETING_PRESENTATION } from "./auth-marketing-presentation.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  agentNativeSocialImageCacheBusterFor,
} from "./social-meta.js";

describe("social image cache buster", () => {
  it("is derived from the sign-in copy and status badges the image renders", () => {
    expect(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER).toBe(
      agentNativeSocialImageCacheBusterFor([
        AUTH_MARKETING_PRESENTATION,
        DEFAULT_APP_STATUS,
        APP_STATUS,
      ]),
    );
    expect(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER).toMatch(
      /^signin-brand-v2-[0-9a-z]+$/,
    );
  });

  it("changes the image URL when app copy or status changes", () => {
    const copy = {
      mail: {
        headline: "Read it. Write it.\nLet your agent take it from here.",
        description: "An inbox that drafts, sorts, and follows up with you.",
      },
    };
    const original = agentNativeSocialImageCacheBusterFor([copy, "alpha", {}]);

    expect(agentNativeSocialImageCacheBusterFor([copy, "alpha", {}])).toBe(
      original,
    );
    expect(
      agentNativeSocialImageCacheBusterFor([
        { mail: { ...copy.mail, headline: "Read it. Send it." } },
        "alpha",
        {},
      ]),
    ).not.toBe(original);
    expect(
      agentNativeSocialImageCacheBusterFor([copy, "alpha", { mail: "beta" }]),
    ).not.toBe(original);
  });
});
