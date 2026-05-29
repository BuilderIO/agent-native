export type SocialMetaDescriptor =
  | { title: string }
  | { property: string; content: string }
  | { name: string; content: string };

export const AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c533fed169648069bffaed652ec0897";

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
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
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
    ...(hasAnySocialImage ? [] : [{ property: "og:image", content: image }]),
    ...(hasMetaName(meta, "twitter:card")
      ? []
      : [{ name: "twitter:card", content: "summary_large_image" }]),
    ...(hasAnySocialImage ? [] : [{ name: "twitter:image", content: image }]),
  ];
}
