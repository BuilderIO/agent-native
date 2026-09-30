import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";

import { getDb, schema } from "../../server/db";

export interface BookingOgLoaderData {
  ogImageUrl: string;
  link: {
    title: string;
    description: string | null;
    duration: number;
    updatedAt: string;
  } | null;
  origin: string;
  pageUrl: string;
  basePath: string;
}

export async function bookingOgLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<BookingOgLoaderData> {
  const slug = params.slug ?? "";
  const url = new URL(request.url);
  const [link] = slug
    ? await getDb()
        .select({
          title: schema.bookingLinks.title,
          description: schema.bookingLinks.description,
          duration: schema.bookingLinks.duration,
          updatedAt: schema.bookingLinks.updatedAt,
        })
        .from(schema.bookingLinks)
        .where(
          and(
            eq(schema.bookingLinks.slug, slug),
            eq(schema.bookingLinks.isActive, true),
          ),
        )
        .limit(1)
    : [];
  const basePath = getConfiguredAppBasePath();
  const imageUrl = new URL(
    `${basePath}/api/public/booking-links/${encodeURIComponent(slug)}/og.png`,
    request.url,
  );
  if (params.username) imageUrl.searchParams.set("username", params.username);
  if (link) imageUrl.searchParams.set("bookingUpdatedAt", link.updatedAt);
  return {
    ogImageUrl: imageUrl.toString(),
    link: link ?? null,
    origin: url.origin,
    pageUrl: `${url.origin}${url.pathname}`,
    basePath,
  };
}
