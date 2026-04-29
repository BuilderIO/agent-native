import AdhocRouter from "@/pages/adhoc/AdhocRouter";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Dashboard — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function AdhocRoute() {
  return <AdhocRouter />;
}
