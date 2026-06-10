import { Spinner } from "@/components/ui/spinner";
import { PlansPage } from "@/pages/PlansPage";
import { APP_TITLE } from "@/lib/app-config";
import type { Route } from ".react-router/types/app/routes/+types/plans.$id";
import { fetchPublicPlanMeta } from "../../server/lib/plan-meta.server";
import { buildPlanMetaDescription } from "../../shared/plan-meta-format";

export async function loader({ params }: Route.LoaderArgs) {
  const id = params.id;
  if (!id) return { planMeta: null };
  const planMeta = await fetchPublicPlanMeta(id);
  return { planMeta };
}

export const meta: Route.MetaFunction = ({ data }) => {
  const planMeta = data?.planMeta;
  if (!planMeta) {
    return [
      { title: APP_TITLE },
      {
        name: "description",
        content:
          "Review coding-agent plans as interactive HTML documents with diagrams, wireframes, prototypes, and annotations.",
      },
    ];
  }
  const title = `${planMeta.title} · ${APP_TITLE}`;
  const description = buildPlanMetaDescription(planMeta.brief);
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
  ];
};

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function PlanRoute() {
  return <PlansPage />;
}
