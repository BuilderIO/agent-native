import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";
import AnalysisDetail from "@/pages/analyses/AnalysisDetail";

import { getAnalysis } from "../../server/lib/dashboards-store";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const analysis = params.id
    ? await getAnalysis(params.id, { email: "", orgId: null })
    : null;

  return {
    preview:
      analysis?.visibility === "public"
        ? {
            title: analysis.name,
            description:
              analysis.description.trim() ||
              analysis.question.trim() ||
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
