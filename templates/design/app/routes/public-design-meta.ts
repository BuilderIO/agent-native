import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
  type SocialMetaDescriptor,
} from "@agent-native/core/shared";

export interface PublicDesignMetaData {
  resource: { title: string; description: string | null } | null;
  origin: string;
  basePath: string;
}

export function designResourceMeta(
  loaderData: PublicDesignMetaData | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
): SocialMetaDescriptor[] {
  const resource = loaderData?.resource;
  if (!resource) return [{ title: fallbackTitle }];

  const title = normalizeDocumentTitle(resource.title, fallbackTitle);
  const description = resource.description?.trim() || fallbackDescription;
  return [
    { title },
    ...buildResourceSocialMeta({
      title,
      description,
      origin: loaderData.origin,
      basePath: loaderData.basePath,
    }),
  ];
}
