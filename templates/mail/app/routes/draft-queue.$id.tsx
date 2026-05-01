import { DraftQueuePage } from "@/pages/DraftQueuePage";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Draft Queue — Mail" }];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

export default function DraftQueueDetailRoute() {
  return <DraftQueuePage />;
}
