import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import { and, eq } from "drizzle-orm";
import type {
  LoaderFunctionArgs,
  MetaArgs,
  MetaDescriptor,
} from "react-router";

import enUSMessages from "@/i18n/en-US";

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

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appBasePath(): string {
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH ||
      process.env.APP_BASE_PATH ||
      metaEnv?.VITE_APP_BASE_PATH ||
      metaEnv?.APP_BASE_PATH ||
      metaEnv?.BASE_URL,
  );
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
  const imageUrl = new URL(
    `${appBasePath()}/api/public/booking-links/${encodeURIComponent(slug)}/og.png`,
    request.url,
  );
  if (params.username) imageUrl.searchParams.set("username", params.username);
  if (link) imageUrl.searchParams.set("v", link.updatedAt);
  return {
    ogImageUrl: imageUrl.toString(),
    link: link ?? null,
    origin: url.origin,
    pageUrl: `${url.origin}${url.pathname}`,
    basePath: getConfiguredAppBasePath(),
  };
}

export function bookingOgMeta({
  loaderData,
}: MetaArgs<typeof bookingOgLoader>): MetaDescriptor[] {
  const link = loaderData?.link;
  if (!link || !loaderData) {
    return [
      { title: enUSMessages.routeTitles.bookMeeting },
      { name: "robots", content: "noindex" },
    ];
  }

  const title = normalizeDocumentTitle(
    link.title,
    enUSMessages.routeTitles.bookMeeting,
  );
  const description =
    link.description?.trim() ||
    `Book a ${link.duration}-minute meeting through this public Calendar link.`;
  return [
    { title },
    { property: "og:url", content: loaderData.pageUrl },
    ...buildResourceSocialMeta({
      title,
      description,
      origin: loaderData.origin,
      basePath: loaderData.basePath,
      type: "website",
      imageUrl: loaderData.ogImageUrl,
    }),
  ];
}
