export type SocialMetaDescriptor =
  | { title: string }
  | { property: string; content: string }
  | { name: string; content: string };

export const AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c533fed169648069bffaed652ec0897";
export const AGENT_NATIVE_SOCIAL_IMAGE_PATH = "/_agent-native/og-image.png";
export const AGENT_NATIVE_SOCIAL_IMAGE_WIDTH = "1200";
export const AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT = "630";
export const AGENT_NATIVE_SOCIAL_IMAGE_TYPE = "image/png";
export const AGENT_NATIVE_SOCIAL_IMAGE_ALT = "Agent-Native app preview";

function hasMetaProperty(meta: SocialMetaDescriptor[], property: string) {
  return meta.some((item) => "property" in item && item.property === property);
}

function hasMetaName(meta: SocialMetaDescriptor[], name: string) {
  return meta.some((item) => "name" in item && item.name === name);
}

export function defaultSocialImageMeta(
  image = AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
): SocialMetaDescriptor[] {
  return [
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: AGENT_NATIVE_SOCIAL_IMAGE_TYPE },
    { property: "og:image:width", content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH },
    { property: "og:image:height", content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT },
    { property: "og:image:alt", content: AGENT_NATIVE_SOCIAL_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: AGENT_NATIVE_SOCIAL_IMAGE_ALT },
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
            content: AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
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
