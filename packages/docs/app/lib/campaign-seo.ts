import type { MetaDescriptor } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { agentNativeSocialImageUrl, withDefaultSocialImage } from "../seo";

export function campaignMeta(
  title: string,
  description: string,
  path: string,
  type: "website" | "article" = "website",
  locale?: string,
  image?: string,
  /** The share title, when it differs from the <title> (an article's H1 vs its SEO title). */
  socialTitle = title,
): MetaDescriptor[] {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error(
      "Campaign canonical path must be a root-relative path without query or fragment",
    );
  }
  const canonical = new URL(
    sitePathForLocale(path, locale),
    "https://www.agent-native.com",
  ).toString();
  return withDefaultSocialImage(
    [
      { title: `${title} | Agent-Native` },
      { property: "og:title", content: socialTitle },
      { name: "description", content: description },
      { name: "robots", content: "index, max-image-preview:large" },
      { tagName: "link", rel: "canonical", href: canonical },
      { property: "og:url", content: canonical },
      { property: "og:type", content: type },
      { name: "twitter:title", content: socialTitle },
      { name: "twitter:description", content: description },
    ],
    image ?? agentNativeSocialImageUrl(socialTitle),
  );
}

/** hreflang links: every language version names all the others, and English is the default. */
export function localeAlternates(
  path: string,
  locales: readonly string[],
): MetaDescriptor[] {
  const site = "https://www.agent-native.com";
  return [
    ...locales.map((locale) => ({
      tagName: "link",
      rel: "alternate",
      hrefLang: locale,
      href: `${site}${sitePathForLocale(path, locale)}`,
    })),
    {
      tagName: "link",
      rel: "alternate",
      hrefLang: "x-default",
      href: `${site}${sitePathForLocale(path)}`,
    },
  ];
}
