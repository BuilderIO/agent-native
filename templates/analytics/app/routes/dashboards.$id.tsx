import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  buildResourceSocialMeta,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import enUSMessages from "@/i18n/en-US";
import AdhocRouter from "@/pages/adhoc/AdhocRouter";

import { getDashboard } from "../../server/lib/dashboards-store";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const dashboard = params.id
    ? await getDashboard(params.id, { email: "", orgId: null })
    : null;
  const config = dashboard?.config ?? {};
  const panelTitles = Array.isArray(config.panels)
    ? config.panels
        .map((panel) =>
          panel && typeof panel === "object" && "title" in panel
            ? panel.title
            : undefined,
        )
        .filter(
          (title): title is string => typeof title === "string" && !!title,
        )
        .slice(0, 3)
    : [];

  return {
    preview:
      dashboard?.visibility === "public"
        ? {
            title: dashboard.title,
            description:
              (typeof config.description === "string" &&
                config.description.trim()) ||
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
