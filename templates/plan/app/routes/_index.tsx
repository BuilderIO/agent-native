import { Spinner } from "@/components/ui/spinner";
import { PlanChatPage } from "@/pages/PlanChatPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Ask product and code questions across merged PR visual recaps, visual plans, diagrams, wireframes, and API specs.",
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
  return <PlanChatPage />;
}
