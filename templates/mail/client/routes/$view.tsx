import { InboxPage } from "@/pages/InboxPage";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Mail" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner />
    </div>
  );
}

export default function ViewRoute() {
  return <InboxPage />;
}
