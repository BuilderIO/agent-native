import { TaskListPage } from "@/components/tasks/TaskListPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `Tasks · ${APP_TITLE}` },
    {
      name: "description",
      content:
        "Manage tasks, reorder by drag-and-drop, and ask chat to add or update reminders.",
    },
  ];
}

export default function TasksRoute() {
  return <TaskListPage />;
}
