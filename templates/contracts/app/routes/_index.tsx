import { Spinner } from "@/components/ui/spinner";
import { ContractsPage } from "@/pages/ContractsPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Review coding-agent assumptions, feedback, and verified evidence before work is called done.",
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
