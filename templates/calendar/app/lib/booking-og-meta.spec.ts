import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  link: null as {
    title: string;
    description: string | null;
    duration: number;
    updatedAt: string;
    isActive: boolean;
  } | null,
}));
const where = vi.hoisted(() =>
  vi.fn((conditions: Array<{ column: string; value: unknown }>) => ({
    limit: async () =>
      conditions.some(
        (condition) =>
          condition.column === "booking_active" &&
          condition.value === true &&
          database.link?.isActive === true,
      )
        ? [database.link]
        : [],
  })),
);

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Array<{ column: string; value: unknown }>) => conditions,
  eq: (column: string, value: unknown) => ({ column, value }),
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "",
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where }) }) }),
  schema: {
    bookingLinks: {
      slug: "booking_slug",
      title: "booking_title",
      description: "booking_description",
      duration: "booking_duration",
      updatedAt: "booking_updated_at",
      isActive: "booking_active",
    },
  },
}));

import { bookingOgLoader, bookingOgMeta } from "../routes/booking-og-meta";

describe("booking OG meta", () => {
  beforeEach(() => {
    database.link = {
      title: "Discovery call",
      description: "Talk through the launch plan.",
      duration: 30,
      updatedAt: "2026-09-25T18:00:00.000Z",
      isActive: true,
    };
    where.mockClear();
  });

  it("loads public link details and versions its image by link update", async () => {
    const loaderData = await bookingOgLoader({
      params: { slug: "meet-steve", username: "steve" },
      request: new Request("https://calendar.example.test/book/meet-steve"),
    } as unknown as Parameters<typeof bookingOgLoader>[0]);
    const url = new URL(loaderData.ogImageUrl);

    expect(loaderData.link).toMatchObject({
      title: "Discovery call",
      description: "Talk through the launch plan.",
      duration: 30,
    });
    expect(url.searchParams.get("username")).toBe("steve");
    expect(url.searchParams.get("v")).toBe("2026-09-25T18:00:00.000Z");
    expect(where).toHaveBeenCalled();
  });

  it("uses the link title and description in crawler metadata", async () => {
    const loaderData = await bookingOgLoader({
      params: { slug: "meet-steve" },
      request: new Request("https://calendar.example.test/book/meet-steve"),
    } as unknown as Parameters<typeof bookingOgLoader>[0]);
    const meta = bookingOgMeta({ loaderData } as Parameters<
      typeof bookingOgMeta
    >[0]);
    const image = meta.find(
      (item) => "property" in item && item.property === "og:image",
    );
    if (!image || !("content" in image)) throw new Error("Missing OG image");
    const imageUrl = new URL(String(image.content));

    expect(meta).toContainEqual({ title: "Discovery call" });
    expect(meta).toContainEqual({
      property: "og:description",
      content: "Talk through the launch plan.",
    });
    expect(meta).toContainEqual({
      name: "twitter:description",
      content: "Talk through the launch plan.",
    });
    expect(imageUrl.pathname).toBe(
      "/api/public/booking-links/meet-steve/og.png",
    );
    expect(imageUrl.searchParams.get("v")).toBe("2026-09-25T18:00:00.000Z");
    expect(meta).toContainEqual({
      property: "og:image:width",
      content: "1200",
    });
    expect(meta).toContainEqual({
      property: "og:image:height",
      content: "630",
    });
    expect(meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("does not index inactive or missing booking links", async () => {
    database.link = {
      title: "Private intake",
      description: "Internal only",
      duration: 30,
      updatedAt: "2026-09-25T18:00:00.000Z",
      isActive: false,
    };
    const loaderData = await bookingOgLoader({
      params: { slug: "private-intake" },
      request: new Request("https://calendar.example.test/book/private-intake"),
    } as unknown as Parameters<typeof bookingOgLoader>[0]);
    const meta = bookingOgMeta({ loaderData } as Parameters<
      typeof bookingOgMeta
    >[0]);

    expect(loaderData.link).toBeNull();
    expect(meta).toContainEqual({ name: "robots", content: "noindex" });
    expect(JSON.stringify(meta)).not.toContain("Private intake");
  });
});
