import { Spinner } from "@/components/ui/spinner";
import { ContractsPage } from "@/pages/ContractsPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Review visual coding-agent plans with diagrams, wireframes, annotations, feedback, and proof gates.",
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
  return <ContractsPage />;
}
