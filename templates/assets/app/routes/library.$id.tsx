import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useParams } from "react-router";

import { getDb, schema } from "../../server/db";
import { messagesByLocale } from "../i18n-data";
import { LibraryWorkspace } from "./library";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  const [library] = id
    ? await getDb()
        .select({
          title: schema.assetLibraries.title,
          description: schema.assetLibraries.description,
        })
        .from(schema.assetLibraries)
        .where(
          and(
            eq(schema.assetLibraries.id, id),
            eq(schema.assetLibraries.visibility, "public"),
            isNull(schema.assetLibraries.archivedAt),
          ),
        )
        .limit(1)
    : [];

  return {
    library: library ?? null,
    origin: new URL(request.url).origin,
    basePath: getConfiguredAppBasePath(),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const library = loaderData?.library;
  if (!library)
    return [{ title: messagesByLocale["en-US"].routeTitles.library }];

  const title = normalizeDocumentTitle(
    library.title,
    messagesByLocale["en-US"].routeTitles.library,
  );
  return [
    { title },
    ...buildResourceSocialMeta({
      title,
      description:
        library.description?.trim() ||
        "Explore this shared asset library in Agent-Native Assets.",
      origin: loaderData.origin,
      basePath: loaderData.basePath,
    }),
  ];
};

export default function LibraryDetailPage() {
  const { id } = useParams();
  return <LibraryWorkspace selectedLibraryId={id ?? null} />;
}
