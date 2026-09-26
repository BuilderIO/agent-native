import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
  type SocialMetaDescriptor,
} from "@agent-native/core/shared";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../../server/db";

export interface PublicDesignMetaData {
  resource: { title: string; description: string | null } | null;
  origin: string;
  basePath: string;
}

export async function loadPublicDesignMeta(
  id: string | undefined,
  requestUrl: string,
): Promise<PublicDesignMetaData> {
  const [resource] = id
    ? await getDb()
        .select({
          title: schema.designs.title,
          description: schema.designs.description,
        })
        .from(schema.designs)
        .where(
          and(
            eq(schema.designs.id, id),
            eq(schema.designs.visibility, "public"),
          ),
        )
        .limit(1)
    : [];

  return {
    resource: resource ?? null,
    origin: new URL(requestUrl).origin,
    basePath: getConfiguredAppBasePath(),
  };
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
