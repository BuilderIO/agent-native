import type { MetaDescriptor } from "react-router";

export const DEFAULT_SOCIAL_IMAGE =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c533fed169648069bffaed652ec0897";

function hasMetaProperty(meta: MetaDescriptor[], property: string) {
  return meta.some(
    (item) =>
      item &&
      typeof item === "object" &&
      "property" in item &&
      item.property === property,
  );
}

function hasMetaName(meta: MetaDescriptor[], name: string) {
  return meta.some(
    (item) =>
      item && typeof item === "object" && "name" in item && item.name === name,
  );
}

export function defaultSocialImageMeta(): MetaDescriptor[] {
  return [
    { property: "og:image", content: DEFAULT_SOCIAL_IMAGE },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: DEFAULT_SOCIAL_IMAGE },
  ];
}

export function withDefaultSocialImage(
  meta: MetaDescriptor[],
): MetaDescriptor[] {
  return [
    ...meta,
    ...(hasMetaProperty(meta, "og:image")
      ? []
      : [{ property: "og:image", content: DEFAULT_SOCIAL_IMAGE }]),
    ...(hasMetaName(meta, "twitter:card")
      ? []
      : [{ name: "twitter:card", content: "summary_large_image" }]),
    ...(hasMetaName(meta, "twitter:image")
      ? []
      : [{ name: "twitter:image", content: DEFAULT_SOCIAL_IMAGE }]),
  ];
}
