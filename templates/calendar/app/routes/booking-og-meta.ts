import type {
  LoaderFunctionArgs,
  MetaArgs,
  MetaDescriptor,
} from "react-router";

import { messagesByLocale } from "@/i18n-data";

export interface BookingOgLoaderData {
  ogImageUrl: string;
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

export function bookingOgLoader({
  params,
  request,
}: LoaderFunctionArgs): BookingOgLoaderData {
  const slug = params.slug ?? "";
  const imageUrl = new URL(
    `${appBasePath()}/api/public/booking-links/${encodeURIComponent(slug)}/og.png`,
    request.url,
  );
  if (params.username) imageUrl.searchParams.set("username", params.username);
  return { ogImageUrl: imageUrl.toString() };
}

export function bookingOgMeta({
  loaderData,
}: MetaArgs<typeof bookingOgLoader>): MetaDescriptor[] {
  const image = loaderData?.ogImageUrl;
  const title = messagesByLocale["en-US"].routeTitles.bookMeeting;
  return [
    { title },
    { property: "og:title", content: title },
    { property: "og:type", content: "website" },
    ...(image
      ? [
          { property: "og:image", content: image },
          { property: "og:image:secure_url", content: image },
          { property: "og:image:type", content: "image/png" },
          { property: "og:image:width", content: "1200" },
          { property: "og:image:height", content: "630" },
          {
            property: "og:image:alt",
            content: "Agent-Native Calendar booking link",
          },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: image },
          {
            name: "twitter:image:alt",
            content: "Agent-Native Calendar booking link",
          },
        ]
      : []),
  ];
}
