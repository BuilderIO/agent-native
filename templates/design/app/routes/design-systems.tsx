import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";

import { getDb, schema } from "../../server/db";
import { publicDesignMetaLoaderData } from "../../server/lib/public-design-meta.server";
import { designResourceMeta } from "./public-design-meta";

export { default } from "../pages/DesignSystems";

export async function loader({ request }: LoaderFunctionArgs) {
  const id = new URL(request.url).searchParams.get("designSystemId");
  const [resource] = id
    ? await getDb()
        .select({
          title: schema.designSystems.title,
          description: schema.designSystems.description,
        })
        .from(schema.designSystems)
        .where(
          and(
            eq(schema.designSystems.id, id),
            eq(schema.designSystems.visibility, "public"),
          ),
        )
        .limit(1)
    : [];

  return publicDesignMetaLoaderData({
    resource: resource ?? null,
    origin: new URL(request.url).origin,
    basePath: getConfiguredAppBasePath(),
  });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  designResourceMeta(
    loaderData,
    enUSMessages.routeTitles.designSystems,
    "A reusable visual system for Agent-Native Design projects.",
  );
