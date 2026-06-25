import { useParams } from "react-router";

import { Spinner } from "@/components/ui/spinner";
import { APP_TITLE } from "@/lib/app-config";
import { PlansPage } from "@/pages/PlansPage";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Review an Agent-Native Plan from local MDX files without Plan app database writes.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function LocalPlanRoute() {
  const params = useParams<{ slug?: string }>();
  return <PlansPage localPlanSlug={params.slug ?? ""} />;
}
