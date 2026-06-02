import { Spinner } from "@/components/ui/spinner";
import { ContractsPage } from "@/pages/ContractsPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${APP_TITLE} Review` },
    {
      name: "description",
      content:
        "Review coding-agent assumptions, feedback, and verified evidence before work is called done.",
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

export default function ContractRoute() {
  return <ContractsPage />;
}
