import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";
import AdhocRouter from "@/pages/adhoc/AdhocRouter";

import { getPublicDashboardMetadata } from "../../server/lib/dashboards-store";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const dashboard = params.id
    ? await getPublicDashboardMetadata(params.id)
    : null;
  const panelTitles = dashboard?.panelTitles ?? [];

  return {
    preview: dashboard
      ? {
          title: dashboard.title,
          description:
            dashboard.description?.trim() ||
            (panelTitles.length > 0
              ? `Analytics dashboard covering ${panelTitles.join(", ")}.`
              : "Analytics dashboard."),
        }
      : null,
    origin: new URL(request.url).origin,
    basePath: getConfiguredAppBasePath(),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData?.preview) {
    return [{ title: enUSMessages.routeTitles.dashboard }];
  }
  const title = normalizeDocumentTitle(
    loaderData.preview.title,
    enUSMessages.routeTitles.dashboard,
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

export default function DashboardRoute() {
  return <AdhocRouter />;
}
