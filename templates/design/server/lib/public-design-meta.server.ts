import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { SSR_QUERY_CACHE_KEY_HEADER } from "@agent-native/core/shared";
import { and, eq } from "drizzle-orm";
import { data } from "react-router";

import type { PublicDesignMetaData } from "../../app/routes/public-design-meta";
import { getDb, schema } from "../db";

export function publicDesignMetaLoaderData(payload: PublicDesignMetaData) {
  return data(payload, {
    headers: { [SSR_QUERY_CACHE_KEY_HEADER]: "query" },
  });
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
