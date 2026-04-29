import CalendarView from "@/pages/CalendarView";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Calendar" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function IndexRoute() {
  return <CalendarView />;
}
