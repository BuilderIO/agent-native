import { APP_STATUS, DEFAULT_APP_STATUS } from "./app-status.js";
import { AUTH_MARKETING_PRESENTATION } from "./auth-marketing-presentation.js";

export type SocialMetaDescriptor =
  | { title: string }
  | { property: string; content: string }
  | { name: string; content: string };

export const AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9ff332b274a147229544c2bf5877a10d";
export const AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE_TYPE = "image/jpeg";
export const AGENT_NATIVE_SOCIAL_IMAGE_PATH = "/_agent-native/og-image.png";
const AGENT_NATIVE_SOCIAL_IMAGE_DESIGN_VERSION = "signin-brand-v2";

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function agentNativeSocialImageCacheBusterFor(content: unknown): string {
  return `${AGENT_NATIVE_SOCIAL_IMAGE_DESIGN_VERSION}-${fnv1a(JSON.stringify(content))}`;
}

export const AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER =
  agentNativeSocialImageCacheBusterFor([
    AUTH_MARKETING_PRESENTATION,
    DEFAULT_APP_STATUS,
    APP_STATUS,
  ]);
export const AGENT_NATIVE_SOCIAL_IMAGE_WIDTH = "1200";
export const AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT = "630";
export const AGENT_NATIVE_SOCIAL_IMAGE_TYPE = "image/png";
export const AGENT_NATIVE_SOCIAL_IMAGE_ALT = "Agent-Native app preview";

export function withAgentNativeSocialImageCacheBuster(image: string): string {
  const separator = image.includes("?") ? "&" : "?";
  return `${image}${separator}v=${encodeURIComponent(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER)}`;
}

function hasMetaProperty(meta: SocialMetaDescriptor[], property: string) {
  return meta.some((item) => "property" in item && item.property === property);
}

function hasMetaName(meta: SocialMetaDescriptor[], name: string) {
  return meta.some((item) => "name" in item && item.name === name);
}

function socialImageType(image: string): string {
  return image === AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE
    ? AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE_TYPE
    : AGENT_NATIVE_SOCIAL_IMAGE_TYPE;
}

export function defaultSocialImageMeta(
  image = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  alt = AGENT_NATIVE_SOCIAL_IMAGE_ALT,
): SocialMetaDescriptor[] {
  return [
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: socialImageType(image) },
    { property: "og:image:width", content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH },
    { property: "og:image:height", content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT },
    { property: "og:image:alt", content: alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: alt },
  ];
}

export function buildResourceSocialMeta({
  title,
  description,
  origin,
  basePath = "",
  type = "article",
  imageUrl,
}: {
  title: string;
  description?: string;
  origin: string;
  basePath?: string;
  type?: "article" | "website";
  imageUrl?: string;
}): SocialMetaDescriptor[] {
  const image = new URL(
    imageUrl ??
      `${basePath.replace(/\/+$/, "")}${AGENT_NATIVE_SOCIAL_IMAGE_PATH}`,
    origin,
  );
  if (!imageUrl) {
    image.searchParams.set("title", title.slice(0, 140));
    if (description)
      image.searchParams.set("accentText", description.slice(0, 80));
  }
  const socialImage = image.searchParams.has("v")
    ? image.toString()
    : withAgentNativeSocialImageCacheBuster(image.toString());

  return [
    ...(description ? [{ name: "description", content: description }] : []),
    { property: "og:title", content: title },
    ...(description
      ? [{ property: "og:description", content: description }]
      : []),
    { property: "og:type", content: type },
    { name: "twitter:title", content: title },
    ...(description
      ? [{ name: "twitter:description", content: description }]
      : []),
    ...defaultSocialImageMeta(socialImage, title),
  ];
}

export function withDefaultSocialImage<T extends SocialMetaDescriptor>(
  meta: T[],
  image = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
): Array<T | SocialMetaDescriptor> {
  const hasAnySocialImage =
    hasMetaProperty(meta, "og:image") || hasMetaName(meta, "twitter:image");

  return [
    ...meta,
    ...(hasAnySocialImage
      ? []
      : [
          { property: "og:image", content: image },
          { property: "og:image:secure_url", content: image },
          {
            property: "og:image:type",
            content: socialImageType(image),
          },
          {
            property: "og:image:width",
            content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
          },
          {
            property: "og:image:height",
            content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
          },
          { property: "og:image:alt", content: AGENT_NATIVE_SOCIAL_IMAGE_ALT },
        ]),
    ...(hasMetaName(meta, "twitter:card")
      ? []
      : [{ name: "twitter:card", content: "summary_large_image" }]),
    ...(hasAnySocialImage
      ? []
      : [
          { name: "twitter:image", content: image },
          { name: "twitter:image:alt", content: AGENT_NATIVE_SOCIAL_IMAGE_ALT },
        ]),
  ];
}
