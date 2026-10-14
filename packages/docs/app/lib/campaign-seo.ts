import type { MetaDescriptor } from "react-router";

import { agentNativeSocialImageUrl, withDefaultSocialImage } from "../seo";

export function campaignMeta(
  title: string,
  description: string,
  path: string,
  type: "website" | "article" = "website",
): MetaDescriptor[] {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error(
      "Campaign canonical path must be a root-relative path without query or fragment",
    );
  }
  const canonical = new URL(path, "https://www.agent-native.com").toString();
  return withDefaultSocialImage(
    [
      { title: `${title} | Agent-Native` },
      { property: "og:title", content: title },
      { name: "description", content: description },
      { name: "robots", content: "index, max-image-preview:large" },
      { tagName: "link", rel: "canonical", href: canonical },
      { property: "og:url", content: canonical },
      { property: "og:type", content: type },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    agentNativeSocialImageUrl(title),
  );
}
