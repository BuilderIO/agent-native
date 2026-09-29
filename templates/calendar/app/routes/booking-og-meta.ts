import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import type { MetaArgs, MetaDescriptor } from "react-router";

import enUSMessages from "@/i18n/en-US";
import type { bookingOgLoader } from "@/lib/booking-og-loader.server";

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
