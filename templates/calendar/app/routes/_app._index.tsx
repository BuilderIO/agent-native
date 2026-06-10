import CalendarView from "@/pages/CalendarView";

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

export default function IndexRoute() {
  return <CalendarView />;
}
