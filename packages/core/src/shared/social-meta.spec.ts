import { describe, expect, it } from "vitest";

import { APP_STATUS, DEFAULT_APP_STATUS } from "./app-status.js";
import { AUTH_MARKETING_PRESENTATION } from "./auth-marketing-presentation.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  agentNativeSocialImageCacheBusterFor,
  buildResourceSocialMeta,
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

describe("resource social metadata", () => {
  it("builds a mounted, content-aware social card", () => {
    const meta = buildResourceSocialMeta({
      title: "Roadmap & launch",
      description: "A public plan for launch day.",
      origin: "https://example.com",
      basePath: "/workspace/",
    });
    const image = new URL(
      meta.find((item) => "property" in item && item.property === "og:image")!
        .content,
    );

    expect(image.pathname).toBe("/workspace/_agent-native/og-image.png");
    expect(image.searchParams.get("title")).toBe("Roadmap & launch");
    expect(image.searchParams.get("accentText")).toBe(
      "A public plan for launch day.",
    );
    expect(image.searchParams.get("v")).toBe(
      AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
    );
    expect(meta).toContainEqual({
      property: "og:title",
      content: "Roadmap & launch",
    });
    expect(meta).toContainEqual({
      property: "og:image:alt",
      content: "Roadmap & launch",
    });
    expect(meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("keeps a public resource's purpose-built social image", () => {
    const meta = buildResourceSocialMeta({
      title: "Discovery call",
      description: "Book a 30-minute meeting.",
      origin: "https://example.com",
      imageUrl: "/calendar/og.png?v=calendar-v1",
    });

    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://example.com/calendar/og.png?v=calendar-v1",
    });
    expect(meta).toContainEqual({
      name: "twitter:image",
      content: "https://example.com/calendar/og.png?v=calendar-v1",
    });
  });
});
