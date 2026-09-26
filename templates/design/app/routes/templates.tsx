import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";

import { getDb, schema } from "../../server/db";
import { designResourceMeta } from "./public-design-meta";

export { default } from "../pages/Templates";

export async function loader({ request }: LoaderFunctionArgs) {
  const id = new URL(request.url).searchParams.get("templateId");
  const [resource] = id
    ? await getDb()
        .select({
          title: schema.designTemplates.title,
          description: schema.designTemplates.description,
        })
        .from(schema.designTemplates)
        .where(
          and(
            eq(schema.designTemplates.id, id),
            eq(schema.designTemplates.visibility, "public"),
          ),
        )
        .limit(1)
    : [];

  return {
    resource: resource ?? null,
    origin: new URL(request.url).origin,
    basePath: getConfiguredAppBasePath(),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  designResourceMeta(
    loaderData,
    enUSMessages.routeTitles.designTemplates,
    "A reusable starting point for a new Agent-Native Design project.",
  );
