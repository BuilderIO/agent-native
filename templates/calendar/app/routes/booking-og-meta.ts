import type {
  LoaderFunctionArgs,
  MetaArgs,
  MetaDescriptor,
} from "react-router";

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
  data,
}: MetaArgs<typeof bookingOgLoader>): MetaDescriptor[] {
  const image = data?.ogImageUrl;
  return [
    { title: "Book a Meeting" },
    { property: "og:title", content: "Book a Meeting" },
    { property: "og:type", content: "website" },
    ...(image
      ? [
          { property: "og:image", content: image },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
}
