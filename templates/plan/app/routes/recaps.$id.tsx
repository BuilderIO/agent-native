import { DefaultSpinner } from "@agent-native/core/client/ui";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { buildResourceSocialMeta } from "@agent-native/core/shared";

import { APP_TITLE } from "@/lib/app-config";
import { planDocumentTitle } from "@/lib/plan-document-title";
import { PlansPage } from "@/pages/PlansPage";

import { fetchPublicPlanMeta } from "../../server/lib/plan-meta.server";
import { buildPlanMetaDescription } from "../../shared/plan-meta-format";
import type { Route } from ".react-router/types/app/routes/+types/recaps.$id";

export async function loader({ params, request }: Route.LoaderArgs) {
  const id = params.id;
  const origin = new URL(request.url).origin;
  const basePath = getConfiguredAppBasePath();
  if (!id) return { planMeta: null, origin, basePath };
  const planMeta = await fetchPublicPlanMeta(id);
  return { planMeta, origin, basePath };
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const planMeta = loaderData?.planMeta;
  if (!planMeta) {
    return [
      { title: APP_TITLE },
      {
        name: "description",
        content:
          "Review a code change as a high-altitude visual recap with diagrams, wireframes, and before/after comparisons.",
      },
    ];
  }
  const title = planDocumentTitle(planMeta.title, APP_TITLE);
  const description = buildPlanMetaDescription(planMeta.brief);
  return [
    { title },
    ...buildResourceSocialMeta({
      title,
      description,
      origin: loaderData.origin,
      basePath: loaderData.basePath,
    }),
  ];
};

export function HydrateFallback() {
  return <DefaultSpinner />;
}

export default function RecapRoute() {
  return <PlansPage />;
}
