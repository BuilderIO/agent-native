import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";
import AnalysisDetail from "@/pages/analyses/AnalysisDetail";

import { getPublicAnalysisMetadata } from "../../server/lib/dashboards-store";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const metadata = params.id
    ? await getPublicAnalysisMetadata(params.id)
    : null;

  return {
    preview: metadata
      ? {
          title: metadata.name,
          description:
            metadata.description.trim() ||
            metadata.question.trim() ||
            "Analytics analysis.",
        }
      : null,
    origin: new URL(request.url).origin,
    basePath: getConfiguredAppBasePath(),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData?.preview) {
    return [{ title: enUSMessages.routeTitles.analysis }];
  }
  const title = normalizeDocumentTitle(
    loaderData.preview.title,
    enUSMessages.routeTitles.analysis,
  );
  return [
    { title },
    ...buildResourceSocialMeta({
      title,
      description: loaderData.preview.description,
      origin: loaderData.origin,
      basePath: loaderData.basePath,
    }),
  ];
};

export default function AnalysisDetailRoute() {
  return <AnalysisDetail />;
}
