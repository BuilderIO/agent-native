import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  agentNativeSocialImageCacheBusterFor,
  buildResourceSocialMeta,
} from "./social-meta.js";

describe("social image cache buster", () => {
  afterEach(() => {
    vi.doUnmock("./app-status.js");
    vi.doUnmock("./auth-marketing-presentation.js");
    vi.resetModules();
  });

  // Loads a fresh copy of social-meta.ts, optionally with edited versions of
  // the modules whose content the social image renders.
  async function loadCacheBuster(edit?: {
    status?: "app" | "default";
    copy?: true;
  }) {
    // Each load starts clean so one edit can't leak into the next comparison.
    vi.resetModules();
    vi.doUnmock("./app-status.js");
    vi.doUnmock("./auth-marketing-presentation.js");
    if (edit?.status) {
      vi.doMock("./app-status.js", async (importOriginal) => {
        const actual = await importOriginal<typeof import("./app-status.js")>();
        return edit.status === "app"
          ? { ...actual, APP_STATUS: { ...actual.APP_STATUS, mail: "beta" } }
          : { ...actual, DEFAULT_APP_STATUS: "beta" };
      });
    }
    if (edit?.copy) {
      vi.doMock("./auth-marketing-presentation.js", async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("./auth-marketing-presentation.js")
          >();
        return {
          ...actual,
          AUTH_MARKETING_PRESENTATION: {
            ...actual.AUTH_MARKETING_PRESENTATION,
            mail: { headline: "Edited headline", description: "Edited copy" },
          },
        };
      });
    }
    const module = await import("./social-meta.js");
    return module.AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER;
  }

  it("is derived from the sign-in copy and status badges the image renders", async () => {
    expect(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER).toMatch(
      /^signin-brand-v2-[0-9a-z]+$/,
    );

    // The constant must track each thing the image renders: editing any one of
    // them has to give shared links a new image URL.
    const unchanged = await loadCacheBuster();
    expect(unchanged).toBe(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER);
    expect(await loadCacheBuster({ status: "app" })).not.toBe(unchanged);
    expect(await loadCacheBuster({ status: "default" })).not.toBe(unchanged);
    expect(await loadCacheBuster({ copy: true })).not.toBe(unchanged);
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
