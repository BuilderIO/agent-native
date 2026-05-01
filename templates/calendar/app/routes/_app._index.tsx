import CalendarView from "@/pages/CalendarView";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Agent-Native Calendar" },
    {
      name: "description",
      content:
        "Your AI agent schedules, reschedules, and manages your calendar so you never have to.",
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

export default function IndexRoute() {
  return <CalendarView />;
}
