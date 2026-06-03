import { Spinner } from "@/components/ui/spinner";
import { PlansPage } from "@/pages/PlansPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Review coding-agent plans as interactive HTML documents with diagrams, wireframes, prototypes, and annotations.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function IndexPage() {
  return <PlansPage />;
}
